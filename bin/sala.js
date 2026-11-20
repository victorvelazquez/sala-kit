#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { loadConfig, ConfigError } = require('../src/config');
const { estado, estadoTexto } = require('../src/estado');
const { plan, planTexto } = require('../src/plan');
const { revisar, revisarTexto } = require('../src/revisar');
const { version } = require('../package.json');

const HELP = `sala ${version}

Uso:
  sala estado [--texto] [--sala <carpeta>]   la foto de cada miembro y su puerta, con el motivo
  sala plan [--texto] [--sala <carpeta>]     por miembro: lo que está en curso, la siguiente tarea lista
                                             y lo que espera, con el motivo; y la cola de la sala
                                             en olas que pueden correr en paralelo
  sala revisar [miembro] [--texto] [--sala <carpeta>]
                                             qué requisitos cumple cada miembro y, para los que
                                             faltan, la orden para cumplirlos

Opciones:
  --texto            salida para leer, en vez de JSON
  --sala <carpeta>   la carpeta de la sala (por defecto, la actual)
  --version          la versión del kit
`;

const COMMANDS = {
  estado: { run: (config) => estado(config), texto: estadoTexto },
  plan: { run: (config) => plan(config), texto: planTexto },
  revisar: { run: (config, opts) => revisar(config, opts.sala, opts.member), texto: revisarTexto, member: true },
};

function fail(error, details) {
  process.stderr.write(`${JSON.stringify(details ? { error, details } : { error })}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const opts = { command: null, member: null, texto: false, sala: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--texto') opts.texto = true;
    else if (arg === '--sala') {
      if (!argv[i + 1]) throw new ConfigError('--sala necesita una carpeta');
      opts.sala = path.resolve(argv[(i += 1)]);
    } else if (arg === '--version' || arg === '--help' || arg === '-h') opts.command = opts.command || arg;
    else if (!opts.command && !arg.startsWith('-')) opts.command = arg;
    else if (COMMANDS[opts.command]?.member && !opts.member && !arg.startsWith('-')) opts.member = arg;
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
    const command = COMMANDS[opts.command];
    if (!command) return fail(`subcomando desconocido: ${opts.command}`);
    const result = await command.run(loadConfig(opts.sala), opts);
    process.stdout.write(opts.texto ? command.texto(result) : `${JSON.stringify(result)}\n`);
  } catch (err) {
    if (err instanceof ConfigError) return fail(err.message, err.details);
    throw err;
  }
}

main();
