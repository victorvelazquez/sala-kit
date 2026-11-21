'use strict';

// sala fusionar (D18, D19, D38, D40): one chain that checks a PR, merges it, takes the member
// back to its base, runs the gate and asks for the next task. It stops at the first step
// that fails, looks at .sala/PAUSA before each step and logs one line per step.
// The person's message naming the PR is the OK (D19): the sala never merges on its own.

const fs = require('node:fs');
const path = require('node:path');
const { run, redact, firstLine } = require('./run');
const { ghCommand } = require('./estado');
const { findMember, SalaError, readState } = require('./abrir');
const { reiniciar, ownTerminal } = require('./reiniciar');
const { enviar, esperar, guard, paused } = require('./enviar');
const { veredicto } = require('./veredicto');
const { plan, readRoadmap } = require('./plan');
const { mask } = require('./requisitos');

const OUTPUT_SCHEMA = 1;
const PR_NUMBER = /^[1-9][0-9]{0,8}$/;
const SHA = /^[0-9a-f]{40}$/;
// A task ID goes into an order: anything else in a roadmap cell is data, never an order.
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
// `Auto: no`, also in bold (`**Auto:** no`).
const AUTO_NO = /\bAuto:\**\s*no\b/i;
// The member commands of the kit (D21), never /flow-*.
const BASE_ORDER = '/miembro-base';
const NEXT_ORDER = '/miembro-tarea';
// The repo decides the method; squash first, like the sala's own repos.
const METHODS = [['squashMergeAllowed', 'squash'], ['rebaseMergeAllowed', 'rebase'], ['mergeCommitAllowed', 'merge']];

class StepError extends Error {}

function gh(member, args, timeout) {
  const [file, list] = ghCommand(args);
  return run(file, list, { cwd: member.path, timeout });
}

function ghJson(res, what) {
  if (res.code !== 0) throw new StepError(`no se pudo leer ${what}: ${firstLine(res.stderr)}`);
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new StepError(`no se pudo leer ${what}: la salida de gh no es JSON`);
  }
}

// A merge fails closed: only known green results pass, unlike the summary of sala estado.
const CI_GREEN = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const CI_RED = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const CI_RUNNING = new Set(['', 'PENDING', 'EXPECTED', 'IN_PROGRESS', 'QUEUED', 'WAITING', 'REQUESTED']);

function ciBlock(rollup) {
  if (rollup == null || (Array.isArray(rollup) && rollup.length === 0)) return null;
  if (!Array.isArray(rollup)) return 'gh no dio el CI';
  const results = rollup.map((c) => String((c && (c.conclusion || c.state)) || '').toUpperCase());
  if (results.some((r) => CI_RED.has(r))) return 'CI en rojo';
  if (results.some((r) => CI_RUNNING.has(r))) return 'CI todavía corriendo';
  const odd = results.find((r) => !CI_GREEN.has(r));
  return odd ? `CI con un resultado que no es verde (${redact(odd).slice(0, 40)})` : null;
}

// Step 1: the PR is open, goes to the base, has green CI and GitHub can merge it.
async function checkPr(ctx) {
  const { member, n } = ctx;
  const fields = 'number,title,state,isDraft,mergeable,baseRefName,headRefOid,statusCheckRollup';
  const pr = ghJson(await gh(member, ['pr', 'view', String(n), '--json', fields]), `el PR #${n}`);
  if (!pr || typeof pr !== 'object') throw new StepError(`gh no devolvió el PR #${n}`);
  if (pr.number !== n) throw new StepError(`gh devolvió otro PR (#${redact(pr.number)}), no el #${n}`);
  const no = (why) => new StepError(`PR #${n}: ${why}`);
  if (pr.state !== 'OPEN') throw no(`está ${redact(pr.state)}, no abierto`);
  if (pr.isDraft) throw no('es un borrador');
  if (pr.baseRefName !== member.base) throw no(`va a ${redact(pr.baseRefName)}, no a la base ${member.base}`);
  const ci = ciBlock(pr.statusCheckRollup);
  if (ci) throw no(ci);
  if (pr.mergeable === 'CONFLICTING') throw no(`tiene conflictos con ${member.base}`);
  if (pr.mergeable !== 'MERGEABLE') throw no('GitHub todavía no sabe si se puede fusionar; probá de nuevo en un rato');
  if (!SHA.test(String(pr.headRefOid))) throw no('gh no dio el commit de la cabeza');
  ctx.head = pr.headRefOid;
  const ciText = Array.isArray(pr.statusCheckRollup) && pr.statusCheckRollup.length ? 'CI en verde' : 'sin CI';
  return `PR #${n} «${redact(pr.title)}»: abierto, a ${member.base}, ${ciText} y fusionable`;
}

