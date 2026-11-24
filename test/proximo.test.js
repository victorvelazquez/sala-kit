'use strict';

// SK32: sala proximo says, for each member, its next step and the exact command, reading only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { feedSala, runAsync, memberRepo, pushRoadmap, roadmap, writeSala, salaConfig, git } = require('./helpers');

// A sala whose member core is a git repo on its clean base, with E2 ready in its roadmap.
function setup(t) {
  const s = feedSala(t);
  const core = memberRepo(s.dir, 'core');
  pushRoadmap(core.work, roadmap([['E1', '—', 'Completada'], ['E2', 'E1', 'Pendiente']]));
  writeSala(s.dir, salaConfig([{ id: 'core', prefix: 'CORE', path: core.work, base: 'main' }]));
  const next = async (env = {}) => {
    const res = await runAsync(s.dir, ['proximo'], { ...s.env, ...env });
    assert.equal(res.code, 0, res.stderr);
    assert.equal(res.stderr, '');
    const out = JSON.parse(res.stdout);
    assert.equal(out.members.length, 1);
    return out.members[0];
  };
  return { ...s, core, next };
}

function pr(extra = {}) {
  return JSON.stringify([{ number: 3, title: 'feat: entrega (E2)', headRefName: 'feat', isDraft: false, statusCheckRollup: [{ conclusion: 'SUCCESS' }], ...extra }]);
}

test('without a usable session, the next step is to open it, keep one, answer it or wait for it', async (t) => {
  const s = setup(t);

  assert.deepEqual(await s.next(), { id: 'core', step: 'abrir', detail: 'no tiene una sesión viva', command: 'sala abrir core' });
  s.session('c1', s.core.work);
  s.session('c2', s.core.work);
  assert.deepEqual(await s.next(), { id: 'core', step: 'una-sesion', detail: 'tiene 2 sesiones vivas (id-c1, id-c2); dejá una sola', command: null });
  fs.rmSync(path.join(s.agentDir, 'desktop', 'sessions', 'c2.json'));
  s.session('c1', s.core.work, { pendingQuestion: { kind: 'choice', question: '¿Sigo?', toolCallId: 'q1', options: [{ label: 'Sí' }] } });
  assert.deepEqual(await s.next(), { id: 'core', step: 'contestar', detail: 'te pregunta: «¿Sigo?»', command: 'sala preguntas' });
  s.session('c1', s.core.work, { activity: { state: 'blocked', label: 'Blocked' } });
  assert.deepEqual(await s.next(), { id: 'core', step: 'contestar', detail: 'la sesión está bloqueada: mirala', command: 'sala mostrar core' });
  s.session('c1', s.core.work, { activity: { state: 'working', label: 'Working' } });
  assert.deepEqual(await s.next(), { id: 'core', step: 'esperar', detail: 'está trabajando', command: 'sala esperar core' });
  s.session('c1', s.core.work, { activity: { state: 'waiting', label: 'Waiting' } });
  assert.deepEqual(await s.next(), { id: 'core', step: 'esperar', detail: 'espera a sus agentes o trabajos', command: 'sala esperar core' });
});

