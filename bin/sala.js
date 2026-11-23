#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { loadConfig, ConfigError } = require('../src/config');
const { estado, estadoTexto } = require('../src/estado');
const { plan, planTexto } = require('../src/plan');
const { proximo, proximoTexto } = require('../src/proximo');
const { revisar, revisarTexto } = require('../src/revisar');
const { abrir, abrirTexto, mostrar, mostrarTexto, retomar, retomarTexto, SalaError } = require('../src/abrir');
const { enviar, enviarTexto, esperar, esperarTexto, respuesta, respuestaTexto } = require('../src/enviar');
const { veredicto, veredictoTexto } = require('../src/veredicto');
const { preguntas, preguntasTexto, responder, responderTexto } = require('../src/responder');
const { init, initTexto, donde, dondeTexto } = require('../src/init');
const { dependencias, dependenciasTexto } = require('../src/dependencias');
const { fusionar, fusionarTexto } = require('../src/fusionar');
const { reiniciar, reiniciarTexto, modelo, modeloTexto } = require('../src/reiniciar');
const { adoptar, adoptarTexto, soltar, soltarTexto, unirse, unirseTexto, condiciones, condicionesTexto } = require('../src/adoptar');
const { actualizar, actualizarTexto } = require('../src/actualizar');
const { pausar, pausarTexto, seguir, seguirTexto, parseMinutes } = require('../src/pausa');
const { motor, MotorError } = require('../src/motor');
const { hospedar, hospedarTexto } = require('../src/hospedar');
const { consentir, consentirTexto } = require('../src/consentir');
const { instalar, instalarTexto } = require('../src/instalar');
const { agendar, agendarTexto, parseHora } = require('../src/agendar');
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
  sala instalar [--forzar] [--texto]         copia los agentes del kit (miembro-entrega) a
                                             ~/.gentle-shell/agent/agents con su versión; pone al día
                                             una copia vieja, pero nunca pisa una editada o ajena
                                             sin --forzar; sale con 1 si dejó alguna sin tocar
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
  sala proximo [--texto] [--sala <carpeta>]  el paso siguiente de cada miembro y el comando exacto:
                                             abrir su sesión, contestar, esperar, entregar, fusionar
                                             su PR, esperar el CI, volver a la base, pedir su tarea
                                             siguiente o nada; solo lee, nunca manda nada
  sala agendar [--hora <HH:MM>] [--texto] [--sala <carpeta>]
                                             imprime la orden de PowerShell que programa en Windows
                                             sala plan todos los días (08:00 por defecto), con su
                                             salida en .sala/plan-del-dia.txt, y la orden para
                                             quitarla; nunca la instala
  sala revisar [miembro] [--texto] [--sala <carpeta>]
                                             qué requisitos cumple cada miembro y, para los que
                                             faltan, la orden para cumplirlos; y sus avisos, con
                                             los agentes del kit que faltan o quedaron viejos
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
  sala unirse [--texto] [--sala <carpeta>]   en un miembro: pone al día su AGENTS.md solo entre las
                                             marcas: el bloque del miembro (al final, si falta) y los
                                             bloques viejos panel:tareas, panel:entrega y
                                             orquestacion:ciclo; fuera de las marcas no cambia nada
  sala dependencias [--instalar] [--texto] [--sala <carpeta>]
                                             en un miembro: dice si hay que instalar sus dependencias
                                             (falta node_modules o el lockfile cambió después de la
                                             última instalación) y, con --instalar, corre pnpm install
                                             --frozen-lockfile o npm ci; si nada cambió, no instala
  sala abrir <miembro> [--texto] [--sala <carpeta>]
                                             reusa la sesión viva del miembro o abre una nueva en Orca
                                             o en Windows Terminal (options.launcher), espera a que
                                             Gentle Shell la publique y la anota en .sala/estado.json;
                                             si la sesión de su terminal de Orca apareció tarde y es la
                                             única del miembro, la anota al reusarla
  sala mostrar <miembro> [--texto] [--sala <carpeta>]
                                             muestra la terminal de Orca que abrió la sala, o dice
                                             el título de su pestaña de Windows Terminal
  sala hospedar <miembro> [--cerrar] [--primer-plano] [--texto] [--sala <carpeta>]
                                             hospeda una sesión sin pantalla del miembro (RPC de pi) y
                                             la mantiene viva en segundo plano; la sala le habla por
                                             un pipe con nombre y contesta desde ahí toda pregunta
                                             menos los consentimientos, que el anfitrión retiene;
                                             reusa la que ya está y no abre otra junto a una sesión
                                             viva. --cerrar la cierra si está libre y sin preguntas;
                                             --primer-plano corre el anfitrión en esta terminal
  sala enviar <miembro> <orden> [--texto] [--sala <carpeta>]
                                             deja la orden en la bandeja de la única sesión viva del
                                             miembro, si no tiene una pregunta abierta, y la anota en
                                             .sala/ordenes.log; a un miembro hospedado se la da su
                                             anfitrión, si no está trabajando
  sala esperar <miembro> [--texto] [--sala <carpeta>]
                                             espera a que el miembro termine de verdad (sin subagentes
                                             ni trabajos) o te necesite; después de una orden de
                                             sala enviar, espera primero a que la empiece (tope de 2
                                             minutos); tope total de 30 minutos
  sala respuesta <miembro> [--texto] [--sala <carpeta>]
                                             la última respuesta de la sesión viva del miembro, leída
                                             de su archivo de sesión, con los secretos enmascarados y
                                             recortada a 8000 caracteres; no anota nada
  sala preguntas [--texto] [--sala <carpeta>]
                                             las preguntas abiertas de todos los miembros, completas,
                                             y dónde se contesta cada una: desde la sala o en la
                                             pestaña del miembro (consentimientos y las demás)
  sala responder <miembro> <opción> --pregunta <id> [--texto] [--sala <carpeta>]
                                             entrega la opción que elegiste a una pregunta de una
                                             opción, si sigue siendo la que mostró sala preguntas, y
                                             la anota en .sala/ordenes.log; a un consentimiento o una
                                             pregunta de la terminal no la contesta: muestra la pestaña.
                                             A un miembro hospedado le contesta cualquier pregunta
                                             (una opción, sí o no, o un texto) menos un consentimiento
  sala consentir <miembro> [--texto] [--sala <carpeta>]
                                             da el consentimiento que pidió una sesión hospedada: solo
                                             en una terminal interactiva, con la opción que tipeás en
                                             ese momento (nunca como argumento); queda en
                                             .sala/ordenes.log
  sala veredicto <miembro> <comando> [--texto] [--sala <carpeta>]
                                             comprueba lo que el comando debía dejar hecho: después de
                                             miembro-entregar (o flow-ship, flow-pr), la rama, el commit
                                             subido, el PR, su CI y la fila Completada; después de
                                             miembro-base (o flow-base), la base limpia y al día
  sala fusionar <miembro> <n> [--texto] [--sala <carpeta>]
                                             fusiona el PR #n del miembro, solo si está abierto, en
                                             verde y fusionable, con el método que el repo permite;
                                             después le manda /miembro-base, corre la puerta y le pide
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
  sala pausar [--minutos <n>] [--texto] [--sala <carpeta>]
                                             pone la sala en pausa (.sala/PAUSA): enviar, fusionar,
                                             reiniciar y sus cadenas se niegan; con --minutos es una
                                             pausa de prueba que vence sola; una pausa que ya está
                                             puesta no se cambia
  sala seguir [--texto] [--sala <carpeta>]   levanta la pausa; solo cuando la persona lo pide
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
  --forzar           con instalar: reemplaza también la copia editada o ajena
  --instalar         con dependencias: corre la instalación cuando hace falta
  --minutos <n>      con pausar: la pausa vence sola a los n minutos (hasta 1440)
  --hora <HH:MM>     con agendar: la hora del plan del día (por defecto, 08:00)
  --id, --prefijo, --base, --remoto
                     con adoptar: el dato del miembro, en vez de deducirlo
  --sala <carpeta>   la carpeta de la sala (por defecto, la actual)
  --help, -h         esta ayuda, en cualquier lugar de los argumentos: no corre el comando
  --version          la versión del kit, en cualquier lugar: no corre el comando
