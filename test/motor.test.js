'use strict';

// `sala motor` runs the copied engine (D22) in a member and checks the PR title (D23)
// before the engine seals it. The engine is never edited: it is spawned as it is.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir, runSala } = require('./helpers');

const ENGINE = path.join(__dirname, '..', 'engine', 'scripts');

// A store like the one `flow-pr --prepare` leaves: <temp>/flow-pr-request-<id>/intent.json.
function prStore(t, title, root = os.tmpdir()) {
  const id = crypto.randomBytes(32).toString('hex');
  const handle = `${id}.${crypto.randomBytes(32).toString('hex')}`;
  const dir = path.join(root, `flow-pr-request-${id}`);
  fs.mkdirSync(dir);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const intent = path.join(dir, 'intent.json');
  fs.writeFileSync(intent, `${JSON.stringify({ schema: 'flow-pr/intent-v2', title, body: 'b' }, null, 2)}\n`);
  return { handle, dir, intent };
}

function engine(cwd, script, args) {
  const res = spawnSync(process.execPath, [path.join(ENGINE, script), ...args], { cwd, encoding: 'utf8' });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

test('a malformed PR title is refused before the engine seals it, without echoing the title', (t) => {
  const cwd = tempDir(t);
  const store = prStore(t, 'add the thing ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  const before = fs.readFileSync(store.intent, 'utf8');
  const res = runSala(cwd, ['motor', 'pr', '--prepare', '--handle', store.handle]);
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.deepEqual(JSON.parse(res.stderr), {
    error: 'el título del PR no cumple el formato; corregilo en intent.json y volvé a correr este paso',
    details: [
      'el título debe ser tipo(ámbito)!: resultado, por ejemplo docs(guide): document theme H (M2c)',
      'el título debe terminar con el ID de la tarea entre paréntesis, por ejemplo (M2c)',
    ],
  });
  assert.doesNotMatch(res.stderr, /ghp_/);
  assert.equal(fs.readFileSync(store.intent, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(store.dir), ['intent.json']);
});

test('the title must be the one of the task and, with --jira, carry a Jira key', (t) => {
  const cwd = tempDir(t);
  const store = prStore(t, 'feat(core): keep the cart (CORE-1)');
  const other = runSala(cwd, ['motor', 'pr', '--prepare', '--handle', store.handle, '--tarea', 'CORE-2']);
  assert.equal(other.code, 1);
  assert.equal(other.stdout, '');
  assert.deepEqual(JSON.parse(other.stderr).details, ['el título termina con (CORE-1), pero la tarea es CORE-2']);
  const jira = runSala(cwd, ['motor', 'pr', '--prepare', '--handle', store.handle, '--jira']);
  assert.equal(jira.code, 1);
  assert.deepEqual(JSON.parse(jira.stderr).details, ['con options.jira el título debe llevar una clave de Jira, por ejemplo ABC-123']);
});

test('a well formed title reaches the engine, and its result comes back unchanged', (t) => {
  const cwd = tempDir(t);
  const store = prStore(t, 'feat(core): keep the cart (CORE-1)');
  const res = runSala(cwd, ['motor', 'pr', '--prepare', '--handle', store.handle, '--tarea', 'CORE-1']);
  // The fake store has no context.json, so the engine itself refuses it: what matters is that it ran.
  const direct = engine(cwd, 'flow-pr.mjs', ['--prepare', '--handle', store.handle]);
  assert.equal(res.stdout, direct.stdout);
  assert.equal(res.code, direct.code);
  assert.match(JSON.parse(res.stdout).schema, /^flow-pr\//);
});

test('a handle that is not one of the engine is refused without reading anything', (t) => {
  const cwd = tempDir(t);
  fs.writeFileSync(path.join(cwd, 'intent.json'), '{"title":"feat: x (A1)"}');
  for (const handle of ['../intent', `${'a'.repeat(64)}`, `${'a'.repeat(64)}.${'b'.repeat(64)}`]) {
    const res = runSala(cwd, ['motor', 'pr', '--prepare', '--handle', handle]);
    assert.equal(res.code, 1, handle);
    assert.equal(res.stdout, '', handle);
    assert.equal(JSON.parse(res.stderr).error, 'no encuentro el pedido de flow-pr de ese handle; volvé a correr sala motor pr --prepare', handle);
  }
});

test('other steps go to the engine as they are, with its output and exit code', (t) => {
  const cwd = tempDir(t);
  for (const [script, args] of [
    ['flow-commit.mjs', ['--prepare']],
    ['flow-pr.mjs', ['--execute', '--handle', `${'a'.repeat(64)}.${'b'.repeat(64)}`]],
    ['flow-pr.mjs', ['--nope']],
  ]) {
    const kind = script === 'flow-commit.mjs' ? 'commit' : 'pr';
    const res = runSala(cwd, ['motor', kind, ...args]);
    const direct = engine(cwd, script, args);
    assert.deepEqual(res, direct, `${kind} ${args.join(' ')}`);
  }
});

test('sala motor needs commit or pr', (t) => {
  const cwd = tempDir(t);
  for (const args of [['motor'], ['motor', 'push']]) {
    const res = runSala(cwd, args);
    assert.equal(res.code, 1);
    assert.equal(res.stdout, '');
    assert.deepEqual(JSON.parse(res.stderr), { error: 'sala motor necesita commit o pr' });
  }
});

test('every argument shape of the sealing step is checked before the engine', (t) => {
  const cwd = tempDir(t);
  const s = prStore(t, 'add the thing');
  for (const args of [
    ['--handle', s.handle, '--prepare'],
    ['--prepare', '--verbose', '--handle', s.handle],
    ['--prepare', '--handle', s.handle, '--handle', s.handle],
    ['--prepare', '--handle', '--tarea', 'A1', s.handle],
    ['--prepare', '--handle', s.handle, '--tarea', '-x'],
  ]) {
    const res = runSala(cwd, ['motor', 'pr', ...args]);
    assert.equal(res.code, 1, args.join(' '));
    assert.equal(res.stdout, '', args.join(' '));
  }
  assert.deepEqual(fs.readdirSync(s.dir), ['intent.json']);
});

test('kit flags outside the sealing step reach the engine unchanged', (t) => {
  const cwd = tempDir(t);
  const args = ['--prepare', '--tarea', 'A1'];
  assert.deepEqual(runSala(cwd, ['motor', 'pr', ...args]), engine(cwd, 'flow-pr.mjs', args));
});

test('the same temp folder written another way is one folder, not two', { skip: process.platform !== 'win32' || !process.env.LOCALAPPDATA }, (t) => {
  const cwd = tempDir(t);
  const standard = path.resolve(process.env.LOCALAPPDATA, 'Temp');
  const s = prStore(t, 'add the thing', standard);
  const other = standard.toLowerCase();
  const res = runSala(cwd, ['motor', 'pr', '--prepare', '--handle', s.handle], { TEMP: other, TMP: other });
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.match(JSON.parse(res.stderr).error, /^el título del PR no cumple el formato/);
});

test('a store present in two different temp folders is refused', { skip: process.platform !== 'win32' || !process.env.LOCALAPPDATA }, (t) => {
  const cwd = tempDir(t);
  const session = tempDir(t);
  const a = prStore(t, 'feat(core): keep the cart (CORE-1)', path.resolve(process.env.LOCALAPPDATA, 'Temp'));
  const id = a.handle.split('.')[0];
  fs.mkdirSync(path.join(session, `flow-pr-request-${id}`));
  fs.writeFileSync(path.join(session, `flow-pr-request-${id}`, 'intent.json'), '{"title":"x"}');
  const res = runSala(cwd, ['motor', 'pr', '--prepare', '--handle', a.handle], { TEMP: session, TMP: session });
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.equal(JSON.parse(res.stderr).error, 'no encuentro el pedido de flow-pr de ese handle; volvé a correr sala motor pr --prepare');
});

test('a store folder that is a link is never sealed, even with a good title', { skip: process.platform !== 'win32' || !process.env.LOCALAPPDATA }, (t) => {
  const cwd = tempDir(t);
  const target = tempDir(t);
  fs.writeFileSync(path.join(target, 'intent.json'), JSON.stringify({ title: 'feat(core): keep the cart (CORE-1)' }));
  const id = crypto.randomBytes(32).toString('hex');
  const link = path.join(path.resolve(process.env.LOCALAPPDATA, 'Temp'), `flow-pr-request-${id}`);
  fs.symlinkSync(target, link, 'junction');
  t.after(() => fs.unlinkSync(link));
  const res = runSala(cwd, ['motor', 'pr', '--prepare', '--handle', `${id}.${'b'.repeat(64)}`]);
  assert.notEqual(res.code, 0);
  assert.match(res.stdout, /"handle-unsafe"/);
});
