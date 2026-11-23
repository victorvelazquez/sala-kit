'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { feedSala, runSala } = require('./helpers');

const TOKEN = `ghp_${'a1B2'.repeat(9)}`;
const KEY = ['-----BEGIN OPENSSH PRIVATE KEY-----', 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ', '-----END OPENSSH PRIVATE KEY-----'].join('\n');

const entry = (id, message, timestamp = '2026-11-22T10:00:00.000Z') => JSON.stringify({ type: 'message', id, parentId: null, timestamp, message });
const text = (t) => ({ type: 'text', text: t });

function setup(t, lines, { file = path.join('sessions', '--c-core--', '2026_c1.jsonl') } = {}) {
  const s = feedSala(t);
  const sessionFile = path.isAbsolute(file) ? file : path.join(s.agentDir, file);
  if (lines) {
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, `${lines.join('\n')}\n`);
  }
  s.session('c1', s.core, { identity: { sessionId: 'id-c1', cwd: s.core, realCwd: s.core, pid: process.pid, mode: 'tui', sessionFile } });
  return s;
}

const REPLY = [
  JSON.stringify({ type: 'session', version: 3, id: 'id-c1', timestamp: '2026-11-22T09:00:00.000Z', cwd: '.' }),
  entry('a1', { role: 'user', content: 'hola' }),
  entry('a2', { role: 'assistant', content: [text('una respuesta vieja')], stopReason: 'stop' }),
  entry('a3', { role: 'user', content: '/flow-avance' }),
  entry('a4', { role: 'assistant', content: [{ type: 'toolCall', id: 'call_1', name: 'bash', arguments: {} }], stopReason: 'toolUse' }),
  entry('a5', { role: 'toolResult', toolCallId: 'call_1', toolName: 'bash', content: [text('salida')], isError: false }),
  entry('a6', { role: 'assistant', content: [{ type: 'thinking', thinking: 'pienso' }, text('Informe:\n\tlínea 2'), text(`token ${TOKEN}\n${KEY}\u202e fin`)], stopReason: 'stop' }, '2026-11-22T10:05:00.000Z'),
  JSON.stringify({ type: 'label', id: 'a7', parentId: 'a6', timestamp: '2026-11-22T10:06:00.000Z', targetId: 'a6', label: 'x' }),
];

test('sala respuesta shows the last reply of the member session, with every secret masked', (t) => {
  const s = setup(t, REPLY);

  const res = runSala(s.dir, ['respuesta', 'core'], s.env);
  const texto = runSala(s.dir, ['respuesta', 'core', '--texto'], s.env);

  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  assert.deepEqual(JSON.parse(res.stdout), {
    member: 'core',
    session: 'id-c1',
    at: '2026-11-22T10:05:00.000Z',
    text: 'Informe:\n\tlínea 2\ntoken [token de GitHub]\n[clave privada] fin',
    truncated: false,
  });
  assert.equal(texto.code, 0, texto.stderr);
  assert.equal(texto.stdout, 'core: última respuesta de la sesión id-c1 (2026-11-22T10:05:00.000Z)\n\nInforme:\n\tlínea 2\ntoken [token de GitHub]\n[clave privada] fin\n');
  for (const out of [res.stdout, texto.stdout]) {
    assert.ok(!out.includes('a1B2a1B2') && !out.includes('b3BlbnNzaC1'), 'a secret got out');
  }
  // Reading a reply is not an order: nothing is logged.
  assert.deepEqual(s.log(), []);
});

test('sala respuesta clips a long reply and says so', (t) => {
  const s = setup(t, [entry('b1', { role: 'assistant', content: [text('x'.repeat(9000))] })]);

  const res = runSala(s.dir, ['respuesta', 'core'], s.env);
  const texto = runSala(s.dir, ['respuesta', 'core', '--texto'], s.env);

  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.text, 'x'.repeat(8000));
  assert.equal(out.truncated, true);
  assert.ok(texto.stdout.endsWith(`${'x'.repeat(8000)}\n(recortada a 8000 caracteres)\n`));
});

