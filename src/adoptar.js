'use strict';

// sala adoptar, soltar, unirse and condiciones (D25, D26, D41): the room adds and drops
// members in sala.json and never writes in them; a member joins by itself, in its own task.

const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./run');
const { validateConfig, ConfigError } = require('./config');
const { findMember, SalaError } = require('./abrir');
const { reviewMember } = require('./revisar');
const { enviar } = require('./enviar');
const { oldBlocks, staleDetail, blockSala, SALA_NAME, MEMBER_START, MEMBER_END } = require('./requisitos');
const { template, readText, create } = require('./init');
const { upgradeAgents } = require('./bloques');
const { parseRoadmap } = require('./roadmap');

// A detail comes from the member's files: it is masked already, and cut so the order stays short.
const MAX_DETAIL = 300;

function realPath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function samePath(a, b) {
  const norm = (p) => (process.platform === 'win32' ? realPath(p).toLowerCase() : realPath(p));
  return norm(a) === norm(b);
}

function readRaw(salaDir) {
  return JSON.parse(fs.readFileSync(path.join(salaDir, 'sala.json'), 'utf8'));
}

// The whole file is validated before it is written, and replaced with a rename.
function writeRaw(salaDir, raw) {
  const { errors } = validateConfig(raw);
  if (errors.length) throw new ConfigError('el cambio dejaría sala.json inválido; no se escribió', errors);
  const file = path.join(salaDir, 'sala.json');
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(raw, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

async function deduceBase(git, remote) {
  const head = await git('symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`);
  const ref = head.stdout.trim();
  if (head.code !== 0 || !ref.startsWith(`${remote}/`)) {
    throw new ConfigError(`no se pudo deducir la base de ${remote}; usá --base <rama>`);
  }
  return ref.slice(remote.length + 1);
}

async function adoptar(config, salaDir, folder, flags = {}) {
  const dir = path.resolve(folder);
  if (!fs.existsSync(dir)) throw new ConfigError(`la carpeta no existe: ${dir}`);
  const real = realPath(dir);
  if (samePath(real, salaDir)) throw new ConfigError(`${real} es la carpeta de la sala`);
  if (fs.existsSync(path.join(real, 'sala.json'))) throw new ConfigError(`${real} es una sala, no un repositorio para adoptar`);
  const already = config.members.find((m) => samePath(m.path, real));
  if (already) throw new ConfigError(`ya es un miembro: ${already.id}`);
  const git = (...args) => run('git', args, { cwd: real });
  const top = await git('rev-parse', '--show-toplevel');
  if (top.code !== 0) throw new ConfigError(`${real} no es un repositorio de git`);
  if (!samePath(top.stdout.trim(), real)) throw new ConfigError(`${real} no es la raíz de su repositorio`);
  const remote = flags.remoto || 'origin';
  // Only the exit code of get-url is used: the URL itself may carry credentials.
  if ((await git('remote', 'get-url', '--', remote)).code !== 0) {
    throw new ConfigError(`el repositorio no tiene el remoto ${remote}; usá --remoto <nombre>`);
  }
  const base = flags.base || (await deduceBase(git, remote));
  const id = flags.id || slug(path.basename(real));
  if (!id) throw new ConfigError('no se pudo deducir el id; usá --id <id>');
  const prefix = flags.prefijo || id.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!flags.prefijo && !/^[A-Z]/.test(prefix)) throw new ConfigError('no se pudo deducir el prefijo; usá --prefijo <PREFIJO>');

  // The working tree is only read: to refuse a member of another sala (D56) and to warn.
  // The requirements read the remote base (sala revisar).
  const agents = readText(path.join(real, 'AGENTS.md'));
  const owner = blockSala(agents);
  if (owner && owner !== config.name) throw new ConfigError(`${path.basename(real)} ya es miembro de la sala ${owner}`);

  const member = { id, prefix, path: real, base, remote };
  const warnings = adoptWarnings(id, agents, owner);
  if (flags.probar) {
    const seen = await seenPrefixes(config);
    return { sala: config.name, dryRun: true, member, seen, suggested: suggest(member, seen), warnings };
  }
  const raw = readRaw(salaDir);
  writeRaw(salaDir, { ...raw, members: [...raw.members, member] });
  return { sala: config.name, member, warnings };
}

// The prefixes the other members' roadmaps name in their dependencies (`WEB-W13`) that no
// member has yet (SK30), read from each base as it is on this machine: no fetch.
async function seenPrefixes(config) {
  const taken = new Set(config.members.map((m) => m.prefix).filter(Boolean));
  const seen = new Map();
  await Promise.all(config.members.filter((m) => !m.lane).map(async (m) => {
    const show = await run('git', ['show', `refs/remotes/${m.remote}/${m.base}:docs/ROADMAP.md`], { cwd: m.path });
    if (show.code !== 0) return;
    const parsed = parseRoadmap(show.stdout);
    for (const r of parsed.rows || []) {
      for (const dep of r.deps) {
        const found = /^([A-Z][A-Z0-9]*)-\S+$/.exec(dep);
        if (!found || taken.has(found[1])) continue;
        if (!seen.has(found[1])) seen.set(found[1], new Set());
        seen.get(found[1]).add(m.id);
      }
    }
  }));
  return [...seen.keys()].sort().map((prefix) => ({ prefix, in: [...seen.get(prefix)].sort() }));
}

// A seen prefix that is a part of the deduced id (`upen-web` and `WEB`); none if it already matches.
function suggest(member, seen) {
  if (seen.some((s) => s.prefix === member.prefix)) return null;
  const parts = member.id.split('-');
  const match = seen.find((s) => parts.includes(s.prefix.toLowerCase()));
  return match ? { id: match.prefix.toLowerCase(), prefix: match.prefix } : null;
}

function adoptWarnings(id, agents, owner) {
  const warnings = [];
  if (owner === undefined) {
    warnings.push(`${id}: no tiene el bloque del miembro en AGENTS.md; \`sala condiciones ${id}\` le manda la orden de ponerse en condiciones`);
  } else if (owner === null) {
    warnings.push(`${id}: el bloque del miembro no nombra su sala; \`sala condiciones ${id}\` le manda la orden de ponerse al día`);
  }
  const stale = staleDetail(agents);
  if (stale) warnings.push(`${id}: ${stale}; \`sala condiciones ${id}\` le manda la orden de ponerse al día`);
  for (const w of oldBlocks(agents)) warnings.push(`${id}: ${w}`);
  return warnings;
}

function adoptarTexto(r) {
  const m = r.member;
  const what = r.dryRun ? `se adoptaría en la sala ${r.sala} (no se escribió nada)` : `adoptado en la sala ${r.sala}`;
  const lines = [`${m.id} ${what}: prefijo ${m.prefix}, base ${m.remote}/${m.base}, ${m.path}`];
  if (r.dryRun) {
    if (r.seen.length) lines.push(`  prefijos en los otros roadmaps: ${r.seen.map((s) => `${s.prefix} (${s.in.join(', ')})`).join(', ')}`);
    if (r.suggested) lines.push(`  propuesta: --id ${r.suggested.id} --prefijo ${r.suggested.prefix}`);
  }
  for (const w of r.warnings) lines.push(`  aviso: ${w}`);
  return `${lines.join('\n')}\n`;
}

// Takes the member out of sala.json, with its pinned tasks; its repository is never touched.
function soltar(config, salaDir, id) {
  const member = findMember(config, id);
  // A lane (D57) shares the prefix of its member: its pinned tasks stay with the member.
  const lanes = config.members.filter((m) => m.lane && m.lane.of === id).map((m) => m.id);
  if (lanes.length) throw new ConfigError(`${id} tiene carriles (${lanes.join(', ')}): soltalos primero`);
  const raw = readRaw(salaDir);
  const next = { ...raw, members: raw.members.filter((m) => m.id !== id) };
  const unpinned = member.lane ? [] : (raw.pinned || []).filter((t) => t.startsWith(`${member.prefix}-`));
  if (raw.pinned) next.pinned = raw.pinned.filter((t) => !unpinned.includes(t));
  writeRaw(salaDir, next);
  return { member: id, path: member.path, unpinned };
}

function soltarTexto(r) {
  const pins = r.unpinned.length ? `; se sacaron de pinned: ${r.unpinned.join(', ')}` : '';
  return `${r.member} ya no es miembro de la sala; su repositorio en ${r.path} quedó igual${pins}\n`;
}

// The block names its sala (D56); without a name, the line and the sentence that use it go.
function memberBlock(sala) {
  let body = template('bloque.md', 'miembro');
  body = sala ? body.replaceAll('{{SALA}}', sala) : body.split('\n').filter((l) => !l.includes('{{SALA}}')).join('\n');
  return `${MEMBER_START}\n${body}${MEMBER_END}\n`;
}

// Run inside the member, by its own session (D41, D52): the member block and the old blocks
// of the catalog are written only between their marks, and the member block goes at the end
// when it is missing. Outside the marks not a byte changes.
// `de` names the sala (D56); without it the block keeps the sala it already names.
function unirse(dir, de) {
  if (de !== undefined && !SALA_NAME.test(de)) {
    throw new ConfigError('--de necesita el nombre de la sala: letras, números, punto, guion o guion bajo, hasta 64, sin empezar con guion');
  }
  if (fs.existsSync(path.join(dir, 'sala.json'))) throw new ConfigError(`${dir} es una sala: unirse no la convierte en miembro`);
  const file = path.join(dir, 'AGENTS.md');
  const current = readText(file);
  const owner = blockSala(current);
  if (owner && de && owner !== de) {
    throw new ConfigError(`AGENTS.md ya tiene el bloque de la sala ${owner}: un repositorio es miembro de una sola sala (D56); para cambiarlo, la persona saca el bloque a mano`);
  }
  const sala = de || owner || null;
  const report = { dir, created: [], updated: [], skipped: [], warnings: [] };
  const unnamed = 'el bloque del miembro no nombra su sala: corré `sala unirse --de <sala>` con el name de su sala.json';
  if (current === null) {
    create(dir, 'AGENTS.md', `# Reglas para agentes\n\n${memberBlock(sala)}`, report);
    if (!sala) report.warnings.push(unnamed);
    return report;
  }
  const next = upgradeAgents(current, memberBlock(sala), [MEMBER_START, MEMBER_END]);
  if (next.broken) {
    const name = next.broken === 'miembro' ? 'del miembro' : next.broken;
    throw new ConfigError(`AGENTS.md tiene las marcas del bloque ${name} repetidas, sin cerrar o al revés; arreglalas a mano y volvé a correr sala unirse`);
  }
  report.warnings = sala ? next.warnings : [...next.warnings, unnamed];
  if (next.updated.length === 0) {
    report.skipped.push({ file: 'AGENTS.md', reason: 'ya tiene el bloque del miembro y los bloques al día' });
    return report;
  }
  // Written whole and renamed: a failure leaves the old file as it was.
  const tmp = `${file}.sala-${process.pid}-${Date.now().toString(36)}`;
  try {
    fs.writeFileSync(tmp, next.text, { flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw new ConfigError(`no se pudo escribir AGENTS.md: ${err.code || 'error'}`);
  }
  report.updated = next.updated;
  return report;
}

function unirseTexto(r) {
  const lines = [`Miembro en ${r.dir}`];
  for (const f of r.created) lines.push(`  creado      ${f}`);
  for (const b of r.updated) lines.push(`  al día     AGENTS.md: bloque ${b}`);
  for (const s of r.skipped) lines.push(`  salteado    ${s.file}: ${s.reason}`);
  for (const w of r.warnings) lines.push(`  aviso: ${w}`);
  return `${lines.join('\n')}\n`;
}

// The order to meet what fails, built from the catalog, sent with the guards of sala enviar.
async function condiciones(config, salaDir, id) {
  const member = findMember(config, id);
  const review = await reviewMember(member, config.name);
  const [base] = review.requirements;
  if (base.ok !== true) throw new SalaError(`${id}: primero corregí la base y el remoto en sala.json: ${base.detail}`);
  // D56: the block, read from the remote base, names another sala; only that sala sends it orders.
  const other = /^el bloque del miembro es de la sala (.+), no de /.exec(review.requirements.find((r) => r.id === 'member-block').detail);
  if (other) throw new SalaError(`${id} es miembro de la sala ${other[1]}: esta sala no le manda órdenes (D56)`);
  const failing = review.requirements.filter((r) => r.ok === false);
  if (failing.length === 0) return { member: id, failing: [], sent: false, session: null };
  const text = [
    'Ponete en condiciones para la sala: en una tarea propia, con su fila en docs/ROADMAP.md y su PR, cumplí estos requisitos de sala-kit.',
    ...failing.map((r) => `- ${r.id}: ${r.detail.slice(0, MAX_DETAIL)}. ${r.fix}`),
    'Si alguno pide una decisión, preguntale a la persona antes de hacerlo.',
  ].join('\n');
  const sent = await enviar(config, salaDir, id, text);
  // The member does the work in a task of its own and waits: the sala sends the delivery (SK30).
  return { member: id, failing: failing.map((r) => r.id), sent: true, session: sent.session, next: `/sala-entregar ${id}` };
}

function condicionesTexto(r) {
  if (!r.sent) return `${r.member}: cumple todos los requisitos; no hay orden que mandar\n`;
  return `${r.member}: orden de ponerse en condiciones entregada a la sesión ${r.session} (${r.failing.join(', ')})\n  cuando termine, el paso siguiente es ${r.next}\n`;
}

module.exports = { adoptar, adoptarTexto, soltar, soltarTexto, unirse, unirseTexto, condiciones, condicionesTexto };
