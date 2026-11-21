'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { feedSala, runAsync, memberRepo, pushRoadmap, roadmap, writeSala, salaConfig, git } = require('./helpers');

const FAKE_ORCA = path.join(__dirname, 'fixtures', 'fake-orca.js');
const FAKE_GH = path.join(__dirname, 'fixtures', 'fake-gh-merge.js');
const SHA = 'a'.repeat(40);
const OLD = { launcher: 'orca', handle: 'term_old', title: 'core', session: 'id-c1', openedAt: '2026-11-21T10:00:00.000Z' };

// A sala whose member core is a git repo on its clean base, with the live session c1
// in an Orca terminal the sala opened (term_old), and a fake Orca that can close it.
function setup(t, { record = OLD, terminals = 'term_old', options } = {}) {
  const s = feedSala(t);
  const core = memberRepo(s.dir, 'core');
  pushRoadmap(core.work, roadmap([['E1', '—', 'Completada'], ['E2', 'E1', 'Pendiente']]));
  writeSala(s.dir, { ...salaConfig([{ id: 'core', prefix: 'CORE', path: core.work, base: 'main' }]), ...(options ? { options } : {}) });
  const stateFile = path.join(s.dir, '.sala', 'estado.json');
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  if (record) fs.writeFileSync(stateFile, JSON.stringify({ schema: 1, members: { core: record } }));
  const terminalsFile = path.join(s.dir, 'terminals.txt');
  fs.writeFileSync(terminalsFile, terminals);
  const launcherLog = path.join(s.dir, 'launcher.log');
  fs.writeFileSync(launcherLog, '');
  const sessions = path.join(s.agentDir, 'desktop', 'sessions');
  // The new session gets its inbox as Gentle Shell would give it.
  for (const box of ['inbox', 'outbox']) fs.mkdirSync(path.join(s.agentDir, 'desktop', box, 'nueva'), { recursive: true });
  const env = {
    ...s.env,
    SALA_ORCA: FAKE_ORCA,
    SALA_OPEN_TIMEOUT_MS: '3000',
    SALA_CLOSE_TIMEOUT_MS: '3000',
    FAKE_LOG: launcherLog,
    FAKE_SNAPSHOT: sessions,
    FAKE_SNAPSHOT_CWD: core.work,
    FAKE_PID: String(process.pid),
    FAKE_ORCA_TERMINALS_FILE: terminalsFile,
    FAKE_ORCA_CLOSE_SNAPSHOT: path.join(sessions, 'c1.json'),
  };
  const orcaCalls = () => fs.readFileSync(launcherLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).args);
  const closes = () => orcaCalls().filter((a) => a[1] === 'close');
  const state = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  return { ...s, core, env, orcaCalls, closes, state, stateFile };
}

const CLOSE_OLD = ['terminal', 'close', '--terminal', 'term_old', '--tab', '--json'];

test('sala reiniciar closes the Orca terminal the sala opened and opens a clean session in its place', async (t) => {
  const s = setup(t);
  s.session('c1', s.core.work);

  const res = await runAsync(s.dir, ['reiniciar', 'core'], s.env);

  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  assert.deepEqual(JSON.parse(res.stdout), { member: 'core', closed: 'term_old', launcher: 'orca', handle: 'term_fake1', session: 'nueva' });
  assert.deepEqual(s.closes(), [CLOSE_OLD]);
  // It closes first and opens after: never two sessions in one member.
  const verbs = s.orcaCalls().map((a) => a[1]);
  assert.ok(verbs.indexOf('close') < verbs.indexOf('create'), verbs.join(','));
  const { openedAt, ...record } = s.state().members.core;
  assert.equal(typeof openedAt, 'string');
  assert.deepEqual(record, { launcher: 'orca', handle: 'term_fake1', title: 'core', session: 'nueva' });

  // The session it opened is the sala's own too: it can be restarted again.
  fs.writeFileSync(s.env.FAKE_ORCA_TERMINALS_FILE, 'term_fake1');
  const env = { ...s.env, FAKE_ORCA_CLOSE_SNAPSHOT: path.join(s.agentDir, 'desktop', 'sessions', 'nueva.json') };
  const texto = await runAsync(s.dir, ['reiniciar', 'core', '--texto'], env);
  assert.equal(texto.code, 0, texto.stderr);
  assert.equal(texto.stdout, 'core: cerrada la terminal term_fake1; sesión nueva nueva en term_fake1\n');
});

