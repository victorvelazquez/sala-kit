'use strict';

// sala hospedar (D14, D51): the kit hosts a member's session itself, a
// `gentle-shell --mode rpc` with GENTLE_SHELL_INTERACTIVE_HOST=1 kept alive in the background,
// and talks to it through a named pipe. This is the rpc adapter: it covers both ports.
// The guards live here, in the process that talks to pi, and not in the CLI the model runs:
// the pause, an unreadable order, an answer that is not an option, an unknown action, and a
// consent, which the host keeps: only `consent`, sent by sala consentir from a terminal, gives it (D48).

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { findMember, SalaError } = require('./abrir');
const { readFeed, feedRoots, bare } = require('./feed');
const { mask } = require('./requisitos');
const { paused } = require('./pausa');

const BIN = path.join(__dirname, '..', 'bin', 'sala.js');
// Only these wait for an answer; notify, setStatus, setWidget and the rest are dropped.
const DIALOGS = ['select', 'confirm', 'input', 'editor'];
const CONFIRM = { sí: true, si: true, no: false };
// A consent is told by its words, not by a field of its own (SK7a); anything that looks like
// one is kept, so a doubt fails closed.
const CONSENT_WORDS = /granted|declined|consent/;
const MAX_REQUEST = 64 * 1024;

const clip = (text, max = 500) => mask(String(text ?? '')).slice(0, max);
// What came from a request is echoed masked and without control characters.
const shown = (text) => clip(String(text).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' '), 200);

// \\.\pipe\sala-<instance>-<tag>-<member> on Windows, a socket in .sala/ elsewhere. The tag
// comes from the sala's folder, so two salas with the same name never share a pipe.
function pipePath(config, salaDir, id) {
  const safe = (text) => String(text).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
  const folder = path.resolve(salaDir);
  const tag = crypto.createHash('sha256').update(process.platform === 'win32' ? folder.toLowerCase() : folder).digest('hex').slice(0, 8);
  if (process.platform === 'win32') return `\\\\.\\pipe\\sala-${safe(config.name)}-${tag}-${safe(id)}`;
  return path.join(folder, '.sala', `host-${safe(id)}.sock`);
}

// One request, one answer. null when nobody listens on the pipe: the member is not hosted.
function hostCall(pipe, request, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipe);
    let data = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new SalaError('el anfitrión no contestó a tiempo'));
    }, timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (d) => { data += d; });
    socket.on('end', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new SalaError('el anfitrión contestó algo ilegible'));
      }
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      if (['ENOENT', 'ECONNREFUSED'].includes(err.code)) resolve(null);
      else reject(new SalaError(`no se pudo hablar con el anfitrión (${err.code || 'error'})`));
    });
  });
}

// SALA_GENTLE_SHELL swaps Gentle Shell; a .js path runs with node (used by the tests).
// gentle-shell is a .cmd on Windows, which only runs through cmd; the command line is fixed.
function gentleShell() {
  const custom = process.env.SALA_GENTLE_SHELL;
  if (custom) return custom.endsWith('.js') ? [process.execPath, [custom]] : [custom, ['--mode', 'rpc']];
  if (process.platform === 'win32') return ['cmd.exe', ['/d', '/s', '/c', 'gentle-shell --mode rpc']];
  return ['gentle-shell', ['--mode', 'rpc']];
}

function dialogOf(req) {
  const options = req.method === 'select' ? (Array.isArray(req.options) ? req.options.map((o) => clip(o, 200)) : [])
    : req.method === 'confirm' ? Object.keys(CONFIRM).filter((k) => k !== 'si') : [];
  const words = [req.title, req.message, ...(Array.isArray(req.options) ? req.options : [])].map((x) => bare(x ?? '')).join('\n');
  return {
    id: String(req.id),
    method: req.method,
    class: CONSENT_WORDS.test(words) ? 'consent' : 'option',
    text: clip(req.message ? `${req.title ?? ''}\n${req.message}` : req.title ?? ''),
    options,
  };
}

