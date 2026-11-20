'use strict';

const fs = require('node:fs');
const { run, redact, gitError } = require('./run');
const { parseRoadmap } = require('./roadmap');

const OUTPUT_SCHEMA = 1;
const ROADMAP = 'docs/ROADMAP.md';
const MAX_TEXT = 100;
// A dependency on another member: its prefix, a dash and the row ID (CORE-E09).
const CROSS = /^([A-Z][A-Z0-9]*)-(\S+)$/;

// Long cells are cut so the plan of a whole sala stays around 2 KB.
function short(text) {
  const clean = redact(text);
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1)}…` : clean;
}

// The roadmap of the remote base after a fetch: what is merged, not the working tree.
async function readRoadmap(member) {
  const { path: dir, base, remote } = member;
  if (!fs.existsSync(dir)) return { error: `la carpeta no existe: ${dir}` };
  const git = (...args) => run('git', args, { cwd: dir });
  const fetch = await git('fetch', '--quiet', '--no-tags', remote, base);
  if (fetch.code !== 0) return { error: `no se pudo traer ${remote}/${base}: ${gitError(fetch.stderr)}` };
  const show = await git('show', `refs/remotes/${remote}/${base}:${ROADMAP}`);
  if (show.code !== 0) return { error: `no hay ${ROADMAP} en ${remote}/${base}` };
  return parseRoadmap(show.stdout);
}

// Each dependency is a row of the member, a prefixed row of another member, or informative.
function resolve(dep, own, byPrefix) {
  const row = own.rows.find((r) => r.id === dep);
  if (row) return { id: dep, estado: row.estado };
  const match = CROSS.exec(dep);
  if (!match) return { id: dep, informative: true };
  const target = byPrefix.get(match[1]);
  if (!target) return { id: dep, unresolved: `dependencia sin resolver: ${dep}` };
  if (target.read.error) return { id: dep, unresolved: `no se pudo leer el miembro ${target.id} de ${dep}` };
  const found = target.read.rows.find((r) => r.id === match[2] || r.id === dep);
  if (!found) return { id: dep, unresolved: `dependencia sin resolver: ${dep}` };
  return { id: dep, member: target.id, estado: found.estado };
}

function waitReason(d) {
  if (d.unresolved) return d.unresolved;
  if (d.informative || d.estado === 'Completada') return null;
  return `espera a ${d.id} (${d.estado}${d.member ? `, en ${d.member}` : ''})`;
}

function planMember(m, byPrefix) {
  const { id, read } = m;
  if (read.error) return { id, error: read.error };
  const out = {
    id,
    done: read.rows.filter((r) => r.estado === 'Completada').length,
    total: read.rows.length,
    inProgress: [],
    next: null,
    blocked: [],
  };
  for (const row of read.rows) {
    const task = { id: row.id, entrega: short(row.entrega) };
    if (row.estado === 'En curso') out.inProgress.push(task);
    else if (row.estado === 'Bloqueada') {
      out.blocked.push({ ...task, reasons: [row.notas ? `Bloqueada: ${short(row.notas)}` : 'Bloqueada'] });
    } else if (row.estado === 'Pendiente') {
      const deps = row.deps.map((d) => resolve(d, read, byPrefix));
      const reasons = deps.map(waitReason).filter(Boolean);
      if (reasons.length === 0 && !out.next) out.next = { ...task, deps };
      else if (reasons.length > 0 && !out.next) out.blocked.push({ ...task, reasons });
    }
  }
  return out;
}

async function plan(config) {
  const read = await Promise.all(config.members.map(readRoadmap));
  const members = config.members.map((m, i) => ({ id: m.id, prefix: m.prefix, read: read[i] }));
  const byPrefix = new Map(members.map((m) => [m.prefix, m]));
  return { schema: OUTPUT_SCHEMA, sala: config.name, members: members.map((m) => planMember(m, byPrefix)) };
}

function planTexto(result) {
  const lines = [`Sala ${result.sala}`];
  for (const m of result.members) {
    if (m.error) {
      lines.push(`${m.id}: no se pudo leer (${m.error})`);
      continue;
    }
    lines.push(`${m.id} (${m.done}/${m.total} completadas)`);
    for (const t of m.inProgress) lines.push(`  en curso:  ${t.id} ${t.entrega}`);
    if (m.next) lines.push(`  siguiente: ${m.next.id} ${m.next.entrega}`);
    for (const t of m.blocked) lines.push(`  espera:    ${t.id} ${t.entrega}: ${t.reasons.join('; ')}`);
  }
  return `${lines.join('\n')}\n`;
}

module.exports = { plan, planTexto };
