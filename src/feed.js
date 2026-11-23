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
// A profile name the person can read: no controls, no bidi, 1-128 characters (D28).
const PROFILE = /^[^\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]{1,128}$/;
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
      // The raw activity state goes to the targets only: a close needs the session to say idle.
      const activity = snap.activity && typeof snap.activity.state === 'string' ? snap.activity.state : null;
      const sessionFile = typeof snap.identity.sessionFile === 'string' && snap.identity.sessionFile ? snap.identity.sessionFile : null;
      targets[member.id].push({ agentDir: root, name, sessionId: snap.identity.sessionId, question: rawQuestion(snap.pendingQuestion), activity, sessionFile });
    }
  }
  return { sessions, targets, warnings };
}

// The formats the snapshots publish, for the contract check of sala revisar (D47):
// only the schema field is kept, and an unreadable file is skipped.
function feedSchemas(roots) {
  const schemas = new Set();
  for (const root of uniqueRoots(roots)) {
    const dir = path.join(root, 'desktop', 'sessions');
    for (const file of sessionFiles(root, [])) {
      try {
        const stat = fs.lstatSync(path.join(dir, file));
        if (!stat.isFile() || stat.size > MAX_SNAPSHOT) continue;
        const snap = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        if (snap && typeof snap.schema === 'string') schemas.add(clip(snap.schema, 80));
      } catch {
        // An unreadable snapshot says nothing about the format.
      }
    }
  }
  return [...schemas].sort();
}

// The last reply of a session (SK12), read from the end of its .jsonl file. Only a
// plain .jsonl inside <agentDir>/sessions is read, whatever path the snapshot names.
const MAX_TAIL = 2 * 1024 * 1024;
const MAX_REPLY = 8000;
// A whole private key block, not only its first line, is masked.
const KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g;
// Controls but new lines and tabs, and invisible format characters (bidi, zero width, soft
// hyphen) never reach the screen. They go before masking: one hidden inside a secret would
// hide it from the mask and, dropped afterwards, rebuild it.
const REPLY_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}]/gu;

function sessionFileOk(target) {
  const file = target.sessionFile;
  const sessions = path.join(target.agentDir, 'sessions');
  if (!file || !path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.jsonl' || !inside(file, sessions)) return false;
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  // A missing file is told as such by the read; a present one must really live there.
  if (!stat) return true;
  try {
    // A hard link would carry a file from elsewhere in under a trusted name.
    return stat.isFile() && stat.nlink === 1 && inside(fs.realpathSync(file), fs.realpathSync(sessions));
  } catch {
    return false;
  }
}

function lastReply(target) {
  const who = clip(target.sessionId, 128);
  if (!target.sessionFile) return refuse('no_session_file', `la sesión ${who} no publica su archivo de sesión`);
  if (!sessionFileOk(target)) return refuse('untrusted', `el archivo de sesión de ${who} no es un .jsonl de la carpeta sessions de Gentle Shell`);
  let tail;
  try {
    const fd = fs.openSync(target.sessionFile, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, MAX_TAIL);
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, size - length);
      tail = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    return refuse('unreadable', `no se pudo leer el archivo de sesión de ${who} (${err.code || 'error'})`);
  }
  const lines = tail.split('\n').reverse();
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // A line cut by the tail or half-written.
    }
    const msg = entry && entry.type === 'message' && entry.message;
    if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    const parts = msg.content.filter((c) => c && c.type === 'text' && typeof c.text === 'string' && c.text.trim() !== '').map((c) => c.text);
    if (parts.length === 0) continue;
    const text = mask(parts.join('\n').replace(REPLY_CONTROL, '').replace(KEY_BLOCK, '[clave privada]'));
    return {
      ok: true,
      at: typeof entry.timestamp === 'string' ? clip(entry.timestamp, 40) : null,
      text: text.slice(0, MAX_REPLY),
      truncated: text.length > MAX_REPLY,
    };
  }
  return refuse('no_reply', `la sesión ${who} todavía no respondió nada`);
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
  // Only by name: a confirmation token is the person's, never the sala's.
  if (kind === 'apply_profile') {
    return keys === 'name' && typeof args.name === 'string' && args.name.trim() !== '' && PROFILE.test(args.name);
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

module.exports = { readFeed, feedSchemas, sendAction, lastReply, MAX_REPLY, feedRoots, FEED_SCHEMA, CONSENT, bare };
