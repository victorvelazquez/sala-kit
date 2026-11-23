'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir, git, memberRepo, member, writeSala, salaConfig, runSala } = require('./helpers');

const FAKE_PM = path.join(__dirname, 'fixtures', 'fake-pm.js');

// A member folder with a fake pnpm and npm that log every install.
function setup(t) {
  const dir = tempDir(t);
  const log = path.join(dir, 'pm.log');
  fs.writeFileSync(log, '');
  const env = { SALA_PNPM: FAKE_PM, SALA_NPM: FAKE_PM, FAKE_LOG: log };
  const installs = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { dir, env, installs };
}

// The lockfile is older than the last install: the state of a base the merge did not touch.
function installed(dir, lockfile, mark) {
  fs.writeFileSync(path.join(dir, lockfile), 'lock\n');
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', mark), 'instalado\n');
  const old = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(path.join(dir, lockfile), old, old);
}

// The last install happened before the lockfile was rewritten, as after a merge that changed it.
function staleMark(file) {
  const older = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(file, older, older);
}

test('sala dependencias installs nothing when the lockfile did not change since the last install', (t) => {
  const s = setup(t);
  installed(s.dir, 'pnpm-lock.yaml', '.modules.yaml');

  const res = runSala(s.dir, ['dependencias', '--instalar'], s.env);

  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  assert.deepEqual(JSON.parse(res.stdout), {
    dir: s.dir, manager: 'pnpm', lockfile: 'pnpm-lock.yaml', needed: false, reason: null,
    command: 'pnpm install --frozen-lockfile', installed: false,
  });
  const texto = runSala(s.dir, ['dependencias', '--instalar', '--texto'], s.env);
  assert.equal(texto.stdout, 'Dependencias al día (pnpm-lock.yaml): no se instala nada\n');
  assert.deepEqual(s.installs(), []);
});

test('sala dependencias installs when node_modules is missing or the lockfile changed, and only with --instalar', (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.dir, 'pnpm-lock.yaml'), 'lock\n');

  const asked = runSala(s.dir, ['dependencias', '--texto'], s.env);
  assert.equal(asked.code, 0, asked.stderr);
  assert.equal(asked.stdout, 'Hay que instalar (falta node_modules): corré sala dependencias --instalar, que corre pnpm install --frozen-lockfile\n');
  assert.deepEqual(s.installs(), []);

  const res = runSala(s.dir, ['dependencias', '--instalar', '--texto'], s.env);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stdout, 'Instaladas con pnpm install --frozen-lockfile (falta node_modules)\n');
  assert.deepEqual(s.installs(), [{ args: ['install', '--frozen-lockfile'], cwd: s.dir }]);

  staleMark(path.join(s.dir, 'node_modules', '.modules.yaml'));
  const changed = JSON.parse(runSala(s.dir, ['dependencias', '--instalar'], s.env).stdout);
  assert.deepEqual({ needed: changed.needed, reason: changed.reason, installed: changed.installed },
    { needed: true, reason: 'pnpm-lock.yaml cambió después de la última instalación', installed: true });
  assert.equal(s.installs().length, 2);

  // npm installs with ci, from its own lockfile.
  const npm = setup(t);
  installed(npm.dir, 'package-lock.json', '.package-lock.json');
  staleMark(path.join(npm.dir, 'node_modules', '.package-lock.json'));
  const ci = JSON.parse(runSala(npm.dir, ['dependencias', '--instalar'], npm.env).stdout);
  assert.equal(ci.command, 'npm ci');
  assert.deepEqual(npm.installs(), [{ args: ['ci'], cwd: npm.dir }]);
});

test('sala dependencias refuses two lockfiles and reports a failed install, without hiding it', (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.dir, 'pnpm-lock.yaml'), 'lock\n');
  fs.writeFileSync(path.join(s.dir, 'package-lock.json'), '{}\n');

  const two = runSala(s.dir, ['dependencias', '--instalar'], s.env);
  assert.equal(two.code, 1);
  assert.equal(two.stdout, '');
  assert.deepEqual(JSON.parse(two.stderr), {
    error: 'hay más de un lockfile (pnpm-lock.yaml, package-lock.json): no se sabe con qué gestor instalar; no instala nada',
  });
  assert.deepEqual(s.installs(), []);

  fs.rmSync(path.join(s.dir, 'package-lock.json'));
  const failed = runSala(s.dir, ['dependencias', '--instalar'], { ...s.env, FAKE_PM_FAIL: '1' });
  assert.equal(failed.code, 1);
  assert.equal(failed.stdout, '');
  assert.deepEqual(JSON.parse(failed.stderr), {
    error: 'pnpm install --frozen-lockfile falló (salió con 1): ERR_PNPM_FETCH_404 no se pudo bajar un paquete',
  });

  const none = setup(t);
  const nothing = runSala(none.dir, ['dependencias', '--instalar', '--texto'], none.env);
  assert.equal(nothing.code, 0, nothing.stderr);
  assert.equal(nothing.stdout, 'Sin lockfile: no hay dependencias que instalar\n');
  assert.deepEqual(none.installs(), []);
});

