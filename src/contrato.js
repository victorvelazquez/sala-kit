'use strict';

// The contract with Gentle Shell (D47): the version and feed format the kit was
// tested with, compared with what this machine has. It only reads and only warns.

const fs = require('node:fs');
const path = require('node:path');
const { run, firstLine } = require('./run');
const { feedRoots, feedSchemas } = require('./feed');

const CONTRACT = path.join(__dirname, '..', 'contrato', 'gentle-shell.json');

// SALA_GENTLE_SHELL swaps Gentle Shell; a .js path runs with node (used by the tests).
// gentle-shell is a .cmd on Windows, which only runs through cmd; the command line is fixed.
function versionCommand() {
  const custom = process.env.SALA_GENTLE_SHELL;
  if (custom) return custom.endsWith('.js') ? [process.execPath, [custom, '--version']] : [custom, ['--version']];
  if (process.platform === 'win32') return ['cmd.exe', ['/d', '/s', '/c', 'gentle-shell --version']];
  return ['gentle-shell', ['--version']];
}

function versionOf(text, name) {
  const match = String(text).match(new RegExp(`^${name}\\s+(\\S+)`, 'm'));
  return match ? match[1] : null;
}

async function installedVersion() {
  const [file, args] = versionCommand();
  const res = await run(file, args, { timeout: 15000 });
  const gentleShell = res.code === 0 ? versionOf(res.stdout, 'gentle-shell') : null;
  if (!gentleShell) return { installed: null, error: res.code === 0 ? 'no dice la versión' : firstLine(res.stderr) };
  return { installed: { gentleShell, pi: versionOf(res.stdout, 'pi') } };
}

async function contractCheck() {
  const tested = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  const { installed, error } = await installedVersion();
  const feeds = feedSchemas(feedRoots());
  const warnings = [];
  if (!installed) {
    warnings.push(`no se pudo leer la versión de Gentle Shell (gentle-shell --version): ${error}`);
  } else if (installed.gentleShell !== tested.gentleShell || installed.pi !== tested.pi) {
    warnings.push(`instalado gentle-shell ${installed.gentleShell} (pi ${installed.pi}); el kit se probó con ${tested.gentleShell} (pi ${tested.pi}): revisá qué cambió en Gentle Shell y, si el kit sigue andando, anotá la versión en contrato/gentle-shell.json`);
  }
  for (const feed of feeds.filter((f) => f !== tested.feed)) {
    warnings.push(`una sesión viva publica ${feed}; el kit se probó con ${tested.feed} y no lee otro formato`);
  }
  return {
    tested: { gentleShell: tested.gentleShell, pi: tested.pi, feed: tested.feed },
    installed,
    feeds,
    warnings,
  };
}

function contractText(contract) {
  const { tested, installed } = contract;
  const now = installed ? `instalado ${installed.gentleShell} (pi ${installed.pi})` : 'instalado sin leer';
  return [`Gentle Shell: probado con ${tested.gentleShell} (pi ${tested.pi}); ${now}`, ...contract.warnings.map((w) => `  aviso: ${w}`)];
}

module.exports = { contractCheck, contractText };
