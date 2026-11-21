'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir, writeSala, salaConfig, runSala } = require('./helpers');

const FAKE_ORCA = path.join(__dirname, 'fixtures', 'fake-orca.js');
const FAKE_WT = path.join(__dirname, 'fixtures', 'fake-wt.js');

// A sala with one member folder, a feed folder and fake launchers. The fake
// launchers never open anything: they log their arguments and, when asked,
// write the snapshot that a starting session would publish.
function setup(t, options) {
  const dir = tempDir(t);
  const work = path.join(dir, 'core');
  fs.mkdirSync(work);
  const agentDir = path.join(dir, 'agent');
  const log = path.join(dir, 'launcher.log');
  fs.writeFileSync(log, '');
  writeSala(dir, { ...salaConfig([{ id: 'core', prefix: 'CORE', path: work, base: 'main' }]), ...(options ? { options } : {}) });
  const env = {
    SALA_ORCA: FAKE_ORCA,
    SALA_WT: FAKE_WT,
    SALA_FEED_ROOTS: agentDir,
    SALA_OPEN_TIMEOUT_MS: '3000',
    FAKE_LOG: log,
    FAKE_SNAPSHOT: path.join(agentDir, 'desktop', 'sessions'),
    FAKE_SNAPSHOT_CWD: work,
    FAKE_PID: String(process.pid),
  };
  const calls = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const stateFile = path.join(dir, '.sala', 'estado.json');
  const state = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  return { dir, work, agentDir, env, calls, stateFile, state };
}

function deadPid() {
  const res = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(res.stdout);
}

function liveSnapshot(agentDir, cwd, pid = process.pid) {
  const dir = path.join(agentDir, 'desktop', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'vieja.json'), JSON.stringify({
    schema: 'gentle-shell.desktop-feed/v1',
    identity: { sessionId: 'vieja', cwd, realCwd: cwd, pid, mode: 'tui' },
    activity: { state: 'working', label: 'Working' },
    pendingQuestion: null,
  }));
}

const orcaCreate = (work) => ({
  tool: 'orca',
  args: ['terminal', 'create', '--worktree', `path:${work}`, '--title', 'core', '--command', 'gentle-shell', '--json'],
});

test('sala abrir opens the member in Orca, waits for its snapshot and records the handle', (t) => {
  const s = setup(t);

  const res = runSala(s.dir, ['abrir', 'core'], s.env);

  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  const out = JSON.parse(res.stdout);
  assert.deepEqual(out, { member: 'core', action: 'opened', launcher: 'orca', handle: 'term_fake1', title: 'core', session: 'nueva' });
  // auto asks Orca first whether it answers, then opens inside the member's Orca project.
  assert.deepEqual(s.calls(), [{ tool: 'orca', args: ['terminal', 'list', '--json'] }, orcaCreate(s.work)]);
  const record = s.state().members.core;
  assert.equal(s.state().schema, 1);
  assert.deepEqual({ ...record, openedAt: typeof record.openedAt }, {
    launcher: 'orca', handle: 'term_fake1', title: 'core', session: 'nueva', openedAt: 'string',
  });
});

test('sala abrir reuses a live session and opens nothing; a dead pid does not count', (t) => {
  const s = setup(t, { launcher: 'orca' });
  liveSnapshot(s.agentDir, path.join(s.work, 'src'));

  const reused = runSala(s.dir, ['abrir', 'core', '--texto'], s.env);

  assert.equal(reused.code, 0, reused.stderr);
  assert.equal(reused.stdout, 'core: ya tiene una sesión viva (vieja); no se abrió otra\n');
  assert.deepEqual(s.calls(), []);
  assert.equal(fs.existsSync(s.stateFile), false);

  liveSnapshot(s.agentDir, s.work, deadPid());
  const opened = runSala(s.dir, ['abrir', 'core'], s.env);

  assert.equal(opened.code, 0, opened.stderr);
  assert.equal(JSON.parse(opened.stdout).action, 'opened');
  assert.deepEqual(s.calls(), [orcaCreate(s.work)]);
});

test('sala abrir falls back to Windows Terminal when Orca does not answer', (t) => {
  const s = setup(t, { launcher: 'auto' });

  const res = runSala(s.dir, ['abrir', 'core'], { ...s.env, FAKE_ORCA_DOWN: '1' });

  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    member: 'core', action: 'opened', launcher: 'wt', handle: null, title: 'sala-core', session: 'nueva',
  });
  assert.deepEqual(s.calls(), [
    { tool: 'orca', args: ['terminal', 'list', '--json'] },
    { tool: 'wt', args: ['-w', '0', 'new-tab', '-d', s.work, '--title', 'sala-core', 'powershell', '-NoExit', '-Command', 'gentle-shell'] },
  ]);
  assert.equal(s.state().members.core.launcher, 'wt');
});

