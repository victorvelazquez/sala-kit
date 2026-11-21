'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir, memberRepo, member, runSala } = require('./helpers');
const { version } = require('../package.json');

const START = '<!-- sala-kit:sala:inicio -->';
const END = '<!-- sala-kit:sala:fin -->';

function read(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

// A room made by `sala init`, plus the block the installed kit writes.
function newSala(t) {
  const dir = tempDir(t);
  assert.equal(runSala(dir, ['init']).code, 0);
  const agents = read(dir, 'AGENTS.md');
  const block = agents.slice(agents.indexOf(START), agents.indexOf(END) + END.length);
  return { dir, block };
}

function snapshot(dir) {
  return Object.fromEntries(fs.readdirSync(dir).filter((f) => f !== '.sala').map((f) => [f, read(dir, f)]));
}

test('en una sala vieja migra sala.json, reescribe solo el bloque y deja igual el texto de afuera', (t) => {
  const { dir, block } = newSala(t);
  const old = { schema: 1, name: 'vieja', members: [], options: { language: 'es', jira: false } };
  fs.writeFileSync(path.join(dir, 'sala.json'), `${JSON.stringify(old, null, 2)}\n`);
  const before = '# Reglas mías\r\n\r\n- Una regla con <!-- sala-kit:otro --> y acentos: ñandú.\r\n\r\n';
  const after = '\r\n## Después\n\n- `sala-kit:sala` en el texto, sin ser marca.\n\n\n';
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `${before}${START}\nel bloque viejo\n${END}${after}`);

  const res = runSala(dir, ['actualizar']);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  const out = JSON.parse(res.stdout);
  assert.deepEqual(out.kit, { from: null, to: version });
  assert.deepEqual(out.updated, ['sala.json', 'AGENTS.md']);
  assert.deepEqual(out.members, []);

  assert.deepEqual(JSON.parse(read(dir, 'sala.json')), { schema: 1, kit: version, name: 'vieja', members: [], options: old.options });
  assert.equal(read(dir, 'AGENTS.md'), `${before}${block}${after}`);
  assert.ok(!fs.existsSync(path.join(dir, 'AGENTS.md.sugerido')));
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});

test('de nuevo no cambia nada y dice qué salteó', (t) => {
  const { dir } = newSala(t);
  const first = runSala(dir, ['actualizar']);
  assert.equal(first.code, 0, first.stderr);
  const files = snapshot(dir);
  const res = runSala(dir, ['actualizar', '--texto']);
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(snapshot(dir), files);
  assert.equal(
    res.stdout,
    `Sala ${path.basename(dir)}: kit ${version}, ya al día\n` +
      '  salteado    sala.json: ya está al día\n' +
      '  salteado    AGENTS.md: el bloque de la sala ya está al día\n' +
      '  sin miembros para revisar\n',
  );
});

test('un AGENTS.md sin las marcas queda igual, y el bloque va a AGENTS.md.sugerido', (t) => {
  const { dir, block } = newSala(t);
  const own = '# Reglas propias\n\n- Nunca abras un PR.\n';
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), own);
  const res = runSala(dir, ['actualizar']);
  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.deepEqual(out.created, ['AGENTS.md.sugerido']);
  assert.equal(out.warnings.length, 1);
  assert.equal(read(dir, 'AGENTS.md'), own);
  assert.equal(read(dir, 'AGENTS.md.sugerido'), `${block}\n`);

  // A suggestion that is already there is never overwritten.
  fs.writeFileSync(path.join(dir, 'AGENTS.md.sugerido'), 'lo que editó la persona\n');
  const again = runSala(dir, ['actualizar']);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(read(dir, 'AGENTS.md.sugerido'), 'lo que editó la persona\n');
});

