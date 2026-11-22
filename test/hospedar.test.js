'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const os = require('node:os');
const { writeSala, salaConfig, runAsync, feedSala } = require('./helpers');

const FAKE_PI = path.join(__dirname, 'fixtures', 'fake-pi-rpc.js');
const TOKEN = 'ghp_0123456789abcdefghijABCDEFGHIJ012345';

// A sala with member core and the fake pi as Gentle Shell (its first question carries a
// U+2028, which must not cut the record). The host is closed after the
// test, before its folder is removed.
function hostSala(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sala-kit-')));
  const core = path.join(dir, 'core');
  fs.mkdirSync(core);
  writeSala(dir, salaConfig([{ id: 'core', prefix: 'CORE', path: core, base: 'main' }]));
  const piLog = path.join(dir, 'pi.log');
  const env = { SALA_GENTLE_SHELL: FAKE_PI, FAKE_PI_LOG: piLog, SALA_FEED_ROOTS: path.join(dir, 'sin-feed') };
  const sala = (...args) => runAsync(dir, args, env);
  const pi = () => (fs.existsSync(piLog) ? fs.readFileSync(piLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const log = () => {
    const file = path.join(dir, '.sala', 'ordenes.log');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  };
  // A test may leave a question open, so the host refuses to close: pi is killed, and the
  // host, which ends with it, is waited for.
  t.after(async () => {
    await sala('hospedar', 'core', '--cerrar');
    for (const r of pi()) if (r.started) try { process.kill(r.pid); } catch { /* already gone */ }
    for (let i = 0; i < 50 && (await sala('hospedar', 'core', '--cerrar')).stderr.includes('pregunta'); i += 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, core, env, sala, pi, log };
}

// The questions of the sala, once `ready` holds for them (the host reads pi asynchronously).
async function questionsWhen(s, ready) {
  for (let i = 0; i < 100; i += 1) {
    const res = await s.sala('preguntas');
    const qs = JSON.parse(res.stdout).questions;
    if (ready(qs)) return qs;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the question never showed up');
}

// Talks to the host pipe directly, as any process of the machine could.
function rawCall(pipe, text) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipe);
    let data = '';
    socket.on('connect', () => socket.write(text));
    socket.on('data', (d) => { data += d; });
    socket.on('end', () => resolve(JSON.parse(data)));
    socket.on('error', reject);
  });
}

const err = (res) => JSON.parse(res.stderr).error;

async function until(fn) {
  for (let i = 0; i < 100; i += 1) {
    const value = fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('it never happened');
}

test('a hosted member answers from the sala a question of two parts', async (t) => {
  const s = hostSala(t);

  const opened = await s.sala('hospedar', 'core');
  assert.equal(opened.code, 0, opened.stderr);
  const host = JSON.parse(opened.stdout);
  assert.equal(host.member, 'core');
  assert.equal(host.hosted, true);
  assert.equal(host.reused, false);
  assert.equal(typeof host.pipe, 'string');
  // The host answers as soon as it listens; pi starts after it (a real one takes over a minute).
  const started = await until(() => s.pi().find((r) => r.started));
  assert.equal(started.cwd, fs.realpathSync(s.core));
  assert.equal(started.host, '1');

  const again = await s.sala('hospedar', 'core');
  assert.deepEqual(JSON.parse(again.stdout), { ...host, reused: true });
  assert.equal(s.pi().filter((r) => r.started).length, 1);

  const sent = await s.sala('enviar', 'core', 'haceme una pregunta');
  assert.equal(sent.code, 0, sent.stderr);
  assert.deepEqual(JSON.parse(sent.stdout), { member: 'core', session: 'rpc', sent: true });

  const first = await questionsWhen(s, (qs) => qs.length === 1);
  assert.deepEqual(first, [
    { member: 'core', session: 'rpc', id: 'q-1', class: 'option', text: '1. ¿Qué rama?\u2028(la base)', options: ['main', 'dev', 'Type something.'] },
  ]);
  const one = await s.sala('responder', 'core', 'main', '--pregunta', 'q-1');
  assert.equal(one.code, 0, one.stderr);
  assert.deepEqual(JSON.parse(one.stdout), { member: 'core', session: 'rpc', question: 'q-1', option: 'main', answered: true });

  const second = await questionsWhen(s, (qs) => qs.length === 1 && qs[0].id === 'q-2');
  assert.deepEqual(second[0].options, ['Sí', 'No']);
  const two = await s.sala('responder', 'core', 'No', '--pregunta', 'q-2');
  assert.equal(two.code, 0, two.stderr);

  const answers = s.pi().filter((r) => r.type === 'extension_ui_response');
  assert.deepEqual(answers, [
    { type: 'extension_ui_response', id: 'q-1', value: 'main' },
    { type: 'extension_ui_response', id: 'q-2', value: 'No' },
  ]);
  // The notices that expect no answer never get one.
  assert.equal(s.pi().filter((r) => /^[nw]-/.test(r.id || '')).length, 0);

  const closed = await s.sala('hospedar', 'core', '--cerrar');
  assert.equal(closed.code, 0, closed.stderr);
  assert.deepEqual(JSON.parse(closed.stdout), { member: 'core', closed: true, code: 0 });
  assert.ok(s.pi().some((r) => r.ended));
  await assert.rejects(rawCall(host.pipe, '{"action":"status"}\n'));
});

test('the host keeps a consent and refuses what the sala may not do, even straight through the pipe', async (t) => {
  const s = hostSala(t);
  const host = JSON.parse((await s.sala('hospedar', 'core')).stdout);
  await s.sala('enviar', 'core', 'pedí el consent');

  const [consent] = await questionsWhen(s, (qs) => qs.length === 1);
  assert.equal(consent.class, 'consent');
  assert.equal(consent.id, 'c-1');

  const texto = await s.sala('preguntas', '--texto');
  assert.match(texto.stdout, /es un consentimiento: el anfitrión lo retiene; lo da la persona con sala consentir \(SK7c\)/);

  for (const option of ['1. Review it — granted', '2. Skip it — declined']) {
    const res = await s.sala('responder', 'core', option, '--pregunta', 'c-1');
    assert.equal(res.code, 1);
    assert.equal(err(res), 'core: la pregunta c-1 es un consentimiento: el anfitrión no la contesta; la da la persona con sala consentir (SK7c)');
  }
  const raw = await rawCall(host.pipe, `${JSON.stringify({ action: 'answer', dialog: 'c-1', value: '1. Review it — granted' })}\n`);
  assert.equal(raw.ok, false);
  const unknown = await rawCall(host.pipe, `${JSON.stringify({ action: 'extension_ui_response', id: 'c-1', value: 'x' })}\n`);
  assert.deepEqual(unknown, { ok: false, error: 'acción desconocida' });
  const broken = await rawCall(host.pipe, 'no es json\n');
  assert.deepEqual(broken, { ok: false, error: 'pedido ilegible' });
  assert.equal(s.pi().filter((r) => r.type === 'extension_ui_response').length, 0);

  const busy = await s.sala('enviar', 'core', `seguí con ${TOKEN}`);
  assert.equal(busy.code, 1);
  assert.equal(err(busy), 'core: la sesión hospedada tiene una pregunta abierta (c-1); contestala antes de mandar otra orden');
  const close = await s.sala('hospedar', 'core', '--cerrar');
  assert.equal(close.code, 1);
  assert.equal(err(close), 'core: la sesión hospedada tiene una pregunta abierta (c-1); no se cierra');

  assert.equal(s.pi().filter((r) => r.type === 'prompt').length, 1);
  assert.ok(!s.log().includes(TOKEN), 'the log keeps no secret');
  assert.ok(!JSON.stringify(s.pi()).includes(TOKEN));
});

test('the host checks every answer and order before pi sees it', async (t) => {
  const s = hostSala(t);
  await s.sala('hospedar', 'core');

  const empty = await s.sala('enviar', 'core', '\u200b');
  assert.equal(err(empty), 'core: la orden no se puede leer: está vacía');

  await s.sala('enviar', 'core', 'confirmá');
  const [confirm] = await questionsWhen(s, (qs) => qs.length === 1);
  assert.deepEqual(confirm, { member: 'core', session: 'rpc', id: 'k-1', class: 'option', text: '¿Borro el caché?\nSe rehace solo.', options: ['sí', 'no'] });
  const wrong = await s.sala('responder', 'core', 'tal vez', '--pregunta', 'k-1');
  assert.equal(wrong.code, 1);
  assert.equal(err(wrong), 'core: «tal vez» no es una opción de la pregunta k-1 (sí, no)');
  const ok = await s.sala('responder', 'core', 'sí', '--pregunta', 'k-1');
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual(s.pi().filter((r) => r.type === 'extension_ui_response'), [{ type: 'extension_ui_response', id: 'k-1', confirmed: true }]);
  await questionsWhen(s, (qs) => qs.length === 0);

  fs.mkdirSync(path.join(s.dir, '.sala'), { recursive: true });
  fs.writeFileSync(path.join(s.dir, '.sala', 'PAUSA'), '{}');
  const paused = await s.sala('enviar', 'core', 'otra cosa');
  assert.equal(paused.code, 1);
  assert.equal(err(paused), 'core: la sala está en pausa (.sala/PAUSA): no manda órdenes');
  assert.equal(s.pi().filter((r) => r.type === 'prompt').length, 1);
  fs.rmSync(path.join(s.dir, '.sala', 'PAUSA'));
});

test('sala hospedar does not open a second session next to a live one, nor for an unknown member', async (t) => {
  const s = feedSala(t);
  s.session('c1', s.core);
  const env = { ...s.env, SALA_GENTLE_SHELL: FAKE_PI, FAKE_PI_LOG: path.join(s.dir, 'pi.log') };

  const live = await runAsync(s.dir, ['hospedar', 'core'], env);
  assert.equal(live.code, 1);
  assert.equal(err(live), 'core: ya tiene una sesión viva (id-c1); el anfitrión no abre otra');
  const unknown = await runAsync(s.dir, ['hospedar', 'nadie'], env);
  assert.equal(unknown.code, 1);
  assert.equal(fs.existsSync(path.join(s.dir, 'pi.log')), false);

  const notHosted = await runAsync(s.dir, ['hospedar', 'web', '--cerrar'], env);
  assert.equal(notHosted.code, 1);
  assert.equal(err(notHosted), 'web: no tiene una sesión hospedada');
});
