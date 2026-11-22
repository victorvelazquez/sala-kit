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

// A terminal for sala consentir: what the person types, and what it shows.
function terminal(typed) {
  const { PassThrough } = require('node:stream');
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  output.isTTY = true;
  let shownText = '';
  output.setEncoding('utf8');
  output.on('data', (d) => { shownText += d; });
  input.end(typed);
  return { input, output, shown: () => shownText };
}

const logLines = (s) => s.log().split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('the sala cannot give a consent by itself: without a terminal, as an argument or straight through the pipe', async (t) => {
  const s = hostSala(t);
  const host = JSON.parse((await s.sala('hospedar', 'core')).stdout);
  await s.sala('enviar', 'core', 'pedí el consent');
  await questionsWhen(s, (qs) => qs.length === 1);

  const noTty = await s.sala('consentir', 'core');
  assert.equal(noTty.code, 1);
  assert.equal(err(noTty), 'core: sala consentir se corre en una terminal interactiva: la respuesta la tipea la persona en ese momento');
  const asArgument = await s.sala('consentir', 'core', '1');
  assert.equal(asArgument.code, 1);
  assert.equal(err(asArgument), 'sala consentir no lleva la respuesta como argumento: la tipea la persona en la terminal');
  for (const args of [['consentir', 'core', '--texto', '2'], ['consentir', '1', 'core']]) {
    assert.equal(err(await s.sala(...args)), 'sala consentir no lleva la respuesta como argumento: la tipea la persona en la terminal');
  }
  const notOption = await rawCall(host.pipe, `${JSON.stringify({ action: 'consent', dialog: 'c-1', value: 'granted', tty: true })}\n`);
  assert.deepEqual(notOption, { ok: false, error: '«granted» no es una opción de la pregunta c-1 (1. Review it — granted, 2. Skip it — declined, 3. Allow for this session)' });
  for (const tty of [undefined, 'yes', 'true', 1]) {
    const raw = await rawCall(host.pipe, `${JSON.stringify({ action: 'consent', dialog: 'c-1', value: '1. Review it — granted', tty })}\n`);
    assert.deepEqual(raw, { ok: false, error: 'un consentimiento solo lo da la persona con sala consentir, en una terminal interactiva' });
  }

  assert.equal(s.pi().filter((r) => r.type === 'extension_ui_response').length, 0);
  const [still] = await questionsWhen(s, (qs) => qs.length === 1);
  assert.equal(still.id, 'c-1');
  const refused = logLines(s).filter((l) => l.result === 'refused');
  assert.equal(refused.length, 9, 'every attempt is logged, the answer as an argument too');
});

test('the person gives a consent with sala consentir, typing it in a real terminal', async (t) => {
  const s = hostSala(t);
  await s.sala('hospedar', 'core');
  const { loadConfig } = require('../src/config');
  const { consentir } = require('../src/consentir');
  const config = loadConfig(s.dir);

  await assert.rejects(consentir(config, s.dir, 'core', terminal('1\n')), { message: 'core: la sesión hospedada no tiene un consentimiento abierto' });

  await s.sala('enviar', 'core', 'pedí el consent');
  await questionsWhen(s, (qs) => qs.length === 1);
  for (const typed of ['7\n', 'granted\n', '\n']) {
    await assert.rejects(consentir(config, s.dir, 'core', terminal(typed)), { message: /^core: (no se contestó el consentimiento|«.*» no es el número de una opción \(1 a 3\))$/ });
  }
  assert.equal(s.pi().filter((r) => r.type === 'extension_ui_response').length, 0);

  const term = terminal('2\n');
  const given = await consentir(config, s.dir, 'core', term);
  assert.deepEqual(given, { member: 'core', session: 'rpc', question: 'c-1', option: '2. Skip it — declined', consented: true });
  assert.match(term.shown(), /Review this change\?/);
  assert.match(term.shown(), /\[3\] 3\. Allow for this session/);
  assert.ok(!term.shown().includes('\u001b'), 'what pi wrote cannot redraw the person\'s terminal');
  assert.deepEqual(s.pi().filter((r) => r.type === 'extension_ui_response'), [{ type: 'extension_ui_response', id: 'c-1', value: '2. Skip it — declined' }]);
  const last = logLines(s).at(-1);
  assert.equal(last.result, 'consented');
  assert.equal(last.question, 'c-1');
  assert.equal(last.text, '2. Skip it — declined');
  await questionsWhen(s, (qs) => qs.length === 0);

  // A question that is not a consent is answered with sala responder, never here.
  await s.sala('enviar', 'core', 'confirmá');
  await questionsWhen(s, (qs) => qs.length === 1);
  const host = JSON.parse((await s.sala('hospedar', 'core')).stdout);
  const raw = await rawCall(host.pipe, `${JSON.stringify({ action: 'consent', dialog: 'k-1', value: 'sí', tty: true })}\n`);
  assert.deepEqual(raw, { ok: false, error: 'la pregunta k-1 no es un consentimiento: se contesta con sala responder' });
  assert.equal(s.pi().filter((r) => r.type === 'extension_ui_response').length, 1);
});