test('a failed install is reported redacted, an install that leaves no mark is not taken as done, and nothing to install is not an error', (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.dir, 'pnpm-lock.yaml'), 'lock\n');
  const bad = path.join(s.dir, 'bad-pm.js');
  fs.writeFileSync(bad, "process.stderr.write('\\nfatal https://user:clave@registry.example.com ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123\\n'); process.exit(7);\n");
  const failed = runSala(s.dir, ['dependencias', '--instalar'], { ...s.env, SALA_PNPM: bad });
  assert.equal(failed.code, 1);
  assert.deepEqual(JSON.parse(failed.stderr), { error: 'pnpm install --frozen-lockfile falló (salió con 7): fatal https://***@registry.example.com ***' });

  const nomark = path.join(s.dir, 'nomark-pm.js');
  fs.writeFileSync(nomark, "require('fs').mkdirSync('node_modules', { recursive: true });\n");
  const half = runSala(s.dir, ['dependencias', '--instalar'], { ...s.env, SALA_PNPM: nomark });
  assert.equal(half.code, 1);
  assert.deepEqual(JSON.parse(half.stderr), { error: 'pnpm install --frozen-lockfile terminó, pero las dependencias siguen sin estar al día (node_modules no tiene la marca de pnpm)' });
  assert.equal(JSON.parse(runSala(s.dir, ['dependencias'], s.env).stdout).reason, 'node_modules no tiene la marca de pnpm');

  // A package.json that declares nothing gets no mark from a real manager: it is not stuck.
  fs.writeFileSync(path.join(s.dir, 'package.json'), JSON.stringify({ name: 'vacio', dependencies: {} }));
  const empty = runSala(s.dir, ['dependencias', '--instalar', '--texto'], s.env);
  assert.equal(empty.code, 0, empty.stderr);
  assert.equal(empty.stdout, 'package.json no declara dependencias (pnpm-lock.yaml): no se instala nada\n');
  fs.writeFileSync(path.join(s.dir, 'pnpm-workspace.yaml'), 'packages: ["apps/*"]\n');
  assert.equal(JSON.parse(runSala(s.dir, ['dependencias'], s.env).stdout).needed, true);
  assert.deepEqual(s.installs(), []);

  const yarn = setup(t);
  fs.writeFileSync(path.join(yarn.dir, 'yarn.lock'), 'lock\n');
  assert.equal(runSala(yarn.dir, ['dependencias', '--instalar', '--texto'], yarn.env).stdout,
    'yarn.lock: el kit todavía no instala con yarn; si hace falta, instalá a mano\n');
  const missing = runSala(yarn.dir, ['dependencias', '--sala', path.join(yarn.dir, 'no-esta')], yarn.env);
  assert.equal(missing.code, 1);
  assert.deepEqual(JSON.parse(missing.stderr), { error: `la carpeta no existe: ${path.join(yarn.dir, 'no-esta')}` });
  assert.deepEqual(yarn.installs(), []);
});

test('the verdict of the base fails deps, without installing, when a member has two lockfiles', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  fs.writeFileSync(path.join(core.work, 'pnpm-lock.yaml'), 'lock\n');
  fs.writeFileSync(path.join(core.work, 'package-lock.json'), '{}\n');
  git(core.work, 'add', '.');
  git(core.work, 'commit', '--quiet', '-m', 'deps');
  git(core.work, 'push', '--quiet', 'origin', 'main');
  writeSala(dir, salaConfig([member('core', 'CORE', core.work)]));
  const out = JSON.parse(runSala(dir, ['veredicto', 'core', 'base']).stdout);
  assert.deepEqual(out.checks.filter((c) => !c.ok), [{ id: 'deps', ok: false,
    detail: 'hay más de un lockfile (pnpm-lock.yaml, package-lock.json): no se sabe con qué gestor instalar; no instala nada' }]);
  assert.equal(fs.existsSync(path.join(core.work, 'node_modules')), false);
});

test('after going back to the base the verdict checks that a member with a lockfile has its dependencies installed', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  fs.writeFileSync(path.join(core.work, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(core.work, 'pnpm-lock.yaml'), 'lock\n');
  git(core.work, 'add', '.gitignore', 'pnpm-lock.yaml');
  git(core.work, 'commit', '--quiet', '-m', 'deps');
  git(core.work, 'push', '--quiet', 'origin', 'main');
  writeSala(dir, salaConfig([member('core', 'CORE', core.work)]));

  const stale = JSON.parse(runSala(dir, ['veredicto', 'core', 'miembro-base']).stdout);
  assert.equal(stale.ok, false);
  assert.deepEqual(stale.checks.filter((c) => !c.ok), [
    { id: 'deps', ok: false, detail: 'hay que instalar (falta node_modules): corré sala dependencias --instalar en el miembro' },
  ]);

  installed(core.work, 'pnpm-lock.yaml', '.modules.yaml');
  const ready = JSON.parse(runSala(dir, ['veredicto', 'core', 'miembro-base']).stdout);
  assert.equal(ready.ok, true);
  assert.deepEqual(ready.checks.at(-1), { id: 'deps', ok: true, detail: 'dependencias al día (pnpm-lock.yaml)' });
});