test('a free member delivers its work, its PR is merged when its CI is green, and only the PR of its branch counts', async (t) => {
  const s = setup(t);
  s.session('c1', s.core.work);

  fs.writeFileSync(path.join(s.core.work, 'README.md'), 'cambio\n');
  assert.deepEqual(await s.next(), { id: 'core', step: 'entregar', detail: 'tiene cambios sin commit', command: '/sala-entregar core' });
  git(s.core.work, 'switch', '--quiet', '-c', 'feat');
  git(s.core.work, 'commit', '--quiet', '-am', 'feat: entrega (E2)');
  assert.deepEqual(await s.next(), { id: 'core', step: 'entregar', detail: 'está en la rama feat sin PR abierto', command: '/sala-entregar core' });
  // A PR of another branch (a release bot, say) is not the member's.
  assert.equal((await s.next({ FAKE_GH_OUT: pr({ headRefName: 'release-please' }) })).step, 'entregar');

  assert.deepEqual(await s.next({ FAKE_GH_OUT: pr() }),
    { id: 'core', step: 'fusionar', detail: 'el PR #3 «feat: entrega (E2)» tiene el CI en verde', command: '/sala-fusionar core 3' });
  assert.equal((await s.next({ FAKE_GH_OUT: pr({ statusCheckRollup: [] }) })).step, 'fusionar');
  assert.deepEqual(await s.next({ FAKE_GH_OUT: pr({ statusCheckRollup: [{ conclusion: '' }] }) }),
    { id: 'core', step: 'ci', detail: 'el CI del PR #3 está corriendo', command: null });
  assert.deepEqual(await s.next({ FAKE_GH_OUT: pr({ statusCheckRollup: [{ conclusion: 'FAILURE' }] }) }),
    { id: 'core', step: 'ci', detail: 'el CI del PR #3 está en rojo: hay que corregirlo', command: null });
  assert.deepEqual(await s.next({ FAKE_GH_OUT: pr({ isDraft: true }) }),
    { id: 'core', step: 'ci', detail: 'el PR #3 es un borrador', command: null });

  // A PR of a task the sala did not ask for is never offered to merge (SK32b).
  fs.mkdirSync(path.join(s.dir, '.sala'), { recursive: true });
  fs.writeFileSync(path.join(s.dir, '.sala', 'ordenes.log'), `${JSON.stringify({ member: 'core', session: 'id-c1', text: '/miembro-tarea E1', result: 'sent' })}
`);
  assert.deepEqual(await s.next({ FAKE_GH_OUT: pr() }),
    { id: 'core', step: 'revisar', detail: 'el PR #3 es de E2, pero la sala le pidió E1: no se fusiona', command: null });
  fs.appendFileSync(path.join(s.dir, '.sala', 'ordenes.log'), `${JSON.stringify({ member: 'core', session: 'id-c1', text: '/miembro-tarea E2', result: 'sent' })}
`);
  assert.equal((await s.next({ FAKE_GH_OUT: pr() })).step, 'fusionar');

  // A branch whose PR was already merged (from GitHub, say) goes back to the base, it is not delivered again.
  assert.deepEqual(await s.next({ FAKE_GH_MERGED: JSON.stringify([{ number: 3 }]) }),
    { id: 'core', step: 'base', detail: 'el PR #3 de la rama feat ya se fusionó', command: 'sala enviar core "/miembro-base main"' });
});

test('on its clean base a member asks for its next task, goes back when behind, and is free when there is none', async (t) => {
  const s = setup(t);
  s.session('c1', s.core.work);

  assert.deepEqual(await s.next(), { id: 'core', step: 'tarea', detail: 'su tarea siguiente es E2', command: '/sala-seguir core' });

  // Someone else pushed to the base: the member is behind it.
  const other = path.join(s.dir, 'otro');
  git(s.dir, 'clone', '--quiet', path.join(s.dir, 'core.git'), other);
  git(other, 'config', 'user.email', 'test@example.com');
  git(other, 'config', 'user.name', 'Test');
  pushRoadmap(other, roadmap([['E1', '—', 'Completada'], ['E2', 'E1', 'Completada']]));
  assert.deepEqual(await s.next(), { id: 'core', step: 'base', detail: 'main está 1 commit detrás de origin/main', command: 'sala enviar core "/miembro-base main"' });

  git(s.core.work, 'pull', '--quiet', 'origin', 'main');
  assert.deepEqual(await s.next(), { id: 'core', step: 'libre', detail: 'no tiene una tarea lista en su roadmap', command: null });
});

test('sala proximo --texto gives one line per member, and a member that cannot be read says why', async (t) => {
  const s = setup(t);
  s.session('c1', s.core.work);
  writeSala(s.dir, salaConfig([
    { id: 'core', prefix: 'CORE', path: s.core.work, base: 'main' },
    { id: 'nada', prefix: 'NADA', path: path.join(s.dir, 'no-esta'), base: 'main' },
  ]));

  const res = await runAsync(s.dir, ['proximo', '--texto'], s.env);

  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stdout, [
    'Sala prueba: el paso siguiente de cada miembro',
    '  core  tarea   su tarea siguiente es E2 → /sala-seguir core',
    `  nada  revisar la carpeta no existe: ${path.join(s.dir, 'no-esta')}`,
    '',
  ].join('\n'));
});