test('con las marcas rotas, un sala.json de un kit más nuevo o inválido, no escribe nada', (t) => {
  const cases = [
    ['una sola marca', { agents: `# Reglas\n\n${START}\nsin fin\n` }, 'AGENTS.md tiene las marcas del bloque de la sala rotas; arreglalas a mano y volvé a correr sala actualizar'],
    ['el bloque dos veces', { agents: `${START}\na\n${END}\n${START}\nb\n${END}\n` }, 'AGENTS.md tiene las marcas del bloque de la sala rotas; arreglalas a mano y volvé a correr sala actualizar'],
    ['el fin antes del inicio', { agents: `${END}\na\n${START}\n` }, 'AGENTS.md tiene las marcas del bloque de la sala rotas; arreglalas a mano y volvé a correr sala actualizar'],
    ['un kit más nuevo', { sala: { kit: '99.0.0' } }, `sala.json es del kit 99.0.0, más nuevo que el instalado (${version}); actualizá el kit`],
    ['un kit que no es una versión', { sala: { kit: 'v9.0.0' } }, `sala.json tiene un kit que no es una versión ("v9.0.0"); corregilo a mano, por ejemplo ${version}`],
    ['un kit con sufijo', { sala: { kit: '0.0.1-beta' } }, `sala.json tiene un kit que no es una versión ("0.0.1-beta"); corregilo a mano, por ejemplo ${version}`],
    ['un kit que es un número', { sala: { kit: 5 } }, `sala.json tiene un kit que no es una versión (5); corregilo a mano, por ejemplo ${version}`],
    ['un formato más nuevo', { sala: { schema: 2 } }, 'sala.json es de un formato más nuevo (schema 2) que el del kit instalado; actualizá el kit'],
    ['un campo desconocido', { sala: { otro: 1 } }, 'sala.json no es válido; no se escribió nada'],
    ['JSON roto', { salaText: '{"schema": 1,' }, 'sala.json no es JSON válido'],
  ];
  for (const [name, change, error] of cases) {
    const { dir } = newSala(t);
    const config = { ...JSON.parse(read(dir, 'sala.json')), kit: '0.0.1', ...(change.sala || {}) };
    fs.writeFileSync(path.join(dir, 'sala.json'), change.salaText ?? `${JSON.stringify(config, null, 2)}\n`);
    if (change.agents) fs.writeFileSync(path.join(dir, 'AGENTS.md'), change.agents);
    const files = snapshot(dir);
    const res = runSala(dir, ['actualizar']);
    assert.equal(res.code, 1, name);
    assert.equal(res.stdout, '', name);
    assert.equal(JSON.parse(res.stderr).error, error, name);
    assert.deepEqual(snapshot(dir), files, name);
  }
});

test('si no puede reemplazar AGENTS.md, no migra sala.json, da el error en JSON y no deja temporales', (t) => {
  const { dir } = newSala(t);
  const config = JSON.parse(read(dir, 'sala.json'));
  delete config.kit;
  fs.writeFileSync(path.join(dir, 'sala.json'), `${JSON.stringify(config, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# Reglas\n\n${START}\nviejo\n${END}\n`);
  const files = snapshot(dir);
  fs.chmodSync(path.join(dir, 'AGENTS.md'), 0o444);
  // The temporary folder may be gone already when this runs.
  t.after(() => fs.existsSync(dir) && fs.chmodSync(path.join(dir, 'AGENTS.md'), 0o644));
  const res = runSala(dir, ['actualizar']);
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.equal(JSON.parse(res.stderr).error, 'no se pudo escribir AGENTS.md; no se cambió nada');
  assert.deepEqual(snapshot(dir), files);
});

test('si escribe AGENTS.md pero no sala.json, lo dice y otra corrida lo termina', (t) => {
  const { dir } = newSala(t);
  const config = { ...JSON.parse(read(dir, 'sala.json')), kit: '0.0.1' };
  fs.writeFileSync(path.join(dir, 'sala.json'), `${JSON.stringify(config, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# Reglas\n\n${START}\nviejo\n${END}\n`);
  const salaBefore = read(dir, 'sala.json');
  fs.chmodSync(path.join(dir, 'sala.json'), 0o444);
  t.after(() => fs.existsSync(dir) && fs.chmodSync(path.join(dir, 'sala.json'), 0o644));
  const res = runSala(dir, ['actualizar']);
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.equal(JSON.parse(res.stderr).error, 'se escribió AGENTS.md, pero no se pudo escribir sala.json; corré sala actualizar de nuevo');
  assert.equal(read(dir, 'sala.json'), salaBefore);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);

  fs.chmodSync(path.join(dir, 'sala.json'), 0o644);
  const again = runSala(dir, ['actualizar']);
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(JSON.parse(again.stdout).updated, ['sala.json']);
  assert.equal(JSON.parse(read(dir, 'sala.json')).kit, version);
});

test('vuelve a revisar a los miembros y propone la orden sin mandarla', (t) => {
  const { dir } = newSala(t);
  const { work } = memberRepo(dir, 'brand');
  const config = JSON.parse(read(dir, 'sala.json'));
  fs.writeFileSync(path.join(dir, 'sala.json'), JSON.stringify({ ...config, members: [member('brand', 'BRAND', work)] }));

  const res = runSala(dir, ['actualizar']);
  assert.equal(res.code, 0, res.stderr);
  const [m] = JSON.parse(res.stdout).members;
  assert.equal(m.id, 'brand');
  assert.equal(m.ok, false);
  assert.ok(m.failing.includes('member-block'));
  assert.ok(m.failing.includes('roadmap-table'));
  assert.equal(m.order, 'sala condiciones brand');
  assert.ok(!fs.existsSync(path.join(dir, '.sala', 'ordenes.log')), 'no manda ninguna orden');

  const texto = runSala(dir, ['actualizar', '--texto']);
  assert.equal(texto.code, 0, texto.stderr);
  const line = texto.stdout.split('\n').find((l) => l.startsWith('  brand: no cumple '));
  assert.ok(line && line.includes('member-block'), texto.stdout);
  assert.ok(texto.stdout.includes('con tu OK: sala condiciones brand'), texto.stdout);
});
