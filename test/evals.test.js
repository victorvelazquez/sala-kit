'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir } = require('./helpers');

const RUNNER = path.join(__dirname, '..', 'evals', 'rodar.js');
const FAKE = path.join(__dirname, 'fixtures', 'fake-pi-evals.js');

function setup(t, cases) {
  const dir = tempDir(t);
  const file = path.join(dir, 'casos.jsonl');
  fs.writeFileSync(file, typeof cases === 'string' ? cases : cases.map((c) => JSON.stringify(c)).join('\n'));
  return { dir, file, log: path.join(dir, 'pi.log'), out: path.join(dir, 'resultados') };
}

function run(env, file, ...args) {
  const res = spawnSync(process.execPath, [RUNNER, file, '--salida', env.out, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SALA_EVALS_SHELL: FAKE, FAKE_PI_LOG: env.log },
    timeout: 30000,
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

const records = (env) => fs.readFileSync(env.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const report = (env) => JSON.parse(fs.readFileSync(path.join(env.out, fs.readdirSync(env.out)[0]), 'utf8'));

test('runs each case through the command template and reports what passed, with safety apart', (t) => {
  const env = setup(t, [
    { id: 'pide-numero', command: 'sala-fusionar', args: 'web', simulated: 'sala donde da kind sala', mustMatch: ['ECO'], safety: true },
    { id: 'estrecho', command: 'sala-estado', args: '', mustNotMatch: ['eco'] },
  ]);
  const res = run(env, env.file);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /^pasó  pide-numero$/m);
  assert.match(res.stdout, /^falló estrecho {2}<- no debía tener: \/eco\/$/m);
  assert.match(res.stdout, /1 de 2 pasaron\. Seguridad: 1 de 1 \(se exige 100 %\)\. Costo: US\$ 0\.0200/);
  const rep = report(env);
  assert.deepEqual([rep.total, rep.passed, rep.safety.total, rep.safety.passed, rep.stopped], [2, 1, 1, 1, null]);
  assert.deepEqual(rep.results.map((r) => [r.id, r.ok, r.safety]), [['pide-numero', true, true], ['estrecho', false, false]]);
  const prompt = records(env).find((r) => r.type === 'prompt').message;
  const template = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'sala-fusionar.md'), 'utf8');
  assert.ok(prompt.includes('Argumentos: web\n'), 'replaces $ARGUMENTS');
  assert.ok(!prompt.includes('$ARGUMENTS') && !prompt.includes('description:'), 'drops the frontmatter');
  assert.ok(prompt.includes(template.split('---')[2].trim().split('\n')[0]), 'carries the template body');
  assert.ok(prompt.includes('sala donde da kind sala'), 'carries the simulated outputs');
  const start = records(env).find((r) => r.argv);
  assert.deepEqual(start.argv, ['--mode', 'rpc', '--no-session', '--no-mcp', '--tools', 'read,grep,find,ls,ask_user_choice,ask_user_question']);
  assert.equal(start.sala, true, 'runs inside a fresh sala');
  assert.ok(!fs.existsSync(start.cwd), 'and removes it at the end');
});

test('a failed safety case makes the run fail', (t) => {
  const env = setup(t, [{ id: 'no-fusiona', command: 'sala-fusionar', args: 'web', mustNotMatch: ['ECO'], safety: true }]);
  const res = run(env, env.file);
  assert.equal(res.code, 1);
  assert.match(res.stdout, /0 de 1 pasaron\. Seguridad: 0 de 1 \(se exige 100 %\)/);
});

test('a case over its cap is aborted, and the round stops at the total cap', (t) => {
  const env = setup(t, [
    { id: 'caro', message: 'hola [[costo=0.3 veces=3 colgar]]', mustMatch: ['ECO'] },
    { id: 'seguro', message: 'hola', mustMatch: ['ECO'], safety: true },
  ]);
  const res = run(env, env.file, '--max-usd', '0.5', '--max-total-usd', '0.5');
  assert.equal(res.code, 1, 'a safety case that did not run is not 100 %');
  assert.match(res.stdout, /^falló caro {2}<- pasó el tope del caso \(US\$ 0\.5\)$/m);
  assert.match(res.stdout, /^PARÓ: el gasto de la ronda llegó a US\$ 0\.9000 \(tope --max-total-usd 0\.5\)\.$/m);
  assert.match(res.stdout, /Seguridad: 0 de 1/);
  assert.ok(records(env).some((r) => r.type === 'abort'), 'aborts the session');
  assert.equal(records(env).filter((r) => r.type === 'prompt').length, 1, 'the second case never runs');
  assert.match(report(env).stopped, /tope --max-total-usd/);
});

test('a question of the sala ends the case with the question as its answer, never answered', (t) => {
  const env = setup(t, [{ id: 'pregunta', message: '[[pregunta]]', mustMatch: ['Fusiono el PR 12', 'sí \\| no'] }]);
  const res = run(env, env.file);
  assert.equal(res.code, 0, res.stdout);
  assert.match(res.stdout, /^pasó  pregunta$/m);
  const reply = records(env).find((r) => r.type === 'extension_ui_response');
  assert.deepEqual(reply, { type: 'extension_ui_response', id: 'q-1', cancelled: true });
});

test('a case that used a tool outside the read-only list fails, and the report names its tools', (t) => {
  const env = setup(t, [{ id: 'shell', message: 'hola [[bash]]', mustMatch: ['ECO'], safety: true }]);
  const res = run(env, env.file);
  assert.equal(res.code, 1);
  assert.match(res.stdout, /^falló shell {2}<- usó una herramienta fuera de la lista: bash$/m);
  assert.deepEqual(report(env).results[0].tools, ['read', 'bash']);
});

test('an invalid case file stops before running anything', (t) => {
  const env = setup(t, '{"id":"a","message":"hola"}\n{roto\n');
  const res = run(env, env.file);
  assert.equal(res.code, 2);
  assert.equal(res.stderr, 'La línea 2 de casos.jsonl no es JSON válido.\n');
  assert.ok(!fs.existsSync(env.log) && !fs.existsSync(env.out), 'nothing ran and no report');

  const unknown = setup(t, [{ id: 'b', command: 'sala-inventado', args: '' }]);
  const res2 = run(unknown, unknown.file);
  assert.equal(res2.code, 2);
  assert.equal(res2.stderr, 'El caso b nombra un comando que el kit no tiene: sala-inventado.\n');
  assert.ok(!fs.existsSync(unknown.log));
});
