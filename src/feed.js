'use strict';

// The feed adapter (D46, D50): reads the Gentle Shell session snapshots and
// leaves actions in a session's inbox. Only this code touches <agentDir>/desktop;
// the room's model never reads or names that folder with its own tools.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { mask } = require('./requisitos');

const FEED_SCHEMA = 'gentle-shell.desktop-feed/v1';
const ACTION_SCHEMA = 'gentle-shell.desktop-action/v1';
const MAX_SNAPSHOT = 1024 * 1024;
const NAME = /^[A-Za-z0-9_-]{1,128}$/;
const CONSENT = ['granted', 'declined'];
// C0, DEL and C1 controls; a prompt may still carry new lines and tabs.
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
// Gentle Shell takes the option of answer_question as its index.
const MAX_OPTION = 63;
const bare = (label) => String(label).replace(/[\p{Cf}\s]/gu, '').toLowerCase();

// SALA_FEED_ROOTS (separated by the path delimiter) replaces the agent dirs; the tests use it.
function feedRoots() {
  const custom = process.env.SALA_FEED_ROOTS;
  if (custom !== undefined) return custom.split(path.delimiter).filter(Boolean);
  return [path.join(os.homedir(), '.gentle-shell', 'agent'), path.join(os.homedir(), '.pi', 'agent')];
}

