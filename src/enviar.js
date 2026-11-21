'use strict';

// sala enviar and sala esperar (D13, D15): an order goes through the feed inbox
// with the kit's guards, and the sala sleeps until the member really ends.

const fs = require('node:fs');
const path = require('node:path');
const { readFeed, sendAction, feedRoots } = require('./feed');
const { findMember, SalaError } = require('./abrir');
const { SESSION_STATE } = require('./estado');
const { mask } = require('./requisitos');

const MAX_ORDER = 4000;
const MAX_MISSES = 10;
// New lines and tabs may go; any other control character makes the order unreadable.
const ORDER_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
// Git Bash rewrites `/flow-avance` into C:/Program Files/Git/flow-avance before node sees it.
const BASH_PATH = /^[A-Za-z]:[\\/](?:.*[\\/])?Git[\\/]/i;
// Bidi controls turn the order around on screen and in the log.
const BIDI = /[\u202a-\u202e\u2066-\u2069]/;

// D39: an order that cannot be read is refused.
function unreadable(text) {
  // Invisible format characters alone make an empty order.
  if (typeof text !== 'string' || text.replace(/[\p{Cf}\s]/gu, '') === '') return 'la orden no se puede leer: está vacía';
  if (text.length > MAX_ORDER) return `la orden no se puede leer: pasa de ${MAX_ORDER} caracteres`;
  if (ORDER_CONTROL.test(text)) return 'la orden no se puede leer: tiene caracteres de control';
  if (BIDI.test(text)) return 'la orden no se puede leer: tiene caracteres de control de dirección';
  if (BASH_PATH.test(text)) return 'la orden parece una ruta que armó Git Bash con un comando /…; corré sala con MSYS_NO_PATHCONV=1';
  return null;
}

// The member's only live session; the whole sala is read so a nested member keeps its own.
function onlySession(config, member) {
  const feed = readFeed(feedRoots(), config.members);
  const sessions = feed.sessions[member.id];
  if (sessions.length === 0) throw new SalaError(`${member.id}: no tiene una sesión viva; corré sala abrir ${member.id}`);
  if (sessions.length > 1) {
    throw new SalaError(`${member.id}: tiene ${sessions.length} sesiones vivas (${sessions.map((s) => s.id).join(', ')}); dejá una sola`);
  }
  return { session: sessions[0], target: feed.targets[member.id][0] };
}

// One JSON line per order, with any secret masked: the log never keeps one.
// Returns false when the line could not be written.
function logOrder(salaDir, entry) {
  const text = mask(String(entry.text)).slice(0, MAX_ORDER);
  try {
    const file = path.join(salaDir, '.sala', 'ordenes.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry, member: mask(String(entry.member)), text })}\n`);
    return true;
  } catch {
    return false;
  }
}

function paused(salaDir) {
  return fs.existsSync(path.join(salaDir, '.sala', 'PAUSA'));
}

// The kit's guards (D13); every refusal is logged.
function guard(config, salaDir, id, text) {
  let found = null;
  try {
    const member = findMember(config, id);
    const reason = unreadable(text);
    if (reason) throw new SalaError(reason);
    if (paused(salaDir)) throw new SalaError('la sala está en pausa (.sala/PAUSA): no manda órdenes');
    found = onlySession(config, member);
    const s = found.session;
    if (s.question) throw new SalaError(`${id}: la sesión ${s.id} tiene una pregunta abierta («${s.question.text}»); contestala antes de mandar otra orden`);
    if (s.state === 'needs-you') throw new SalaError(`${id}: la sesión ${s.id} está bloqueada; mirala antes de mandar otra orden`);
    return found;
  } catch (err) {
    logOrder(salaDir, { member: id, session: found ? found.session.id : null, text, result: 'refused' });
    throw err;
  }
}

async function enviar(config, salaDir, id, text) {
  const found = guard(config, salaDir, id, text);
  if (!logOrder(salaDir, { member: id, session: found.session.id, text, result: 'sending' })) {
    throw new SalaError(`${id}: no se pudo anotar la orden en .sala/ordenes.log; no se mandó`);
  }
  const timeoutMs = Number(process.env.SALA_SEND_TIMEOUT_MS) || 10000;
  const res = await sendAction(found.target, 'send_prompt', { text }, { timeoutMs });
  logOrder(salaDir, { member: id, session: found.session.id, text, result: res.ok ? 'sent' : res.error.code });
  if (!res.ok) throw new SalaError(`${id}: la sesión no aceptó la orden: ${res.error.message} (${res.error.code})`);
  return { member: id, session: found.session.id, sent: true };
}

function enviarTexto(r) {
  return `${r.member}: orden entregada a la sesión ${r.session}\n`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ends when the session is idle for a while (a fresh order may not have started yet),
// or at once when it needs the person. `waiting` (agents or jobs left) never ends it.
async function esperar(config, id) {
  const member = findMember(config, id);
  const { session: first, target } = onlySession(config, member);
  const snapshotFile = path.join(target.agentDir, 'desktop', 'sessions', `${target.name}.json`);
  const env = (name, fallback) => Number(process.env[name]) || fallback;
  const pollMs = env('SALA_WAIT_POLL_MS', 500);
  const settleMs = env('SALA_WAIT_SETTLE_MS', 3000);
  const timeoutMs = env('SALA_WAIT_TIMEOUT_MS', 30 * 60 * 1000);
  const deadline = Date.now() + timeoutMs;
  let idleSince = null;
  let misses = 0;
  for (;;) {
    const s = readFeed(feedRoots(), config.members).sessions[id].find((x) => x.id === first.id);
    // A snapshot caught half-written drops out of one read: the session is closed only when
    // its file is gone, or when it keeps missing (its process ended).
    misses = s ? 0 : misses + 1;
    if (!s && (!fs.existsSync(snapshotFile) || misses >= MAX_MISSES)) {
      throw new SalaError(`${id}: la sesión ${first.id} se cerró antes de terminar`);
    }
    if (!s) {
      await sleep(pollMs);
      continue;
    }
    const result = { member: id, session: s.id, state: s.state, label: s.label };
    if (s.state === 'needs-you') return { ...result, question: s.question ? s.question.text : null };
    idleSince = s.state === 'idle' ? idleSince || Date.now() : null;
    if (idleSince && Date.now() - idleSince >= settleMs) return result;
    if (Date.now() >= deadline) throw new SalaError(`${id}: sigue trabajando después de ${timeoutMs / 1000} s`);
    await sleep(pollMs);
  }
}

function esperarTexto(r) {
  const ask = r.question ? `: «${r.question}»` : '';
  return r.state === 'needs-you'
    ? `${r.member}: te necesita (sesión ${r.session})${ask}\n`
    : `${r.member}: terminó (sesión ${r.session}, ${SESSION_STATE[r.state]})\n`;
}

module.exports = { enviar, enviarTexto, esperar, esperarTexto, logOrder };