test('sala reiniciar never closes a session that works, waits, asks, has its task unmerged or is not the sala\'s own', async (t) => {
  const s = setup(t);
  const refused = async (why, error, env = s.env) => {
    const res = await runAsync(s.dir, ['reiniciar', 'core'], env);
    assert.equal(res.code, 1, why);
    assert.equal(res.stdout, '', why);
    assert.deepEqual(JSON.parse(res.stderr), { error }, why);
  };

  await refused('no session', 'core: no tiene una sesión viva; corré sala abrir core');
  s.session('c1', s.core.work, { activity: { state: 'working', label: 'Working' } });
  await refused('working', 'core: la sesión id-c1 está trabajando; no la cierra');
  s.session('c1', s.core.work, { activity: { state: 'waiting', label: 'Waiting' } });
  await refused('waiting', 'core: la sesión id-c1 espera a sus agentes o trabajos; no la cierra');
  s.session('c1', s.core.work, { pendingQuestion: { kind: 'choice', question: '¿Sigo?', options: [{ label: 'Sí' }] } });
  await refused('question', 'core: la sesión id-c1 te necesita; no la cierra');
  s.session('c1', s.core.work, { activity: { state: 'blocked', label: 'Blocked' } });
  await refused('blocked', 'core: la sesión id-c1 te necesita; no la cierra');
  // A state the kit does not know, or none, is not free: only a session that says idle is closed.
  for (const activity of [{ state: 'compacting', label: 'Compacting' }, null]) {
    s.session('c1', s.core.work, { activity });
    await refused(JSON.stringify(activity), 'core: la sesión id-c1 no dice que esté libre; no la cierra');
  }

  s.session('c1', s.core.work);
  fs.writeFileSync(path.join(s.core.work, 'a-medias.txt'), 'sin commitear\n');
  await refused('dirty tree', 'core: la tarea no está fusionada o el árbol no está limpio (árbol con cambios); no la cierra');
  fs.rmSync(path.join(s.core.work, 'a-medias.txt'));
  fs.writeFileSync(path.join(s.core.work, 'README.md'), 'otra\n');
  git(s.core.work, 'commit', '--quiet', '-am', 'sin subir');
  await refused('unpushed work', 'core: la tarea no está fusionada o el árbol no está limpio (main tiene 1 commits sin subir y está 0 detrás de origin/main); no la cierra');
  git(s.core.work, 'push', '--quiet', 'origin', 'main');

  await refused('terminal gone', 'core: la terminal term_old ya no está en Orca; no la cierra', { ...s.env, FAKE_ORCA_TERMINALS_FILE: path.join(s.dir, 'nada.txt') });
  await refused('orca down', 'core: Orca no responde; no la cierra', { ...s.env, FAKE_ORCA_DOWN: '1' });

  fs.writeFileSync(path.join(s.dir, '.sala', 'PAUSA'), '');
  await refused('paused', 'la sala está en pausa (.sala/PAUSA): no cierra ni abre sesiones');
  fs.rmSync(path.join(s.dir, '.sala', 'PAUSA'));

  // A terminal the sala did not open, or another session in it, is the person's: never closed.
  for (const [why, record] of [
    ['wt', { ...OLD, launcher: 'wt', handle: null, title: 'sala-core' }],
    ['no handle', { ...OLD, handle: null }],
    ['prototype', { ...OLD, launcher: 'constructor' }],
  ]) {
    fs.writeFileSync(s.stateFile, JSON.stringify({ schema: 1, members: { core: record } }));
    await refused(why, 'core: la sala no abrió una terminal de Orca para este miembro; no cierra nada');
  }
  fs.writeFileSync(s.stateFile, JSON.stringify({ schema: 1, members: {} }));
  await refused('no record', 'core: la sala no abrió una terminal de Orca para este miembro; no cierra nada');
  fs.writeFileSync(s.stateFile, JSON.stringify({ schema: 1, members: { core: { ...OLD, session: 'otra' } } }));
  await refused('other session', 'core: la sesión viva id-c1 no es la que abrió la sala; no la cierra');

  assert.deepEqual(s.closes(), []);
  assert.deepEqual(s.orcaCalls().filter((a) => a[1] === 'create'), []);
  assert.equal(fs.existsSync(path.join(s.agentDir, 'desktop', 'sessions', 'c1.json')), true);
});

test('a session that outlives its closed terminal is reported and no second session is opened', async (t) => {
  const s = setup(t);
  s.session('c1', s.core.work);

  const res = await runAsync(s.dir, ['reiniciar', 'core'], { ...s.env, FAKE_ORCA_CLOSE_SNAPSHOT: '', SALA_CLOSE_TIMEOUT_MS: '300' });

  assert.equal(res.code, 1);
  assert.deepEqual(JSON.parse(res.stderr), { error: 'core: Orca cerró la terminal term_old, pero la sesión id-c1 sigue viva; no se abre otra' });
  assert.deepEqual(s.closes(), [CLOSE_OLD]);
  assert.deepEqual(s.orcaCalls().filter((a) => a[1] === 'create'), []);
});

