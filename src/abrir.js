'use strict';

// sala abrir, sala mostrar and sala estado --retomar: the live state of the sala
// (D5, D37) is .sala/estado.json in the instance, with what the sala opened.

const fs = require('node:fs');
const path = require('node:path');
const { readFeed, feedRoots } = require('./feed');
const { pickLauncher, LAUNCHERS } = require('./launcher');
const { SESSION_STATE } = require('./estado');

const STATE_SCHEMA = 1;
// A lock older than this is left over from a cut run: no abrir waits that long.
const STALE_LOCK_MS = 5 * 60 * 1000;

class SalaError extends Error {}

function stateFile(salaDir) {
  return path.join(salaDir, '.sala', 'estado.json');
}

// A state the sala cannot read is never overwritten: it may hold handles of open terminals.
function readState(salaDir) {
  let text;
  try {
    text = fs.readFileSync(stateFile(salaDir), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { schema: STATE_SCHEMA, members: {} };
    throw new SalaError(`.sala/estado.json no se pudo leer (${err.code || 'error'})`);
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    throw new SalaError('.sala/estado.json no es JSON válido; la sala no lo pisa');
  }
  const ok = state && typeof state === 'object' && !Array.isArray(state) && state.schema === STATE_SCHEMA
    && state.members && typeof state.members === 'object' && !Array.isArray(state.members);
  if (!ok) throw new SalaError('.sala/estado.json no tiene el formato esperado; la sala no lo pisa');
  return state;
}

// Written whole to a temporary file and renamed, so a cut never leaves half a file.
function saveRecord(salaDir, id, record) {
  const state = readState(salaDir);
  state.members[id] = record;
  const file = stateFile(salaDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function findMember(config, id) {
  const member = config.members.find((m) => m.id === id);
  if (!member) throw new SalaError(`no hay un miembro ${id} en sala.json`);
  return member;
}

function liveSessions(member) {
  return readFeed(feedRoots(), [member]).sessions[member.id];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSession(member, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [session] = liveSessions(member);
    if (session) return session;
    if (Date.now() >= deadline) return null;
    await sleep(Math.min(200, timeoutMs));
  }
}

// One abrir at a time per sala: two would open two sessions or lose a record.
function takeLock(salaDir) {
  const lock = path.join(salaDir, '.sala', 'abrir.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const stat = fs.statSync(lock, { throwIfNoEntry: false });
  if (stat && Date.now() - stat.mtimeMs > STALE_LOCK_MS) fs.rmSync(lock, { force: true });
  try {
    fs.closeSync(fs.openSync(lock, 'wx'));
  } catch (err) {
    if (err.code !== 'EEXIST') throw new SalaError(`no se pudo crear .sala/abrir.lock (${err.code || 'error'})`);
    throw new SalaError('otra sala abrir está en curso en esta sala; si no hay ninguna, borrá .sala/abrir.lock');
  }
  return () => fs.rmSync(lock, { force: true });
}

// Reuses the member's live session; otherwise opens one and waits for its snapshot.
async function abrir(config, salaDir, id) {
  const member = findMember(config, id);
  if (!fs.existsSync(member.path)) throw new SalaError(`${id}: la carpeta no existe: ${member.path}`);
  readState(salaDir);
  const release = takeLock(salaDir);
  try {
    return await openMember(config, salaDir, member);
  } finally {
    release();
  }
}

async function openMember(config, salaDir, member) {
  const { id } = member;
  const [live] = liveSessions(member);
  if (live) return { member: id, action: 'reused', session: live.id };
  // An Orca terminal from an abrir that timed out may still be starting: never orphan it.
  const previous = readState(salaDir).members[id];
  if (previous && previous.launcher === 'orca' && previous.session === null) {
    const open = await LAUNCHERS.orca.terminals();
    if (open && open.includes(previous.handle)) {
      throw new SalaError(`${id}: la terminal ${previous.handle} que abrió la sala sigue abierta sin sesión; mirala con sala mostrar ${id}`);
    }
  }

  const launcher = await pickLauncher(config.options.launcher);
  const opened = await launcher.open(member);
  if (!opened.ok) throw new SalaError(`${id}: ${opened.error}`);
  const record = { launcher: launcher.name, handle: opened.handle, title: opened.title, session: null, openedAt: new Date().toISOString() };
  saveRecord(salaDir, id, record);

  const timeoutMs = Number(process.env.SALA_OPEN_TIMEOUT_MS) || 60000;
  const session = await waitForSession(member, timeoutMs);
  if (!session) {
    const what = opened.handle ? `la terminal ${opened.handle}` : `la pestaña «${opened.title}»`;
    throw new SalaError(`${id}: se abrió ${what}, pero Gentle Shell no publicó su sesión en ${timeoutMs / 1000} s`);
  }
  saveRecord(salaDir, id, { ...record, session: session.id });
  return { member: id, action: 'opened', launcher: launcher.name, handle: opened.handle, title: opened.title, session: session.id };
}

function abrirTexto(r) {
  if (r.action === 'reused') return `${r.member}: ya tiene una sesión viva (${r.session}); no se abrió otra\n`;
  const where = r.handle ? `${r.launcher} (${r.handle})` : `${r.launcher}, pestaña «${r.title}»`;
  return `${r.member}: abierta en ${where}, sesión ${r.session}\n`;
}

async function mostrar(config, salaDir, id) {
  findMember(config, id);
  const record = readState(salaDir).members[id];
  const launcher = record && Object.hasOwn(LAUNCHERS, record.launcher) ? LAUNCHERS[record.launcher] : null;
  if (!launcher) throw new SalaError(`${id}: la sala no abrió una terminal; corré sala abrir ${id}`);
  const res = await launcher.show(record);
  if (!res.ok) throw new SalaError(`${id}: ${res.error}${res.gone ? `; corré sala abrir ${id}` : ''}`);
  return { member: id, launcher: launcher.name, shown: res.shown, title: record.title };
}

function mostrarTexto(r) {
  if (!r.shown) return `${r.member}: en Windows Terminal, la pestaña «${r.title}»\n`;
  return `${r.member}: se mostró la terminal «${r.title}» en Orca\n`;
}

// Only the fields the sala writes: a hand-edited state never carries extra fields out.
function openedRecord(r) {
  if (!r || typeof r !== 'object') return null;
  const text = (v) => (typeof v === 'string' ? v : null);
  return { launcher: text(r.launcher), handle: text(r.handle), title: text(r.title), session: text(r.session), openedAt: text(r.openedAt) };
}

// The short summary the sala starts from (D37): what it opened and each live session, without git.
function retomar(config, salaDir) {
  const state = readState(salaDir);
  const feed = readFeed(feedRoots(), config.members);
  const members = config.members.map((m) => ({
    id: m.id,
    opened: openedRecord(state.members[m.id]),
    sessions: feed.sessions[m.id].map((s) => ({ id: s.id, state: s.state, label: s.label, question: s.question ? s.question.text : null })),
  }));
  return { schema: STATE_SCHEMA, sala: config.name, members, feed: { warnings: feed.warnings } };
}

function retomarTexto(result) {
  const width = Math.max(...result.members.map((m) => m.id.length));
  const lines = [`Sala ${result.sala}`];
  for (const m of result.members) {
    const o = m.opened;
    const opened = o ? `abierta por la sala en ${o.launcher} (${o.handle || `pestaña «${o.title}»`})` : 'no la abrió la sala';
    const sessions = m.sessions.map((s) => `sesión ${s.id}: ${SESSION_STATE[s.state]}${s.question ? `: «${s.question}»` : ''}`);
    lines.push(`${m.id.padEnd(width)}  ${[opened, ...(sessions.length ? sessions : ['sin sesión viva'])].join('; ')}`);
  }
  for (const w of result.feed.warnings) lines.push(`Feed: ${w}`);
  return `${lines.join('\n')}\n`;
}

module.exports = { abrir, abrirTexto, mostrar, mostrarTexto, retomar, retomarTexto, SalaError };
