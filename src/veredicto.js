'use strict';

// The verdict after a command (D16): fixed checks per rule, defined here and not in a prompt.
// Read-only: it never changes the member.

const fs = require('node:fs');
const path = require('node:path');
const { run, redact, gitError } = require('./run');
const { readTaskOrder, namedRows } = require('./enviar');
const { parseRoadmap } = require('./roadmap');
const { openPrs } = require('./estado');
const { findMember, SalaError } = require('./abrir');
const { depsCheck } = require('./dependencias');

const OUTPUT_SCHEMA = 1;
const ROADMAP = 'docs/ROADMAP.md';
const TITLE_ID = /\(([^()]+)\)\s*$/;
// Git Bash rewrites `/miembro-base` into C:/Program Files/Git/miembro-base before node sees it.
const BASH_PATH = /^[A-Za-z]:[\\/](?:.*[\\/])?Git[\\/]([^\\/\s]+)/i;

// Control and bidi characters never reach an error message as they are.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

// The rule a command must leave true. The rule names work as commands too.
// The /flow-* bridge is gone (SK5g): the sala only sends /miembro-* (D26).
// No prototype: `constructor` or `toString` are not commands.
const RULES = Object.freeze(Object.assign(Object.create(null), {
  'miembro-entregar': 'entrega',
  'miembro-base': 'base',
  entrega: 'entrega',
  base: 'base',
}));

function check(id, ok, detail) {
  return { id, ok, detail };
}

