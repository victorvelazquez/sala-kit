'use strict';

// SK30: sala adoptar --probar shows what it would add and the prefixes the other members use.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir, git, memberRepo, writeSala, salaConfig, runSala, runAsync, feedSala } = require('./helpers');

const HEADER = '**Dónde está:** algo.\n**Qué sigue:** algo.\n**Qué lo bloquea:** nada.\n';
const row = (id, deps) => `| ${id} | Una | Se ve | ${deps} | Pendiente |  | — |`;
const roadmap = (...rows) => `${HEADER}\n| ID | Entrega | Resultado visible | Depende de | Estado | Notas | Ficha |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`;

function pushRoadmap(work, text) {
  fs.mkdirSync(path.join(work, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(work, 'docs', 'ROADMAP.md'), text);
  git(work, 'add', 'docs/ROADMAP.md');
  git(work, 'commit', '--quiet', '-m', 'roadmap');
  git(work, 'push', '--quiet', 'origin', 'main');
}

function cloned(root, name) {
  const repo = memberRepo(root, name);
  git(repo.work, 'remote', 'set-head', 'origin', '-a');
  return repo.work;
}

test('sala adoptar --probar writes nothing and shows the prefixes the other roadmaps use, with a proposal', (t) => {
  const dir = tempDir(t);
  const erp = cloned(dir, 'upen-erp');
  const brand = cloned(dir, 'upen-brand');
  pushRoadmap(erp, roadmap(row('E1', 'WEB-W13, BRAND-M2, PAGES-P1'), row('E2', 'E1, WEB-W2')));
  pushRoadmap(brand, roadmap(row('M2', 'ERP-E1')));
  writeSala(dir, salaConfig([
    { id: 'erp', prefix: 'ERP', path: erp, base: 'main' },
    { id: 'brand', prefix: 'BRAND', path: brand, base: 'main' },
  ]));
  const web = cloned(dir, 'upen-web');
  const old = fs.readFileSync(path.join(dir, 'sala.json'), 'utf8');

  const res = runSala(dir, ['adoptar', web, '--probar']);

  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  assert.deepEqual(JSON.parse(res.stdout), {
    sala: 'prueba',
    dryRun: true,
    member: { id: 'upen-web', prefix: 'UPENWEB', path: web, base: 'main', remote: 'origin' },
    // Prefixes of members already in the sala are not offered; each one says where it was seen.
    seen: [{ prefix: 'PAGES', in: ['erp'] }, { prefix: 'WEB', in: ['erp'] }],
    suggested: { id: 'web', prefix: 'WEB' },
    warnings: ['upen-web: no tiene el bloque del miembro en AGENTS.md; `sala condiciones upen-web` le manda la orden de ponerse en condiciones'],
  });
  assert.equal(fs.readFileSync(path.join(dir, 'sala.json'), 'utf8'), old);

  const text = runSala(dir, ['adoptar', web, '--probar', '--texto']).stdout;
  assert.equal(text, [
    'upen-web se adoptaría en la sala prueba (no se escribió nada): prefijo UPENWEB, base origin/main, ' + web,
    '  prefijos en los otros roadmaps: PAGES (erp), WEB (erp)',
    '  propuesta: --id web --prefijo WEB',
    '  aviso: upen-web: no tiene el bloque del miembro en AGENTS.md; `sala condiciones upen-web` le manda la orden de ponerse en condiciones',
    '',
  ].join('\n'));

  // With the flags of the proposal nothing else is proposed; without a match there is no proposal.
  const chosen = JSON.parse(runSala(dir, ['adoptar', web, '--probar', '--id', 'web', '--prefijo', 'WEB']).stdout);
  assert.deepEqual([chosen.member.id, chosen.member.prefix, chosen.suggested], ['web', 'WEB', null]);
  const other = cloned(dir, 'tools');
  assert.equal(JSON.parse(runSala(dir, ['adoptar', other, '--probar']).stdout).suggested, null);

  // It refuses like the real one, and writes nothing.
  const twice = runSala(dir, ['adoptar', erp, '--probar']);
  assert.equal(twice.code, 1);
  assert.deepEqual(JSON.parse(twice.stderr), { error: 'ya es un miembro: erp' });
  assert.equal(fs.readFileSync(path.join(dir, 'sala.json'), 'utf8'), old);

  assert.deepEqual(JSON.parse(runSala(dir, ['revisar', '--probar']).stderr), { error: 'argumento desconocido: --probar' });
});

test('sala condiciones says that the next step, when the member finishes, is /sala-entregar', async (t) => {
  const s = feedSala(t);
  fs.rmdirSync(path.join(s.dir, 'core'));
  memberRepo(s.dir, 'core');
  pushRoadmap(s.core, roadmap(row('E1', '—')));
  s.session('c1', s.core);
  const seen = s.answer('c1');

  const res = await runAsync(s.dir, ['condiciones', 'core'], s.env);
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    member: 'core', failing: ['agents-size', 'member-block'], sent: true, session: 'id-c1', next: '/sala-entregar core',
  });
  assert.equal(seen.length, 1);

  const text = await runAsync(s.dir, ['condiciones', 'core', '--texto'], s.env);
  assert.equal(text.stdout, [
    'core: orden de ponerse en condiciones entregada a la sesión id-c1 (agents-size, member-block)',
    '  cuando termine, el paso siguiente es /sala-entregar core',
    '',
  ].join('\n'));
});
