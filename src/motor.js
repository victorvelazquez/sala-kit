'use strict';

// `sala motor commit|pr <args>`: runs the delivery engine copied in engine/ (D22) in the
// current repo, without a shell, and passes its output and exit code through unchanged.
// Before the PR step that seals the title (`pr --prepare --handle`), it checks the title
// the agent wrote in the engine's intent.json with the format of D23 (src/formato.js).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkTitle } = require('./formato');

const SCRIPTS = { commit: 'flow-commit.mjs', pr: 'flow-pr.mjs' };
const ENGINE = path.join(__dirname, '..', 'engine', 'scripts');
// Mirrors engine/scripts/flow-pr.mjs: HANDLE_PATTERN, HANDLE_PREFIX and the intent size limit.
const HANDLE = /^([0-9a-f]{64})\.([0-9a-f]{64})$/;
const STORE_PREFIX = 'flow-pr-request-';
const MAX_INTENT_BYTES = 128 * 1024;
const NO_STORE = 'no encuentro el pedido de flow-pr de ese handle; volvé a correr sala motor pr --prepare';

class MotorError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

// The engine keeps one temp root: os.tmpdir(), or the standard Windows Temp when the
// session points os.tmpdir() somewhere else. The store, with its random id, exists in only one.
function intentPath(handle) {
  const match = HANDLE.exec(handle || '');
  if (!match) throw new MotorError(NO_STORE);
  const roots = [path.resolve(os.tmpdir())];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) roots.push(path.resolve(process.env.LOCALAPPDATA, 'Temp'));
  // The same folder may be written with other case or as an 8.3 short name: compare real paths.
  const found = new Map();
  for (const root of roots) {
    const dir = path.join(root, `${STORE_PREFIX}${match[1]}`);
    let real;
    try {
      real = fs.realpathSync.native(dir);
    } catch {
      continue;
    }
    found.set(process.platform === 'win32' ? real.toLowerCase() : real, path.join(dir, 'intent.json'));
  }
  if (found.size !== 1) throw new MotorError(NO_STORE);
  return [...found.values()][0];
}

function readTitle(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    throw new MotorError(NO_STORE);
  }
  // The engine refuses these too; never follow a link to read some other file.
  if (!stat.isFile() || stat.size > MAX_INTENT_BYTES) throw new MotorError('intent.json no es un archivo seguro');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).title;
  } catch {
    throw new MotorError('intent.json no es JSON válido');
  }
}

// `--tarea <ID>` and `--jira` are the kit's; the engine never sees them.
function splitKitFlags(args) {
  const engine = [];
  const kit = { id: null, jira: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--jira') kit.jira = true;
    else if (args[i] === '--tarea') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new MotorError('--tarea necesita el ID de la tarea');
      if (kit.id !== null) throw new MotorError('--tarea va una sola vez');
      kit.id = args[(i += 1)];
    } else engine.push(args[i]);
  }
  return { engine, kit };
}

// Returns the warnings of the title, or throws when it does not pass.
async function checkSealedTitle(args, kit) {
  const handle = args[args.indexOf('--handle') + 1];
  const res = await checkTitle(readTitle(intentPath(handle)), kit);
  if (!res.ok) throw new MotorError('el título del PR no cumple el formato; corregilo en intent.json y volvé a correr este paso', res.errors);
  return res.warnings;
}

// Returns the exit code; the engine writes to this process's stdout and stderr itself.
async function motor(argv) {
  const [kind, ...rest] = argv;
  if (!Object.hasOwn(SCRIPTS, kind)) throw new MotorError('sala motor necesita commit o pr');
  let args = rest;
  if (kind === 'pr' && rest.includes('--prepare') && rest.includes('--handle')) {
    const { engine, kit } = splitKitFlags(rest);
    const warnings = await checkSealedTitle(engine, kit);
    if (warnings.length) process.stderr.write(`${JSON.stringify({ warnings })}\n`);
    args = engine;
  }
  const res = spawnSync(process.execPath, [path.join(ENGINE, SCRIPTS[kind]), ...args], { stdio: 'inherit' });
  if (res.error) throw new MotorError(`no se pudo correr el motor: ${res.error.code || res.error.message}`);
  if (res.status === null) throw new MotorError(`el motor terminó por la señal ${res.signal}`);
  return res.status;
}

module.exports = { motor, MotorError };
