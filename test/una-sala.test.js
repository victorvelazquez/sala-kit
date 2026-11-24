'use strict';

// D56: a repo is a member of one sala only (SK27).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir, git, memberRepo, writeSala, salaConfig, runSala, runAsync, feedSala } = require('./helpers');

const START = '<!-- sala-kit:miembro:inicio -->';
const END = '<!-- sala-kit:miembro:fin -->';
const HEADER = '**Dónde está:** algo.\n**Qué sigue:** algo.\n**Qué lo bloquea:** nada.\n';
const TABLE = '| ID | Entrega | Resultado visible | Depende de | Estado | Notas | Ficha |\n| --- | --- | --- | --- | --- | --- | --- |\n| E1 | Una | Se ve | — | Pendiente |  | — |\n';
const named = (sala) => `# Reglas\n\n${START}\n<!-- sala-kit:sala=${sala} -->\nbloque\n${END}\n`;
const unnamed = `# Reglas\n\n${START}\nbloque\n${END}\n`;

function read(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

function pushFiles(work, files) {
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
    fs.writeFileSync(path.join(work, file), content);
    git(work, 'add', file);
  }
  git(work, 'commit', '--quiet', '-m', 'files');
  git(work, 'push', '--quiet', 'origin', 'main');
}

function cloned(root, name) {
  const repo = memberRepo(root, name);
  git(repo.work, 'remote', 'set-head', 'origin', 'main');
  return repo.work;
}

test('sala adoptar refuses a repo whose block names another sala, and says which; the same sala or an unnamed block is adopted', (t) => {
  const dir = tempDir(t);
  writeSala(dir, salaConfig([]));
  const old = read(dir, 'sala.json');

  const brand = cloned(dir, 'upen-brand');
  fs.writeFileSync(path.join(brand, 'AGENTS.md'), named('upen'));
  const refused = runSala(dir, ['adoptar', brand]);
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, '');
  assert.deepEqual(JSON.parse(refused.stderr), { error: 'upen-brand ya es miembro de la sala upen' });
  assert.equal(read(dir, 'sala.json'), old);

  const own = cloned(dir, 'own');
  fs.writeFileSync(path.join(own, 'AGENTS.md'), named('prueba'));
  const ok = runSala(dir, ['adoptar', own]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout).warnings, []);

  const legacy = cloned(dir, 'legacy');
  fs.writeFileSync(path.join(legacy, 'AGENTS.md'), unnamed);
  const warned = runSala(dir, ['adoptar', legacy]);
  assert.equal(warned.code, 0, warned.stderr);
  assert.deepEqual(JSON.parse(warned.stdout).warnings, [
    'legacy: el bloque del miembro no nombra su sala; `sala condiciones legacy` le manda la orden de ponerse al día',
  ]);
  assert.deepEqual(JSON.parse(read(dir, 'sala.json')).members.map((m) => m.id), ['own', 'legacy']);
});

test('sala unirse --de names the sala in the block, keeps it without --de, and never moves the repo to another sala', (t) => {
  const dir = tempDir(t);
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);

  const res = runSala(repo, ['unirse', '--de', 'upen']);
  assert.equal(res.code, 0, res.stderr);
  const text = read(repo, 'AGENTS.md');
  assert.ok(text.includes(`${START}\n## La sala\n\n<!-- sala-kit:sala=upen -->\n`), text);
  assert.ok(text.includes('Su sala es **upen**'), text);

  // Without --de the name stays: nothing to update.
  const again = JSON.parse(runSala(repo, ['unirse']).stdout);
  assert.deepEqual(again.updated, []);
  assert.equal(read(repo, 'AGENTS.md'), text);

  const moved = runSala(repo, ['unirse', '--de', 'otra']);
  assert.equal(moved.code, 1);
  assert.equal(moved.stdout, '');
  assert.deepEqual(JSON.parse(moved.stderr), {
    error: 'AGENTS.md ya tiene el bloque de la sala upen: un repositorio es miembro de una sola sala (D56); para cambiarlo, la persona saca el bloque a mano',
  });
  assert.equal(read(repo, 'AGENTS.md'), text);

  // An old block without a name gets it; without --de it stays unnamed and warns.
  const legacy = path.join(dir, 'legacy');
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, 'AGENTS.md'), unnamed);
  const warned = JSON.parse(runSala(legacy, ['unirse']).stdout);
  assert.deepEqual(warned.warnings, ['el bloque del miembro no nombra su sala: corré `sala unirse --de <sala>` con el name de su sala.json']);
  assert.ok(!read(legacy, 'AGENTS.md').includes('sala-kit:sala='));
  const fixed = runSala(legacy, ['unirse', '--de', 'upen']);
  assert.equal(fixed.code, 0, fixed.stderr);
  assert.deepEqual(JSON.parse(fixed.stdout).updated, ['miembro']);
  assert.ok(read(legacy, 'AGENTS.md').includes('<!-- sala-kit:sala=upen -->'));

  for (const bad of ['a b', '-x', 'x-->', 'ñ'.repeat(3), 'a'.repeat(65)]) {
    const r = runSala(repo, ['unirse', '--de', bad]);
    assert.equal(r.code, 1, bad);
    assert.deepEqual(JSON.parse(r.stderr), {
      error: '--de necesita el nombre de la sala: letras, números, punto, guion o guion bajo, hasta 64, sin empezar con guion',
    }, bad);
  }
  assert.deepEqual(JSON.parse(runSala(repo, ['unirse', '--de']).stderr), { error: '--de necesita un valor' });
  assert.deepEqual(JSON.parse(runSala(dir, ['revisar', '--de', 'upen']).stderr), { error: 'argumento desconocido: --de' });
});

