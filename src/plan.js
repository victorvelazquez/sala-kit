'use strict';

const fs = require('node:fs');
const { run, gitError } = require('./run');
const { parseRoadmap } = require('./roadmap');
const { openPrs } = require('./estado');
const { short, findDep, buildQueue, queueTexto } = require('./queue');

const OUTPUT_SCHEMA = 1;
const ROADMAP = 'docs/ROADMAP.md';

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
  const f = findDep(dep, own, byPrefix);
  if (f.unresolved) return { id: dep, unresolved: f.unresolved };
  if (f.informative) return { id: dep, informative: true };
  return f.cross ? { id: dep, member: f.member.id, estado: f.row.estado } : { id: dep, estado: f.row.estado };
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
      const deps = row.deps.map((d) => resolve(d, m, byPrefix));
      const reasons = deps.map(waitReason).filter(Boolean);
      if (reasons.length === 0 && !out.next) out.next = { ...task, deps };
      else if (reasons.length > 0 && !out.next) out.blocked.push({ ...task, reasons });
    }
  }
  return out;
}

// The open pull requests tell which tasks are in review; a missing folder has none to read.
async function readMember(member) {
  const exists = fs.existsSync(member.path);
  const [read, prs] = await Promise.all([readRoadmap(member), exists ? openPrs(member.path) : { prs: null }]);
  return { id: member.id, prefix: member.prefix, read, ...prs };
}

async function plan(config) {
  const members = await Promise.all(config.members.map(readMember));
  const byPrefix = new Map(members.map((m) => [m.prefix, m]));
  return {
    schema: OUTPUT_SCHEMA,
    sala: config.name,
    members: members.map((m) => planMember(m, byPrefix)),
    queue: buildQueue(members, byPrefix, config.pinned),
  };
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
  lines.push(...queueTexto(result.queue));
  return `${lines.join('\n')}\n`;
}

module.exports = { plan, planTexto };