test('sala abrir with launcher orca and Orca down fails without Windows Terminal or a record', (t) => {
  const s = setup(t, { launcher: 'orca' });

  const res = runSala(s.dir, ['abrir', 'core'], { ...s.env, FAKE_ORCA_DOWN: '1' });

  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.deepEqual(JSON.parse(res.stderr), { error: 'core: Orca no pudo abrir la terminal: Orca is not running' });
  assert.deepEqual(s.calls(), [orcaCreate(s.work)]);
  assert.equal(fs.existsSync(s.stateFile), false);
});

test('sala abrir keeps the handle when the session never publishes its snapshot', (t) => {
  const s = setup(t, { launcher: 'orca' });

  const res = runSala(s.dir, ['abrir', 'core'], { ...s.env, FAKE_SNAPSHOT: '', SALA_OPEN_TIMEOUT_MS: '600' });

  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.deepEqual(JSON.parse(res.stderr), {
    error: 'core: se abrió la terminal term_fake1, pero Gentle Shell no publicó su sesión en 0.6 s',
  });
  assert.equal(s.state().members.core.handle, 'term_fake1');
  assert.equal(s.state().members.core.session, null);
});

test('sala abrir never prints a credential from an Orca error answered on stdout', (t) => {
  const s = setup(t, { launcher: 'orca' });
  const fake = path.join(s.dir, 'orca-leak.js');
  const leak = 'https://u:ghp_abcdefghijklmnopqrstuvwxyz0123@x.com';
  fs.writeFileSync(fake, `process.stdout.write(JSON.stringify({ ok: false, error: { message: '${leak}' } }))`);

  const res = runSala(s.dir, ['abrir', 'core'], { ...s.env, SALA_ORCA: fake });

  assert.equal(res.code, 1);
  assert.deepEqual(JSON.parse(res.stderr), { error: 'core: Orca no pudo abrir la terminal: https://***@x.com' });
  assert.equal(fs.existsSync(s.stateFile), false);
});

test('sala abrir waits for no other abrir: a fresh lock refuses, launching nothing', (t) => {
  const s = setup(t, { launcher: 'orca' });
  const lock = path.join(s.dir, '.sala', 'abrir.lock');
  fs.mkdirSync(path.dirname(lock));
  fs.writeFileSync(lock, '');

  const res = runSala(s.dir, ['abrir', 'core'], s.env);

  assert.equal(res.code, 1);
  assert.deepEqual(JSON.parse(res.stderr), {
    error: 'otra sala abrir está en curso en esta sala; si no hay ninguna, borrá .sala/abrir.lock',
  });
  assert.deepEqual(s.calls(), []);
  assert.equal(fs.existsSync(s.stateFile), false);

  // A lock older than any abrir is left over from a cut run and does not count.
  const old = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(lock, old, old);
  assert.equal(runSala(s.dir, ['abrir', 'core'], s.env).code, 0);
  assert.equal(fs.existsSync(lock), false);
});

test('sala abrir does not orphan an Orca terminal still open from an abrir that timed out', (t) => {
  const s = setup(t, { launcher: 'orca' });
  const env = { ...s.env, FAKE_SNAPSHOT: '', SALA_OPEN_TIMEOUT_MS: '300' };
  assert.equal(runSala(s.dir, ['abrir', 'core'], env).code, 1);
  const before = fs.readFileSync(s.stateFile, 'utf8');

  const res = runSala(s.dir, ['abrir', 'core'], { ...env, FAKE_ORCA_TERMINALS: 'term_fake1' });

  assert.equal(res.code, 1);
  assert.deepEqual(JSON.parse(res.stderr), {
    error: 'core: la terminal term_fake1 que abrió la sala sigue abierta sin sesión; mirala con sala mostrar core',
  });
  assert.equal(s.calls().filter((c) => c.args[1] === 'create').length, 1);
  assert.equal(fs.readFileSync(s.stateFile, 'utf8'), before);
});

