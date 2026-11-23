'use strict';

// Lanes (D57): a member can be a lane of another member of the same repo. Each row of the
// shared roadmap belongs to one member only, so no order and no plan gives it to both.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { validateConfig } = require('../src/config');
const { pipePath } = require('../src/hospedar');
const {
  tempDir, git, memberRepo, roadmap, pushRoadmap, member, writeSala, salaConfig, runSala, feedSala, runAsync,
} = require('./helpers');

const abs = (name) => path.resolve('/repos', name);
const LANE = { of: 'erp', rows: ['DM0', 'DS-BASE'] };

function config(members, extra = {}) {
  return { schema: 1, kit: '0.1.0', name: 'upen', members, ...extra };
}

function erp() {
  return { id: 'erp', prefix: 'ERP', path: abs('upen-erp'), base: 'develop' };
}

function pantallas(lane = LANE) {
  return { id: 'erp-pantallas', path: abs('upen-erp-pantallas'), base: 'develop', lane };
}

test('a lane has no prefix of its own: it takes the one of its member, and pinned IDs resolve with it', () => {
  const res = validateConfig(config([erp(), pantallas()], { pinned: ['ERP-DM0', 'ERP-B10'] }));
  assert.deepEqual(res.errors, []);
  const lane = res.config.members[1];
  assert.equal(lane.prefix, 'ERP');
  assert.equal(lane.remote, 'origin');
  assert.deepEqual(lane.lane, LANE);
  // A config without lanes comes out as before.
  assert.deepEqual(validateConfig(config([erp()])).config.members, [{ ...erp(), remote: 'origin' }]);
});

test('a lane is refused with where the problem is', () => {
  const errors = (members) => validateConfig(config(members)).errors;
  assert.deepEqual(errors([erp(), { ...pantallas(), prefix: 'ERP' }]),
    ['members[1].prefix: un carril no lleva prefix: usa el de lane.of']);
  assert.deepEqual(errors([erp(), pantallas({ of: 'nada', rows: ['DM0'] })]),
    ['members[1].lane.of: no hay un miembro «nada»']);
  assert.deepEqual(errors([erp(), pantallas({ of: 'erp-pantallas', rows: ['DM0'] })]),
    ['members[1].lane.of: un carril no puede ser carril de sí mismo']);
  assert.deepEqual(errors([erp(), pantallas(), { ...pantallas({ of: 'erp-pantallas', rows: ['B7'] }), id: 'otro', path: abs('otro') }]),
    ['members[2].lane.of: «erp-pantallas» es un carril; un carril es de un miembro con prefix']);
  assert.deepEqual(errors([erp(), pantallas({ of: 'erp', rows: [] })]),
    ['members[1].lane.rows: debe ser una lista de IDs de filas, por ejemplo ["DM0"]']);
  assert.deepEqual(errors([erp(), pantallas({ of: 'erp', rows: ['DM0', 'DM0', 'dos palabras', 7] })]), [
    'members[1].lane.rows[1]: «DM0» está repetido',
    'members[1].lane.rows[2]: debe ser el ID de una fila',
    'members[1].lane.rows[3]: debe ser el ID de una fila',
  ]);
  assert.deepEqual(errors([erp(), pantallas({ of: 'erp', rows: ['DM0'], extra: 1 })]),
    ['members[1].lane.extra: campo desconocido']);
  assert.deepEqual(errors([erp(), pantallas('erp')]),
    ['members[1].lane: debe ser un objeto con of y rows']);
  // A lane works on the base of its member: the plan reads the shared roadmap there.
  assert.deepEqual(errors([erp(), { ...pantallas(), base: 'main' }]),
    ['members[1].base: un carril trabaja en la base de su miembro (develop)']);
  // One row, one lane: two lanes of the same member cannot both own a row.
  assert.deepEqual(errors([erp(), pantallas(), { ...pantallas({ of: 'erp', rows: ['B7', 'DM0'] }), id: 'otro', path: abs('otro') }]),
    ['members[2].lane.rows: «DM0» ya es del carril erp-pantallas']);
});

// One repo worked from two clones: erp (main lane) and erp-pantallas (screens lane).
function lanes(t, rows, extra = {}) {
  const dir = tempDir(t);
  const main = memberRepo(dir, 'erp');
  pushRoadmap(main.work, roadmap(rows));
  const clone = path.join(dir, 'erp-pantallas');
  git(dir, 'clone', '--quiet', path.join(dir, 'erp.git'), clone);
  writeSala(dir, {
    ...salaConfig([
      member('erp', 'ERP', main.work),
      { id: 'erp-pantallas', path: clone, base: 'main', lane: { of: 'erp', rows: ['DM0', 'DS-BASE'] } },
    ]),
    ...extra,
  });
  return dir;
}

