'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { feedSala, runAsync, writeSala, salaConfig } = require('./helpers');

const choice = (id, text, options, extra = {}) => ({
  pendingQuestion: { kind: 'choice', toolCallId: id, question: text, options: options.map((label) => ({ label })), terminalOnly: false, ...extra },
});

// The sala opened the member's tab in Windows Terminal: sala mostrar knows its title.
function openedInWt(dir, id) {
  fs.mkdirSync(path.join(dir, '.sala'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.sala', 'estado.json'), JSON.stringify({
    schema: 1,
    members: { [id]: { launcher: 'wt', handle: null, title: `sala-${id}`, session: `id-c1`, openedAt: '2026-11-21T00:00:00.000Z' } },
  }));
}

test('sala preguntas lists every open question of the sala, whole, with where it is answered', async (t) => {
  const s = feedSala(t);
  s.session('c1', s.core, choice('q1', '¿Sigo con SK2?', ['Sí', 'No']));
  s.session('w1', s.web, choice('q2', '¿Aceptás la revisión?', ['granted', 'declined']));
  s.session('w2', path.join(s.web, 'src'), choice('q3', '¿Qué archivos?', ['a', 'b'], { terminalOnly: true }));

  const res = await runAsync(s.dir, ['preguntas'], s.env);

  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    questions: [
      { member: 'core', session: 'id-c1', id: 'q1', class: 'option', text: '¿Sigo con SK2?', options: ['Sí', 'No'] },
      { member: 'web', session: 'id-w1', id: 'q2', class: 'consent', text: '¿Aceptás la revisión?', options: ['granted', 'declined'] },
      { member: 'web', session: 'id-w2', id: 'q3', class: 'terminal', text: '¿Qué archivos?', options: ['a', 'b'] },
    ],
    warnings: [],
  });

  const texto = await runAsync(s.dir, ['preguntas', '--texto'], s.env);
  assert.equal(texto.stdout, [
    'core (sesión id-c1, pregunta q1): ¿Sigo con SK2?',
    '  opciones: Sí | No',
    '  se contesta desde la sala: sala responder core <opción> --pregunta q1',
    'web (sesión id-w1, pregunta q2): ¿Aceptás la revisión?',
    '  opciones: granted | declined',
    '  es un consentimiento: se contesta en la pestaña del miembro (sala mostrar web)',
    'web (sesión id-w2, pregunta q3): ¿Qué archivos?',
    '  opciones: a | b',
    '  se contesta en la pestaña del miembro (sala mostrar web)',
    '',
  ].join('\n'));
});

