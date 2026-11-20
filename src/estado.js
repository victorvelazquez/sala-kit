'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { run, redact, firstLine } = require('./run');

const OUTPUT_SCHEMA = 1;

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function gitError(stderr) {
  const lines = String(stderr).split(/\r?\n/);
  return firstLine(lines.find((l) => /^(fatal|error):/.test(l)) || stderr).replace(/^(fatal|error):\s*/, '');
}

function countChanges(porcelain) {
  const changes = { staged: 0, unstaged: 0, untracked: 0 };
  for (const line of porcelain.split('\n')) {
    if (!line) continue;
    if (line.startsWith('??')) { changes.untracked += 1; continue; }
    if (line[0] !== ' ') changes.staged += 1;
    if (line[1] !== ' ') changes.unstaged += 1;
  }
  return changes;
}

function ciSummary(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none';
  const results = rollup.map((c) => String(c.conclusion || c.state || '').toUpperCase());
  if (results.some((r) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(r))) {
    return 'failing';
  }
  if (results.some((r) => r === '' || ['PENDING', 'EXPECTED', 'IN_PROGRESS', 'QUEUED'].includes(r))) return 'pending';
  return 'passing';
}

// SALA_GH swaps the gh binary; a .js path runs with node (used by the tests).
function ghCommand(args) {
  const gh = process.env.SALA_GH;
  if (!gh) return ['gh', args];
  return gh.endsWith('.js') ? [process.execPath, [gh, ...args]] : [gh, args];
}

async function openPrs(cwd) {
  const [file, args] = ghCommand([
    'pr', 'list', '--state', 'open', '--limit', '50',
    '--json', 'number,title,headRefName,isDraft,statusCheckRollup',
  ]);
  const res = await run(file, args, { cwd });
  if (res.code !== 0) return { prs: null, prsError: firstLine(res.stderr) };
  try {
    const prs = JSON.parse(res.stdout).map((pr) => ({
      number: pr.number,
      title: redact(pr.title || ''),
      branch: redact(pr.headRefName || ''),
      draft: Boolean(pr.isDraft),
      ci: ciSummary(pr.statusCheckRollup),
    }));
    return { prs };
  } catch {
    return { prs: null, prsError: 'la salida de gh no es JSON' };
  }
}

async function localState(cwd, base, remote) {
  const git = (...args) => run('git', args, { cwd });
  const [branch, status, stash, fetch] = await Promise.all([
    git('branch', '--show-current'),
    git('status', '--porcelain=v1'),
    git('stash', 'list'),
    git('fetch', '--quiet', '--no-tags', remote, base),
  ]);
  const counts = fetch.code === 0
    ? await git('rev-list', '--left-right', '--count', `refs/heads/${base}...refs/remotes/${remote}/${base}`)
    : null;
  return { branch, status, stash, fetch, counts };
}

function gateReasons(m, base, remote) {
  const reasons = [];
  if (m.branch !== base) {
    reasons.push(m.branch ? `está en la rama ${m.branch}, no en la base ${base}` : `HEAD suelto, no está en la base ${base}`);
  }
  if (!m.clean) {
    const c = m.changes;
    reasons.push(`árbol con cambios: ${c.staged} en el índice, ${c.unstaged} sin agregar, ${c.untracked} sin seguimiento`);
  }
  if (m.stash > 0) reasons.push(`hay ${m.stash} stash`);
  if (!m.fetch.ok) reasons.push(`no se pudo traer ${remote}/${base}: ${m.fetch.error}`);
  else if (m.ahead === null) reasons.push(`no se pudo comparar ${base} con ${remote}/${base}: ${m.compareError}`);
  else {
    if (m.ahead > 0) reasons.push(`${base} tiene ${plural(m.ahead, 'commit', 'commits')} sin subir a ${remote}/${base}`);
    if (m.behind > 0) reasons.push(`${base} está ${plural(m.behind, 'commit', 'commits')} detrás de ${remote}/${base}`);
  }
  return reasons;
}

async function memberStatus(member) {
  const { id, path: dir, base, remote } = member;
  const out = { id, path: dir, base, remote };
  if (!fs.existsSync(dir)) return { ...out, gate: { ready: false, reasons: [`la carpeta no existe: ${dir}`] } };
  const inside = await run('git', ['rev-parse', '--show-toplevel'], { cwd: dir });
  if (inside.code !== 0 || path.resolve(inside.stdout.trim()) !== path.resolve(dir)) {
    return { ...out, gate: { ready: false, reasons: ['no es la raíz de un repositorio git'] } };
  }

  const [s, pr] = await Promise.all([localState(dir, base, remote), openPrs(dir)]);
  const m = {
    ...out,
    branch: s.branch.stdout.trim() || null,
    changes: countChanges(s.status.stdout),
    stash: s.stash.stdout.split('\n').filter(Boolean).length,
    fetch: s.fetch.code === 0 ? { ok: true } : { ok: false, error: gitError(s.fetch.stderr) },
    ahead: null,
    behind: null,
  };
  m.clean = s.status.code === 0 && s.status.stdout.trim() === '';
  if (s.counts && s.counts.code === 0) {
    [m.ahead, m.behind] = s.counts.stdout.trim().split(/\s+/).map(Number);
  } else if (s.counts) {
    m.compareError = gitError(s.counts.stderr);
  }
  Object.assign(m, pr);
  const reasons = gateReasons(m, base, remote);
  m.gate = { ready: reasons.length === 0, reasons };
  return m;
}

async function estado(config) {
  const members = await Promise.all(config.members.map(memberStatus));
  return { schema: OUTPUT_SCHEMA, sala: config.name, members };
}

function estadoTexto(result) {
  const width = Math.max(...result.members.map((m) => m.id.length));
  const lines = [`Sala ${result.sala}`];
  for (const m of result.members) {
    const id = m.id.padEnd(width);
    if (m.gate.ready) lines.push(`${id}  LISTO     ${m.branch}`);
    else lines.push(`${id}  NO LISTO  ${m.branch ? `${m.branch}: ` : ''}${m.gate.reasons.join('; ')}`);
    for (const pr of m.prs || []) {
      lines.push(`${' '.repeat(width)}  PR #${pr.number} ${pr.title} [CI: ${pr.ci}${pr.draft ? ', borrador' : ''}]`);
    }
    if (m.prsError) lines.push(`${' '.repeat(width)}  PR: no se pudieron leer (${m.prsError})`);
  }
  return `${lines.join('\n')}\n`;
}

module.exports = { estado, estadoTexto };
