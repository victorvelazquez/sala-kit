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
const { preguntas, preguntasTexto, responder, responderTexto } = require('../src/responder');
const { init, initTexto, donde, dondeTexto } = require('../src/init');
const { fusionar, fusionarTexto } = require('../src/fusionar');
const { reiniciar, reiniciarTexto, modelo, modeloTexto } = require('../src/reiniciar');
const { adoptar, adoptarTexto, soltar, soltarTexto, unirse, unirseTexto, condiciones, condicionesTexto } = require('../src/adoptar');
const { actualizar, actualizarTexto } = require('../src/actualizar');
const { motor, MotorError } = require('../src/motor');
const { version } = require('../package.json');

const HELP = `sala ${version}

Uso:
  sala init [--texto] [--sala <carpeta>]     crea una sala nueva: sala.json sin miembros, el AGENTS.md con
                                             el bloque de la sala y .sala/ en .gitignore; nunca pisa,
                                             dice qué hizo y qué salteó
  sala actualizar [--texto] [--sala <carpeta>]
                                             lleva la sala a la versión instalada del kit: migra
                                             sala.json, reescribe solo el bloque de la sala en su
                                             AGENTS.md y vuelve a revisar a los miembros; propone la
                                             orden de ponerse en condiciones, sin mandarla
  sala donde [--texto] [--sala <carpeta>]    dice si la carpeta es una sala, un miembro o ninguna:
                                             la guarda de los comandos /sala-*
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
                                             faltan, la orden para cumplirlos; y sus avisos
  sala adoptar <carpeta> [--id <id>] [--prefijo <PREFIJO>] [--base <rama>] [--remoto <nombre>]
               [--texto] [--sala <carpeta>]
                                             suma el repositorio a sala.json; deduce el id y el prefijo
                                             del nombre de la carpeta, el remoto (origin) y la base
                                             (la rama por defecto del remoto); nunca escribe en él
  sala soltar <miembro> [--texto] [--sala <carpeta>]
                                             saca al miembro de sala.json, con sus tareas de pinned,
                                             sin tocar su repositorio
  sala condiciones <miembro> [--texto] [--sala <carpeta>]
                                             le manda al miembro, con las guardas de sala enviar, la
                                             orden de cumplir los requisitos que le faltan
  sala unirse [--texto] [--sala <carpeta>]   en un miembro: pone el bloque del miembro en su AGENTS.md;
                                             nunca pisa: si tiene reglas propias sin las marcas, lo
                                             deja en AGENTS.md.sugerido
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
  sala preguntas [--texto] [--sala <carpeta>]
                                             las preguntas abiertas de todos los miembros, completas,
                                             y dónde se contesta cada una: desde la sala o en la
                                             pestaña del miembro (consentimientos y las demás)
  sala responder <miembro> <opción> --pregunta <id> [--texto] [--sala <carpeta>]
                                             entrega la opción que elegiste a una pregunta de una
                                             opción, si sigue siendo la que mostró sala preguntas, y
                                             la anota en .sala/ordenes.log; a un consentimiento o una
                                             pregunta de la terminal no la contesta: muestra la pestaña
  sala veredicto <miembro> <comando> [--texto] [--sala <carpeta>]
                                             comprueba lo que el comando debía dejar hecho: después de
                                             miembro-entregar (o flow-ship, flow-pr), la rama, el commit
                                             subido, el PR, su CI y la fila Completada; después de
                                             miembro-base (o flow-base), la base limpia y al día
  sala fusionar <miembro> <n> [--texto] [--sala <carpeta>]
                                             fusiona el PR #n del miembro, solo si está abierto, en
                                             verde y fusionable, con el método que el repo permite;
                                             después le manda /flow-base, corre la puerta y le pide
                                             la tarea siguiente (salvo Auto: no) en una sesión nueva,
                                             si la sala abrió su terminal de Orca. Se detiene en el
                                             primer paso que falla, mira .sala/PAUSA antes de cada
                                             uno y los anota en .sala/fusiones.log; sale con 1 si
                                             no terminó
  sala reiniciar <miembro> [--texto] [--sala <carpeta>]
                                             cierra la terminal de Orca que abrió la sala y abre una
                                             sesión nueva, solo si la sesión está libre, sin pregunta,
                                             y el miembro está en su base limpia y al día; nunca cierra
                                             una terminal de la persona
  sala modelo [--texto] [--sala <carpeta>]   aplica el perfil de options.roomModel solo a la sesión de
                                             la sala, sin tocar la configuración global; si el perfil
                                             pide confirmación, la da la persona en la terminal
  sala motor commit|pr <argumentos del motor> [--tarea <ID>] [--jira]  (estos dos, solo al sellar el PR)
                                             en un miembro: corre el motor de entrega del kit (engine/)
                                             sin shell, con su salida tal cual; antes de sellar el PR
                                             revisa su título (lo usa /miembro-entregar)

Opciones:
  --texto            salida para leer, en vez de JSON
  --retomar          con estado: el resumen corto, sin git
  --pregunta <id>    con responder: el id de la pregunta que mostró sala preguntas
  --id, --prefijo, --base, --remoto
                     con adoptar: el dato del miembro, en vez de deducirlo
  --sala <carpeta>   la carpeta de la sala (por defecto, la actual)
  --version          la versión del kit
`;

