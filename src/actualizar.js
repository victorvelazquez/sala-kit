'use strict';

// sala actualizar (D27): brings a room to the installed kit. It migrates sala.json, rewrites only
// the managed block of its AGENTS.md and reviews the members again; it never sends an order.

const fs = require('node:fs');
const path = require('node:path');
const { validateConfig, ConfigError, SCHEMA } = require('./config');
const { readText, create, salaBlock, SALA_START, SALA_END } = require('./init');
const { revisar } = require('./revisar');
const { version } = require('../package.json');

// The migrations of the format: MIGRATIONS[n] takes a sala.json of schema n to schema n + 1.
const MIGRATIONS = {};

function parseVersion(v) {
  const match = typeof v === 'string' ? /^(\d+)\.(\d+)\.(\d+)$/.exec(v) : null;
  return match ? match.slice(1).map(Number) : null;
}

function isNewer(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  if (!x || !y) return false;
  const i = x.findIndex((n, k) => n !== y[k]);
  return i !== -1 && x[i] > y[i];
}

function migrate(raw) {
  if (Number.isInteger(raw.schema) && raw.schema > SCHEMA) {
    throw new ConfigError(`sala.json es de un formato más nuevo (schema ${raw.schema}) que el del kit instalado; actualizá el kit`);
  }
  // A version it cannot read could be a newer kit: it is never overwritten in silence.
  if (raw.kit !== undefined && !parseVersion(raw.kit)) {
    throw new ConfigError(`sala.json tiene un kit que no es una versión (${JSON.stringify(raw.kit).slice(0, 40)}); corregilo a mano, por ejemplo ${version}`);
  }
  if (isNewer(raw.kit, version)) throw new ConfigError(`sala.json es del kit ${raw.kit}, más nuevo que el instalado (${version}); actualizá el kit`);
  let next = raw;
  while (Number.isInteger(next.schema) && MIGRATIONS[next.schema]) next = MIGRATIONS[next.schema](next);
  // The version goes right after schema, as `sala init` writes it.
  const { schema, kit, ...rest } = next;
  next = { schema, kit: version, ...rest };
  const { errors } = validateConfig(next);
  if (errors.length) throw new ConfigError('sala.json no es válido; no se escribió nada', errors);
  return next;
}

function count(text, mark) {
  return text.split(mark).length - 1;
}

// The new AGENTS.md, or null when it has no block; the text outside the marks is kept byte for byte.
function rewriteBlock(agents) {
  const [starts, ends] = [count(agents, SALA_START), count(agents, SALA_END)];
  if (starts === 0 && ends === 0) return null;
  const start = agents.indexOf(SALA_START);
  const end = agents.indexOf(SALA_END);
  if (starts !== 1 || ends !== 1 || end < start) {
    throw new ConfigError('AGENTS.md tiene las marcas del bloque de la sala rotas; arreglalas a mano y volvé a correr sala actualizar');
  }
  return agents.slice(0, start) + salaBlock().replace(/\n$/, '') + agents.slice(end + SALA_END.length);
}

// The file is replaced with a rename; when that fails, the temporary file is removed.
function replace(file, text, failure) {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, file);
  } catch {
    fs.rmSync(temp, { force: true });
    throw new ConfigError(failure);
  }
}

async function actualizar(salaDir) {
  // Read and decide everything first, so a problem stops it before it writes anything.
  const salaText = readText(path.join(salaDir, 'sala.json'));
  if (salaText === null) throw new ConfigError(`no hay sala.json en ${salaDir}`);
  let raw;
  try {
    raw = JSON.parse(salaText);
  } catch (err) {
    throw new ConfigError('sala.json no es JSON válido', [err.message]);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError('sala.json debe ser un objeto');
  const next = migrate(raw);
  const agents = readText(path.join(salaDir, 'AGENTS.md'));
  const newAgents = agents === null ? null : rewriteBlock(agents);

  const report = {
    sala: next.name,
    kit: { from: typeof raw.kit === 'string' ? raw.kit : null, to: version },
    updated: [],
    created: [],
    skipped: [],
    warnings: [],
    members: [],
  };
  // AGENTS.md goes first: if it fails, nothing changed; if sala.json fails after it, a new run ends the job.
  if (agents === null) {
    report.warnings.push('no hay AGENTS.md: `sala init` lo crea con el bloque de la sala');
  } else if (newAgents === null) {
    report.warnings.push(
      'AGENTS.md no tiene las marcas del bloque de la sala: el bloque nuevo quedó en AGENTS.md.sugerido. ' +
        'Revisá si alguna regla choca con él y pasalo a mano, con sus marcas.',
    );
    create(salaDir, 'AGENTS.md.sugerido', salaBlock(), report);
  } else if (newAgents === agents) {
    report.skipped.push({ file: 'AGENTS.md', reason: 'el bloque de la sala ya está al día' });
  } else {
    replace(path.join(salaDir, 'AGENTS.md'), newAgents, 'no se pudo escribir AGENTS.md; no se cambió nada');
    report.updated.push('AGENTS.md');
  }
  // sala.json is written last, but it is reported first.
  if (JSON.stringify(next) === JSON.stringify(raw)) report.skipped.unshift({ file: 'sala.json', reason: 'ya está al día' });
  else {
    const done = [...report.updated, ...report.created];
    const failure = done.length
      ? `se escribió ${done.join(' y ')}, pero no se pudo escribir sala.json; corré sala actualizar de nuevo`
      : 'no se pudo escribir sala.json; no se cambió nada';
    replace(path.join(salaDir, 'sala.json'), `${JSON.stringify(next, null, 2)}\n`, failure);
    report.updated.unshift('sala.json');
  }

  const { config } = validateConfig(next);
  const review = await revisar(config, salaDir);
  report.members = review.members.map((m) => {
    const failing = m.requirements.filter((r) => r.ok !== true).map((r) => r.id);
    return { id: m.id, ok: m.ok, failing, order: m.ok ? null : `sala condiciones ${m.id}` };
  });
  return report;
}

function actualizarTexto(r) {
  const changed = r.updated.length || r.created.length;
  const kit = r.kit.from === r.kit.to ? `kit ${r.kit.to}` : `kit ${r.kit.from || 'sin versión'} → ${r.kit.to}`;
  const lines = [`Sala ${r.sala}: ${kit}${changed ? '' : ', ya al día'}`];
  for (const f of r.updated) lines.push(`  actualizado ${f}`);
  for (const f of r.created) lines.push(`  creado      ${f}`);
  for (const s of r.skipped) lines.push(`  salteado    ${s.file}: ${s.reason}`);
  for (const w of r.warnings) lines.push(`  aviso: ${w}`);
  if (r.members.length === 0) lines.push('  sin miembros para revisar');
  for (const m of r.members) {
    if (m.ok) lines.push(`  ${m.id}: cumple todos los requisitos`);
    else lines.push(`  ${m.id}: no cumple ${m.failing.join(', ')}; con tu OK: ${m.order}`);
  }
  return `${lines.join('\n')}\n`;
}

module.exports = { actualizar, actualizarTexto };
