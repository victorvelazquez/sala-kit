'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir, runSala } = require('./helpers');

const START = '<!-- sala-kit:sala:inicio -->';
const END = '<!-- sala-kit:sala:fin -->';

function read(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

test('init deja una sala nueva en una carpeta vacía, y en ella plan y donde funcionan', (t) => {
  const dir = path.join(tempDir(t), 'mi-sala');
  const res = runSala(process.cwd(), ['init', '--sala', dir]);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  const out = JSON.parse(res.stdout);
  assert.deepEqual(out.created, ['sala.json', 'AGENTS.md', '.gitignore']);
  assert.deepEqual(out.skipped, []);
  assert.deepEqual(out.warnings, []);

  const config = JSON.parse(read(dir, 'sala.json'));
  assert.equal(config.name, 'mi-sala');
  assert.deepEqual(config.members, []);
  const agents = read(dir, 'AGENTS.md');
  assert.ok(agents.includes(START) && agents.includes(END));
  assert.ok(agents.indexOf('## Preguntas') > agents.indexOf(START), 'la regla de preguntas va dentro del bloque');
  assert.ok(agents.indexOf('## Preguntas') < agents.indexOf(END));
  assert.ok(!agents.includes('SK3a'), 'el comentario de la plantilla no se copia');
  assert.equal(read(dir, '.gitignore'), '.sala/\n');

  const plan = runSala(dir, ['plan']);
  assert.equal(plan.code, 0, plan.stderr);
  const donde = runSala(dir, ['donde']);
  assert.equal(donde.code, 0, donde.stderr);
  assert.equal(JSON.parse(donde.stdout).kind, 'sala');
});

test('init de nuevo no cambia nada y dice qué salteó', (t) => {
  const dir = tempDir(t);
  assert.equal(runSala(dir, ['init']).code, 0);
  const before = ['sala.json', 'AGENTS.md', '.gitignore'].map((f) => read(dir, f));
  const res = runSala(dir, ['init']);
  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.deepEqual(out.created, []);
  assert.deepEqual(out.skipped.map((s) => s.file), ['sala.json', 'AGENTS.md', '.gitignore']);
  assert.deepEqual(['sala.json', 'AGENTS.md', '.gitignore'].map((f) => read(dir, f)), before);
  assert.ok(!fs.existsSync(path.join(dir, 'AGENTS.md.sugerido')));
});

test('un AGENTS.md sin las marcas queda igual, y el bloque va a AGENTS.md.sugerido con un aviso', (t) => {
  const dir = tempDir(t);
  const own = '# Reglas viejas\n\n- Nunca abras un PR.\n';
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), own);
  fs.writeFileSync(path.join(dir, 'sala.json'), '{"mio": true}\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
  const res = runSala(dir, ['init']);
  assert.equal(res.code, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(read(dir, 'AGENTS.md'), own);
  assert.equal(read(dir, 'sala.json'), '{"mio": true}\n');
  const suggested = read(dir, 'AGENTS.md.sugerido');
  assert.ok(suggested.includes(START) && suggested.includes(END));
  assert.deepEqual(out.created, ['AGENTS.md.sugerido']);
  assert.deepEqual(out.updated, ['.gitignore']);
  assert.equal(read(dir, '.gitignore'), 'node_modules/\n.sala/\n');
  assert.equal(out.warnings.length, 2);
  assert.match(out.warnings[0], /sala\.json ya existe pero no es válido/);
  assert.match(out.warnings[1], /AGENTS\.md ya tiene reglas propias/);

  // Running it again does not rewrite the suggestion nor the .gitignore.
  fs.writeFileSync(path.join(dir, 'AGENTS.md.sugerido'), 'editado\n');
  const again = JSON.parse(runSala(dir, ['init']).stdout);
  assert.equal(read(dir, 'AGENTS.md.sugerido'), 'editado\n');
  assert.equal(read(dir, '.gitignore'), 'node_modules/\n.sala/\n');
  assert.deepEqual(again.created, []);
  assert.deepEqual(again.updated, []);
});

test('un AGENTS.md que ya tiene el bloque no se toca', (t) => {
  const dir = tempDir(t);
  const text = `# Mi sala\n\n${START}\nversión vieja del bloque\n${END}\n\nMis notas.\n`;
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), text);
  const res = runSala(dir, ['init']);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(read(dir, 'AGENTS.md'), text);
  const out = JSON.parse(res.stdout);
  assert.ok(out.skipped.some((s) => s.file === 'AGENTS.md'));
  assert.ok(!fs.existsSync(path.join(dir, 'AGENTS.md.sugerido')));
});

test('init se niega en la carpeta de un miembro, y si no puede leer algo no escribe nada', (t) => {
  const member = tempDir(t);
  const agents = '<!-- sala-kit:miembro:inicio -->\nx\n<!-- sala-kit:miembro:fin -->\n';
  fs.writeFileSync(path.join(member, 'AGENTS.md'), agents);
  const res = runSala(member, ['init']);
  assert.equal(res.code, 1);
  assert.deepEqual(JSON.parse(res.stderr), { error: `${member} es un miembro de una sala: init no lo convierte en sala` });
  assert.deepEqual(fs.readdirSync(member), ['AGENTS.md']);

  const odd = tempDir(t);
  fs.mkdirSync(path.join(odd, 'AGENTS.md'));
  const broken = runSala(odd, ['init']);
  assert.equal(broken.code, 1);
  assert.deepEqual(JSON.parse(broken.stderr), { error: 'no se pudo leer AGENTS.md: EISDIR' });
  assert.deepEqual(fs.readdirSync(odd), ['AGENTS.md']);
});

test('un sala.json que no es válido se saltea con un aviso, y un .gitignore con CRLF sigue con CRLF', (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'sala.json'), '{"schema": 1}\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\r\n');
  const out = JSON.parse(runSala(dir, ['init']).stdout);
  assert.equal(read(dir, 'sala.json'), '{"schema": 1}\n');
  assert.deepEqual(out.warnings, ['sala.json ya existe pero no es válido: `sala donde` dice qué le falta']);
  assert.equal(read(dir, '.gitignore'), 'node_modules/\r\n.sala/\r\n');
});

test('donde dice si la carpeta es una sala, un miembro o ninguna', (t) => {
  const root = tempDir(t);
  const none = runSala(root, ['donde']);
  assert.equal(none.code, 0, none.stderr);
  assert.deepEqual(JSON.parse(none.stdout), { kind: 'ninguna', dir: root });

  const member = path.join(root, 'brand');
  fs.mkdirSync(member);
  fs.writeFileSync(path.join(member, 'AGENTS.md'), '<!-- sala-kit:miembro:inicio -->\nx\n<!-- sala-kit:miembro:fin -->\n');
  assert.equal(JSON.parse(runSala(member, ['donde']).stdout).kind, 'miembro');

  fs.writeFileSync(path.join(root, 'sala.json'), 'no es json');
  const broken = runSala(root, ['donde']);
  assert.equal(broken.code, 1);
  assert.match(JSON.parse(broken.stderr).error, /sala\.json no es JSON válido/);
  assert.equal(runSala(root, ['donde', '--texto']).code, 1);
});
