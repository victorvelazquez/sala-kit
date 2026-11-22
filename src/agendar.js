'use strict';

// sala agendar (D44): prints the Windows scheduled task that leaves the plan of the day in
// .sala/plan-del-dia.txt every morning, and the command to remove it. It never installs it:
// the person copies the command into PowerShell.

const path = require('node:path');
const { SalaError } = require('./abrir');

const BIN = path.resolve(__dirname, '..', 'bin', 'sala.js');
const DEFAULT_TIME = '08:00';

function parseHora(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? ''));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new SalaError('--hora necesita una hora entre 00:00 y 23:59, como 08:00');
  }
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

// A PowerShell literal: inside single quotes only the quote itself needs doubling.
const ps = (text) => `'${String(text).replace(/'/g, "''")}'`;

// The task name keeps to letters, digits and dashes, so it never needs quoting rules of its own.
const taskName = (name) => `sala-plan-${String(name).replace(/[^A-Za-z0-9_-]+/g, '-')}`;

function agendar(config, salaDir, hora) {
  const time = hora ?? DEFAULT_TIME;
  const output = path.join(salaDir, '.sala', 'plan-del-dia.txt');
  // cmd expands %NAME% even between quotes; a Windows path cannot hold a double quote.
  for (const p of [salaDir, process.execPath, BIN]) {
    if (p.includes('%')) throw new SalaError(`la carpeta tiene un % que cmd expandiría: ${p}`);
  }
  const execute = process.env.ComSpec || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
  // It does not start with a quote, so cmd /c keeps every quote as it is.
  const argument = `/c mkdir "${path.dirname(output)}" 2>nul & "${process.execPath}" "${BIN}" plan --texto --sala "${salaDir}" > "${output}" 2>&1`;
  const task = taskName(config.name);
  const install = [
    `Register-ScheduledTask -TaskName ${ps(task)}`,
    `-Description ${ps(`sala-kit: el plan del día de ${config.name}, en ${output}`)}`,
    `-Trigger (New-ScheduledTaskTrigger -Daily -At ${ps(time)})`,
    `-Action (New-ScheduledTaskAction -Execute ${ps(execute)} -Argument ${ps(argument)} -WorkingDirectory ${ps(salaDir)})`,
  ].join(' ');
  return {
    task,
    time,
    output,
    action: { execute, argument, workingDirectory: salaDir },
    install,
    remove: `Unregister-ScheduledTask -TaskName ${ps(task)} -Confirm:$false`,
  };
}

function agendarTexto(r) {
  return [
    `Tarea programada ${r.task}: todos los días a las ${r.time} corre sala plan y deja el resultado en`,
    `  ${r.output}`,
    'No la instalé. Para instalarla, copiá esta orden en PowerShell:',
    `  ${r.install}`,
    'Para quitarla:',
    `  ${r.remove}`,
    '',
  ].join('\n');
}

module.exports = { agendar, agendarTexto, parseHora };