test('sala abrir refuses an unknown member, a missing folder or an unreadable state, launching nothing', (t) => {
  const s = setup(t, { launcher: 'orca' });

  const unknown = runSala(s.dir, ['abrir', 'web'], s.env);
  assert.equal(unknown.code, 1);
  assert.deepEqual(JSON.parse(unknown.stderr), { error: 'no hay un miembro web en sala.json' });

  fs.mkdirSync(path.dirname(s.stateFile));
  fs.writeFileSync(s.stateFile, '{roto');
  const broken = runSala(s.dir, ['abrir', 'core'], s.env);
  assert.equal(broken.code, 1);
  assert.deepEqual(JSON.parse(broken.stderr), { error: '.sala/estado.json no es JSON válido; la sala no lo pisa' });
  assert.equal(fs.readFileSync(s.stateFile, 'utf8'), '{roto');

  fs.rmSync(s.stateFile);
  fs.rmSync(s.work, { recursive: true });
  const missing = runSala(s.dir, ['abrir', 'core'], s.env);
  assert.equal(missing.code, 1);
  assert.deepEqual(JSON.parse(missing.stderr), { error: `core: la carpeta no existe: ${s.work}` });

  assert.deepEqual(s.calls(), []);
  assert.equal(fs.existsSync(s.stateFile), false);
});

test('sala mostrar switches to the Orca terminal the sala opened, and says why when it cannot', (t) => {
  const s = setup(t, { launcher: 'orca' });

  const none = runSala(s.dir, ['mostrar', 'core'], s.env);
  assert.equal(none.code, 1);
  assert.deepEqual(JSON.parse(none.stderr), { error: 'core: la sala no abrió una terminal; corré sala abrir core' });

  assert.equal(runSala(s.dir, ['abrir', 'core'], s.env).code, 0);
  const gone = runSala(s.dir, ['mostrar', 'core'], s.env);
  assert.equal(gone.code, 1);
  assert.deepEqual(JSON.parse(gone.stderr), { error: 'core: la terminal term_fake1 ya no existe en Orca; corré sala abrir core' });

  const shown = runSala(s.dir, ['mostrar', 'core'], { ...s.env, FAKE_ORCA_TERMINALS: 'term_otra,term_fake1' });
  assert.equal(shown.code, 0, shown.stderr);
  assert.deepEqual(JSON.parse(shown.stdout), { member: 'core', launcher: 'orca', shown: true, title: 'core' });
  assert.deepEqual(s.calls().slice(-2), [
    { tool: 'orca', args: ['terminal', 'list', '--json'] },
    { tool: 'orca', args: ['terminal', 'switch', '--terminal', 'term_fake1', '--json'] },
  ]);
});

test('sala mostrar names the Windows Terminal tab, which it cannot bring forward', (t) => {
  const s = setup(t, { launcher: 'wt' });
  assert.equal(runSala(s.dir, ['abrir', 'core'], s.env).code, 0);

  const res = runSala(s.dir, ['mostrar', 'core', '--texto'], s.env);

  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stdout, 'core: en Windows Terminal, la pestaña «sala-core»\n');
  assert.equal(s.calls().length, 1);
});

test('sala abrir with Windows Terminal refuses a path with ";", which wt reads as a new command', (t) => {
  const s = setup(t, { launcher: 'wt' });
  const odd = path.join(s.dir, 'a;b');
  fs.mkdirSync(odd);
  writeSala(s.dir, { ...salaConfig([{ id: 'core', prefix: 'CORE', path: odd, base: 'main' }]), options: { launcher: 'wt' } });

  const res = runSala(s.dir, ['abrir', 'core'], s.env);

  assert.equal(res.code, 1);
  assert.deepEqual(JSON.parse(res.stderr), { error: 'core: Windows Terminal no abre una ruta con «;»; usá Orca' });
  assert.deepEqual(s.calls(), []);
});

test('sala estado --retomar sums up what the sala opened and each live session, without git', (t) => {
  const s = setup(t, { launcher: 'orca' });
  assert.equal(runSala(s.dir, ['abrir', 'core'], s.env).code, 0);

  const res = runSala(s.dir, ['estado', '--retomar'], s.env);

  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.sala, 'prueba');
  assert.deepEqual(out.members.map((m) => ({ ...m, opened: m.opened && { ...m.opened, openedAt: typeof m.opened.openedAt } })), [{
    id: 'core',
    opened: { launcher: 'orca', handle: 'term_fake1', title: 'core', session: 'nueva', openedAt: 'string' },
    sessions: [{ id: 'nueva', state: 'idle', label: 'Idle', question: null }],
  }]);

  const text = runSala(s.dir, ['estado', '--retomar', '--texto'], s.env);
  assert.equal(text.stdout, 'Sala prueba\ncore  abierta por la sala en orca (term_fake1); sesión nueva: libre\n');
});

test('options.launcher accepts auto, orca or wt; the old transport option still validates', (t) => {
  const s = setup(t, { launcher: 'tmux', transport: 'orca' });

  const res = runSala(s.dir, ['abrir', 'core'], s.env);

  assert.equal(res.code, 1);
  assert.deepEqual(JSON.parse(res.stderr), {
    error: 'sala.json no es válido',
    details: ['options.launcher: debe ser auto, orca o wt'],
  });
  assert.deepEqual(s.calls(), []);
});
