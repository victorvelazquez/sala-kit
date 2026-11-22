'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir, writeSala, salaConfig, runSala } = require('./helpers');

const BIN = path.resolve(__dirname, '..', 'bin', 'sala.js');

function sala(t, folder = 'sala') {
  const dir = path.join(tempDir(t), folder);
  fs.mkdirSync(dir);
  writeSala(dir, salaConfig([]));
  return dir;
}

const files = (dir) => fs.readdirSync(dir, { recursive: true }).sort();

test('sala agendar prints the daily task with absolute paths and the command to remove it, and installs nothing', (t) => {
  const dir = sala(t);
  const before = files(dir);

  const res = runSala(dir, ['agendar']);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  const r = JSON.parse(res.stdout);
  assert.equal(r.task, 'sala-plan-prueba');
  assert.equal(r.time, '08:00');
  assert.equal(r.output, path.join(dir, '.sala', 'plan-del-dia.txt'));
  assert.equal(r.action.workingDirectory, dir);
  assert.ok(path.isAbsolute(r.action.execute));
  for (const p of [process.execPath, BIN, dir, r.output]) assert.ok(r.action.argument.includes(`"${p}"`), p);
  assert.ok(r.install.startsWith("Register-ScheduledTask -TaskName 'sala-plan-prueba' "));
  assert.ok(r.install.includes("New-ScheduledTaskTrigger -Daily -At '08:00'"));
  assert.equal(r.remove, "Unregister-ScheduledTask -TaskName 'sala-plan-prueba' -Confirm:$false");
  assert.deepEqual(files(dir), before);

  const texto = runSala(dir, ['agendar', '--hora', '7:30', '--texto']);
  assert.equal(texto.code, 0, texto.stderr);
  assert.ok(texto.stdout.includes("New-ScheduledTaskTrigger -Daily -At '07:30'"));
  assert.ok(texto.stdout.includes(r.remove));
});

test('sala agendar refuses a wrong time and a path cmd would expand, without printing a task', (t) => {
  const dir = sala(t);
  for (const args of [['--hora', '24:00'], ['--hora', '8'], ['--hora', '08:60'], ['--hora']]) {
    const res = runSala(dir, ['agendar', ...args]);
    assert.equal(res.code, 1, args.join(' '));
    assert.equal(res.stdout, '');
    assert.deepEqual(JSON.parse(res.stderr), { error: '--hora necesita una hora entre 00:00 y 23:59, como 08:00' });
  }
  const twice = runSala(dir, ['agendar', '--hora', '08:00', '--hora', '09:00']);
  assert.equal(twice.code, 1);
  assert.deepEqual(JSON.parse(twice.stderr), { error: '--hora va una sola vez' });

  const other = runSala(dir, ['plan', '--hora', '08:00']);
  assert.equal(other.code, 1);
  assert.deepEqual(JSON.parse(other.stderr), { error: 'argumento desconocido: --hora' });

  const percent = sala(t, 'sala %USERNAME%');
  const res = runSala(percent, ['agendar']);
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.deepEqual(JSON.parse(res.stderr), { error: `la carpeta tiene un % que cmd expandiría: ${percent}` });
});

test('the printed action writes the plan of the day, also from a folder with spaces and an apostrophe', { skip: process.platform !== 'win32' }, (t) => {
  const dir = sala(t, "mi sala d'Ana");
  const res = runSala(dir, ['agendar']);
  assert.equal(res.code, 0, res.stderr);
  const r = JSON.parse(res.stdout);
  assert.ok(r.install.includes("-WorkingDirectory '" + dir.replace(/'/g, "''") + "'"));

  // What the scheduled task would run, without registering it.
  const run = spawnSync(r.action.execute, [r.action.argument], {
    cwd: r.action.workingDirectory,
    windowsVerbatimArguments: true,
    encoding: 'utf8',
    env: { ...process.env, SALA_FEED_ROOTS: path.join(dir, 'sin-feed') },
  });
  assert.equal(run.status, 0, run.stderr);
  const plan = runSala(dir, ['plan', '--texto']);
  assert.equal(fs.readFileSync(r.output, 'utf8'), plan.stdout);
});