test('sala revisar fails member-block when the block names no sala or another one', (t) => {
  const dir = tempDir(t);
  const agents = { core: named('prueba'), web: unnamed, api: named('upen') };
  const members = Object.keys(agents).map((id) => {
    const repo = memberRepo(dir, id);
    pushFiles(repo.work, { 'docs/ROADMAP.md': `${HEADER}\n${TABLE}`, 'AGENTS.md': agents[id] });
    return { id, prefix: id.toUpperCase(), path: repo.work, base: 'main' };
  });
  writeSala(dir, salaConfig(members));

  const out = JSON.parse(runSala(dir, ['revisar']).stdout);
  const block = (i) => out.members[i].requirements.find((r) => r.id === 'member-block');
  assert.deepEqual(block(0), { id: 'member-block', ok: true, detail: 'AGENTS.md tiene el bloque del miembro de la sala prueba', fix: null });
  assert.equal(block(1).ok, false);
  assert.equal(block(1).detail, 'el bloque del miembro no nombra su sala');
  assert.match(block(1).fix, /^En una tarea propia, corré `sala unirse --de prueba` en la raíz del repositorio/);
  assert.equal(block(2).ok, false);
  assert.equal(block(2).detail, 'el bloque del miembro es de la sala upen, no de prueba');
  assert.equal(block(2).fix, 'Un repositorio es miembro de una sola sala (D56) y esta no le manda órdenes. Decide la persona: sacarlo de esta sala con `sala soltar`, o sacar a mano el bloque de la otra y correr `sala unirse --de prueba`.');
});

test('sala condiciones never sends an order to a member of another sala, and asks an unnamed one for --de', async (t) => {
  const s = feedSala(t);
  for (const name of ['core', 'web']) {
    fs.rmdirSync(path.join(s.dir, name));
    memberRepo(s.dir, name);
  }
  const dir = s.dir;
  pushFiles(s.core, { 'docs/ROADMAP.md': `${HEADER}\n${TABLE}`, 'AGENTS.md': named('upen') });
  pushFiles(s.web, { 'docs/ROADMAP.md': `${HEADER}\n${TABLE}`, 'AGENTS.md': unnamed });
  s.session('c1', s.core);
  s.session('w1', s.web);
  const seenCore = s.answer('c1');
  const seenWeb = s.answer('w1');

  const refused = await runAsync(dir, ['condiciones', 'core'], s.env);
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, '');
  assert.deepEqual(JSON.parse(refused.stderr), { error: 'core es miembro de la sala upen: esta sala no le manda órdenes (D56)' });
  assert.equal(seenCore.length, 0);

  const sent = await runAsync(dir, ['condiciones', 'web'], s.env);
  assert.equal(sent.code, 0, sent.stderr);
  assert.deepEqual(JSON.parse(sent.stdout).failing, ['member-block']);
  assert.equal(seenWeb.length, 1);
  assert.match(seenWeb[0].args.text, /member-block: el bloque del miembro no nombra su sala\. En una tarea propia, corré `sala unirse --de prueba`/);
});
