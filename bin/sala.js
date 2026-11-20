#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { loadConfig, ConfigError } = require('../src/config');
const { estado, estadoTexto } = require('../src/estado');
const { version } = require('../package.json');

const HELP = `sala ${version}

Uso:
  sala estado [--texto] [--sala <carpeta>]   la foto de cada miembro y su puerta, con el motivo

Opciones:
  --texto            salida para leer, en vez de JSON
  --sala <carpeta>   la carpeta de la sala (por defecto, la actual)
  --version          la versión del kit
`;

function fail(error, details) {
  process.stderr.write(`${JSON.stringify(details ? { error, details } : { error })}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const opts = { command: null, texto: false, sala: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--texto') opts.texto = true;
    else if (arg === '--sala') {
      if (!argv[i + 1]) throw new ConfigError('--sala necesita una carpeta');
      opts.sala = path.resolve(argv[(i += 1)]);
    } else if (arg === '--version' || arg === '--help' || arg === '-h') opts.command = opts.command || arg;
    else if (!opts.command && !arg.startsWith('-')) opts.command = arg;
    else throw new ConfigError(`argumento desconocido: ${arg}`);
  }
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (opts.command === '--version') return void process.stdout.write(`${version}\n`);
    if (!opts.command || opts.command === '--help' || opts.command === '-h') return void process.stdout.write(HELP);
    if (opts.command !== 'estado') return fail(`subcomando desconocido: ${opts.command}`);
    const result = await estado(loadConfig(opts.sala));
    process.stdout.write(opts.texto ? estadoTexto(result) : `${JSON.stringify(result)}\n`);
  } catch (err) {
    if (err instanceof ConfigError) return fail(err.message, err.details);
    throw err;
  }
}

main();