test('a handle that only looks like the sala\'s, or an abrir in course, never gets a terminal closed', async (t) => {
  const s = setup(t);
  s.session('c1', s.core.work);
  for (const handle of ['term_old\n', 'term_old;x', ' term_old', 'term_', ['term_old']]) {
    fs.writeFileSync(s.stateFile, JSON.stringify({ schema: 1, members: { core: { ...OLD, handle } } }));
    const res = await runAsync(s.dir, ['reiniciar', 'core'], s.env);
    assert.equal(res.code, 1, JSON.stringify(handle));
    assert.deepEqual(s.orcaCalls(), [], JSON.stringify(handle));
  }
  fs.writeFileSync(s.stateFile, JSON.stringify({ schema: 1, members: { core: OLD } }));
  fs.writeFileSync(path.join(s.dir, '.sala', 'abrir.lock'), '');
  const res = await runAsync(s.dir, ['reiniciar', 'core'], s.env);
  assert.equal(res.code, 1);
  assert.deepEqual(JSON.parse(res.stderr), { error: 'otra sala abrir está en curso en esta sala; si no hay ninguna, borrá .sala/abrir.lock' });
  assert.deepEqual(s.closes(), []);
});

test('a pause set during the checks stops the close, and what fails after it says the old terminal is gone', async (t) => {
  const s = setup(t);
  s.session('c1', s.core.work);
  const pause = path.join(s.dir, '.sala', 'PAUSA');
  const paused = await runAsync(s.dir, ['reiniciar', 'core'], { ...s.env, FAKE_ORCA_LIST_TOUCHES: pause });
  assert.equal(paused.code, 1);
  assert.deepEqual(JSON.parse(paused.stderr), { error: 'la sala está en pausa (.sala/PAUSA): no cierra ni abre sesiones' });
  assert.deepEqual(s.closes(), []);
  fs.rmSync(pause);

  const failed = await runAsync(s.dir, ['reiniciar', 'core'], { ...s.env, FAKE_ORCA_CREATE_FAIL: '1' });
  assert.equal(failed.code, 1);
  assert.deepEqual(JSON.parse(failed.stderr), {
    error: 'core: la terminal term_old ya se cerró, pero no se pudo abrir otra (core: Orca no pudo abrir la terminal: no se pudo crear); corré sala abrir core',
  });

  // A session of the person that shows up between the close and the open is never taken as the sala's.
  s.session('c1', s.core.work);
  fs.writeFileSync(s.env.FAKE_ORCA_TERMINALS_FILE, 'term_old');
  const staging = path.join(s.dir, 'staging');
  fs.mkdirSync(staging);
  const theirs = JSON.parse(fs.readFileSync(path.join(s.agentDir, 'desktop', 'sessions', 'c1.json'), 'utf8'));
  theirs.identity.sessionId = 'id-p1';
  fs.writeFileSync(path.join(staging, 'p1.json'), JSON.stringify(theirs));
  const seen = s.answer('p1');
  const appeared = await runAsync(s.dir, ['reiniciar', 'core'], { ...s.env, FAKE_ORCA_CLOSE_ADDS: path.join(staging, 'p1.json') });
  assert.equal(appeared.code, 1);
  assert.deepEqual(JSON.parse(appeared.stderr), {
    error: 'core: la terminal term_old ya se cerró, pero apareció otra sesión (id-p1) que no abrió la sala; no se abre otra ni se le manda nada',
  });
  assert.deepEqual(s.orcaCalls().filter((a) => a[1] === 'create').length, 1, 'only the failed create of before');
  assert.deepEqual(seen, []);
});

function mergeEnv(s) {
  return {
    ...s.env,
    SALA_GH: FAKE_GH,
    FAKE_GH_LOG: path.join(s.dir, 'gh.log'),
    FAKE_GH_REPO: JSON.stringify({ squashMergeAllowed: true }),
    FAKE_GH_PR: JSON.stringify({
      number: 3, title: 'feat: entrega (E1)', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE',
      baseRefName: 'main', headRefOid: SHA, statusCheckRollup: [],
    }),
  };
}

test('sala fusionar restarts the member it opened before asking for the next task, in the new session', async (t) => {
  const s = setup(t);
  s.session('c1', s.core.work);
  const old = s.answer('c1');
  const fresh = s.answer('nueva');

  const res = await runAsync(s.dir, ['fusionar', 'core', '3'], mergeEnv(s));

  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.deepEqual(out.steps.slice(5), [
    { id: 'restart', ok: true, detail: 'cerrada la terminal term_old; sesión nueva nueva en term_fake1' },
    { id: 'next', ok: true, detail: 'pedida la tarea siguiente: /miembro-tarea E2' },
  ]);
  assert.deepEqual(old.map((a) => a.args.text), ['/miembro-base']);
  assert.deepEqual(fresh.map((a) => a.args.text), ['/miembro-tarea E2']);
  assert.deepEqual(s.closes(), [CLOSE_OLD]);
});

