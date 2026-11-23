'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir, runSala } = require('./helpers');

const START = '<!-- sala-kit:miembro:inicio -->';
const END = '<!-- sala-kit:miembro:fin -->';
const TEMPLATES = path.join(__dirname, '..', 'templates');
const body = (file) => fs.readFileSync(path.join(TEMPLATES, 'bloques', file), 'utf8');
const memberBody = () => fs.readFileSync(path.join(TEMPLATES, 'miembro', 'bloque.md'), 'utf8').replace(/^<!--[\s\S]*?-->\r?\n/, '');
const read = (dir) => fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
const crlf = (text) => text.replace(/\r?\n/g, '\r\n');

const NEW = {
  tareas: `<!-- panel:tareas v1.4 -->\n${body('panel-tareas.md')}<!-- /panel:tareas -->`,
  entrega: `<!-- panel:entrega v1.1 -->\n${body('panel-entrega.md')}<!-- /panel:entrega -->`,
  ciclo: `<!-- orquestacion:ciclo v1.1 -->\n${body('orquestacion-ciclo.md')}<!-- /orquestacion:ciclo -->`,
};
const member = () => `${START}\n${memberBody()}${END}\n`;

// An AGENTS.md like repo-panel's: own rules around the old blocks, and blocks the kit does not know.
const OUTSIDE = [
  '# Reglas para agentes en ejemplo\n\nPanel con acentos: ñandú, «comillas» y la palabra panel:tareas suelta.\n\n',
  '<!-- orquestacion:registro v1.0 -->\n## Registro\nno es del catálogo\n<!-- /orquestacion:registro -->\n\n',
  '\n\nUna regla propia entre bloques.\n\n',
  '\n\n',
  '\n\n<!-- panel:estado v1.0 -->\n## Estado\nno es del catálogo\n<!-- /panel:estado -->\n\n## Más reglas propias\n\nAl final.',
];
const OLD = [
  '<!-- panel:tareas v1.3 -->\n## Panel: mecanismo de tareas (el único)\nEste es el ÚNICO mecanismo.\n<!-- /panel:tareas -->',
  '<!-- panel:entrega v1.0 -->\n## Panel: entrega\nSolo /flow-*.\n<!-- /panel:entrega -->',
  '<!-- orquestacion:ciclo v1.0 -->\n## Ciclo\nNunca ejecutes los comandos.\n<!-- /orquestacion:ciclo -->',
];
const joined = (blocks) => OUTSIDE[0] + OUTSIDE[1] + blocks[0] + OUTSIDE[2] + blocks[1] + OUTSIDE[3] + blocks[2] + OUTSIDE[4];

test('sala unirse brings the old blocks up to date between their marks and never touches a byte outside them', (t) => {
  for (const eol of ['lf', 'crlf']) {
    const dir = path.join(tempDir(t), eol);
    fs.mkdirSync(dir);
    const conv = eol === 'crlf' ? crlf : (x) => x;
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), conv(joined(OLD)));

    const res = runSala(dir, ['unirse']);

    assert.equal(res.code, 0, res.stderr);
    assert.equal(res.stderr, '');
    assert.deepEqual(JSON.parse(res.stdout), {
      dir, created: [], updated: ['panel:tareas', 'panel:entrega', 'orquestacion:ciclo', 'miembro'], skipped: [], warnings: [],
    });
    // Outside the marks it is the same file byte by byte; the member block goes at the end.
    const expected = conv(`${joined([NEW.tareas, NEW.entrega, NEW.ciclo])}\n\n${member()}`);
    assert.equal(read(dir), expected, eol);
    assert.deepEqual(fs.readdirSync(dir), ['AGENTS.md']);

    // Run again: everything is up to date and nothing changes.
    const again = runSala(dir, ['unirse']);
    assert.equal(again.code, 0, again.stderr);
    assert.deepEqual(JSON.parse(again.stdout), {
      dir, created: [], updated: [], skipped: [{ file: 'AGENTS.md', reason: 'ya tiene el bloque del miembro y los bloques al día' }], warnings: [],
    });
    assert.equal(read(dir), expected);
  }
});

