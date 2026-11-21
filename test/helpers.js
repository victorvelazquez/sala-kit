'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');

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

function roadmap(rows) {
  return [
    '# Hoja de ruta',
    '',
    '| ID | Entrega | Resultado visible | Depende de | Estado | Notas | Ficha |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(([id, deps, estado, notas = '']) => `| ${id} | Entrega ${id} | Se ve | ${deps} | ${estado} | ${notas} | — |`),
    '',
  ].join('\n');
}

function pushRoadmap(work, text) {
  fs.mkdirSync(path.join(work, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(work, 'docs', 'ROADMAP.md'), text);
  git(work, 'add', 'docs/ROADMAP.md');
  git(work, 'commit', '--quiet', '-m', 'roadmap');
  git(work, 'push', '--quiet', 'origin', 'main');
}

function member(id, prefix, work) {
  return { id, prefix, path: work, base: 'main' };
}

function writeSala(dir, config) {
  fs.writeFileSync(path.join(dir, 'sala.json'), JSON.stringify(config, null, 2));
}

function salaConfig(members) {
  return { schema: 1, kit: '0.1.0', name: 'prueba', members };
}

const FAKE_GH = path.join(__dirname, 'fixtures', 'fake-gh.js');

// The tests never call the real gh nor read the real feed: by default gh answers
// with no open PRs and the feed is a folder that does not exist.
function runSala(cwd, args, env = {}) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, SALA_GH: FAKE_GH, FAKE_GH_OUT: '[]', SALA_FEED_ROOTS: path.join(cwd, 'sin-feed'), ...env },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}


// Runs the CLI without blocking, so the test can play Gentle Shell meanwhile.
function runAsync(cwd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: { ...process.env, SALA_GH: FAKE_GH, FAKE_GH_OUT: '[]', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// A sala with members core and web, and a feed folder with inboxes.
function feedSala(t) {
  const dir = tempDir(t);
  const core = path.join(dir, 'core');
  const web = path.join(dir, 'web');
  fs.mkdirSync(core);
  fs.mkdirSync(web);
  const agentDir = path.join(dir, 'agent');
  writeSala(dir, salaConfig([
    { id: 'core', prefix: 'CORE', path: core, base: 'main' },
    { id: 'web', prefix: 'WEB', path: web, base: 'main' },
  ]));
  const env = { SALA_FEED_ROOTS: agentDir, SALA_SEND_TIMEOUT_MS: '3000', SALA_WAIT_POLL_MS: '50', SALA_WAIT_SETTLE_MS: '200' };
  const session = (name, cwd, extra = {}) => {
    const sessions = path.join(agentDir, 'desktop', 'sessions');
    fs.mkdirSync(sessions, { recursive: true });
    fs.mkdirSync(path.join(agentDir, 'desktop', 'inbox', name), { recursive: true });
    fs.mkdirSync(path.join(agentDir, 'desktop', 'outbox', name), { recursive: true });
    fs.writeFileSync(path.join(sessions, `${name}.json`), JSON.stringify({
      schema: 'gentle-shell.desktop-feed/v1',
      identity: { sessionId: `id-${name}`, cwd, realCwd: cwd, pid: process.pid, mode: 'tui' },
      activity: { state: 'idle', label: 'Idle' },
      pendingQuestion: null,
      ...extra,
    }));
  };
  const inbox = (name) => {
    const d = path.join(agentDir, 'desktop', 'inbox', name);
    return fs.existsSync(d) ? fs.readdirSync(d) : [];
  };
  // Plays Gentle Shell: answers every action left in the inbox and records it.
  const answer = (name, reply = { ok: true, data: { queued: false } }) => {
    const seen = [];
    const timer = setInterval(() => {
      for (const file of inbox(name)) {
        const full = path.join(agentDir, 'desktop', 'inbox', name, file);
        seen.push(JSON.parse(fs.readFileSync(full, 'utf8')));
        fs.rmSync(full);
        fs.writeFileSync(path.join(agentDir, 'desktop', 'outbox', name, file), JSON.stringify(reply));
      }
    }, 20);
    t.after(() => clearInterval(timer));
    return seen;
  };
  const log = () => {
    const file = path.join(dir, '.sala', 'ordenes.log');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  return { dir, core, web, agentDir, env, session, inbox, answer, log };
}

module.exports = { tempDir, git, memberRepo, roadmap, pushRoadmap, member, writeSala, salaConfig, runSala, runAsync, feedSala };