`;

const COMMANDS = {
  init: { run: (opts) => init(opts.sala), texto: initTexto, noConfig: true },
  donde: { run: (opts) => donde(opts.sala), texto: dondeTexto, noConfig: true },
  instalar: { run: (opts) => instalar({ forzar: opts.forzar }), texto: instalarTexto, noConfig: true, failed: (result) => !result.ok },
  // It reads sala.json by itself: an old one may not pass loadConfig until it is migrated.
  actualizar: { run: (opts) => actualizar(opts.sala), texto: actualizarTexto, noConfig: true },
  unirse: { run: (opts) => unirse(opts.sala), texto: unirseTexto, noConfig: true },
  dependencias: { run: (opts) => dependencias(opts.sala, { instalar: opts.instalar }), texto: dependenciasTexto, noConfig: true },
  adoptar: { run: (config, opts) => adoptar(config, opts.sala, opts.member, opts.adopt), texto: adoptarTexto, member: 'required', memberLabel: 'una carpeta' },
  soltar: { run: (config, opts) => soltar(config, opts.sala, opts.member), texto: soltarTexto, member: 'required' },
  condiciones: { run: (config, opts) => condiciones(config, opts.sala, opts.member), texto: condicionesTexto, member: 'required' },
  estado: {
    run: (config, opts) => (opts.retomar ? retomar(config, opts.sala) : estado(config)),
    texto: (result, opts) => (opts.retomar ? retomarTexto(result) : estadoTexto(result)),
  },
  plan: { run: (config) => plan(config), texto: planTexto },
  proximo: { run: (config, opts) => proximo(config, opts.sala), texto: proximoTexto },
  agendar: { run: (config, opts) => agendar(config, opts.sala, opts.hora), texto: agendarTexto },
  revisar: { run: (config, opts) => revisar(config, opts.sala, opts.member), texto: revisarTexto, member: true },
  abrir: { run: (config, opts) => abrir(config, opts.sala, opts.member), texto: abrirTexto, member: 'required' },
  mostrar: { run: (config, opts) => mostrar(config, opts.sala, opts.member), texto: mostrarTexto, member: 'required' },
  enviar: { run: (config, opts) => enviar(config, opts.sala, opts.member, opts.order), texto: enviarTexto, member: 'required', order: 'una orden' },
  esperar: { run: (config, opts) => esperar(config, opts.sala, opts.member), texto: esperarTexto, member: 'required' },
  respuesta: { run: (config, opts) => respuesta(config, opts.member), texto: respuestaTexto, member: 'required' },
  veredicto: { run: (config, opts) => veredicto(config, opts.member, opts.order, opts.sala), texto: veredictoTexto, member: 'required', order: 'un comando' },
  preguntas: { run: (config, opts) => preguntas(config, opts.sala), texto: preguntasTexto },
  hospedar: {
    run: (config, opts) => hospedar(config, opts.sala, opts.member, { cerrar: opts.cerrar, primerPlano: opts.primerPlano }),
    texto: hospedarTexto,
    member: 'required',
  },
  consentir: { run: (config, opts) => consentir(config, opts.sala, opts.member, { answerArg: opts.answerArg }), texto: consentirTexto, member: 'required' },
  reiniciar: { run: (config, opts) => reiniciar(config, opts.sala, opts.member), texto: reiniciarTexto, member: 'required' },
  modelo: { run: (config, opts) => modelo(config, opts.sala), texto: modeloTexto },
  pausar: { run: (config, opts) => pausar(opts.sala, opts.minutos), texto: pausarTexto },
  seguir: { run: (config, opts) => seguir(opts.sala), texto: seguirTexto },
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
  const opts = { command: null, member: null, order: null, pregunta: null, minutos: null, hora: null, adopt: {}, texto: false, retomar: false, forzar: false, instalar: false, cerrar: false, primerPlano: false, sala: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--texto') opts.texto = true;
    else if (opts.command === 'adoptar' && Object.hasOwn(ADOPT_FLAGS, arg)) {
      if (!argv[i + 1]) throw new ConfigError(`${arg} necesita un valor`);
      if (Object.hasOwn(opts.adopt, ADOPT_FLAGS[arg])) throw new ConfigError(`${arg} va una sola vez`);
      opts.adopt[ADOPT_FLAGS[arg]] = argv[(i += 1)];
    }
    else if (arg === '--retomar' && opts.command === 'estado') opts.retomar = true;
    else if (arg === '--forzar' && opts.command === 'instalar') opts.forzar = true;
    else if (arg === '--instalar' && opts.command === 'dependencias') opts.instalar = true;
    else if (arg === '--cerrar' && opts.command === 'hospedar') opts.cerrar = true;
    else if (arg === '--primer-plano' && opts.command === 'hospedar') opts.primerPlano = true;
    else if (arg === '--pregunta' && opts.command === 'responder') {
      if (!argv[i + 1]) throw new ConfigError('--pregunta necesita el id de la pregunta');
      if (opts.pregunta !== null) throw new ConfigError('--pregunta va una sola vez');
      opts.pregunta = argv[(i += 1)];
    } else if (arg === '--minutos' && opts.command === 'pausar') {
      if (opts.minutos !== null) throw new ConfigError('--minutos va una sola vez');
      opts.minutos = parseMinutes(argv[(i += 1)]);
    } else if (arg === '--hora' && opts.command === 'agendar') {
      if (opts.hora !== null) throw new ConfigError('--hora va una sola vez');
      opts.hora = parseHora(argv[(i += 1)]);
    } else if (arg === '--sala') {
      if (!argv[i + 1]) throw new ConfigError('--sala necesita una carpeta');
      opts.sala = path.resolve(argv[(i += 1)]);
    } else if (!opts.command && !arg.startsWith('-')) opts.command = arg;
    else if (COMMANDS[opts.command]?.member && !opts.member && !arg.startsWith('-')) opts.member = arg;
    else if (COMMANDS[opts.command]?.order && opts.member && opts.order === null && !arg.startsWith('-')) opts.order = arg;
    // D48: the consent is typed by the person, and an argument is what the sala's model could
    // write; sala consentir refuses it and logs the attempt.
    else if (opts.command === 'consentir' && opts.member && !arg.startsWith('-')) opts.answerArg = true;
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
  // Asking for help or the version, anywhere in the arguments, never runs a command (SK13).
  const argv = process.argv.slice(2);
  if (argv.some((arg) => arg === '--help' || arg === '-h')) return void process.stdout.write(HELP);
  if (argv.includes('--version')) return void process.stdout.write(`${version}\n`);
  try {
    opts = parseArgs(argv);
    if (!opts.command) return void process.stdout.write(HELP);
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