test('sala unirse brings an old member block up to date between its marks', (t) => {
  const dir = tempDir(t);
  const text = `# Reglas\n\nPropia.\n\n${START}\nla versión vieja del bloque\n${END}\n\nDespués.\n`;
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), text);

  const res = runSala(dir, ['unirse']);

  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout).updated, ['miembro']);
  assert.equal(read(dir), `# Reglas\n\nPropia.\n\n${member()}\nDespués.\n`);
});

test('sala unirse writes nothing when a block has broken marks', (t) => {
  const cases = [
    { text: `${OLD[0]}\n${OLD[0]}\n`, error: 'AGENTS.md tiene las marcas del bloque panel:tareas repetidas, sin cerrar o al revés; arreglalas a mano y volvé a correr sala unirse' },
    { text: '<!-- panel:entrega v1.0 -->\nsin fin\n', error: 'AGENTS.md tiene las marcas del bloque panel:entrega repetidas, sin cerrar o al revés; arreglalas a mano y volvé a correr sala unirse' },
    { text: '<!-- /orquestacion:ciclo -->\n<!-- orquestacion:ciclo v1.0 -->\n', error: 'AGENTS.md tiene las marcas del bloque orquestacion:ciclo repetidas, sin cerrar o al revés; arreglalas a mano y volvé a correr sala unirse' },
    { text: `${OLD[1]}\n${END}\n${START}\n`, error: 'AGENTS.md tiene las marcas del bloque del miembro repetidas, sin cerrar o al revés; arreglalas a mano y volvé a correr sala unirse' },
    { text: `${OLD[1]}\n${START}\nsin fin\n`, error: 'AGENTS.md tiene las marcas del bloque del miembro repetidas, sin cerrar o al revés; arreglalas a mano y volvé a correr sala unirse' },
  ];
  for (const c of cases) {
    const dir = tempDir(t);
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), c.text);
    const res = runSala(dir, ['unirse']);
    assert.equal(res.code, 1, c.error);
    assert.equal(res.stdout, '');
    assert.deepEqual(JSON.parse(res.stderr), { error: c.error });
    assert.equal(read(dir), c.text);
    assert.deepEqual(fs.readdirSync(dir), ['AGENTS.md']);
  }
});

test('sala unirse keeps mixed line ends outside the marks byte by byte, and never downgrades a newer block', (t) => {
  const dir = tempDir(t);
  const before = 'A\r\nB\nC\r\n';
  const newer = '<!-- panel:entrega v2.0 -->\nde una versión futura\n<!-- /panel:entrega -->';
  const middle = '\nD\n';
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `${before}<!-- panel:tareas v1.3 -->\r\nviejo\r\n<!-- /panel:tareas -->${middle}${newer}\nE`);

  const res = runSala(dir, ['unirse']);

  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    dir,
    created: [],
    updated: ['panel:tareas', 'miembro'],
    skipped: [],
    warnings: ['AGENTS.md tiene panel:entrega v2.0, más nuevo que el v1.1 del kit: no se tocó'],
  });
  // The replaced block takes the line ends of its own mark line; the appended one, LF like the last line.
  assert.equal(read(dir), `${before}${crlf(NEW.tareas)}${middle}${newer}\nE\n\n${member()}`);
});

test('sala unirse keeps the line end after the member end mark as it was', (t) => {
  for (const [after, tail] of [['\n', 'Después.\r\n'], ['\r\n', 'Después.\n'], ['', '']]) {
    const dir = tempDir(t);
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# R\r\n${START}\r\nviejo\r\n${END}${after}${tail}`);
    const res = runSala(dir, ['unirse']);
    assert.equal(res.code, 0, res.stderr);
    assert.equal(read(dir), `# R\r\n${crlf(member()).replace(/\r\n$/, '')}${after}${tail}`, JSON.stringify(after));
    assert.deepEqual(JSON.parse(runSala(dir, ['unirse']).stdout).updated, []);
  }
});