test('the plan and the queue give each row of the shared roadmap to one lane only', (t) => {
  const dir = lanes(t, [
    ['B10', '—', 'Completada'],
    ['CUENTAS-1', '—', 'Pendiente'],
    ['DM0', '—', 'Pendiente'],
    // A screen waits on a row of the main lane: the dependency is read on the whole roadmap.
    ['DS-BASE', 'CUENTAS-1', 'Pendiente'],
    ['B9b', '—', 'Pendiente'],
  ]);

  const res = runSala(dir, ['plan']);

  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  const [main, screens] = out.members;
  assert.deepEqual({ id: main.id, done: main.done, total: main.total, next: main.next.id, blocked: main.blocked },
    { id: 'erp', done: 1, total: 3, next: 'CUENTAS-1', blocked: [] });
  assert.deepEqual({ id: screens.id, done: screens.done, total: screens.total, next: screens.next.id },
    { id: 'erp-pantallas', done: 0, total: 2, next: 'DM0' });
  // Every open row is in the queue once, with its own lane; DS-BASE waits on the main lane.
  const placed = out.queue.waves.flat().map((x) => `${x.member} ${x.id}`);
  assert.deepEqual(out.queue.waves.map((w) => w.map((x) => `${x.member} ${x.id}${x.waitsFor.length ? ` < ${x.waitsFor}` : ''}`)), [
    ['erp CUENTAS-1', 'erp-pantallas DM0'],
    ['erp B9b', 'erp-pantallas DS-BASE < CUENTAS-1'],
  ]);
  assert.equal(new Set(out.queue.waves.flat().map((x) => x.id)).size, placed.length);
  assert.deepEqual(out.queue.waiting, []);
});

test('a pinned row of the lane goes first in the lane, and nowhere else', (t) => {
  const dir = lanes(t, [
    ['DM0', '—', 'Pendiente'],
    ['DS-BASE', '—', 'Pendiente'],
    ['B9b', '—', 'Pendiente'],
  ], { pinned: ['ERP-DS-BASE'] });

  const out = JSON.parse(runSala(dir, ['plan']).stdout);

  assert.deepEqual(out.queue.waves.map((w) => w.map((x) => `${x.member} ${x.id}${x.pinned ? ' [fijada]' : ''}`)), [
    ['erp-pantallas DS-BASE [fijada]', 'erp B9b'],
    ['erp-pantallas DM0'],
  ]);
});

// Two lanes of core in the feed sala: core (main) and core-pantallas, owner of P1.
function laneFeed(t) {
  const s = feedSala(t);
  const screens = path.join(s.dir, 'core-pantallas');
  fs.mkdirSync(screens);
  writeSala(s.dir, salaConfig([
    { id: 'core', prefix: 'CORE', path: s.core, base: 'main' },
    { id: 'core-pantallas', path: screens, base: 'main', lane: { of: 'core', rows: ['P1'] } },
  ]));
  return { ...s, screens };
}

test('sala enviar refuses a /miembro-tarea of a row of the other lane, before anything else, and logs it', async (t) => {
  const s = laneFeed(t);
  s.session('c1', s.core);
  const refused = async (id, text, error) => {
    const res = await runAsync(s.dir, ['enviar', id, text], s.env);
    assert.equal(res.code, 1, text);
    assert.equal(res.stdout, '', text);
    assert.deepEqual(JSON.parse(res.stderr), { error }, text);
  };

  await refused('core', '/miembro-tarea P1', 'core: P1 es una fila del carril core-pantallas; mandásela a core-pantallas');
  await refused('core', '/miembro-tarea CORE-P1 plan', 'core: CORE-P1 es una fila del carril core-pantallas; mandásela a core-pantallas');
  // The lane has no live session: the lane guard answers before the session guard.
  await refused('core-pantallas', '/miembro-tarea E1', 'core-pantallas: E1 no es una fila de este carril (sus filas: P1); mandásela a core');
  assert.deepEqual(s.log().map((l) => `${l.member} ${l.text} ${l.result}`), [
    'core /miembro-tarea P1 refused',
    'core /miembro-tarea CORE-P1 plan refused',
    'core-pantallas /miembro-tarea E1 refused',
  ]);

  // Its own rows, and any other order, pass the lane guard as before.
  const seen = s.answer('c1');
  const own = await runAsync(s.dir, ['enviar', 'core', '/miembro-tarea E1'], s.env);
  assert.equal(own.code, 0, own.stderr);
  const other = await runAsync(s.dir, ['enviar', 'core', '/miembro-informe'], s.env);
  assert.equal(other.code, 0, other.stderr);
  assert.deepEqual(seen.map((a) => a.args.text), ['/miembro-tarea E1', '/miembro-informe']);
  const lane = await runAsync(s.dir, ['enviar', 'core-pantallas', '/miembro-tarea P1'], s.env);
  assert.deepEqual(JSON.parse(lane.stderr), { error: 'core-pantallas: no tiene una sesión viva; corré sala abrir core-pantallas' });
});

