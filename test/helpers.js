'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'sala.js');

function tempDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sala-kit-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// A bare remote plus a clone on `base` with one pushed commit.
function memberRepo(root, name, base = 'main') {
  const remote = path.join(root, `${name}.git`);
  const work = path.join(root, name);
  git(root, 'init', '--quiet', '--bare', `--initial-branch=${base}`, remote);
  git(root, 'init', '--quiet', `--initial-branch=${base}`, work);
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'user.name', 'Test');
  git(work, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(work, 'README.md'), 'hola\n');
  git(work, 'add', 'README.md');
  git(work, 'commit', '--quiet', '-m', 'first');
  git(work, 'remote', 'add', 'origin', remote);
  git(work, 'push', '--quiet', 'origin', base);
  return { remote, work };
}

function writeSala(dir, config) {
  fs.writeFileSync(path.join(dir, 'sala.json'), JSON.stringify(config, null, 2));
}

function salaConfig(members) {
  return { schema: 1, kit: '0.1.0', name: 'prueba', members };
}

const FAKE_GH = path.join(__dirname, 'fixtures', 'fake-gh.js');

// The tests never call the real gh: by default it answers with no open PRs.
function runSala(cwd, args, env = {}) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, SALA_GH: FAKE_GH, FAKE_GH_OUT: '[]', ...env },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

module.exports = { tempDir, git, memberRepo, writeSala, salaConfig, runSala };
