'use strict';

// sala dependencias (SK24): after going back to its base, a member installs its dependencies
// only when they are out of date. One rule, shared with the verdict of the base: they are out
// of date when node_modules is missing or the mark of the last install is older than the
// lockfile. Git rewrites the lockfile only when it changes, so an untouched base installs nothing.

const fs = require('node:fs');
const path = require('node:path');
const { run, redact, firstLine } = require('./run');
const { SalaError } = require('./abrir');

// The install commands never rewrite the lockfile: the tree stays clean.
const MANAGERS = [
  { lockfile: 'pnpm-lock.yaml', manager: 'pnpm', args: ['install', '--frozen-lockfile'], mark: '.modules.yaml', env: 'SALA_PNPM' },
  { lockfile: 'package-lock.json', manager: 'npm', args: ['ci'], mark: '.package-lock.json', env: 'SALA_NPM' },
];
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

// A package.json that declares nothing, outside a workspace: the managers leave no mark there.
function declaresNothing(dir) {
  if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return false;
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return false;
  }
  if (!pkg || typeof pkg !== 'object' || pkg.workspaces) return false;
  return DEP_FIELDS.every((f) => !pkg[f] || Object.keys(pkg[f]).length === 0);
}

// What the folder needs; read-only.
function depsState(dir) {
  if (!fs.existsSync(dir)) throw new SalaError(`la carpeta no existe: ${dir}`);
  const found = MANAGERS.filter((m) => fs.existsSync(path.join(dir, m.lockfile)));
  if (found.length === 0) {
    const yarn = fs.existsSync(path.join(dir, 'yarn.lock'));
    return { dir, manager: yarn ? 'yarn' : null, lockfile: yarn ? 'yarn.lock' : null, needed: false, reason: null, command: null };
  }
  if (found.length > 1) {
    throw new SalaError(`hay más de un lockfile (${found.map((m) => m.lockfile).join(', ')}): no se sabe con qué gestor instalar; no instala nada`);
  }
  const [m] = found;
  const command = [m.manager, ...m.args].join(' ');
  if (declaresNothing(dir)) return { dir, manager: m.manager, lockfile: m.lockfile, needed: false, reason: null, command, empty: true };
  const modules = path.join(dir, 'node_modules');
  const mark = mtime(path.join(modules, m.mark));
  let reason = null;
  if (!fs.existsSync(modules)) reason = 'falta node_modules';
  else if (mark === null) reason = `node_modules no tiene la marca de ${m.manager}`;
  else if (mark < mtime(path.join(dir, m.lockfile))) reason = `${m.lockfile} cambió después de la última instalación`;
  return { dir, manager: m.manager, lockfile: m.lockfile, needed: reason !== null, reason, command };
}

// SALA_PNPM or SALA_NPM swap the manager; a .js path runs with node (used by the tests).
// pnpm and npm are .cmd files on Windows, which only run through cmd; the command line is fixed.
function installer(m) {
  const custom = process.env[m.env];
  if (custom) return custom.endsWith('.js') ? [process.execPath, [custom, ...m.args]] : [custom, m.args];
  if (process.platform === 'win32') {
    // cmd looks in the current folder first: a pnpm.cmd inside the member must not run.
    process.env.NoDefaultCurrentDirectoryInExePath = '1';
    return ['cmd.exe', ['/d', '/s', '/c', [m.manager, ...m.args].join(' ')]];
  }
  return [m.manager, m.args];
}

async function dependencias(dir, { instalar = false } = {}) {
  const state = depsState(dir);
  if (!state.needed || !instalar) return { ...state, installed: false };
  const m = MANAGERS.find((x) => x.manager === state.manager);
  const [file, args] = installer(m);
  const res = await run(file, args, { cwd: dir, timeout: INSTALL_TIMEOUT_MS });
  if (res.code !== 0) throw new SalaError(`${state.command} falló (salió con ${res.code}): ${redact(firstLine(res.stderr))}`);
  const after = depsState(dir);
  if (after.needed) throw new SalaError(`${state.command} terminó, pero las dependencias siguen sin estar al día (${after.reason})`);
  return { ...state, installed: true };
}

function dependenciasTexto(r) {
  if (!r.lockfile) return 'Sin lockfile: no hay dependencias que instalar\n';
  if (r.manager === 'yarn') return 'yarn.lock: el kit todavía no instala con yarn; si hace falta, instalá a mano\n';
  if (r.empty) return `package.json no declara dependencias (${r.lockfile}): no se instala nada\n`;
  if (r.installed) return `Instaladas con ${r.command} (${r.reason})\n`;
  if (r.needed) return `Hay que instalar (${r.reason}): corré sala dependencias --instalar, que corre ${r.command}\n`;
  return `Dependencias al día (${r.lockfile}): no se instala nada\n`;
}

// The check of the verdict of the base: present only for a member with a lockfile.
function depsCheck(dir) {
  let state;
  try {
    state = depsState(dir);
  } catch (err) {
    return { id: 'deps', ok: false, detail: err.message };
  }
  if (!state.lockfile || state.manager === 'yarn') return null;
  if (state.needed) return { id: 'deps', ok: false, detail: `hay que instalar (${state.reason}): corré sala dependencias --instalar en el miembro` };
  return { id: 'deps', ok: true, detail: `dependencias al día (${state.lockfile})` };
}

module.exports = { dependencias, dependenciasTexto, depsCheck, depsState };
