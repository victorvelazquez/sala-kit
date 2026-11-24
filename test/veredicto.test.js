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

// The lines sala enviar leaves in .sala/ordenes.log.
function logOrders(dir, entries) {
  fs.mkdirSync(path.join(dir, '.sala'), { recursive: true });
  const lines = entries.map(([member, text, result = 'sent', extra = {}]) => JSON.stringify({ at: '2026-11-23T10:00:00.000Z', member, session: 'id-c1', text, result, ...extra }));
  fs.appendFileSync(path.join(dir, '.sala', 'ordenes.log'), `${lines.join('\n')}\n`);
}

function pr(conclusion, title = 'feat: entrega (E1)') {
  return JSON.stringify([
    { number: 7, title: 'otra cosa (E9)', headRefName: 'otra', isDraft: false, statusCheckRollup: [] },
    { number: 3, title, headRefName: 'feat', isDraft: false, statusCheckRollup: [{ conclusion }] },
  ]);
}

test('after a delivery the verdict gives branch, commit, PR, CI and the task row, and the /flow-* bridge is gone', (t) => {
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
      // Without an order in the log there is nothing to compare: it warns and does not fail (SK32b).
      { id: 'order', ok: true, detail: 'aviso: la sala no le anotó a core una orden /miembro-tarea con ID; no se compara' },
    ],
  });

  // The /flow-* bridge is gone (SK5g): the sala only sends /miembro-*.
  for (const alias of ['flow-ship', '/flow-pr']) {
    const gone = runSala(dir, ['veredicto', 'core', alias], { FAKE_GH_OUT: pr('SUCCESS') });
    assert.equal(gone.code, 1, alias);
    assert.equal(gone.stdout, '', alias);
    assert.deepEqual(JSON.parse(gone.stderr), {
      error: `${alias.replace('/', '')} no tiene veredicto; acepta miembro-entregar, miembro-base, entrega y base`,
    });
  }
});

test('a delivery of a task the sala did not ask for fails; only the last task order sent to that member counts (SK32b)', (t) => {
  const dir = tempDir(t);
  deliveredMember(dir, 'Completada');
  const order = () => JSON.parse(runSala(dir, ['veredicto', 'core', 'entrega'], { FAKE_GH_OUT: pr('SUCCESS') }).stdout);

  logOrders(dir, [['core', '/miembro-tarea E2']]);
  const wrong = order();
  assert.equal(wrong.ok, false);
  assert.deepEqual(wrong.checks.filter((c) => !c.ok), [{ id: 'order', ok: false, detail: 'el PR es de E1, pero la sala le pidió E2' }]);

  // A refused order, an order to another member, an answer and an order without an ID change nothing.
  logOrders(dir, [
    ['core', '/miembro-tarea E1', 'refused'],
    ['web', '/miembro-tarea E1'],
    ['core', '/miembro-tarea E1', 'sent', { question: 'q1' }],
    ['core', '/miembro-base'],
  ]);
  assert.deepEqual(order().checks.at(-1), { id: 'order', ok: false, detail: 'el PR es de E1, pero la sala le pidió E2' });

  // The member prefix and the case do not matter.
  logOrders(dir, [['core', '/Miembro-Tarea core-e1']]);
  const right = order();
  assert.equal(right.ok, true);
  assert.deepEqual(right.checks.at(-1), { id: 'order', ok: true, detail: 'la sala le pidió core-e1' });

  // A later order without an ID leaves the sala not knowing which task it asked for: it warns.
  logOrders(dir, [['core', '/miembro-tarea']]);
  const unknown = order();
  assert.equal(unknown.ok, true);
  assert.deepEqual(unknown.checks.at(-1), { id: 'order', ok: true, detail: 'aviso: la sala no le anotó a core una orden /miembro-tarea con ID; no se compara' });

  // The base the sala passes along (SK23) is never the ID: E1 --base main asks for E1, and
  // --base main alone names no row.
  logOrders(dir, [['core', '/miembro-tarea E1 --base main']]);
  assert.deepEqual(order().checks.at(-1), { id: 'order', ok: true, detail: 'la sala le pidió E1' });
  logOrders(dir, [['core', '/miembro-tarea --base main']]);
  assert.deepEqual(order().checks.at(-1), { id: 'order', ok: true, detail: 'aviso: la sala no le anotó a core una orden /miembro-tarea con ID; no se compara' });
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

test('after going back to the base the verdict checks base, tree, stash and remote', (t) => {
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

  // Git Bash turns `/miembro-base` into a path before node sees it; read-only, so the verdict reads it back.
  const bash = JSON.parse(runSala(dir, ['veredicto', 'core', 'C:/Program Files/Git/miembro-base']).stdout);
  assert.deepEqual({ command: bash.command, rule: bash.rule, ok: bash.ok }, { command: 'miembro-base', rule: 'base', ok: true });
  const gone = runSala(dir, ['veredicto', 'core', 'C:/Program Files/Git/flow-base']);
  assert.equal(gone.code, 1);
  assert.equal(gone.stdout, '');
  assert.deepEqual(JSON.parse(gone.stderr), { error: 'flow-base no tiene veredicto; acepta miembro-entregar, miembro-base, entrega y base' });

  fs.writeFileSync(path.join(core.work, 'README.md'), 'cambio\n');
  git(core.work, 'stash', '--quiet');
  git(core.work, 'switch', '--quiet', '-c', 'feat');
  git(core.work, 'commit', '--quiet', '--allow-empty', '-m', 'local');
  const res = runSala(dir, ['veredicto', 'core', '/miembro-base']);
  const out = JSON.parse(res.stdout);
  assert.equal(out.rule, 'base');
  assert.equal(out.ok, false);
  assert.deepEqual(out.checks.filter((c) => !c.ok), [
    { id: 'branch', ok: false, detail: 'está en la rama feat, no en la base main' },
    { id: 'stash', ok: false, detail: 'hay 1 stash' },
  ]);

  const text = runSala(dir, ['veredicto', 'core', 'miembro-base', '--texto']).stdout;
  assert.equal(text, [
    'Veredicto de core después de miembro-base (base): FALLA',
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
    error: 'flow-avance no tiene veredicto; acepta miembro-entregar, miembro-base, entrega y base',
  });

  // Names every JavaScript object inherits are not commands; an odd command is never echoed raw.
  const tail = 'acepta miembro-entregar, miembro-base, entrega y base';
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
