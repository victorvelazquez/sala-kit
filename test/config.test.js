'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateConfig } = require('../src/config');
const { tempDir, writeSala, runSala } = require('./helpers');

const abs = path.resolve('/repos/core');

function valid() {
  return {
    schema: 1,
    kit: '0.1.0',
    name: 'upen',
    members: [{ id: 'core', prefix: 'CORE', path: abs, base: 'develop', remote: 'origin' }],
    options: { language: 'en', jira: false, transport: 'orca', roomModel: null },
  };
}

test('a config like the D4 example is valid, and remote defaults to origin', () => {
  const config = valid();
  delete config.members[0].remote;
  const res = validateConfig(config);
  assert.deepEqual(res.errors, []);
  assert.equal(res.config.members[0].remote, 'origin');
});

test('every problem is reported with where it is', () => {
  const config = valid();
  config.schema = 2;
  config.extra = true;
  config.members.push({ id: 'core', prefix: 'core', path: 'relativa', base: '' });
  const { errors } = validateConfig(config);
  assert.deepEqual(errors, [
    'schema: se esperaba 1',
    'extra: campo desconocido',
    'members[1].id: «core» está repetido',
    'members[1].prefix: debe ser mayúsculas y dígitos, por ejemplo CORE',
    'members[1].path: debe ser una ruta absoluta',
    'members[1].base: falta',
  ]);
});

test('sala estado without sala.json fails with a reason and exit 1', (t) => {
  const dir = tempDir(t);
  const res = runSala(dir, ['estado']);
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.deepEqual(JSON.parse(res.stderr), { error: `no hay sala.json en ${dir}` });
});

test('a URL as remote is rejected without echoing its credential', (t) => {
  const dir = tempDir(t);
  const pw = 'cfgpw9secret';
  const config = valid();
  config.members[0].remote = `https://user:${pw}@127.0.0.1:9/r.git`;
  writeSala(dir, config);

  for (const args of [['estado'], ['estado', '--texto']]) {
    const res = runSala(dir, args);
    assert.equal(res.code, 1);
    assert.equal(res.stdout, '');
    assert.ok(!res.stderr.includes(pw), `secret leaked: ${res.stderr}`);
    assert.deepEqual(JSON.parse(res.stderr), {
      error: 'sala.json no es válido',
      details: ['members[0].remote: debe ser el nombre de un remoto, por ejemplo origin, no una URL'],
    });
  }
});

test('a base that is an option or a URL is rejected without echoing it', () => {
  for (const base of ['--upload-pack=x', 'https://u:pw@h/x', 'a..b']) {
    const config = valid();
    config.members[0].base = base;
    assert.deepEqual(validateConfig(config).errors, [
      'members[0].base: debe ser el nombre de una rama, por ejemplo main',
    ], base);
  }
  const config = valid();
  config.members[0].base = 'release/2.0';
  assert.deepEqual(validateConfig(config).errors, []);
});

test('sala estado with an invalid sala.json lists the errors and exit 1', (t) => {
  const dir = tempDir(t);
  writeSala(dir, { schema: 1, kit: '0.1.0', name: 'x', members: [] });
  const res = runSala(dir, ['estado']);
  assert.equal(res.code, 1);
  assert.deepEqual(JSON.parse(res.stderr), {
    error: 'sala.json no es válido',
    details: ['members: tiene que haber al menos un miembro'],
  });
});
