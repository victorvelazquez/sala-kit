'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { checkTitle, prFormat } = require('../src/formato');
const { validateConfig } = require('../src/config');

test('a well formed PR title passes, with or without scope', async () => {
  assert.deepEqual(await checkTitle('docs(guide): document theme H (M2c)', { id: 'M2c' }), {
    ok: true,
    errors: [],
    warnings: [],
    title: { type: 'docs', scope: 'guide', breaking: false, outcome: 'document theme H', id: 'M2c' },
  });
  const plain = await checkTitle('feat!: drop the old flag (SK5e)');
  assert.equal(plain.ok, true);
  assert.deepEqual(plain.title, { type: 'feat', scope: null, breaking: true, outcome: 'drop the old flag', id: 'SK5e' });
});

test('a malformed title is rejected with every reason', async () => {
  const cases = [
    ['document theme H (M2c)', 'el título debe ser tipo(ámbito)!: resultado, por ejemplo docs(guide): document theme H (M2c)'],
    ['docs(): document theme H (M2c)', 'el título debe ser tipo(ámbito)!: resultado, por ejemplo docs(guide): document theme H (M2c)'],
    ['Docs: document theme H (M2c)', 'el título debe ser tipo(ámbito)!: resultado, por ejemplo docs(guide): document theme H (M2c)'],
    ['docs(guide): document theme H', 'el título debe terminar con el ID de la tarea entre paréntesis, por ejemplo (M2c)'],
    ['docs(guide): (M2c)', 'el título debe ser tipo(ámbito)!: resultado, por ejemplo docs(guide): document theme H (M2c)'],
  ];
  for (const [title, error] of cases) {
    const res = await checkTitle(title);
    assert.equal(res.ok, false, title);
    assert.deepEqual(res.errors, [error], title);
    assert.equal(res.title, null, title);
  }
  const other = await checkTitle('docs(guide): document theme H (M2d)', { id: 'M2c' });
  assert.deepEqual(other.errors, ['el título termina con (M2d), pero la tarea es M2c']);
});

test('over 72 characters is only a warning', async () => {
  const title = `fix(core): ${'a'.repeat(60)} (SK5e)`;
  const res = await checkTitle(title);
  assert.equal(res.ok, true);
  assert.deepEqual(res.warnings, [`el título tiene ${title.length} caracteres; conviene no pasar de 72`]);
  assert.deepEqual((await checkTitle(`fix: ${'a'.repeat(59)} (SK5e)`)).warnings, []);
});

test('with jira on, the title needs a Jira key; off, it does not', async () => {
  assert.equal((await checkTitle('fix: keep the cart (SK5e)', { jira: false })).ok, true);
  assert.deepEqual((await checkTitle('fix: keep the cart (SK5e)', { jira: true })).errors, [
    'con options.jira el título debe llevar una clave de Jira, por ejemplo ABC-123',
  ]);
  assert.equal((await checkTitle('fix: ABC-123 keep the cart (SK5e)', { jira: true })).ok, true);
});

test('prFormat takes language and jira from options, with English and no Jira by default', () => {
  assert.deepEqual(prFormat({}), {
    language: 'en',
    jira: false,
    softLimit: 72,
    sections: ['Summary', 'Changes', 'Validation', 'Risks', 'Out of scope'],
    notRun: 'Not run',
  });
  assert.deepEqual(prFormat({ language: 'es', jira: true }), {
    language: 'es',
    jira: true,
    softLimit: 72,
    sections: ['Resumen', 'Cambios', 'Validación', 'Riesgos', 'Fuera de alcance'],
    notRun: 'No se corrió',
  });
});

test('sala.json accepts only es or en as language, and jira stays a boolean', () => {
  const config = {
    schema: 1,
    kit: '0.1.0',
    name: 'upen',
    members: [{ id: 'core', prefix: 'CORE', path: path.resolve('/repos/core'), base: 'develop' }],
    options: { language: 'es', jira: true },
  };
  assert.deepEqual(validateConfig(config).errors, []);
  config.options = { language: 'fr', jira: 'no' };
  assert.deepEqual(validateConfig(config).errors, [
    'options.language: debe ser es o en',
    'options.jira: debe ser true o false',
  ]);
});

test('a newline in the title is rejected, and the task ID alone is not a Jira key', async () => {
  for (const title of ['fix: a (SK5e)\n', 'fix: a\r\n (SK5e)', 'fix: a\nb (SK5e)']) {
    assert.equal((await checkTitle(title)).ok, false, JSON.stringify(title));
  }
  assert.equal((await checkTitle('fix: a (CORE-12)', { id: 'CORE-12', jira: true })).ok, false);
});

test('a title over the engine limit says so, and null options or input do not throw', async () => {
  assert.deepEqual((await checkTitle(`fix: ${'a'.repeat(510)} (SK5e)`)).errors, ['el título pasa de 512 bytes']);
  assert.equal((await checkTitle('fix: a (SK5e)', null)).ok, true);
  assert.equal((await checkTitle(null)).ok, false);
});

test('prFormat rejects a language it has no sections for', () => {
  assert.throws(() => prFormat({ language: 'fr' }), /idioma desconocido: fr/);
  assert.throws(() => prFormat({ language: 'toString' }), /idioma desconocido/);
  assert.equal(prFormat(null).language, 'en');
});

test('the 512-byte engine limit counts bytes of the whole title, ID included', async () => {
  const fits = `feat: ${'á'.repeat(249)} (SK5e)`;
  assert.equal(Buffer.byteLength(fits), 511);
  assert.equal((await checkTitle(fits)).ok, true);
  assert.deepEqual((await checkTitle(`feat: ${'á'.repeat(250)} (SK5e)`)).errors, ['el título pasa de 512 bytes']);
});