test('with lanes, a /miembro-tarea without an ID or with a disguised ID of the other lane never goes', async (t) => {
  const s = laneFeed(t);
  s.session('c1', s.core);
  const seen = s.answer('c1');
  const send = (id, text) => runAsync(s.dir, ['enviar', id, text], s.env);

  // Without an ID the member would take the first Pendiente row of the shared roadmap.
  for (const [id, error] of [
    ['core', 'core: tiene carriles: /miembro-tarea va con el ID de la fila, el que da sala plan'],
    ['core-pantallas', 'core-pantallas: es un carril: /miembro-tarea va con el ID de la fila, el que da sala plan'],
  ]) {
    const res = await send(id, '/miembro-tarea');
    assert.equal(res.code, 1, id);
    assert.deepEqual(JSON.parse(res.stderr), { error }, id);
  }
  for (const text of ['/miembro-tarea p1', '/MIEMBRO-TAREA P1', '/miembro-tarea core-P1', '/miembro-tarea "P1"',
    '/miembro-tarea P1,E1', '\u200b/miembro-tarea P1', '/miembro-tarea CORE-CORE-P1', '  /miembro-tarea\tP1.']) {
    const res = await send('core', text);
    assert.equal(res.code, 1, JSON.stringify(text));
    assert.match(JSON.parse(res.stderr).error, /^core: .+ es una fila del carril core-pantallas; mandásela a core-pantallas$/, JSON.stringify(text));
  }
  assert.deepEqual(seen, []);
  // A mode after the ID is not an ID: it passes, as SK19 will need.
  const own = await send('core', '/miembro-tarea E1 plan');
  assert.equal(own.code, 0, own.stderr);
  assert.deepEqual(seen.map((a) => a.args.text), ['/miembro-tarea E1 plan']);
});

test('a hosted lane never gets a row of the other lane: the lane guard runs before the host', async (t) => {
  const s = laneFeed(t);
  const requests = [];
  const servers = ['core', 'core-pantallas'].map((id) => {
    const pipe = pipePath({ name: 'prueba' }, s.dir, id);
    if (process.platform !== 'win32') fs.mkdirSync(path.dirname(pipe), { recursive: true });
    const server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      socket.on('data', (d) => {
        requests.push({ id, ...JSON.parse(d) });
        socket.end(`${JSON.stringify({ ok: true })}\n`);
      });
    });
    server.listen(pipe);
    return server;
  });
  t.after(() => servers.forEach((server) => server.close()));
  const send = (id, text) => runAsync(s.dir, ['enviar', id, text], s.env);

  assert.equal((await send('core', '/miembro-tarea CORE-P1')).code, 1);
  assert.equal((await send('core-pantallas', '/miembro-tarea E1')).code, 1);
  assert.equal((await send('core-pantallas', '/miembro-tarea')).code, 1);
  assert.deepEqual(requests, []);
  const own = await send('core-pantallas', '/miembro-tarea P1');
  assert.equal(own.code, 0, own.stderr);
  assert.deepEqual(JSON.parse(own.stdout), { member: 'core-pantallas', session: 'rpc', sent: true });
  assert.deepEqual(requests, [{ id: 'core-pantallas', action: 'prompt', text: '/miembro-tarea P1' }]);
});

test('sala soltar of a lane keeps the pinned tasks of its member, and its member cannot leave while it has lanes', (t) => {
  const dir = tempDir(t);
  for (const name of ['erp', 'erp-pantallas']) fs.mkdirSync(path.join(dir, name));
  const raw = config([
    { id: 'erp', prefix: 'ERP', path: path.join(dir, 'erp'), base: 'main' },
    { id: 'erp-pantallas', path: path.join(dir, 'erp-pantallas'), base: 'main', lane: { of: 'erp', rows: ['DM0'] } },
  ], { pinned: ['ERP-DM0', 'ERP-B10'] });
  writeSala(dir, raw);

  const main = runSala(dir, ['soltar', 'erp']);
  assert.equal(main.code, 1);
  assert.equal(main.stdout, '');
  assert.equal(JSON.parse(main.stderr).error, 'erp tiene carriles (erp-pantallas): soltalos primero');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'sala.json'), 'utf8')), raw);

  const lane = runSala(dir, ['soltar', 'erp-pantallas']);
  assert.equal(lane.code, 0, lane.stderr);
  assert.deepEqual(JSON.parse(lane.stdout).unpinned, []);
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'sala.json'), 'utf8'));
  assert.deepEqual(after.members.map((m) => m.id), ['erp']);
  assert.deepEqual(after.pinned, ['ERP-DM0', 'ERP-B10']);
});