// `/miembro-entregar`, `miembro-entregar`, `/miembro-entregar SK2d` and the Git Bash path name the same command.
// The verdict only reads, so reading the command back from that path is harmless.
function commandName(text) {
  const clean = String(text).trim();
  const bash = BASH_PATH.exec(clean);
  return bash ? bash[1] : clean.split(/\s+/)[0].replace(/^\//, '');
}

function accepted() {
  const names = Object.keys(RULES);
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

async function treeChecks(git) {
  const [status, stash] = await Promise.all([git('status', '--porcelain=v1'), git('stash', 'list')]);
  const clean = status.code === 0 && status.stdout.trim() === '';
  const stashes = stash.stdout.split('\n').filter(Boolean).length;
  return {
    clean: check('clean', clean, clean ? 'árbol limpio' : 'árbol con cambios'),
    stash: check('stash', stashes === 0, stashes === 0 ? 'sin stash' : `hay ${stashes} stash`),
  };
}

// HEAD against `<remote>/<ref>` after a fetch of that ref.
async function sameAsRemote(git, remote, ref) {
  const fetch = await git('fetch', '--quiet', '--no-tags', remote, ref);
  if (fetch.code !== 0) return { error: `no se pudo traer ${remote}/${ref}: ${gitError(fetch.stderr)}` };
  const [head, theirs] = await Promise.all([
    git('rev-parse', 'HEAD'),
    git('rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${ref}`),
  ]);
  return { same: head.code === 0 && theirs.code === 0 && head.stdout.trim() === theirs.stdout.trim() };
}

async function baseVerdict(member, git, branch) {
  const { base, remote } = member;
  const tree = await treeChecks(git);
  let onBase = check('branch', true, `en la base ${base}`);
  if (branch !== base) {
    onBase = check('branch', false, branch ? `está en la rama ${branch}, no en la base ${base}` : `HEAD suelto, no está en la base ${base}`);
  }
  const fetch = await git('fetch', '--quiet', '--no-tags', remote, base);
  let synced;
  if (fetch.code !== 0) synced = check('synced', false, `no se pudo traer ${remote}/${base}: ${gitError(fetch.stderr)}`);
  else {
    const counts = await git('rev-list', '--left-right', '--count', `refs/heads/${base}...refs/remotes/${remote}/${base}`);
    const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [null, null];
    if (ahead === null) synced = check('synced', false, `no se pudo comparar ${base} con ${remote}/${base}: ${gitError(counts.stderr)}`);
    else if (ahead || behind) synced = check('synced', false, `${base} tiene ${ahead} commits sin subir y está ${behind} detrás de ${remote}/${base}`);
    else synced = check('synced', true, `${base} igual a ${remote}/${base}`);
  }
  const deps = depsCheck(member.path);
  return { branch, checks: [onBase, tree.clean, tree.stash, synced, ...(deps ? [deps] : [])] };
}

// The row of the task named at the end of the PR title, in the roadmap of the delivered commit.
async function taskCheck(member, git, pr) {
  if (!pr) return { task: null, check: check('task', false, 'sin PR, no hay tarea que mirar') };
  const match = TITLE_ID.exec(pr.title);
  if (!match) {
    return { task: null, check: check('task', false, 'el título del PR no termina con el ID de la tarea entre paréntesis') };
  }
  const task = match[1].trim();
  const show = await git('show', `HEAD:${ROADMAP}`);
  const read = show.code === 0 ? parseRoadmap(show.stdout) : { error: `no hay ${ROADMAP} en el último commit` };
  if (read.error) return { task, check: check('task', false, read.error) };
  const row = read.rows.find((r) => r.id === task || `${member.prefix}-${r.id}` === task);
  if (!row) return { task, check: check('task', false, `la fila ${task} no está en ${ROADMAP}`) };
  const done = row.estado === 'Completada';
  return { task, check: check('task', done, done ? `la fila ${task} dice Completada` : `la fila ${task} dice ${redact(row.estado)}, no Completada`) };
}

// The task the sala asked this member for last: the last `/miembro-tarea <ID>` that sala enviar
// (or its host) delivered to it, read from .sala/ordenes.log. Null when there is none, or the last
// one named no row: then the sala does not know which task it asked for.
function orderedTask(salaDir, member) {
  let lines;
  try {
    lines = fs.readFileSync(path.join(salaDir, '.sala', 'ordenes.log'), 'utf8').split('\n');
  } catch {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    // An answer to a question carries its question; only orders count.
    if (!entry || entry.member !== member.id || entry.result !== 'sent' || entry.question || typeof entry.text !== 'string') continue;
    const match = readTaskOrder(entry.text);
    if (!match) continue;
    if (!match[1]) return null;
    return { shown: redact(match[1]).replace(UNSAFE, '?').slice(0, 64), rows: namedRows(match[1], member.prefix) };
  }
  return null;
}

// Why a delivery of `task` is not the task the sala asked for, or null when it is or nobody knows.
function orderMismatch(salaDir, member, task) {
  const ordered = orderedTask(salaDir, member);
  if (!ordered || !task) return null;
  const rows = namedRows(task, member.prefix);
  if (rows.length > 0 && rows.every((r) => ordered.rows.includes(r))) return null;
  return `es de ${redact(task).replace(UNSAFE, '?')}, pero la sala le pidió ${ordered.shown}`;
}

function orderCheck(salaDir, member, task) {
  if (!task) return check('order', true, 'sin tarea en el PR, no hay orden que comparar');
  const ordered = orderedTask(salaDir, member);
  if (!ordered) return check('order', true, `aviso: la sala no le anotó a ${member.id} una orden /miembro-tarea con ID; no se compara`);
  const why = orderMismatch(salaDir, member, task);
  return why ? check('order', false, `el PR ${why}`) : check('order', true, `la sala le pidió ${ordered.shown}`);
}

const CI = {
  passing: [true, 'CI en verde'],
  none: [true, 'sin comprobaciones de CI'],
  pending: [false, 'CI todavía corriendo'],
  failing: [false, 'CI en rojo'],
};

async function deliveryVerdict(member, git, branch, salaDir) {
  const { base, remote } = member;
  let onBranch = check('branch', true, `en la rama ${branch}`);
  if (!branch) onBranch = check('branch', false, 'HEAD suelto, no está en la rama de la entrega');
  else if (branch === base) onBranch = check('branch', false, `está en la base ${base}, no en la rama de la entrega`);
  const [tree, last, prs] = await Promise.all([treeChecks(git), git('log', '-1', '--format=%h%n%s'), openPrs(member.path)]);
  const [sha, subject] = last.code === 0 ? last.stdout.split('\n') : [null, null];
  const commit = sha ? { sha, subject: redact(subject || '') } : null;

  let pushed = check('pushed', false, 'no hay una rama de la entrega que comparar');
  if (onBranch.ok) {
    const cmp = await sameAsRemote(git, remote, branch);
    if (cmp.error) pushed = check('pushed', false, cmp.error);
    else pushed = check('pushed', cmp.same, `el último commit ${cmp.same ? 'está' : 'no está'} en ${remote}/${branch}`);
  }

  let pr = null;
  let prCheck;
  if (!prs.prs) prCheck = check('pr', false, `no se pudieron leer los PR: ${prs.prsError}`);
  else {
    const found = onBranch.ok ? prs.prs.find((p) => p.branch === branch) : undefined;
    if (found) {
      pr = { number: found.number, title: found.title, ci: found.ci };
      prCheck = check('pr', true, `PR #${found.number} abierto`);
    } else prCheck = check('pr', false, `no hay un PR abierto de la rama ${branch || '(ninguna)'}`);
  }
  const ci = pr ? check('ci', ...CI[pr.ci]) : check('ci', false, 'sin PR, no hay CI que mirar');
  const task = await taskCheck(member, git, pr);

  const order = orderCheck(salaDir, member, task.task);

  return { branch, commit, pr, task: task.task, checks: [onBranch, tree.clean, pushed, prCheck, ci, task.check, order] };
}

async function veredicto(config, memberId, text, salaDir) {
  const member = findMember(config, memberId);
  const command = commandName(text);
  const rule = RULES[command];
  if (!command) throw new SalaError(`falta el comando; acepta ${accepted()}`);
  if (!rule) throw new SalaError(`${redact(command).replace(UNSAFE, '?')} no tiene veredicto; acepta ${accepted()}`);
  if (!fs.existsSync(member.path)) throw new SalaError(`${member.id}: la carpeta no existe: ${member.path}`);
  const git = (...args) => run('git', args, { cwd: member.path });
  const branch = (await git('branch', '--show-current')).stdout.trim() || null;
  const result = rule === 'entrega' ? await deliveryVerdict(member, git, branch, salaDir) : await baseVerdict(member, git, branch);
  const { checks, ...facts } = result;
  return {
    schema: OUTPUT_SCHEMA,
    sala: config.name,
    member: member.id,
    command,
    rule,
    ok: checks.every((c) => c.ok),
    ...facts,
    checks,
  };
}

function veredictoTexto(result) {
  const width = Math.max(...result.checks.map((c) => c.id.length));
  const lines = [`Veredicto de ${result.member} después de ${result.command} (${result.rule}): ${result.ok ? 'OK' : 'FALLA'}`];
  for (const c of result.checks) lines.push(`  ${c.ok ? 'sí' : 'NO'}  ${c.id.padEnd(width)}  ${c.detail}`);
  return `${lines.join('\n')}\n`;
}

module.exports = { veredicto, veredictoTexto, orderMismatch, TITLE_ID, RULES };
