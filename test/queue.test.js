'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  tempDir, memberRepo, roadmap, pushRoadmap, member, writeSala, salaConfig, runSala,
} = require('./helpers');

function task(memberId, id, waitsFor = [], extra = {}) {
  return { member: memberId, id, entrega: `Entrega ${id}`, waitsFor, ...extra };
}

test('the queue orders every pending task in waves: deps first, one task per member, pinned ahead', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  const brand = memberRepo(dir, 'brand');
  pushRoadmap(core.work, roadmap([
    ['E01', '—', 'Completada'],
    ['E02', '—', 'Pendiente'],
    ['E03', 'E02', 'Pendiente'],
    ['E04', 'BRAND-B1', 'Pendiente'],
    ['E05', '—', 'Pendiente'],
  ]));
  pushRoadmap(brand.work, roadmap([
    ['B1', '—', 'Pendiente'],
    ['B2', 'CORE-E03', 'Pendiente'],
  ]));
  writeSala(dir, {
    ...salaConfig([member('core', 'CORE', core.work), member('brand', 'BRAND', brand.work)]),
    pinned: ['BRAND-B1', 'CORE-E05'],
  });

  const res = runSala(dir, ['plan']);

  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout).queue, {
    waves: [
      [task('brand', 'B1', [], { pinned: true }), task('core', 'E05', [], { pinned: true })],
      [task('core', 'E02')],
      [task('core', 'E03', ['E02'])],
      [task('core', 'E04', ['BRAND-B1']), task('brand', 'B2', ['CORE-E03'])],
    ],
    waiting: [],
  });
});

test('what does not advance says why, and a task in review is not done', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  const brand = memberRepo(dir, 'brand');
  pushRoadmap(core.work, roadmap([
    ['E01', 'E02', 'Pendiente'],
    ['E02', 'E01', 'Pendiente'],
    ['E03', 'CORE-E99', 'Pendiente'],
    ['E04', '—', 'Bloqueada', 'Falta el logo'],
    ['E05', 'E04', 'Pendiente'],
    ['E06', '—', 'Pendiente'],
    ['E07', 'E06', 'Pendiente'],
    ['E08', 'E01', 'Pendiente'],
  ]));
  writeSala(dir, salaConfig([member('core', 'CORE', core.work), member('brand', 'BRAND', brand.work)]));
  const prs = [{ number: 7, title: 'Algo nuevo (E06)', headRefName: 'feat/e06', isDraft: false, statusCheckRollup: [] }];

  const res = runSala(dir, ['plan'], { FAKE_GH_OUT: JSON.stringify(prs) });

  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout).queue, {
    waves: [
      [task('core', 'E06', [], { status: 'en revisión' })],
      [task('core', 'E07', ['E06'])],
    ],
    waiting: [
      { member: 'core', id: 'E01', entrega: 'Entrega E01', reasons: ['ciclo de dependencias: E01 → E02 → E01'] },
      { member: 'core', id: 'E02', entrega: 'Entrega E02', reasons: ['ciclo de dependencias: E02 → E01 → E02'] },
      { member: 'core', id: 'E03', entrega: 'Entrega E03', reasons: ['dependencia sin resolver: CORE-E99'] },
      { member: 'core', id: 'E04', entrega: 'Entrega E04', reasons: ['Bloqueada: Falta el logo'] },
      { member: 'core', id: 'E05', entrega: 'Entrega E05', reasons: ['espera a E04 (Bloqueada)'] },
      { member: 'core', id: 'E08', entrega: 'Entrega E08', reasons: ['espera a E01, que no puede avanzar'] },
      { member: 'brand', reasons: ['no se pudo leer: no hay docs/ROADMAP.md en origin/main'] },
    ],
  });
});

test('pinned tasks in sala.json are validated against the members', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  writeSala(dir, { ...salaConfig([member('core', 'CORE', core.work)]), pinned: ['E05', 'ZZ-1', 'CORE-E1', 'CORE-E1'] });

  const res = runSala(dir, ['plan']);

  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.deepEqual(JSON.parse(res.stderr), {
    error: 'sala.json no es válido',
    details: [
      'pinned[0]: debe ser un ID con el prefijo de un miembro, por ejemplo CORE-E09',
      'pinned[1]: no hay un miembro con el prefijo ZZ',
      'pinned[3]: «CORE-E1» está repetido',
    ],
  });
});