// The host itself: runs pi, keeps its open dialogs and answers the pipe. Resolves when pi exits.
function runHost(config, salaDir, member) {
  const { logOrder, unreadable } = require('./enviar');
  const pipe = pipePath(config, salaDir, member.id);
  const log = (text, result, question) => logOrder(salaDir, { member: member.id, session: 'rpc', ...(question ? { question: shown(question) } : {}), text, result, via: 'rpc' });
  const dialogs = new Map();
  const pending = new Map();
  let busy = false;
  let seq = 0;
  let pi = null;
  let exited = null;
  const exitWaiters = [];

  const send = (record) => pi.stdin.write(`${JSON.stringify(record)}\n`);
  const command = (record, timeoutMs = 10000) => new Promise((resolve) => {
    const id = `sala-${(seq += 1)}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ success: false, error: 'pi no contestó a tiempo' });
    }, timeoutMs);
    pending.set(id, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
    send({ ...record, id });
  });

  // pi's stdout is cut on LF only: readline would also cut on U+2028 and U+2029 (D51).
  function onRecord(record) {
    if (!record || typeof record !== 'object') return;
    if (record.type === 'response' && pending.has(record.id)) {
      const done = pending.get(record.id);
      pending.delete(record.id);
      done(record);
    } else if (record.type === 'extension_ui_request' && DIALOGS.includes(record.method) && record.id != null) {
      dialogs.set(String(record.id), dialogOf(record));
    } else if (record.type === 'agent_start') busy = true;
    else if (record.type === 'agent_settled') busy = false;
  }

  const refuse = (error, code) => ({ ok: false, error, ...(code ? { code } : {}) });
  const firstDialog = () => dialogs.keys().next().value;

  async function prompt(text) {
    const reason = unreadable(text);
    if (reason) return refuse(reason);
    if (paused(salaDir)) return refuse('la sala está en pausa (.sala/PAUSA): no manda órdenes');
    if (dialogs.size) return refuse(`la sesión hospedada tiene una pregunta abierta (${shown(firstDialog())}); contestala antes de mandar otra orden`);
    if (busy) return refuse('la sesión hospedada está trabajando; esperá a que termine');
    busy = true;
    const res = await command({ type: 'prompt', message: text });
    if (!res.success) {
      busy = false;
      return refuse(`pi no aceptó la orden: ${clip(res.error, 200)}`);
    }
    if (res.data && res.data.disposition === 'handled') busy = false;
    return { ok: true, sent: true };
  }

  function answer(id, value) {
    const dialog = typeof id === 'string' ? dialogs.get(id) : undefined;
    if (!dialog) return refuse('la pregunta ya no está abierta', 'unknown-dialog');
    if (dialog.class === 'consent') return refuse(`la pregunta ${shown(id)} es un consentimiento: el anfitrión no la contesta; la da la persona con sala consentir (SK7c)`);
    return deliver(id, dialog, value);
  }

  // D48: a consent goes only from sala consentir, which checks that the person typed it in a
  // terminal and says so with `tty: true`. The pipe cannot see the caller's terminal, so this
  // keeps the sala's model out (its bash has none), not a process that lies about it.
  function consent(id, value, tty) {
    const dialog = typeof id === 'string' ? dialogs.get(id) : undefined;
    if (!dialog) return refuse('la pregunta ya no está abierta', 'unknown-dialog');
    if (tty !== true) return refuse('un consentimiento solo lo da la persona con sala consentir, en una terminal interactiva');
    if (dialog.class !== 'consent') return refuse(`la pregunta ${shown(id)} no es un consentimiento: se contesta con sala responder`);
    // A consent is given by choosing one of its options; free text is never one.
    if (dialog.method !== 'select' && dialog.method !== 'confirm') return refuse(`el consentimiento ${shown(id)} no tiene opciones: el anfitrión no lo contesta`);
    return deliver(id, dialog, value);
  }

  function deliver(id, dialog, value) {
    const name = shown(id);
    if (typeof value !== 'string') return refuse('la respuesta tiene que ser un texto');
    const notOption = refuse(`«${shown(value)}» no es una opción de la pregunta ${name} (${dialog.options.join(', ')})`);
    let response;
    if (dialog.method === 'select') {
      const index = dialog.options.indexOf(value.trim());
      if (index < 0) return notOption;
      response = { value: dialog.options[index] };
    } else if (dialog.method === 'confirm') {
      const key = value.trim().toLowerCase();
      if (!Object.hasOwn(CONFIRM, key)) return notOption;
      response = { confirmed: CONFIRM[key] };
    } else {
      const reason = unreadable(value);
      if (reason) return refuse(reason.replace('la orden', 'la respuesta'));
      response = { value };
    }
    dialogs.delete(id);
    send({ type: 'extension_ui_response', id, ...response });
    return { ok: true, answered: true, option: shown(value.trim()) };
  }

  async function close() {
    if (dialogs.size) return refuse(`la sesión hospedada tiene una pregunta abierta (${shown(firstDialog())}); no se cierra`);
    if (busy) return refuse('la sesión hospedada está trabajando; no se cierra');
    pi.stdin.end();
    const code = exited !== null ? exited : await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pi.kill();
        resolve(null);
      }, 30000);
      exitWaiters.push((c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    return { ok: true, closed: true, code };
  }

  async function handle(line) {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      log('(pedido ilegible)', 'refused');
      return refuse('pedido ilegible');
    }
    const action = req && typeof req === 'object' ? req.action : null;
    if (action === 'status') {
      return { ok: true, member: member.id, pid: process.pid, busy, dialogs: [...dialogs.values()] };
    }
    if (action === 'prompt') {
      const res = await prompt(req.text);
      log(req.text, res.ok ? 'sent' : 'refused');
      return res;
    }
    if (action === 'answer') {
      const res = answer(req.dialog, req.value);
      log(req.value, res.ok ? 'answered' : 'refused', typeof req.dialog === 'string' ? req.dialog : null);
      return res;
    }
    if (action === 'consent') {
      const res = consent(req.dialog, req.value, req.tty);
      log(req.value, res.ok ? 'consented' : 'refused', typeof req.dialog === 'string' ? req.dialog : null);
      return res;
    }
    if (action === 'close') {
      const res = await close();
      log('(cerrar)', res.ok ? 'closed' : 'refused');
      return res;
    }
    log(`(acción ${shown(action)})`, 'refused');
    return refuse('acción desconocida');
  }

  const server = net.createServer((socket) => {
    let data = '';
    socket.setEncoding('utf8');
    socket.setTimeout(10000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', async (chunk) => {
      if (data === null) return;
      data += chunk;
      const at = data.indexOf('\n');
      if (at < 0 && data.length <= MAX_REQUEST) return;
      const line = at < 0 ? null : data.slice(0, at);
      data = null;
      const res = line === null ? refuse('pedido ilegible') : await handle(line);
      socket.end(`${JSON.stringify(res)}\n`);
      if (res.closed) server.close();
    });
  });

  return new Promise((resolve, reject) => {
    // A stale socket file (Linux or Mac) is removed only when nobody answers on it.
    const listen = (retried) => {
      server.once('error', async (err) => {
        if (err.code === 'EADDRINUSE' && !retried && process.platform !== 'win32' && (await hostCall(pipe, { action: 'status' }).catch(() => null)) === null) {
          fs.rmSync(pipe, { force: true });
          return listen(true);
        }
        reject(new SalaError(err.code === 'EADDRINUSE' ? `${member.id}: ya tiene un anfitrión` : `${member.id}: el anfitrión no pudo escuchar (${err.code})`));
      });
      server.listen(pipe, start);
    };
    function start() {
      if (process.platform !== 'win32') fs.chmodSync(pipe, 0o600);
      const [file, args] = gentleShell();
      pi = spawn(file, args, {
        cwd: member.path,
        env: { ...process.env, GENTLE_SHELL_INTERACTIVE_HOST: '1' },
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });
      let buffer = Buffer.alloc(0);
      pi.stdout.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        let at;
        while ((at = buffer.indexOf(0x0a)) >= 0) {
          const line = buffer.subarray(0, at).toString('utf8').replace(/\r$/, '');
          buffer = buffer.subarray(at + 1);
          try {
            onRecord(JSON.parse(line));
          } catch { /* not a protocol record */ }
        }
      });
      pi.stdin.on('error', () => {});
      pi.on('error', (err) => {
        log('(hospedar)', `failed: ${err.code || 'error'}`);
        server.close();
        reject(new SalaError(`${member.id}: no se pudo lanzar Gentle Shell (${err.code || 'error'})`));
      });
      pi.on('exit', (code) => {
        exited = code;
        for (const done of pending.values()) done({ success: false, error: 'pi se cerró' });
        pending.clear();
        exitWaiters.forEach((w) => w(code));
        // The answer to `close` goes out first; then the pipe closes.
        setTimeout(() => {
          server.close();
          resolve({ member: member.id, exited: code });
        }, 200);
      });
    }
    listen(false);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Starts the host in the background and returns once it answers on its pipe.
async function hospedar(config, salaDir, id, { cerrar = false, primerPlano = false } = {}) {
  const member = findMember(config, id);
  const pipe = pipePath(config, salaDir, member.id);
  if (cerrar) {
    const res = await hostCall(pipe, { action: 'close' }, 40000);
    if (!res) throw new SalaError(`${id}: no tiene una sesión hospedada`);
    if (!res.ok) throw new SalaError(`${id}: ${res.error}`);
    return { member: id, closed: true, code: res.code };
  }
  if (primerPlano) return runHost(config, salaDir, member);
  const status = await hostCall(pipe, { action: 'status' });
  if (status && status.ok) return { member: id, pipe, pid: status.pid, hosted: true, reused: true };
  const live = readFeed(feedRoots(), config.members).sessions[id];
  if (live.length) throw new SalaError(`${id}: ya tiene una sesión viva (${live.map((s) => s.id).join(', ')}); el anfitrión no abre otra`);
  // Out of the sala's folder, so a running host never locks it.
  const child = spawn(process.execPath, [BIN, 'hospedar', id, '--primer-plano', '--sala', salaDir], {
    cwd: path.dirname(BIN),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  let gone = null;
  child.on('exit', (code) => { gone = code; });
  child.on('error', () => { gone = -1; });
  const timeoutMs = Number(process.env.SALA_HOST_START_MS) || 15000;
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline && gone === null;) {
    const res = await hostCall(pipe, { action: 'status' }).catch(() => null);
    if (res && res.ok) {
      child.unref();
      return { member: id, pipe, pid: res.pid, hosted: true, reused: false };
    }
    await sleep(100);
  }
  if (gone === null) child.kill();
  throw new SalaError(`${id}: el anfitrión no arrancó${gone !== null ? ` (salió con ${gone})` : ''}`);
}

function hospedarTexto(r) {
  if (r.closed) return `${r.member}: sesión hospedada cerrada (salió con ${r.code})\n`;
  if (Object.hasOwn(r, 'exited')) return `${r.member}: la sesión hospedada terminó (salió con ${r.exited})\n`;
  return `${r.member}: sesión hospedada ${r.reused ? 'que ya estaba' : 'nueva'} (anfitrión ${r.pid}, ${r.pipe})\n`;
}

module.exports = { hospedar, hospedarTexto, hostCall, pipePath };
