'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir, git, memberRepo, writeSala, salaConfig, runSala } = require('./helpers');

function member(id, work, extra = {}) {
  return { id, prefix: id.toUpperCase(), path: work, base: 'main', ...extra };
}

test('a clean member on its base, equal to the remote, is ready', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  writeSala(dir, salaConfig([member('core', core.work)]));

  const res = runSala(dir, ['estado']);

  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  const out = JSON.parse(res.stdout);
  assert.equal(out.schema, 1);
  assert.equal(out.sala, 'prueba');
  const m = out.members[0];
  assert.deepEqual(
    { id: m.id, branch: m.branch, clean: m.clean, stash: m.stash, ahead: m.ahead, behind: m.behind, fetch: m.fetch },
    { id: 'core', branch: 'main', clean: true, stash: 0, ahead: 0, behind: 0, fetch: { ok: true } },
  );
  assert.deepEqual(m.gate, { ready: true, reasons: [] });
});

test('a member that is not ready says every reason', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  // The remote moves ahead from another clone.
  const other = path.join(dir, 'other');
  git(dir, 'clone', '--quiet', core.remote, other);
  git(other, 'config', 'user.email', 'test@example.com');
  git(other, 'config', 'user.name', 'Test');
  git(other, 'commit', '--quiet', '--allow-empty', '-m', 'remote change');
  git(other, 'push', '--quiet', 'origin', 'main');
  // Locally: a stash, a feature branch and a dirty tree.
  fs.writeFileSync(path.join(core.work, 'README.md'), 'cambio\n');
  git(core.work, 'stash', '--quiet');
  git(core.work, 'switch', '--quiet', '-c', 'feat');
  fs.writeFileSync(path.join(core.work, 'nuevo.txt'), 'x\n');
  writeSala(dir, salaConfig([member('core', core.work)]));

  const m = JSON.parse(runSala(dir, ['estado']).stdout).members[0];

  assert.equal(m.branch, 'feat');
  assert.deepEqual(m.changes, { staged: 0, unstaged: 0, untracked: 1 });
  assert.deepEqual(m.gate, {
    ready: false,
    reasons: [
      'está en la rama feat, no en la base main',
      'árbol con cambios: 0 en el índice, 0 sin agregar, 1 sin seguimiento',
      'hay 1 stash',
      'main está 1 commit detrás de origin/main',
    ],
  });
});

test('a missing folder is reported without stopping the other members', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  const ghost = path.join(dir, 'no-existe');
  writeSala(dir, salaConfig([member('ghost', ghost), member('core', core.work)]));

  const res = runSala(dir, ['estado']);

  assert.equal(res.code, 0);
  const [g, c] = JSON.parse(res.stdout).members;
  assert.deepEqual(g.gate, { ready: false, reasons: [`la carpeta no existe: ${ghost}`] });
  assert.equal(c.gate.ready, true);
});

test('a failing fetch is a reason, and no credential from the remote URL leaks', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  git(core.work, 'remote', 'set-url', 'origin', `http://user:${secret}@127.0.0.1:9/repo.git`);
  writeSala(dir, salaConfig([member('core', core.work)]));

  const res = runSala(dir, ['estado']);
  const text = runSala(dir, ['estado', '--texto']);

  assert.equal(res.code, 0);
  for (const output of [res.stdout, res.stderr, text.stdout, text.stderr]) {
    assert.ok(!output.includes(secret), `secret leaked: ${output}`);
  }
  const m = JSON.parse(res.stdout).members[0];
  assert.equal(m.fetch.ok, false);
  assert.equal(m.gate.ready, false);
  assert.match(m.gate.reasons[0], /^no se pudo traer origin\/main: /);
});

test('open PRs come with their CI summary; a failing gh is reported, not fatal', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  writeSala(dir, salaConfig([member('core', core.work)]));
  const prs = [
    { number: 7, title: 'feat: x (CORE-1)', headRefName: 'feat', isDraft: false,
      statusCheckRollup: [{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }] },
    { number: 8, title: 'docs: y', headRefName: 'docs', isDraft: true,
      statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: '' }] },
    { number: 9, title: 'chore: z', headRefName: 'z', isDraft: false, statusCheckRollup: [] },
  ];

  const ok = JSON.parse(runSala(dir, ['estado'], { FAKE_GH_OUT: JSON.stringify(prs) }).stdout);
  const bad = JSON.parse(runSala(dir, ['estado'], { FAKE_GH_OUT: '' }).stdout);

  assert.deepEqual(ok.members[0].prs, [
    { number: 7, title: 'feat: x (CORE-1)', branch: 'feat', draft: false, ci: 'failing' },
    { number: 8, title: 'docs: y', branch: 'docs', draft: true, ci: 'pending' },
    { number: 9, title: 'chore: z', branch: 'z', draft: false, ci: 'none' },
  ]);
  assert.equal(bad.members[0].prs, null);
  assert.equal(bad.members[0].prsError, 'gh: not logged in');
  assert.equal(bad.members[0].gate.ready, true);
});

test('a token in a PR title or branch from gh is redacted', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  writeSala(dir, salaConfig([member('core', core.work)]));
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  const prs = [{ number: 1, title: `leak ${secret}`, headRefName: `b-${secret}`, isDraft: false, statusCheckRollup: [] }];

  const env = { FAKE_GH_OUT: JSON.stringify(prs) };
  const res = runSala(dir, ['estado'], env);
  const text = runSala(dir, ['estado', '--texto'], env);

  for (const output of [res.stdout, text.stdout]) {
    assert.ok(!output.includes(secret), `secret leaked: ${output}`);
  }
  const pr = JSON.parse(res.stdout).members[0].prs[0];
  assert.deepEqual({ title: pr.title, branch: pr.branch }, { title: 'leak ***', branch: 'b-***' });
});

test('--texto prints one readable line per member', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  const brand = memberRepo(dir, 'brand');
  git(brand.work, 'switch', '--quiet', '-c', 'feat');
  writeSala(dir, salaConfig([member('core', core.work), member('brand', brand.work)]));

  const res = runSala(dir, ['estado', '--texto']);

  assert.equal(res.code, 0);
  assert.equal(res.stdout, [
    'Sala prueba',
    'core   LISTO     main',
    'brand  NO LISTO  feat: está en la rama feat, no en la base main',
    '',
  ].join('\n'));
});

test('--sala points to a sala folder from anywhere', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  const sala = path.join(dir, 'sala');
  fs.mkdirSync(sala);
  writeSala(sala, salaConfig([member('core', core.work)]));

  const res = runSala(core.work, ['estado', '--sala', sala]);

  assert.equal(res.code, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).members[0].id, 'core');
});
