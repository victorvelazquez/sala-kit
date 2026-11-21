'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { feedSala: setup, runAsync } = require('./helpers');

const PAUSED = { error: 'la sala está en pausa (.sala/PAUSA): no manda órdenes' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('sala pausar stops every order until sala seguir lifts the pause', async (t) => {
  const s = setup(t);
  s.session('c1', s.core);
  const seen = s.answer('c1');

  const paused = await runAsync(s.dir, ['pausar'], s.env);
  assert.equal(paused.code, 0, paused.stderr);
  assert.equal(paused.stderr, '');
  assert.deepEqual(JSON.parse(paused.stdout), { paused: true, until: null, already: false });

  const refused = await runAsync(s.dir, ['enviar', 'core', '/flow-avance'], s.env);
  assert.equal(refused.code, 1);
  assert.deepEqual(JSON.parse(refused.stderr), PAUSED);
  assert.equal(seen.length, 0);
  assert.deepEqual(s.log().map((l) => l.result), ['refused']);

  const lifted = await runAsync(s.dir, ['seguir'], s.env);
  assert.equal(lifted.code, 0, lifted.stderr);
  assert.deepEqual(JSON.parse(lifted.stdout), { paused: false, removed: true });
  assert.equal(fs.existsSync(path.join(s.dir, '.sala', 'PAUSA')), false);

  const sent = await runAsync(s.dir, ['enviar', 'core', '/flow-avance'], s.env);
  assert.equal(sent.code, 0, sent.stderr);
  assert.equal(seen.length, 1);

  const again = await runAsync(s.dir, ['seguir', '--texto'], s.env);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(again.stdout, 'la sala no estaba en pausa\n');
});

test('a test pause ends by itself, and never shortens a pause that is already on', async (t) => {
  const s = setup(t);
  s.session('c1', s.core);
  s.answer('c1');

  const short = await runAsync(s.dir, ['pausar', '--minutos', '0.05'], s.env);
  assert.equal(short.code, 0, short.stderr);
  const result = JSON.parse(short.stdout);
  assert.equal(result.paused, true);
  assert.equal(result.already, false);
  const end = Date.parse(result.until);
  assert.ok(Math.abs(end - Date.now() - 3000) < 2500, result.until);

  const during = await runAsync(s.dir, ['enviar', 'core', '/flow-avance'], s.env);
  assert.equal(during.code, 1, 'the test pause ended before the order: the machine is too slow for this test');
  assert.deepEqual(JSON.parse(during.stderr), PAUSED);
  await sleep(Math.max(0, end - Date.now()) + 200);
  const after = await runAsync(s.dir, ['enviar', 'core', '/flow-avance'], s.env);
  assert.equal(after.code, 0, after.stderr);

  // An endless pause stays: a later test pause does not replace it.
  await runAsync(s.dir, ['pausar'], s.env);
  const shorter = await runAsync(s.dir, ['pausar', '--minutos', '0.001', '--texto'], s.env);
  assert.equal(shorter.code, 0, shorter.stderr);
  assert.equal(shorter.stdout, 'la sala ya estaba en pausa, sin vencimiento; no la cambié\n');
  await sleep(200);
  const still = await runAsync(s.dir, ['enviar', 'core', '/flow-avance'], s.env);
  assert.deepEqual(JSON.parse(still.stderr), PAUSED);
});

test('a pause file nobody can read still stops orders, and a bad duration writes nothing', async (t) => {
  const s = setup(t);
  s.session('c1', s.core);
  fs.mkdirSync(path.join(s.dir, '.sala'), { recursive: true });
  fs.writeFileSync(path.join(s.dir, '.sala', 'PAUSA'), '{"until": "ayer"');

  const refused = await runAsync(s.dir, ['enviar', 'core', '/flow-avance'], s.env);
  assert.deepEqual(JSON.parse(refused.stderr), PAUSED);
  assert.deepEqual(s.inbox('c1'), []);
  fs.rmSync(path.join(s.dir, '.sala', 'PAUSA'));

  for (const bad of [['--minutos'], ['--minutos', '0'], ['--minutos', '-5'], ['--minutos', 'diez'], ['--minutos', '1441']]) {
    const res = await runAsync(s.dir, ['pausar', ...bad], s.env);
    assert.equal(res.code, 1, bad.join(' '));
    assert.equal(res.stdout, '');
    assert.deepEqual(JSON.parse(res.stderr), { error: '--minutos necesita un número de minutos mayor que 0 y hasta 1440' });
    assert.equal(fs.existsSync(path.join(s.dir, '.sala', 'PAUSA')), false, bad.join(' '));
  }
});