// Step 2: after the merge the sala must be able to send orders, so it checks the session first.
async function checkSession(ctx) {
  const found = guard(ctx.config, ctx.salaDir, ctx.member.id, BASE_ORDER);
  return `la sesión ${found.session.id} puede recibir órdenes`;
}

// Step 3: the method the repo allows, and only the head commit that was checked.
async function merge(ctx) {
  const { member, n } = ctx;
  const repo = ghJson(await gh(member, ['repo', 'view', '--json', METHODS.map(([key]) => key).join(',')]), 'los métodos de fusión del repo');
  const method = METHODS.find(([key]) => repo[key] === true);
  if (!method) throw new StepError('el repo no permite ningún método de fusión');
  const res = await gh(member, ['pr', 'merge', String(n), `--${method[1]}`, '--match-head-commit', ctx.head], 120000);
  if (res.code !== 0) throw new StepError(`gh no fusionó: ${firstLine(res.stderr)}`);
  // With a merge queue gh may end well while the PR is still open: the chain goes on only on MERGED.
  let after;
  try {
    after = ghJson(await gh(member, ['pr', 'view', String(n), '--json', 'state']), `el estado del PR #${n}`);
  } catch (err) {
    throw new StepError(`gh dijo que fusionó el PR #${n}, pero ${err.message}; la cadena no sigue`);
  }
  const state = after && typeof after === 'object' ? after.state : null;
  if (state !== 'MERGED') {
    throw new StepError(`gh terminó, pero el PR #${n} figura ${redact(state)}, no fusionado (¿una cola de fusión?); la cadena no sigue`);
  }
  return `fusionado con ${method[1]}`;
}

// Step 4: the member's own session goes back to its base.
async function backToBase(ctx) {
  const { config, salaDir, member } = ctx;
  const sent = await enviar(config, salaDir, member.id, BASE_ORDER);
  const done = await esperar(config, member.id);
  if (done.state === 'needs-you') {
    throw new StepError(`${member.id} te necesita${done.question ? `: «${done.question}»` : ''}; contestale y corré la puerta`);
  }
  return `${BASE_ORDER} mandado; la sesión ${sent.session} terminó`;
}

// Step 5: the gate, with the verdict of going back to the base.
async function gate(ctx) {
  const { member } = ctx;
  const result = await veredicto(ctx.config, member.id, 'base');
  if (!result.ok) throw new StepError(`la puerta no da LISTO: ${result.checks.filter((c) => !c.ok).map((c) => c.detail).join('; ')}`);
  return `${member.base} limpia, sin stash e igual a ${member.remote}/${member.base}`;
}

// The next ready task of the sala's plan, unless its row says `Auto: no`:
// { order }, { skip } with why none is asked for, or { error }.
async function pickNext(ctx) {
  const { config, member } = ctx;
  const mine = (await plan(config)).members.find((m) => m.id === member.id);
  if (mine.error) return { error: `no se pudo leer el plan: ${mine.error}` };
  if (!mine.next) return { skip: 'no hay una tarea siguiente lista' };
  if (!TASK_ID.test(mine.next.id)) return { error: 'la tarea siguiente no tiene un ID válido; no se pide' };
  const read = await readRoadmap(member);
  const row = read.rows ? read.rows.find((r) => r.id === mine.next.id) : null;
  if (!row) return { error: `no se pudo releer la fila ${mine.next.id}` };
  if (AUTO_NO.test(row.notas)) return { skip: `la tarea siguiente ${row.id} dice Auto: no; no se pide sola` };
  return { order: `${NEXT_ORDER} ${row.id}` };
}

