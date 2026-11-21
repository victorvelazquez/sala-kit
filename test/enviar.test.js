'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { feedSala: setup, runAsync } = require('./helpers');

test('sala enviar leaves send_prompt in the member session inbox and logs the order', async (t) => {
  const s = setup(t);
  s.session('c1', s.core);
  const seen = s.answer('c1');

  const res = await runAsync(s.dir, ['enviar', 'core', '/flow-avance'], s.env);

  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  assert.deepEqual(JSON.parse(res.stdout), { member: 'core', session: 'id-c1', sent: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'send_prompt');
  assert.equal(seen[0].sessionId, 'id-c1');
  assert.deepEqual(seen[0].args, { text: '/flow-avance' });
  // The order is logged before it goes: one that cannot be logged is never sent.
  assert.deepEqual(s.log().map(({ at, ...rest }) => ({ ...rest, at: typeof at })), [
    { member: 'core', session: 'id-c1', text: '/flow-avance', result: 'sending', at: 'string' },
    { member: 'core', session: 'id-c1', text: '/flow-avance', result: 'sent', at: 'string' },
  ]);
});

test('sala enviar refuses invisible or bidi orders, a paused sala, a blocked session and a linked inbox', async (t) => {
  const s = setup(t);
  const cases = [
    { order: '\u200b\u2060 ', error: 'la orden no se puede leer: está vacía' },
    { order: '/flow-avance \u202eesrever', error: 'la orden no se puede leer: tiene caracteres de control de dirección' },
    {
      order: '/flow-avance',
      before: () => { fs.mkdirSync(path.join(s.dir, '.sala'), { recursive: true }); fs.writeFileSync(path.join(s.dir, '.sala', 'PAUSA'), ''); },
      after: () => fs.rmSync(path.join(s.dir, '.sala', 'PAUSA')),
      error: 'la sala está en pausa (.sala/PAUSA): no manda órdenes',
    },
    {
      order: '/flow-avance',
      extra: { activity: { state: 'blocked', label: 'Blocked' } },
      error: 'core: la sesión id-c1 está bloqueada; mirala antes de mandar otra orden',
    },
  ];
  for (const c of cases) {
    fs.rmSync(s.agentDir, { recursive: true, force: true });
    s.session('c1', s.core, c.extra);
    if (c.before) c.before();

    const res = await runAsync(s.dir, ['enviar', 'core', c.order], s.env);

    assert.equal(res.code, 1, c.error);
    assert.deepEqual(JSON.parse(res.stderr), { error: c.error });
    assert.deepEqual(s.inbox('c1'), [], c.error);
    if (c.after) c.after();
  }

  // The inbox folder swapped for a link to elsewhere: nothing is written there.
  fs.rmSync(s.agentDir, { recursive: true, force: true });
  s.session('c1', s.core);
  const elsewhere = path.join(s.dir, 'elsewhere');
  fs.mkdirSync(path.join(elsewhere, 'c1'), { recursive: true });
  fs.rmSync(path.join(s.agentDir, 'desktop', 'inbox'), { recursive: true });
  fs.symlinkSync(elsewhere, path.join(s.agentDir, 'desktop', 'inbox'), 'junction');
  const linked = await runAsync(s.dir, ['enviar', 'core', '/flow-avance'], s.env);
  assert.equal(linked.code, 1);
  assert.deepEqual(JSON.parse(linked.stderr), { error: 'core: la sesión no aceptó la orden: la sesión no tiene bandeja (no_inbox)' });
  assert.deepEqual(fs.readdirSync(path.join(elsewhere, 'c1')), []);
});

test('sala enviar logs every refusal, masked, and sends nothing when it cannot log', async (t) => {
  const s = setup(t);
  s.session('c1', s.core);
  const token = `ghp_${'d'.repeat(36)}`;
  await runAsync(s.dir, ['enviar', 'core', `${token}\u0007`], s.env);
  await runAsync(s.dir, ['enviar', 'nadie', '/flow-avance'], s.env);

  assert.deepEqual(s.log().map((l) => [l.member, l.result]), [['core', 'refused'], ['nadie', 'refused']]);
  assert.ok(!fs.readFileSync(path.join(s.dir, '.sala', 'ordenes.log'), 'utf8').includes(token));

  fs.rmSync(path.join(s.dir, '.sala'), { recursive: true });
  fs.writeFileSync(path.join(s.dir, '.sala'), '');
  const res = await runAsync(s.dir, ['enviar', 'core', '/flow-avance'], s.env);
  assert.equal(res.code, 1);
  assert.deepEqual(JSON.parse(res.stderr), { error: 'core: no se pudo anotar la orden en .sala/ordenes.log; no se mandó' });
  assert.deepEqual(s.inbox('c1'), []);
});

test('sala esperar does not take a half-written snapshot for a closed session', async (t) => {
  const s = setup(t);
  s.session('c1', s.core, { activity: { state: 'working', label: 'w' } });
  const timer = setInterval(() => s.session('c1', s.core, { activity: { state: 'working', label: 'w'.repeat(20000) } }), 1);
  t.after(() => clearInterval(timer));

  const res = await runAsync(s.dir, ['esperar', 'core'], { ...s.env, SALA_WAIT_POLL_MS: '5', SALA_WAIT_TIMEOUT_MS: '1500' });

  clearInterval(timer);
  assert.equal(res.code, 1);
  assert.deepEqual(JSON.parse(res.stderr), { error: 'core: sigue trabajando después de 1.5 s' });
});

test('sala esperar never ends while the session keeps waiting on agents (D15)', async (t) => {
  const s = setup(t);
  s.session('c1', s.core, { activity: { state: 'waiting', label: 'Waiting on 1 agent' } });

  const res = await runAsync(s.dir, ['esperar', 'core'], { ...s.env, SALA_WAIT_TIMEOUT_MS: '800' });

  assert.equal(res.code, 1);
  assert.deepEqual(JSON.parse(res.stderr), { error: 'core: sigue trabajando después de 0.8 s' });
});

test('sala enviar refuses, writing nothing to any inbox, when the guards do not hold', async (t) => {
  const s = setup(t);
  const token = `ghp_${'b'.repeat(36)}`;
  const cases = [
    // No session of its own: the only live session belongs to another member.
    { setup: () => s.session('w1', s.web), args: ['core', '/flow-avance'], error: 'core: no tiene una sesión viva; corré sala abrir core' },
    // A session with an open question.
    {
      setup: () => s.session('c1', s.core, { pendingQuestion: { kind: 'choice', question: '¿Sigo?', toolCallId: 'q1', options: [] } }),
      args: ['core', '/flow-avance'],
      error: 'core: la sesión id-c1 tiene una pregunta abierta («¿Sigo?»); contestala antes de mandar otra orden',
    },
    // Two live sessions: the sala does not pick one.
    {
      setup: () => { s.session('c1', s.core); s.session('c2', path.join(s.core, 'src')); },
      args: ['core', '/flow-avance'],
      error: 'core: tiene 2 sesiones vivas (id-c1, id-c2); dejá una sola',
    },
    // Unreadable orders (D39).
    { setup: () => s.session('c1', s.core), args: ['core', 'hola\u0007'], error: 'la orden no se puede leer: tiene caracteres de control' },
    { setup: () => s.session('c1', s.core), args: ['core', 'x'.repeat(4001)], error: 'la orden no se puede leer: pasa de 4000 caracteres' },
    { setup: () => s.session('c1', s.core), args: ['core', '   '], error: 'la orden no se puede leer: está vacía' },
    // Git Bash turned `/flow-avance` into a path before the CLI saw it.
    {
      setup: () => s.session('c1', s.core),
      args: ['core', 'C:/Program Files/Git/flow-avance'],
      error: 'la orden parece una ruta que armó Git Bash con un comando /…; corré sala con MSYS_NO_PATHCONV=1',
    },
    { setup: () => s.session('c1', s.core), args: ['nadie', '/flow-avance'], error: 'no hay un miembro nadie en sala.json' },
  ];
  for (const c of cases) {
    fs.rmSync(s.agentDir, { recursive: true, force: true });
    c.setup();

    const res = await runAsync(s.dir, ['enviar', ...c.args, '--texto'], s.env);

    assert.equal(res.code, 1, c.error);
    assert.equal(res.stdout, '');
    assert.deepEqual(JSON.parse(res.stderr), { error: c.error });
    for (const name of ['c1', 'c2', 'w1']) assert.deepEqual(s.inbox(name), [], c.error);
  }
  // A refused order is logged too, with any secret masked.
  fs.rmSync(s.agentDir, { recursive: true, force: true });
  const res = await runAsync(s.dir, ['enviar', 'core', `usá ${token}`], s.env);
  assert.equal(res.code, 1);
  const last = s.log().at(-1);
  assert.equal(last.result, 'refused');
  assert.equal(last.text, 'usá [token de GitHub]');
  assert.ok(!fs.readFileSync(path.join(s.dir, '.sala', 'ordenes.log'), 'utf8').includes(token));
});

test('sala enviar reports what Gentle Shell answered when it refuses the order', async (t) => {
  const s = setup(t);
  s.session('c1', s.core);
  s.answer('c1', { ok: false, error: { code: 'terminal_only', message: '/new runs only in the terminal' } });

  const res = await runAsync(s.dir, ['enviar', 'core', '/new'], s.env);

  assert.equal(res.code, 1);
  assert.deepEqual(JSON.parse(res.stderr), { error: 'core: la sesión no aceptó la orden: /new runs only in the terminal (terminal_only)' });
  assert.equal(s.log().at(-1).result, 'terminal_only');
});

test('sala esperar ends only when the member is idle for real, not while agents still run', async (t) => {
  const s = setup(t);
  s.session('c1', s.core, { activity: { state: 'working', label: 'Working' } });
  setTimeout(() => s.session('c1', s.core, { activity: { state: 'waiting', label: 'Waiting on 2 agents' } }), 300);
  setTimeout(() => s.session('c1', s.core, { activity: { state: 'idle', label: 'Idle' } }), 700);
  const started = Date.now();

  const res = await runAsync(s.dir, ['esperar', 'core', '--texto'], s.env);

  assert.equal(res.code, 0, res.stderr);
  assert.ok(Date.now() - started >= 700, 'it does not end while the session works or waits');
  assert.equal(res.stdout, 'core: terminó (sesión id-c1, libre)\n');
});

test('sala esperar wakes the sala when the member asks something, and fails when it dies or never ends', async (t) => {
  const s = setup(t);
  // Late enough for the CLI to have started even when the whole suite runs at once.
  const LATER = 1500;
  s.session('c1', s.core, { activity: { state: 'working', label: 'Working' } });
  setTimeout(() => s.session('c1', s.core, {
    pendingQuestion: { kind: 'choice', question: '¿Fusiono?', toolCallId: 'q1', options: [{ label: 'Sí' }] },
  }), LATER);

  const asked = await runAsync(s.dir, ['esperar', 'core'], s.env);

  assert.equal(asked.code, 0, asked.stderr);
  assert.deepEqual(JSON.parse(asked.stdout), { member: 'core', session: 'id-c1', state: 'needs-you', label: 'Idle', question: '¿Fusiono?' });

  s.session('c1', s.core, { activity: { state: 'working', label: 'Working' } });
  setTimeout(() => fs.rmSync(path.join(s.agentDir, 'desktop', 'sessions', 'c1.json')), LATER);
  const gone = await runAsync(s.dir, ['esperar', 'core'], s.env);
  assert.equal(gone.code, 1);
  assert.deepEqual(JSON.parse(gone.stderr), { error: 'core: la sesión id-c1 se cerró antes de terminar' });

  s.session('c1', s.core, { activity: { state: 'working', label: 'Working' } });
  const slow = await runAsync(s.dir, ['esperar', 'core'], { ...s.env, SALA_WAIT_TIMEOUT_MS: '400' });
  assert.equal(slow.code, 1);
  assert.deepEqual(JSON.parse(slow.stderr), { error: 'core: sigue trabajando después de 0.4 s' });

  fs.rmSync(s.agentDir, { recursive: true, force: true });
  const none = await runAsync(s.dir, ['esperar', 'core'], s.env);
  assert.equal(none.code, 1);
  assert.deepEqual(JSON.parse(none.stderr), { error: 'core: no tiene una sesión viva; corré sala abrir core' });
});