function clip(text, max = 500) {
  return mask(String(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')).slice(0, max);
}

function samePath(p) {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function inside(dir, root) {
  const d = samePath(dir);
  const r = samePath(root);
  return d === r || d.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function sessionState(snap) {
  const state = snap.activity && snap.activity.state;
  if (snap.pendingQuestion || state === 'blocked') return 'needs-you';
  return state === 'working' || state === 'waiting' ? state : 'idle';
}

function question(q) {
  if (!q || typeof q !== 'object') return null;
  return {
    kind: clip(q.kind || '', 32),
    text: clip(q.question || q.label || '', 2000),
    options: Array.isArray(q.options) ? q.options.slice(0, 10).map((o) => clip((o && o.label) || '', 200)) : [],
    terminalOnly: Boolean(q.terminalOnly),
    toolCallId: typeof q.toolCallId === 'string' ? clip(q.toolCallId, 128) : null,
  };
}

// The question as the session wrote it, for sala responder: an answer is matched
// against the real labels, never the masked ones. It never goes to the JSON.
function rawQuestion(q) {
  if (!q || typeof q !== 'object') return null;
  return {
    id: typeof q.toolCallId === 'string' && NAME.test(q.toolCallId) ? q.toolCallId : null,
    kind: typeof q.kind === 'string' ? q.kind : '',
    terminalOnly: Boolean(q.terminalOnly),
    options: Array.isArray(q.options) ? q.options.map((o) => (o && typeof o.label === 'string' ? o.label : '')) : [],
  };
}

function summary(snap, name) {
  const id = snap.identity;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    id: typeof id.sessionId === 'string' ? clip(id.sessionId, 128) : name,
    mode: clip(id.mode || '', 16),
    state: sessionState(snap),
    label: clip((snap.activity && snap.activity.label) || ''),
    question: question(snap.pendingQuestion),
    context: num(snap.context && snap.context.percent),
    cost: num(snap.cost && snap.cost.total),
  };
}

// One snapshot: { snap } or { warning }; null when it is skipped without a word.
function readSnapshot(dir, file) {
  const full = path.join(dir, file);
  const stat = fs.lstatSync(full, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) return null;
  if (stat.size > MAX_SNAPSHOT) return { warning: `${file}: pasa de 1 MiB` };
  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch {
    return { warning: `${file}: no es JSON válido` };
  }
  if (!snap || snap.schema !== FEED_SCHEMA) {
    const schema = clip(snap && snap.schema !== undefined ? snap.schema : 'sin schema', 80);
    return { warning: `${file}: formato desconocido ${schema}; se lee solo ${FEED_SCHEMA}` };
  }
  if (!snap.identity || typeof snap.identity !== 'object') return { warning: `${file}: no tiene identity` };
  return { snap };
}

// The same agent dir named twice (a junction, a trailing `.`) is read once.
function uniqueRoots(roots) {
  const seen = new Set();
  return roots.filter((root) => {
    let real;
    try {
      real = fs.realpathSync(root);
    } catch {
      real = path.resolve(root);
    }
    if (seen.has(samePath(real))) return false;
    seen.add(samePath(real));
    return true;
  });
}

// Warnings name the agent dir, never the feed folder inside it.
function sessionFiles(root, warnings) {
  const dir = path.join(root, 'desktop', 'sessions');
  try {
    const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (!stat) return [];
    if (!stat.isDirectory()) {
      warnings.push(`${root}: el feed no es una carpeta común`);
      return [];
    }
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch (err) {
    warnings.push(`${root}: no se pudo leer el feed (${err.code || 'error'})`);
    return [];
  }
}

// Live sessions per member, matched by the session's folder inside the member's path;
// with nested members, the deepest one owns the session.
function readFeed(roots, members) {
  const sessions = Object.fromEntries(members.map((m) => [m.id, []]));
  const targets = Object.fromEntries(members.map((m) => [m.id, []]));
  const deepestFirst = [...members].sort((a, b) => path.resolve(b.path).length - path.resolve(a.path).length);
  const warnings = [];
  for (const root of uniqueRoots(roots)) {
    const dir = path.join(root, 'desktop', 'sessions');
    for (const file of sessionFiles(root, warnings)) {
      let read;
      try {
        read = readSnapshot(dir, file);
      } catch (err) {
        read = { warning: `${file}: no se pudo leer (${err.code || 'error'})` };
      }
      if (!read) continue;
      if (read.warning) {
        warnings.push(read.warning);
        continue;
      }
      const { snap } = read;
      if (!alive(snap.identity.pid)) continue;
      const name = file.slice(0, -'.json'.length);
      const cwds = [snap.identity.cwd, snap.identity.realCwd].filter((c) => typeof c === 'string' && c);
      const member = deepestFirst.find((m) => cwds.some((c) => inside(c, m.path)));
      if (!member) continue;
      sessions[member.id].push(summary(snap, name));
      targets[member.id].push({ agentDir: root, name, sessionId: snap.identity.sessionId, question: rawQuestion(snap.pendingQuestion) });
    }
  }
  return { sessions, targets, warnings };
}

// The closed list of D50: any other kind, or other args, is refused before writing.
function allowed(kind, args) {
  const keys = args && typeof args === 'object' ? Object.keys(args).sort().join(',') : null;
  if (kind === 'send_prompt') {
    const text = keys === 'text' && typeof args.text === 'string' ? args.text : '';
    return text.trim() !== '' && text.length <= 4000 && !PROMPT_CONTROL.test(text);
  }
  if (kind === 'answer_question') {
    return keys === 'option,toolCallId,via' && args.via === 'session' && typeof args.toolCallId === 'string'
      && NAME.test(args.toolCallId) && Number.isInteger(args.option) && args.option >= 0 && args.option <= MAX_OPTION;
  }
  return false;
}

// An answer goes only to the question the session has open, to one of its options,
// and never to a consent token, not even disguised with invisible characters.
function answerable(target, args) {
  const q = target.question;
  if (!q || q.id !== args.toolCallId || args.option >= q.options.length) return false;
  const label = bare(q.options[args.option]);
  return label !== '' && !CONSENT.includes(label);
}

function refuse(code, message) {
  return { ok: false, error: { code, message } };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Drops one action in the session's inbox and waits for its answer in the outbox.
async function sendAction(target, kind, args, { timeoutMs = 10000 } = {}) {
  if (!allowed(kind, args)) return refuse('not_allowed', `la sala no manda ${clip(kind, 64)} con esos datos`);
  if (!target || !NAME.test(target.name || '') || typeof target.sessionId !== 'string') {
    return refuse('invalid_target', 'la sesión no es válida');
  }
  if (kind === 'answer_question' && !answerable(target, args)) {
    return refuse('not_allowed', 'la respuesta no corresponde a la pregunta abierta de la sesión');
  }
  const desktop = path.join(target.agentDir, 'desktop');
  const inbox = path.join(desktop, 'inbox', target.name);
  const id = `sala-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
  const actionFile = path.join(inbox, `${id}.json`);
  const action = { schema: ACTION_SCHEMA, id, sessionId: target.sessionId, kind, args, createdAt: new Date().toISOString() };
  try {
    // Every folder on the way is a plain folder: a link would carry the write elsewhere.
    const plain = [desktop, path.dirname(inbox), inbox].every((d) => {
      const stat = fs.lstatSync(d, { throwIfNoEntry: false });
      return stat && stat.isDirectory();
    });
    if (!plain) return refuse('no_inbox', 'la sesión no tiene bandeja');
    fs.writeFileSync(actionFile, JSON.stringify(action), { flag: 'wx', mode: 0o600 });
  } catch (err) {
    return refuse('write_failed', `no se pudo dejar la acción en la bandeja (${err.code || 'error'})`);
  }

  const answerFile = path.join(desktop, 'outbox', target.name, `${id}.json`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(Math.min(50, timeoutMs));
    let answer;
    try {
      answer = JSON.parse(fs.readFileSync(answerFile, 'utf8'));
    } catch {
      continue;
    }
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
      return refuse('invalid_answer', 'la respuesta de la sesión no es válida');
    }
    if (answer.ok === true) return { ok: true, data: answer.data };
    const error = answer.error || {};
    return refuse(clip(error.code || 'error', 64), clip(error.message || 'sin detalle'));
  }
  fs.rmSync(actionFile, { force: true });
  return refuse('timeout', `la sesión no respondió en ${timeoutMs / 1000} s`);
}

module.exports = { readFeed, sendAction, feedRoots, FEED_SCHEMA, CONSENT, bare };
