'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir, git, memberRepo, roadmap, member, writeSala, salaConfig, runSala } = require('./helpers');

// A member on the branch `feat` whose last commit, pushed, leaves the row of the task in `estado`.
function deliveredMember(dir, estado) {
  const core = memberRepo(dir, 'core');
  git(core.work, 'switch', '--quiet', '-c', 'feat');
  fs.mkdirSync(path.join(core.work, 'docs'));
  fs.writeFileSync(path.join(core.work, 'docs', 'ROADMAP.md'), roadmap([['E1', '—', estado]]));
  git(core.work, 'add', 'docs/ROADMAP.md');
  git(core.work, 'commit', '--quiet', '-m', 'feat: entrega (E1)');
  git(core.work, 'push', '--quiet', 'origin', 'feat');
  writeSala(dir, salaConfig([member('core', 'CORE', core.work)]));
  return core;
}

function pr(conclusion, title = 'feat: entrega (E1)') {
  return JSON.stringify([
    { number: 7, title: 'otra cosa (E9)', headRefName: 'otra', isDraft: false, statusCheckRollup: [] },
    { number: 3, title, headRefName: 'feat', isDraft: false, statusCheckRollup: [{ conclusion }] },
  ]);
}

test('after a delivery the verdict gives branch, commit, PR, CI and the task row, the same for its /flow-* bridge', (t) => {
  const dir = tempDir(t);
  const core = deliveredMember(dir, 'Completada');
  const sha = git(core.work, 'rev-parse', '--short', 'HEAD');

  const res = runSala(dir, ['veredicto', 'core', '/miembro-entregar'], { FAKE_GH_OUT: pr('SUCCESS') });

  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  const out = JSON.parse(res.stdout);
  assert.deepEqual(out, {
    schema: 1,
    sala: 'prueba',
    member: 'core',
    command: 'miembro-entregar',
    rule: 'entrega',
    ok: true,
    branch: 'feat',
    commit: { sha, subject: 'feat: entrega (E1)' },
    pr: { number: 3, title: 'feat: entrega (E1)', ci: 'passing' },
    task: 'E1',
    checks: [
      { id: 'branch', ok: true, detail: 'en la rama feat' },
      { id: 'clean', ok: true, detail: 'árbol limpio' },
      { id: 'pushed', ok: true, detail: 'el último commit está en origin/feat' },
      { id: 'pr', ok: true, detail: 'PR #3 abierto' },
      { id: 'ci', ok: true, detail: 'CI en verde' },
      { id: 'task', ok: true, detail: 'la fila E1 dice Completada' },
    ],
  });

  for (const alias of ['flow-ship', '/flow-pr']) {
    const bridge = JSON.parse(runSala(dir, ['veredicto', 'core', alias], { FAKE_GH_OUT: pr('SUCCESS') }).stdout);
    assert.deepEqual({ ...bridge, command: 'miembro-entregar' }, out, alias);
    assert.equal(bridge.command, alias.replace('/', ''));
  }
});

test('a delivery with red CI, an unmarked row and an unpushed commit fails and says why', (t) => {
  const dir = tempDir(t);
  const core = deliveredMember(dir, 'En curso');
  git(core.work, 'commit', '--quiet', '--allow-empty', '-m', 'sin subir');

  const out = JSON.parse(runSala(dir, ['veredicto', 'core', 'entrega'], { FAKE_GH_OUT: pr('FAILURE') }).stdout);

  assert.equal(out.ok, false);
  assert.equal(out.rule, 'entrega');
  assert.deepEqual(out.checks.filter((c) => !c.ok), [
    { id: 'pushed', ok: false, detail: 'el último commit no está en origin/feat' },
    { id: 'ci', ok: false, detail: 'CI en rojo' },
    { id: 'task', ok: false, detail: 'la fila E1 dice En curso, no Completada' },
  ]);
});

test('a delivery without an open PR, or a PR title without the task ID, fails', (t) => {
  const dir = tempDir(t);
  deliveredMember(dir, 'Completada');

  const none = JSON.parse(runSala(dir, ['veredicto', 'core', 'entrega']).stdout);
  assert.equal(none.pr, null);
  assert.equal(none.task, null);
  assert.deepEqual(none.checks.filter((c) => !c.ok), [
    { id: 'pr', ok: false, detail: 'no hay un PR abierto de la rama feat' },
    { id: 'ci', ok: false, detail: 'sin PR, no hay CI que mirar' },
    { id: 'task', ok: false, detail: 'sin PR, no hay tarea que mirar' },
  ]);

  const noId = JSON.parse(runSala(dir, ['veredicto', 'core', 'entrega'], { FAKE_GH_OUT: pr('SUCCESS', 'feat: entrega') }).stdout);
  assert.deepEqual(noId.checks.filter((c) => !c.ok), [
    { id: 'task', ok: false, detail: 'el título del PR no termina con el ID de la tarea entre paréntesis' },
  ]);
});

