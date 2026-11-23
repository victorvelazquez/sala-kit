'use strict';

// The queue of the sala (D45): every open task of every member, in the order the sala
// runs them, grouped in waves that can run in parallel. Computed on each request, never stored.

const { redact } = require('./run');

const MAX_TEXT = 100;
// A dependency on another member: its prefix, a dash and the row ID (CORE-E09).
const CROSS = /^([A-Z][A-Z0-9]*)-(\S+)$/;
// The task ID goes at the end of a pull request title, in parentheses.
const TITLE_ID = /\(([^()]+)\)\s*$/;

// Long cells are cut so the plan of a whole sala stays around 2 KB.
function short(text) {
  const clean = redact(text);
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1)}…` : clean;
}

// A row of the member, a prefixed row of another member (cross), informative, or unresolved.
function findDep(dep, own, byPrefix) {
  const row = own.read.rows.find((r) => r.id === dep);
  if (row) return { member: own, row };
  const match = CROSS.exec(dep);
  if (!match) return { informative: true };
  const target = byPrefix.get(match[1]);
  if (!target) return { unresolved: `dependencia sin resolver: ${dep}` };
  if (target.read.error) return { unresolved: `no se pudo leer el miembro ${target.id} de ${dep}` };
  const found = target.read.rows.find((r) => r.id === match[2] || r.id === dep);
  if (!found) return { unresolved: `dependencia sin resolver: ${dep}` };
  return { member: target, row: found, cross: true };
}

function inReview(row, m) {
  return (m.prs || []).some((pr) => {
    const id = TITLE_ID.exec(pr.title);
    return id && (id[1] === row.id || id[1] === `${m.prefix}-${row.id}`);
  });
}

// A task waits only on rows that are not Completada on the remote base. A member takes only
// its own rows: with lanes (D57), each row of the shared roadmap belongs to one of them.
function openTasks(m, byPrefix) {
  return (m.own || m.read.rows).filter((row) => row.estado !== 'Completada').map((row) => {
    const t = { m, row, deps: [], unresolved: [], status: null };
    if (row.estado !== 'Bloqueada') {
      if (inReview(row, m)) t.status = 'en revisión';
      else if (row.estado === 'En curso') t.status = 'en curso';
    }
    for (const dep of row.deps) {
      const f = findDep(dep, m, byPrefix);
      if (f.unresolved) t.unresolved.push(f.unresolved);
      else if (f.row && f.row.estado !== 'Completada') t.deps.push({ label: dep, row: f.row });
    }
    return t;
  });
}

function pinnedRanks(members, byPrefix, pinned, warnings) {
  const ranks = new Map();
  pinned.forEach((id, i) => {
    const target = byPrefix.get(CROSS.exec(id)[1]);
    if (!target || target.read.error) return;
    const row = target.read.rows.find((r) => r.id === id.slice(target.prefix.length + 1) || r.id === id);
    if (row) ranks.set(row, i);
    else warnings.push(`pinned: ${id} no está en el roadmap de ${target.id}`);
  });
  return ranks;
}

// The path back to start through tasks that never got a wave, or null.
function findCycle(start) {
  const seen = new Set();
  const walk = (t, path) => {
    for (const { task } of t.deps) {
      if (task.wave) continue;
      if (task === start) return [...path, start];
      if (seen.has(task)) continue;
      seen.add(task);
      const found = walk(task, [...path, task]);
      if (found) return found;
    }
    return null;
  };
  return walk(start, [start]);
}

function label(t, from) {
  return t.m === from ? t.row.id : `${t.m.prefix}-${t.row.id}`;
}

function waitReasons(t) {
  if (t.row.estado === 'Bloqueada') return [t.row.notas ? `Bloqueada: ${short(t.row.notas)}` : 'Bloqueada'];
  const reasons = [...t.unresolved];
  const cycle = findCycle(t);
  if (cycle) return [...reasons, `ciclo de dependencias: ${cycle.map((c) => label(c, t.m)).join(' → ')}`];
  for (const d of t.deps.filter((dep) => !dep.task.wave)) {
    reasons.push(d.row.estado === 'Bloqueada' ? `espera a ${d.label} (Bloqueada)` : `espera a ${d.label}, que no puede avanzar`);
  }
  return reasons;
}

// Each wave takes, per member, the first task whose deps are done or ran in an earlier wave.
// Order inside a member: in-flight tasks, then pinned ones in the list order, then row order.
function buildQueue(members, byPrefix, pinned) {
  const warnings = [];
  const ranks = pinnedRanks(members, byPrefix, pinned, warnings);
  const rank = (t) => (ranks.has(t.row) ? ranks.get(t.row) : pinned.length);
  const readable = members.filter((m) => !m.read.error);
  const tasks = new Map(readable.map((m) => [m, openTasks(m, byPrefix)]));
  const byRow = new Map([...tasks.values()].flat().map((t) => [t.row, t]));
  for (const t of byRow.values()) for (const d of t.deps) d.task = byRow.get(d.row);

  const lists = readable.map((m) => tasks.get(m)
    .filter((t) => t.row.estado !== 'Bloqueada')
    .map((t, i) => ({ t, key: [t.status ? 0 : 1, rank(t), i] }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2])
    .map(({ t }) => t));
  const waves = [];
  for (let wave = 1; ; wave += 1) {
    const ready = (t) => t.status || (t.unresolved.length === 0 && t.deps.every((d) => d.task.wave && d.task.wave < wave));
    const picked = [];
    for (const list of lists) {
      const i = list.findIndex(ready);
      if (i !== -1) picked.push(list.splice(i, 1)[0]);
    }
    if (picked.length === 0) break;
    for (const t of picked) t.wave = wave;
    waves.push(picked.sort((a, b) => rank(a) - rank(b)));
  }

  const waiting = [];
  for (const m of members) {
    if (m.read.error) {
      waiting.push({ member: m.id, reasons: [`no se pudo leer: ${m.read.error}`] });
      continue;
    }
    if (m.prsError) warnings.push(`${m.id}: no se pudieron leer los PR (${m.prsError}); lo que está en revisión sale como pendiente`);
    for (const t of tasks.get(m).filter((task) => !task.wave)) {
      waiting.push({ member: m.id, id: t.row.id, entrega: short(t.row.entrega), reasons: waitReasons(t) });
    }
  }
  const item = (t) => ({
    member: t.m.id,
    id: t.row.id,
    entrega: short(t.row.entrega),
    waitsFor: t.deps.map((d) => d.label),
    ...(t.status && { status: t.status }),
    ...(ranks.has(t.row) && { pinned: true }),
  });
  return { waves: waves.map((w) => w.map(item)), waiting, ...(warnings.length > 0 && { warnings }) };
}

function queueTexto(queue) {
  const lines = ['Cola'];
  const text = (t) => `${t.member} ${t.id}${t.status ? ` [${t.status}]` : ''}${t.pinned ? ' [fijada]' : ''}`
    + `${t.waitsFor.length ? ` (espera a ${t.waitsFor.join(', ')})` : ''}`;
  queue.waves.forEach((wave, i) => lines.push(`  ola ${i + 1}: ${wave.map(text).join(' · ')}`));
  for (const w of queue.waiting) lines.push(`  espera: ${w.member}${w.id ? ` ${w.id}` : ''}: ${w.reasons.join('; ')}`);
  for (const w of queue.warnings || []) lines.push(`  aviso: ${w}`);
  if (lines.length === 1) lines.push('  vacía');
  return lines;
}

module.exports = { short, findDep, buildQueue, queueTexto };