const COMMANDS = {
  init: { run: (opts) => init(opts.sala), texto: initTexto, noConfig: true },
  donde: { run: (opts) => donde(opts.sala), texto: dondeTexto, noConfig: true },
  // It reads sala.json by itself: an old one may not pass loadConfig until it is migrated.
  actualizar: { run: (opts) => actualizar(opts.sala), texto: actualizarTexto, noConfig: true },
  unirse: { run: (opts) => unirse(opts.sala), texto: unirseTexto, noConfig: true },
  adoptar: { run: (config, opts) => adoptar(config, opts.sala, opts.member, opts.adopt), texto: adoptarTexto, member: 'required', memberLabel: 'una carpeta' },
  soltar: { run: (config, opts) => soltar(config, opts.sala, opts.member), texto: soltarTexto, member: 'required' },
  condiciones: { run: (config, opts) => condiciones(config, opts.sala, opts.member), texto: condicionesTexto, member: 'required' },
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
  preguntas: { run: (config) => preguntas(config), texto: preguntasTexto },
  reiniciar: { run: (config, opts) => reiniciar(config, opts.sala, opts.member), texto: reiniciarTexto, member: 'required' },
  modelo: { run: (config, opts) => modelo(config, opts.sala), texto: modeloTexto },
  fusionar: {
    run: (config, opts) => fusionar(config, opts.sala, opts.member, opts.order),
    texto: fusionarTexto,
    member: 'required',
    order: 'el número del PR',
    failed: (result) => !result.ok,
  },
  responder: {
    run: (config, opts) => responder(config, opts.sala, opts.member, opts.order, opts.pregunta),
    texto: responderTexto,
    member: 'required',
    order: 'una opción',
  },
};

function fail(error, details) {
  process.stderr.write(`${JSON.stringify(details ? { error, details } : { error })}\n`);
  process.exitCode = 1;
}

// The data of a member that sala adoptar takes instead of deducing it.
const ADOPT_FLAGS = { '--id': 'id', '--prefijo': 'prefijo', '--base': 'base', '--remoto': 'remoto' };

function parseArgs(argv) {
  const opts = { command: null, member: null, order: null, pregunta: null, adopt: {}, texto: false, retomar: false, sala: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--texto') opts.texto = true;
    else if (opts.command === 'adoptar' && Object.hasOwn(ADOPT_FLAGS, arg)) {
      if (!argv[i + 1]) throw new ConfigError(`${arg} necesita un valor`);
      if (Object.hasOwn(opts.adopt, ADOPT_FLAGS[arg])) throw new ConfigError(`${arg} va una sola vez`);
      opts.adopt[ADOPT_FLAGS[arg]] = argv[(i += 1)];
    }
    else if (arg === '--retomar' && opts.command === 'estado') opts.retomar = true;
    else if (arg === '--pregunta' && opts.command === 'responder') {
      if (!argv[i + 1]) throw new ConfigError('--pregunta necesita el id de la pregunta');
      if (opts.pregunta !== null) throw new ConfigError('--pregunta va una sola vez');
      opts.pregunta = argv[(i += 1)];
    } else if (arg === '--sala') {
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
  // The engine's arguments go to it as they are: parseArgs would refuse its flags.
  if (process.argv[2] === 'motor') {
    try {
      process.exitCode = await motor(process.argv.slice(3));
    } catch (err) {
      if (err instanceof MotorError) return fail(err.message, err.details);
      throw err;
    }
    return;
  }
  try {
    opts = parseArgs(process.argv.slice(2));
    if (opts.command === '--version') return void process.stdout.write(`${version}\n`);
    if (!opts.command || opts.command === '--help' || opts.command === '-h') return void process.stdout.write(HELP);
    const command = COMMANDS[opts.command];
    if (!command) return fail(`subcomando desconocido: ${opts.command}`);
    if (command.member === 'required' && !opts.member) return fail(`sala ${opts.command} necesita ${command.memberLabel || 'un miembro'}`);
    if (command.order && opts.order === null) return fail(`sala ${opts.command} necesita ${command.order}`);
    const result = await (command.noConfig ? command.run(opts) : command.run(loadConfig(opts.sala), opts));
    process.stdout.write(opts.texto ? command.texto(result, opts) : `${JSON.stringify(result)}\n`);
    if (command.failed && command.failed(result)) process.exitCode = 1;
  } catch (err) {
    if (err instanceof ConfigError) return fail(err.message, err.details);
    if (err instanceof SalaError) return fail(err.message);
    throw err;
  }
}

main();