test('sala fusionar stops before the next task when the restart is refused, and keeps the person\'s terminal', async (t) => {
  const s = setup(t, { terminals: '' });
  s.session('c1', s.core.work);
  const seen = s.answer('c1');

  const res = await runAsync(s.dir, ['fusionar', 'core', '3'], mergeEnv(s));

  assert.equal(res.code, 1);
  const out = JSON.parse(res.stdout);
  assert.equal(out.stoppedAt, 'restart');
  assert.deepEqual(out.steps[5], { id: 'restart', ok: false, detail: 'core: la terminal term_old ya no está en Orca; no la cierra' });
  assert.deepEqual(seen.map((a) => a.args.text), ['/miembro-base']);
  assert.deepEqual(s.closes(), []);

  // A terminal the sala did not open stays, and the next task goes to the same session.
  fs.writeFileSync(s.stateFile, JSON.stringify({ schema: 1, members: {} }));
  const kept = JSON.parse((await runAsync(s.dir, ['fusionar', 'core', '3'], mergeEnv(s))).stdout);
  assert.equal(kept.ok, true);
  assert.deepEqual(kept.steps[5], { id: 'restart', ok: true, detail: 'core no tiene una terminal de Orca que abrió la sala: sigue la misma sesión' });
  assert.deepEqual(seen.map((a) => a.args.text), ['/miembro-base', '/miembro-base', '/miembro-tarea E2']);
  assert.deepEqual(s.closes(), []);
});

test('sala modelo binds options.roomModel to the sala\'s own session only, and never confirms for the person', async (t) => {
  const s = setup(t, { options: { roomModel: 'barato' } });
  s.session('c1', s.core.work);
  s.session('s1', s.dir);
  const member = s.answer('c1');
  const applied = { ok: true, data: { profile: 'barato', mode: 'session', status: 'applied', notes: [] } };
  const sala = s.answer('s1', applied);

  const res = await runAsync(s.dir, ['modelo'], s.env);

  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), { sala: 'prueba', session: 'id-s1', profile: 'barato', status: 'applied' });
  assert.deepEqual(sala.map((a) => [a.kind, a.args]), [['apply_profile', { name: 'barato' }]]);
  assert.deepEqual(member, []);
  const texto = await runAsync(s.dir, ['modelo', '--texto'], s.env);
  assert.equal(texto.stdout, 'Sala prueba: el perfil barato quedó solo en la sesión id-s1\n');
});

test('sala modelo refuses without a profile, without one sala session, and stops when the profile asks for a confirmation', async (t) => {
  const s = setup(t);
  const refused = async (why, error, env = s.env) => {
    const res = await runAsync(s.dir, ['modelo'], env);
    assert.equal(res.code, 1, why);
    assert.equal(res.stdout, '', why);
    assert.deepEqual(JSON.parse(res.stderr), { error }, why);
  };

  s.session('s1', s.dir);
  await refused('no roomModel', 'options.roomModel no nombra un perfil; no hay nada que aplicar');
  assert.deepEqual(s.inbox('s1'), []);

  writeSala(s.dir, { ...salaConfig([{ id: 'core', prefix: 'CORE', path: s.core.work, base: 'main' }]), options: { roomModel: 'barato' } });
  fs.rmSync(path.join(s.agentDir, 'desktop', 'sessions', 's1.json'));
  s.session('c1', s.core.work);
  await refused('only a member session', 'la sala no tiene una sesión viva de Gentle Shell');
  s.session('s1', s.dir);
  s.session('s2', s.dir);
  await refused('two', 'la sala tiene 2 sesiones vivas (id-s1, id-s2); dejá una sola');
  fs.rmSync(path.join(s.agentDir, 'desktop', 'sessions', 's2.json'));

  const confirm = { ok: true, data: { profile: 'barato', mode: 'session', status: 'confirmation_required', confirmation: { title: 'Super-YOLO', message: '¿Seguro?', token: 'tok' } } };
  const seen = s.answer('s1', confirm);
  await refused('confirmation', 'el perfil barato pide una confirmación; aplicalo vos con /gentle:profiles en la terminal de la sala');
  // One action only: the confirmation token is never sent back.
  assert.deepEqual(seen.map((a) => a.args), [{ name: 'barato' }]);
});