test('sala responder delivers the person\'s option with answer_question and logs it', async (t) => {
  const s = feedSala(t);
  s.session('c1', s.core, choice('q1', '¿Sigo?', ['Sí', 'No']));
  const seen = s.answer('c1');

  const res = await runAsync(s.dir, ['responder', 'core', 'Sí', '--pregunta', 'q1'], s.env);

  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  assert.deepEqual(JSON.parse(res.stdout), { member: 'core', session: 'id-c1', question: 'q1', option: 'Sí', answered: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'answer_question');
  assert.equal(seen[0].sessionId, 'id-c1');
  // Gentle Shell takes the index of the option, not its label.
  assert.deepEqual(seen[0].args, { toolCallId: 'q1', option: 0, via: 'session' });
  assert.deepEqual(s.log().map(({ at, ...rest }) => rest), [
    { member: 'core', session: 'id-c1', question: 'q1', text: 'Sí', result: 'answering' },
    { member: 'core', session: 'id-c1', question: 'q1', text: 'Sí', result: 'answered' },
  ]);
});

test('the sala cannot answer on its own: without the shown question, a changed one or an invented answer nothing goes', async (t) => {
  const s = feedSala(t);
  s.session('c1', s.core, choice('q1', '¿Borro la rama?', ['Sí', 'No']));
  const cases = [
    { args: ['responder', 'core', 'Sí'], error: 'sala responder necesita --pregunta <id>, el que mostró sala preguntas' },
    // The question changed since sala preguntas showed q0: the answer was not for this one.
    { args: ['responder', 'core', 'Sí', '--pregunta', 'q0'], error: 'core: la pregunta q0 ya no está abierta; mirá sala preguntas' },
    { args: ['responder', 'core', 'Dale, borrala', '--pregunta', 'q1'], error: 'core: «Dale, borrala» no es una opción de la pregunta q1 (Sí, No)' },
    { args: ['responder', 'web', 'Sí', '--pregunta', 'q1'], error: 'web: la pregunta q1 ya no está abierta; mirá sala preguntas' },
  ];
  for (const c of cases) {
    const res = await runAsync(s.dir, c.args, s.env);

    assert.equal(res.code, 1, c.error);
    assert.equal(res.stdout, '');
    assert.deepEqual(JSON.parse(res.stderr), { error: c.error });
    assert.deepEqual(s.inbox('c1'), [], c.error);
  }
  assert.deepEqual(s.log().map((l) => [l.member, l.question, l.result]), [
    ['core', null, 'refused'], ['core', 'q0', 'refused'], ['core', 'q1', 'refused'], ['web', 'q1', 'refused'],
  ]);
});

test('a consent or a terminal question is never answered from the sala: it shows the member tab', async (t) => {
  const s = feedSala(t);
  openedInWt(s.dir, 'core');
  const cases = [
    {
      extra: choice('q1', '¿Aceptás la revisión?', ['granted', 'declined']),
      option: 'granted',
      error: 'core: la pregunta q1 es un consentimiento; contestala en la pestaña del miembro: en Windows Terminal, la pestaña «sala-core»',
    },
    {
      extra: choice('q1', '¿Cuáles?', ['a', 'b'], { terminalOnly: true }),
      option: 'a',
      error: 'core: la pregunta q1 se contesta en la terminal; contestala en la pestaña del miembro: en Windows Terminal, la pestaña «sala-core»',
    },
  ];
  for (const c of cases) {
    fs.rmSync(s.agentDir, { recursive: true, force: true });
    s.session('c1', s.core, c.extra);

    const res = await runAsync(s.dir, ['responder', 'core', c.option, '--pregunta', 'q1'], s.env);

    assert.equal(res.code, 1, c.error);
    assert.deepEqual(JSON.parse(res.stderr), { error: c.error });
    assert.deepEqual(s.inbox('c1'), [], c.error);
  }
  assert.deepEqual(s.log().map((l) => l.result), ['terminal', 'terminal']);
});

test('a secret never leaves sala responder or sala preguntas unmasked', async (t) => {
  const s = feedSala(t);
  const token = `ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2'.repeat(2).slice(0, 36)}`;
  s.session('c1', s.core, choice('q1', '¿Cuál?', [token, 'No']));
  s.answer('c1');

  const runs = [
    await runAsync(s.dir, ['responder', 'core', 'No', '--pregunta', token], s.env),
    await runAsync(s.dir, ['responder', 'core', token, '--pregunta', 'q1'], s.env),
    await runAsync(s.dir, ['responder', 'core', token, '--pregunta', 'q1', '--texto'], s.env),
    await runAsync(s.dir, ['preguntas', '--texto'], s.env),
  ];

  assert.deepEqual(runs.map((r) => r.code), [1, 0, 0, 0]);
  for (const r of runs) assert.ok(!(r.stdout + r.stderr).includes(token), r.stdout + r.stderr);
  assert.ok(!fs.readFileSync(path.join(s.dir, '.sala', 'ordenes.log'), 'utf8').includes(token));
});

test('a nested member\'s question or a disguised consent never reaches an inbox, and --pregunta goes once', async (t) => {
  const s = feedSala(t);
  const sub = path.join(s.core, 'sub');
  fs.mkdirSync(sub);
  writeSala(s.dir, salaConfig([
    { id: 'core', prefix: 'CORE', path: s.core, base: 'main' },
    { id: 'sub', prefix: 'SUB', path: sub, base: 'main' },
  ]));
  s.session('n1', sub, choice('qn', '¿Sigo?', ['Sí']));
  s.session('c1', s.core, choice('q1', '¿Aceptás?', ['gr​anted', 'No']));

  const nested = await runAsync(s.dir, ['responder', 'core', 'Sí', '--pregunta', 'qn'], s.env);
  const consent = await runAsync(s.dir, ['responder', 'core', 'gr​anted', '--pregunta', 'q1'], s.env);
  const twice = await runAsync(s.dir, ['responder', 'sub', 'Sí', '--pregunta', 'qx', '--pregunta', 'qn'], s.env);

  assert.deepEqual(JSON.parse(nested.stderr), { error: 'core: la pregunta qn ya no está abierta; mirá sala preguntas' });
  assert.equal(consent.code, 1);
  assert.match(JSON.parse(consent.stderr).error, /^core: la pregunta q1 es un consentimiento;/);
  assert.deepEqual(JSON.parse(twice.stderr), { error: '--pregunta va una sola vez' });
  assert.deepEqual([...s.inbox('n1'), ...s.inbox('c1')], []);
});
