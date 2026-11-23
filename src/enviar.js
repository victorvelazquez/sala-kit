'use strict';

// sala enviar and sala esperar (D13, D15): an order goes through the feed inbox
// with the kit's guards, and the sala sleeps until the member really ends.

const fs = require('node:fs');
const path = require('node:path');
const { readFeed, sendAction, lastReply, MAX_REPLY, feedRoots } = require('./feed');
const { findMember, SalaError } = require('./abrir');
const { SESSION_STATE } = require('./estado');
const { mask } = require('./requisitos');
const { paused } = require('./pausa');
const { hostCall, pipePath } = require('./hospedar');

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

// `/miembro-tarea [ID] [modo]`, read loosely: case, format characters and spaces never hide it.
const TASK_ORDER = /^\/miembro-tarea(?:\s+(\S+))?(?:\s|$)/i;

// The rows an ID argument names: quotes and trailing punctuation go, a list splits, and the
// member prefix goes as many times as it is written (ERP-ERP-DM0), in any case.
function namedRows(arg, prefix) {
  const strip = (word) => {
    let row = word;
    const head = `${prefix.toLowerCase()}-`;
    while (row.toLowerCase().startsWith(head)) row = row.slice(head.length);
    return row.toLowerCase();
  };
  return arg.replace(/^["'«`]+|["'»`.:;!?]+$/g, '').split(/[,;]+/).filter(Boolean).map(strip);
}

// Lanes (D57): a task order goes only to the lane that owns its row. It needs only sala.json,
// so it runs before the host and the session: no lane gets a row of the other one.
function laneRefusal(config, id, text) {
  const member = config.members.find((m) => m.id === id);
  if (!member || typeof text !== 'string') return null;
  const main = member.lane ? member.lane.of : member.id;
  const lanes = config.members.filter((m) => m.lane && m.lane.of === main);
  if (lanes.length === 0) return null;
  const match = TASK_ORDER.exec(text.replace(/\p{Cf}/gu, '').trim());
  if (!match) return null;
  // Without an ID the member takes the first Pendiente row of the shared roadmap, of any lane.
  if (!match[1]) {
    return `${id}: ${member.lane ? 'es un carril' : 'tiene carriles'}: /miembro-tarea va con el ID de la fila, el que da sala plan`;
  }
  const ownerOf = (row) => lanes.find((m) => m.lane.rows.some((r) => r.toLowerCase() === row));
  for (const row of namedRows(match[1], member.prefix)) {
    const owner = ownerOf(row);
    if (member.lane && owner !== member) {
      return `${id}: ${match[1]} no es una fila de este carril (sus filas: ${member.lane.rows.join(', ')}); mandásela a ${owner ? owner.id : main}`;
    }
    if (!member.lane && owner) return `${id}: ${match[1]} es una fila del carril ${owner.id}; mandásela a ${owner.id}`;
  }
  return null;
}

async function enviar(config, salaDir, id, text) {
  const lane = laneRefusal(config, id, text);
  if (lane) {
    logOrder(salaDir, { member: id, session: null, text, result: 'refused' });
    throw new SalaError(lane);
  }
  // A hosted member gets the order through its host, which has the guards (D51).
  const known = config.members.some((m) => m.id === id);
  const hosted = known ? await hostCall(pipePath(config, salaDir, id), { action: 'prompt', text }) : null;
  if (hosted) {
    if (!hosted.ok) throw new SalaError(`${id}: ${hosted.error}`);
    return { member: id, session: 'rpc', sent: true };
  }
  const found = guard(config, salaDir, id, text);
  if (!logOrder(salaDir, { member: id, session: found.session.id, text, result: 'sending' })) {
    throw new SalaError(`${id}: no se pudo anotar la orden en .sala/ordenes.log; no se mandó`);
  }
  const timeoutMs = Number(process.env.SALA_SEND_TIMEOUT_MS) || 10000;
  const res = await sendAction(found.target, 'send_prompt', { text }, { timeoutMs });
  // What the session had when it took the order: sala esperar knows it started when this moves.
  const before = { cost: found.session.cost, context: found.session.context };
  logOrder(salaDir, { member: id, session: found.session.id, text, result: res.ok ? 'sent' : res.error.code, ...(res.ok && { before }) });
  if (!res.ok) throw new SalaError(`${id}: la sesión no aceptó la orden: ${res.error.message} (${res.error.code})`);
  return { member: id, session: found.session.id, sent: true };
}

function enviarTexto(r) {
  return `${r.member}: orden entregada a la sesión ${r.session}\n`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The last order sala enviar delivered to this session, with what the session had then.
function lastSent(salaDir, id, sessionId) {
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
    if (entry && entry.member === id && entry.session === sessionId && entry.result === 'sent') {
      const b = entry.before;
      // Without a cost or a context there is nothing to compare: the wait goes as before SK29.
      const num = (v) => typeof v === 'number' && Number.isFinite(v);
      return b && typeof b === 'object' && (num(b.cost) || num(b.context)) ? b : null;
    }
  }
  return null;
}

// Ends when the session is idle for a while, or at once when it needs the person. `waiting`
// (agents or jobs left) never ends it. After an order (SK29), idle time counts only once the
// session started it: it worked, asked, or its cost or context moved since the order.
async function esperar(config, salaDir, id) {
  const member = findMember(config, id);
  const { session: first, target } = onlySession(config, member);
  const snapshotFile = path.join(target.agentDir, 'desktop', 'sessions', `${target.name}.json`);
  const env = (name, fallback) => Number(process.env[name]) || fallback;
  const pollMs = env('SALA_WAIT_POLL_MS', 500);
  const settleMs = env('SALA_WAIT_SETTLE_MS', 3000);
  const timeoutMs = env('SALA_WAIT_TIMEOUT_MS', 30 * 60 * 1000);
  const startMs = Math.min(env('SALA_WAIT_START_MS', 2 * 60 * 1000), timeoutMs);
  const deadline = Date.now() + timeoutMs;
  const startDeadline = Date.now() + startMs;
  const before = lastSent(salaDir, id, first.id);
  let started = !before;
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
    if (!started) {
      started = s.state !== 'idle' || s.cost !== before.cost || s.context !== before.context;
      if (!started) {
        if (Date.now() >= startDeadline) {
          throw new SalaError(`${id}: la sesión ${first.id} no empezó la orden en ${startMs / 1000} s; mirala con sala mostrar ${id}`);
        }
        await sleep(pollMs);
        continue;
      }
    }
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

// SK12: what the member answered last, read from its session file and never logged.
function respuesta(config, id) {
  const member = findMember(config, id);
  const { session, target } = onlySession(config, member);
  const reply = lastReply(target);
  if (!reply.ok) throw new SalaError(`${id}: ${reply.error.message}`);
  return { member: id, session: session.id, at: reply.at, text: reply.text, truncated: reply.truncated };
}

function respuestaTexto(r) {
  const clipped = r.truncated ? `\n(recortada a ${MAX_REPLY} caracteres)` : '';
  return `${r.member}: última respuesta de la sesión ${r.session} (${r.at || 'sin hora'})\n\n${r.text}${clipped}\n`;
}

module.exports = { TASK_ORDER, namedRows, enviar, enviarTexto, esperar, esperarTexto, respuesta, respuestaTexto, logOrder, guard, paused, onlySession, unreadable };
