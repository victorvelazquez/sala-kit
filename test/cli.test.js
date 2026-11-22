'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { git, runSala, feedSala } = require('./helpers');

const { version } = require('../package.json');

// Every file under dir with its contents: a run that did nothing leaves it equal.
function snapshot(dir) {
  const files = {};
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[path.relative(dir, full)] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return files;
}

// A sala with members core (a Git repo) and web, and a live idle session in core.
function sala(t) {
  const s = feedSala(t);
  git(s.core, 'init', '--quiet', '--initial-branch=main');
  s.session('core', s.core);
  return s;
}

const HELP_FLAGS = ['--help', '-h'];

// The commands that write in the sala or in a member, or send to a session: before SK13, a
// --help after them was dropped and the command ran.
function writers(s) {
  return {
    init: ['init', '--sala', path.join(s.dir, 'nueva')],
    unirse: ['unirse', '--sala', s.core],
    soltar: ['soltar', 'web'],
    actualizar: ['actualizar'],
    enviar: ['enviar', 'core', '/miembro-base'],
    pausar: ['pausar', '--minutos', '5'],
    seguir: ['seguir'],
  };
}

for (const flag of HELP_FLAGS) {
  test(`${flag} después de un comando que escribe o manda muestra la ayuda y no hace nada`, (t) => {
    const s = sala(t);
    const help = runSala(s.dir, ['--help']);
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /^sala /);
    const before = snapshot(s.dir);
    for (const [name, args] of Object.entries(writers(s))) {
      const res = runSala(s.dir, [...args, flag], s.env);
      assert.equal(res.code, 0, `${name}: ${res.stderr}`);
      assert.equal(res.stdout, help.stdout, `${name} no muestra la ayuda`);
      assert.equal(res.stderr, '', name);
      assert.deepEqual(snapshot(s.dir), before, `${name} escribió algo`);
      assert.deepEqual(s.log(), [], `${name} anotó una orden`);
    }
  });
}

test('--version después de un comando que manda imprime la versión y no manda nada', (t) => {
  const s = sala(t);
  const before = snapshot(s.dir);
  const res = runSala(s.dir, ['enviar', 'core', '/miembro-base', '--version'], s.env);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stdout, `${version}\n`);
  assert.equal(res.stderr, '');
  assert.deepEqual(snapshot(s.dir), before);
  assert.deepEqual(s.inbox('core'), []);
});

test('--help en cualquier lugar de los argumentos muestra la ayuda en todos los comandos', (t) => {
  const s = sala(t);
  const help = runSala(s.dir, ['--help']).stdout;
  const commands = ['init', 'donde', 'instalar', 'actualizar', 'unirse', 'adoptar', 'soltar', 'condiciones', 'estado',
    'plan', 'agendar', 'revisar', 'abrir', 'mostrar', 'enviar', 'esperar', 'veredicto', 'preguntas', 'hospedar',
    'consentir', 'reiniciar', 'modelo', 'pausar', 'seguir', 'fusionar', 'responder'];
  const before = snapshot(s.dir);
  for (const name of commands) {
    for (const args of [[name, '--help'], ['--help', name], [name, 'core', '-h', '1']]) {
      const res = runSala(s.dir, args, s.env);
      assert.equal(res.code, 0, `${args.join(' ')}: ${res.stderr}`);
      assert.equal(res.stdout, help, args.join(' '));
      assert.equal(res.stderr, '', args.join(' '));
    }
  }
  assert.deepEqual(snapshot(s.dir), before);
});

test('un argumento desconocido sigue saliendo con 1 sin hacer nada', (t) => {
  const s = sala(t);
  const before = snapshot(s.dir);
  const res = runSala(s.dir, ['unirse', '--sala', s.core, '--nada'], s.env);
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.deepEqual(JSON.parse(res.stderr), { error: 'argumento desconocido: --nada' });
  assert.deepEqual(snapshot(s.dir), before);
});

test('los flags de ayuda ganan aunque estén como valor o con un comando desconocido', (t) => {
  const s = sala(t);
  const help = runSala(s.dir, ['--help']).stdout;
  const before = snapshot(s.dir);
  for (const args of [['foo', '--help'], ['--sala', '--help'], ['pausar', '--minutos', '--help'],
    ['responder', 'core', '1', '--pregunta', '-h'], ['fusionar', 'core', '7', '-h'], ['--version', '--help']]) {
    const res = runSala(s.dir, args, s.env);
    assert.equal(res.code, 0, args.join(' '));
    assert.equal(res.stdout, help, args.join(' '));
  }
  assert.deepEqual(snapshot(s.dir), before);
  assert.deepEqual(s.log(), []);
});

test('sin flags de ayuda, los errores de siempre siguen iguales', (t) => {
  const s = sala(t);
  for (const [args, error] of [[['foo'], 'subcomando desconocido: foo'], [['enviar', 'core'], 'sala enviar necesita una orden'],
    [['--HELP'], 'argumento desconocido: --HELP'], [['--help=1'], 'argumento desconocido: --help=1']]) {
    const res = runSala(s.dir, args, s.env);
    assert.equal(res.code, 1, args.join(' '));
    assert.deepEqual(JSON.parse(res.stderr), { error });
  }
});
