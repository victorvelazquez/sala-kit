#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { loadConfig, ConfigError } = require('../src/config');
const { estado, estadoTexto } = require('../src/estado');
const { plan, planTexto } = require('../src/plan');
const { revisar, revisarTexto } = require('../src/revisar');
const { abrir, abrirTexto, mostrar, mostrarTexto, retomar, retomarTexto, SalaError } = require('../src/abrir');
const { enviar, enviarTexto, esperar, esperarTexto } = require('../src/enviar');
const { veredicto, veredictoTexto } = require('../src/veredicto');
const { version } = require('../package.json');

const HELP = `sala ${version}

Uso:
  sala estado [--texto] [--sala <carpeta>]   la foto de cada miembro y su puerta, con el motivo,
                                             y su sesión viva de Gentle Shell: qué hace y si te necesita
  sala estado --retomar [--texto] [--sala <carpeta>]
                                             el resumen corto con el que arranca la sala: lo que abrió
                                             y la sesión viva de cada miembro, sin git
  sala plan [--texto] [--sala <carpeta>]     por miembro: lo que está en curso, la siguiente tarea lista
                                             y lo que espera, con el motivo; y la cola de la sala
                                             en olas que pueden correr en paralelo
  sala revisar [miembro] [--texto] [--sala <carpeta>]
                                             qué requisitos cumple cada miembro y, para los que
                                             faltan, la orden para cumplirlos
  sala abrir <miembro> [--texto] [--sala <carpeta>]
                                             reusa la sesión viva del miembro o abre una nueva en Orca
                                             o en Windows Terminal (options.launcher), espera a que
                                             Gentle Shell la publique y la anota en .sala/estado.json
  sala mostrar <miembro> [--texto] [--sala <carpeta>]
                                             muestra la terminal de Orca que abrió la sala, o dice
                                             el título de su pestaña de Windows Terminal
  sala enviar <miembro> <orden> [--texto] [--sala <carpeta>]
                                             deja la orden en la bandeja de la única sesión viva del
                                             miembro, si no tiene una pregunta abierta, y la anota en
                                             .sala/ordenes.log
  sala esperar <miembro> [--texto] [--sala <carpeta>]
                                             espera a que el miembro termine de verdad (sin subagentes
                                             ni trabajos) o te necesite; tope de 30 minutos
  sala veredicto <miembro> <comando> [--texto] [--sala <carpeta>]
                                             comprueba lo que el comando debía dejar hecho: después de
                                             miembro-entregar (o flow-ship, flow-pr), la rama, el commit
                                             subido, el PR, su CI y la fila Completada; después de
                                             miembro-base (o flow-base), la base limpia y al día

Opciones:
  --texto            salida para leer, en vez de JSON
  --retomar          con estado: el resumen corto, sin git
  --sala <carpeta>   la carpeta de la sala (por defecto, la actual)
  --version          la versión del kit
`;

const COMMANDS = {
  estado: {
    run: (config, opts) => (opts.retomar ? retomar(config, opts.sala) : estado(config)),
    texto: (result, opts) => (opts.retomar ? retomarTexto(result) : estadoTexto(result)),
  },
  plan: { run: (config) => plan(config), texto: planTexto },
  revisar: { run: (config, opts) => revisar(config, opts.sala, opts.member), texto: revisarTexto, member: true },
  abrir: { run: (config, opts) => abrir(config, opts.sala, opts.member), texto: abrirTexto, member: 'required' },
  mostrar: { run: (config, opts) => mostrar(config, opts.sala, opts.member), texto: mostrarTexto, member: 'required' },
  enviar: { run: (config, opts) => enviar(config, opts.sala, opts.member, opts.order), texto: enviarTexto, member: 'required', order: 'una orden' },
  esperar: { run: (config, opts) => esperar(config, opts.member), texto: esperarTexto, member: 'required' },
  veredicto: { run: (config, opts) => veredicto(config, opts.member, opts.order), texto: veredictoTexto, member: 'required', order: 'un comando' },
};

function fail(error, details) {
  process.stderr.write(`${JSON.stringify(details ? { error, details } : { error })}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const opts = { command: null, member: null, order: null, texto: false, retomar: false, sala: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--texto') opts.texto = true;
    else if (arg === '--retomar' && opts.command === 'estado') opts.retomar = true;
    else if (arg === '--sala') {
      if (!argv[i + 1]) throw new ConfigError('--sala necesita una carpeta');
      opts.sala = path.resolve(argv[(i += 1)]);
    } else if (arg === '--version' || arg === '--help' || arg === '-h') opts.command = opts.command || arg;
    else if (!opts.command && !arg.startsWith('-')) opts.command = arg;
    else if (COMMANDS[opts.command]?.member && !opts.member && !arg.startsWith('-')) opts.member = arg;
    else if (COMMANDS[opts.command]?.order && opts.member && opts.order === null && !arg.startsWith('-')) opts.order = arg;
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
    if (command.member === 'required' && !opts.member) return fail(`sala ${opts.command} necesita un miembro`);
    if (command.order && opts.order === null) return fail(`sala ${opts.command} necesita ${command.order}`);
    const result = await command.run(loadConfig(opts.sala), opts);
    process.stdout.write(opts.texto ? command.texto(result, opts) : `${JSON.stringify(result)}\n`);
  } catch (err) {
    if (err instanceof ConfigError) return fail(err.message, err.details);
    if (err instanceof SalaError) return fail(err.message);
    throw err;
  }
}

main();