// Step 6 (D29): the next task starts in a clean session, when the sala opened the terminal.
// A terminal of the person is never closed; a restart that is refused stops the chain.
async function restart(ctx) {
  const { config, salaDir, member } = ctx;
  ctx.next = await pickNext(ctx);
  if (!ctx.next.order) return 'no hay una tarea para pedir: no se reinicia';
  if (!ownTerminal(readState(salaDir).members[member.id])) return `${member.id} no tiene una terminal de Orca que abrió la sala: sigue la misma sesión`;
  const r = await reiniciar(config, salaDir, member.id);
  return `cerrada la terminal ${r.closed}; sesión nueva ${r.session} en ${r.handle}`;
}

// Step 7: asks for the next task.
async function nextTask(ctx) {
  const { config, salaDir, member, next } = ctx;
  if (next.error) throw new StepError(next.error);
  if (!next.order) return next.skip;
  await enviar(config, salaDir, member.id, next.order);
  return `pedida la tarea siguiente: ${next.order}`;
}

const STEPS = [
  ['pr', checkPr], ['session', checkSession], ['merge', merge], ['base', backToBase], ['gate', gate], ['restart', restart], ['next', nextTask],
];

// A step that cannot be logged ends the chain, so the merge never runs after an unlogged step.
function logStep(salaDir, entry) {
  try {
    const file = path.join(salaDir, '.sala', 'fusiones.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch (err) {
    throw new SalaError(`no se pudo anotar el paso ${entry.step} en .sala/fusiones.log (${err.code || 'error'}); la cadena no sigue`);
  }
}

async function fusionar(config, salaDir, id, number) {
  const member = findMember(config, id);
  if (!PR_NUMBER.test(String(number))) throw new SalaError('el número del PR tiene que ser un entero positivo');
  const n = Number(number);
  const timeoutMs = Number(process.env.SALA_MERGE_TIMEOUT_MS) || 45 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  const ctx = { config, salaDir, member, n, head: null, next: null };
  const steps = [];
  for (const [step, fn] of STEPS) {
    let ok = true;
    let detail;
    try {
      if (paused(salaDir)) throw new StepError('la sala está en pausa (.sala/PAUSA): la cadena no sigue');
      if (Date.now() > deadline) throw new StepError(`la cadena pasó su tope de ${timeoutMs / 1000} s; no sigue`);
      detail = await fn(ctx);
    } catch (err) {
      if (!(err instanceof StepError) && !(err instanceof SalaError)) throw err;
      ok = false;
      detail = err.message;
    }
    detail = mask(redact(detail));
    steps.push({ id: step, ok, detail });
    try {
      logStep(salaDir, { member: member.id, pr: n, step, ok, detail });
    } catch (err) {
      if (step === 'merge' && ok) throw new SalaError(`el PR #${n} ya se fusionó, pero ${err.message}`);
      throw err;
    }
    if (!ok) break;
  }
  const failed = steps.find((s) => !s.ok);
  return { schema: OUTPUT_SCHEMA, sala: config.name, member: member.id, pr: n, ok: !failed, stoppedAt: failed ? failed.id : null, steps };
}

function fusionarTexto(r) {
  const lines = [`Fusión del PR #${r.pr} de ${r.member}: ${r.ok ? 'OK' : `se detuvo en ${r.stoppedAt}`}`];
  for (const s of r.steps) lines.push(`  ${s.ok ? 'sí' : 'NO'}  ${s.id.padEnd(7)}  ${s.detail}`);
  return `${lines.join('\n')}\n`;
}

module.exports = { fusionar, fusionarTexto };
