'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  tempDir, git, memberRepo, roadmap, pushRoadmap, member, writeSala, salaConfig, runSala,
} = require('./helpers');

function twoMembers(t) {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  const brand = memberRepo(dir, 'brand');
  pushRoadmap(core.work, roadmap([
    ['E01', '—', 'Completada'],
    ['E02', '—', 'En curso'],
    ['E03', 'E02', 'Pendiente'],
    ['E04', '—', 'Pendiente'],
  ]));
  pushRoadmap(brand.work, roadmap([
    ['B1', 'CORE-E03', 'Pendiente'],
    ['B2', 'CORE-E01, upen-ceo', 'Pendiente'],
    ['B3', '—', 'Bloqueada', 'Falta el logo'],
  ]));
  writeSala(dir, salaConfig([member('core', 'CORE', core.work), member('brand', 'BRAND', brand.work)]));
  return { dir, core, brand };
}

test('per member: in progress, next ready task and what waits, with cross-member deps resolved', (t) => {
  const { dir } = twoMembers(t);

  const res = runSala(dir, ['plan']);

  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  const { queue, ...rest } = JSON.parse(res.stdout);
  assert.ok(queue);
  assert.deepEqual(rest, {
    schema: 1,
    sala: 'prueba',
    members: [
      {
        id: 'core',
        done: 1,
        total: 4,
        inProgress: [{ id: 'E02', entrega: 'Entrega E02' }],
        next: { id: 'E04', entrega: 'Entrega E04', deps: [] },
        blocked: [{ id: 'E03', entrega: 'Entrega E03', reasons: ['espera a E02 (En curso)'] }],
      },
      {
        id: 'brand',
        done: 0,
        total: 3,
        inProgress: [],
        next: {
          id: 'B2',
          entrega: 'Entrega B2',
          deps: [
            { id: 'CORE-E01', member: 'core', estado: 'Completada' },
            { id: 'upen-ceo', informative: true },
          ],
        },
        blocked: [
          { id: 'B1', entrega: 'Entrega B1', reasons: ['espera a CORE-E03 (Pendiente, en core)'] },
          { id: 'B3', entrega: 'Entrega B3', reasons: ['Bloqueada: Falta el logo'] },
        ],
      },
    ],
  });
});

test('the plan reads the remote base, not the working tree', (t) => {
  const { dir, core } = twoMembers(t);
  // Pushed from another clone: E02 is done now, so E03 is ready.
  const other = path.join(dir, 'other');
  git(dir, 'clone', '--quiet', core.remote, other);
  git(other, 'config', 'user.email', 'test@example.com');
  git(other, 'config', 'user.name', 'Test');
  pushRoadmap(other, roadmap([
    ['E01', '—', 'Completada'],
    ['E02', '—', 'Completada'],
    ['E03', 'E02', 'Pendiente'],
    ['E04', '—', 'Pendiente'],
  ]));
  // An uncommitted local edit is ignored.
  fs.writeFileSync(path.join(core.work, 'docs', 'ROADMAP.md'), roadmap([['X9', '—', 'Pendiente']]));

  const c = JSON.parse(runSala(dir, ['plan']).stdout).members[0];

  assert.deepEqual(c.next, { id: 'E03', entrega: 'Entrega E03', deps: [{ id: 'E02', estado: 'Completada' }] });
  assert.deepEqual(c.inProgress, []);
  assert.equal(c.done, 2);
});

test('unresolved dependencies and unreadable members are reported, never guessed', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  const brand = memberRepo(dir, 'brand');
  pushRoadmap(brand.work, roadmap([['B1', 'CORE-E99, BRAND-B7, ZZ-1', 'Pendiente']]));
  writeSala(dir, salaConfig([member('core', 'CORE', core.work), member('brand', 'BRAND', brand.work)]));

  const [c, b] = JSON.parse(runSala(dir, ['plan']).stdout).members;

  assert.deepEqual(c, { id: 'core', error: 'no hay docs/ROADMAP.md en origin/main' });
  assert.equal(b.next, null);
  assert.deepEqual(b.blocked, [{
    id: 'B1',
    entrega: 'Entrega B1',
    reasons: [
      'no se pudo leer el miembro core de CORE-E99',
      'dependencia sin resolver: BRAND-B7',
      'dependencia sin resolver: ZZ-1',
    ],
  }]);
});

test('--texto prints the plan for reading', (t) => {
  const { dir } = twoMembers(t);

  const res = runSala(dir, ['plan', '--texto']);

  assert.equal(res.code, 0);
  assert.equal(res.stdout, [
    'Sala prueba',
    'core (1/4 completadas)',
    '  en curso:  E02 Entrega E02',
    '  siguiente: E04 Entrega E04',
    '  espera:    E03 Entrega E03: espera a E02 (En curso)',
    'brand (0/3 completadas)',
    '  siguiente: B2 Entrega B2',
    '  espera:    B1 Entrega B1: espera a CORE-E03 (Pendiente, en core)',
    '  espera:    B3 Entrega B3: Bloqueada: Falta el logo',
    'Cola',
    '  ola 1: core E02 [en curso] · brand B2',
    '  ola 2: core E03 (espera a E02)',
    '  ola 3: core E04 · brand B1 (espera a CORE-E03)',
    '  espera: brand B3: Bloqueada: Falta el logo',
    '',
  ].join('\n'));
});