test('after going back to the base the verdict checks base, tree, stash and remote; /flow-base is its bridge', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  writeSala(dir, salaConfig([member('core', 'CORE', core.work)]));

  const ready = JSON.parse(runSala(dir, ['veredicto', 'core', 'miembro-base']).stdout);
  assert.deepEqual(ready, {
    schema: 1,
    sala: 'prueba',
    member: 'core',
    command: 'miembro-base',
    rule: 'base',
    ok: true,
    branch: 'main',
    checks: [
      { id: 'branch', ok: true, detail: 'en la base main' },
      { id: 'clean', ok: true, detail: 'árbol limpio' },
      { id: 'stash', ok: true, detail: 'sin stash' },
      { id: 'synced', ok: true, detail: 'main igual a origin/main' },
    ],
  });

  // Git Bash turns `/flow-base` into a path before node sees it; read-only, so the verdict reads it back.
  const bash = JSON.parse(runSala(dir, ['veredicto', 'core', 'C:/Program Files/Git/flow-base']).stdout);
  assert.deepEqual({ command: bash.command, rule: bash.rule, ok: bash.ok }, { command: 'flow-base', rule: 'base', ok: true });

  fs.writeFileSync(path.join(core.work, 'README.md'), 'cambio\n');
  git(core.work, 'stash', '--quiet');
  git(core.work, 'switch', '--quiet', '-c', 'feat');
  git(core.work, 'commit', '--quiet', '--allow-empty', '-m', 'local');
  const res = runSala(dir, ['veredicto', 'core', '/flow-base']);
  const out = JSON.parse(res.stdout);
  assert.equal(out.rule, 'base');
  assert.equal(out.ok, false);
  assert.deepEqual(out.checks.filter((c) => !c.ok), [
    { id: 'branch', ok: false, detail: 'está en la rama feat, no en la base main' },
    { id: 'stash', ok: false, detail: 'hay 1 stash' },
  ]);

  const text = runSala(dir, ['veredicto', 'core', 'flow-base', '--texto']).stdout;
  assert.equal(text, [
    'Veredicto de core después de flow-base (base): FALLA',
    '  NO  branch  está en la rama feat, no en la base main',
    '  sí  clean   árbol limpio',
    '  NO  stash   hay 1 stash',
    '  sí  synced  main igual a origin/main',
    '',
  ].join('\n'));
});

test('an unknown command, an unknown member or a missing command is refused with nothing on stdout', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  writeSala(dir, salaConfig([member('core', 'CORE', core.work)]));

  const unknown = runSala(dir, ['veredicto', 'core', '/flow-avance']);
  assert.equal(unknown.code, 1);
  assert.equal(unknown.stdout, '');
  assert.deepEqual(JSON.parse(unknown.stderr), {
    error: 'flow-avance no tiene veredicto; acepta miembro-entregar, miembro-base, flow-ship, flow-pr, flow-base, entrega y base',
  });

  // Names every JavaScript object inherits are not commands; an odd command is never echoed raw.
  const tail = 'acepta miembro-entregar, miembro-base, flow-ship, flow-pr, flow-base, entrega y base';
  for (const [name, error] of [
    ['constructor', `constructor no tiene veredicto; ${tail}`],
    ['toString', `toString no tiene veredicto; ${tail}`],
    ['__proto__', `__proto__ no tiene veredicto; ${tail}`],
    ['x\u202ey\u0007', `x?y? no tiene veredicto; ${tail}`],
    ['/', `falta el comando; ${tail}`],
  ]) {
    const res = runSala(dir, ['veredicto', 'core', name]);
    assert.equal(res.code, 1, name);
    assert.equal(res.stdout, '', name);
    assert.deepEqual(JSON.parse(res.stderr), { error }, name);
  }

  const ghost = runSala(dir, ['veredicto', 'nadie', 'entrega']);
  assert.equal(ghost.code, 1);
  assert.equal(ghost.stdout, '');
  assert.deepEqual(JSON.parse(ghost.stderr), { error: 'no hay un miembro nadie en sala.json' });

  const missing = runSala(dir, ['veredicto', 'core']);
  assert.equal(missing.code, 1);
  assert.deepEqual(JSON.parse(missing.stderr), { error: 'sala veredicto necesita un comando' });

  // The missing-argument label is shared with enviar, whose error stays as it was.
  const order = runSala(dir, ['enviar', 'core']);
  assert.equal(order.code, 1);
  assert.equal(order.stdout, '');
  assert.deepEqual(JSON.parse(order.stderr), { error: 'sala enviar necesita una orden' });
});