test('sala respuesta refuses a session file it cannot trust or read, without leaking it', (t) => {
  const outside = (s) => path.join(s.core, 'notas.jsonl');
  const cases = [
    { name: 'no session', make: (tt) => feedSala(tt), error: 'core: no tiene una sesión viva; corré sala abrir core' },
    {
      name: 'no sessionFile',
      make: (tt) => { const s = feedSala(tt); s.session('c1', s.core); return s; },
      error: 'core: la sesión id-c1 no publica su archivo de sesión',
    },
    {
      name: 'outside the sessions folder',
      make: (tt) => {
        const s = feedSala(tt);
        fs.writeFileSync(outside(s), `${entry('c1', { role: 'assistant', content: [text(`secreto ${TOKEN}`)] })}\n`);
        s.session('c1', s.core, { identity: { sessionId: 'id-c1', cwd: s.core, realCwd: s.core, pid: process.pid, sessionFile: outside(s) } });
        return s;
      },
      error: 'core: el archivo de sesión de id-c1 no es un .jsonl de la carpeta sessions de Gentle Shell',
    },
    {
      name: 'climbing out with ..',
      make: (tt) => setup(tt, REPLY, { file: path.join('sessions', '..', 'otro.jsonl') }),
      error: 'core: el archivo de sesión de id-c1 no es un .jsonl de la carpeta sessions de Gentle Shell',
    },
    {
      name: 'not a jsonl',
      make: (tt) => setup(tt, REPLY, { file: path.join('sessions', 'c1.json') }),
      error: 'core: el archivo de sesión de id-c1 no es un .jsonl de la carpeta sessions de Gentle Shell',
    },
    {
      name: 'missing file',
      make: (tt) => setup(tt, null),
      error: 'core: no se pudo leer el archivo de sesión de id-c1 (ENOENT)',
    },
    {
      name: 'no reply yet',
      make: (tt) => setup(tt, [REPLY[0], REPLY[1], '{roto', entry('d1', { role: 'assistant', content: [{ type: 'toolCall', id: 'x', name: 'y', arguments: {} }] })]),
      error: 'core: la sesión id-c1 todavía no respondió nada',
    },
  ];
  for (const c of cases) {
    const s = c.make(t);
    const res = runSala(s.dir, ['respuesta', 'core'], s.env);
    assert.equal(res.code, 1, c.name);
    assert.equal(res.stdout, '', c.name);
    assert.deepEqual(JSON.parse(res.stderr), { error: c.error }, c.name);
    assert.ok(!res.stderr.includes('a1B2a1B2'), c.name);
  }
});

test('sala respuesta never rebuilds a masked secret by dropping hidden characters', (t) => {
  const body = 'a1B2'.repeat(9);
  for (const h of ['\u202e', '\u0001', '\u200b', '\u00ad', '\u2066', '\r']) {
    const s = setup(t, [entry('h1', { role: 'assistant', content: [text(`t gh${h}p_${body}\nk -----BEGIN${h} RSA PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA`)] })]);
    for (const args of [['respuesta', 'core'], ['respuesta', 'core', '--texto']]) {
      const res = runSala(s.dir, args, s.env);
      assert.equal(res.code, 0, res.stderr);
      assert.ok(!res.stdout.includes('a1B2a1B2') && !res.stdout.includes('b3BlbnNzaC1'), JSON.stringify(h));
    }
  }
});

test('sala respuesta skips an empty text and refuses a hard link to a file outside', (t) => {
  const s = setup(t, [
    entry('e1', { role: 'assistant', content: [text('la de antes')] }),
    entry('e2', { role: 'assistant', content: [text(''), { type: 'toolCall', id: 'x', name: 'y', arguments: {} }] }),
  ]);
  assert.equal(JSON.parse(runSala(s.dir, ['respuesta', 'core'], s.env).stdout).text, 'la de antes');

  const h = feedSala(t);
  const outside = path.join(h.core, 'afuera.jsonl');
  fs.writeFileSync(outside, `${entry('f1', { role: 'assistant', content: [text(`secreto ${TOKEN}`)] })}\n`);
  const linked = path.join(h.agentDir, 'sessions', 'c1.jsonl');
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  fs.linkSync(outside, linked);
  h.session('c1', h.core, { identity: { sessionId: 'id-c1', cwd: h.core, realCwd: h.core, pid: process.pid, sessionFile: linked } });
  const res = runSala(h.dir, ['respuesta', 'core'], h.env);
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.deepEqual(JSON.parse(res.stderr), { error: 'core: el archivo de sesión de id-c1 no es un .jsonl de la carpeta sessions de Gentle Shell' });
});
