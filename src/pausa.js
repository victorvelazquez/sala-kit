'use strict';

// sala pausar and sala seguir (D38): while .sala/PAUSA exists, no order goes out.
// The file holds {"at", "until"}; an empty or unreadable one is a pause with no end.

const fs = require('node:fs');
const path = require('node:path');
const { SalaError } = require('./abrir');

const MAX_MINUTES = 1440;

const pauseFile = (salaDir) => path.join(salaDir, '.sala', 'PAUSA');

// The pause that is on, or null. A pause only ends when its `until` is a date already past:
// anything else stops orders, so a broken file never lets one through.
function readPause(salaDir) {
  let text;
  try {
    text = fs.readFileSync(pauseFile(salaDir), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    return { until: null };
  }
  let until = null;
  try {
    until = JSON.parse(text).until ?? null;
  } catch {
    return { until: null };
  }
  const end = typeof until === 'string' ? Date.parse(until) : NaN;
  if (Number.isNaN(end)) return { until: null };
  return end <= Date.now() ? null : { until };
}

function paused(salaDir) {
  return readPause(salaDir) !== null;
}

function parseMinutes(value) {
  const minutes = Number(value);
  if (value === undefined || value === null || !/^\d+(\.\d+)?$/.test(String(value)) || !(minutes > 0) || minutes > MAX_MINUTES) {
    throw new SalaError(`--minutos necesita un número de minutos mayor que 0 y hasta ${MAX_MINUTES}`);
  }
  return minutes;
}

// A pause already on is never replaced: a test pause must not shorten an endless one.
function pausar(salaDir, minutes) {
  const current = readPause(salaDir);
  if (current) return { paused: true, until: current.until, already: true };
  const until = minutes === null ? null : new Date(Date.now() + minutes * 60000).toISOString();
  fs.mkdirSync(path.dirname(pauseFile(salaDir)), { recursive: true });
  fs.writeFileSync(pauseFile(salaDir), `${JSON.stringify({ at: new Date().toISOString(), until })}\n`);
  return { paused: true, until, already: false };
}

function pausarTexto(r) {
  const end = r.until ? `hasta ${r.until}` : 'sin vencimiento';
  return r.already ? `la sala ya estaba en pausa, ${end}; no la cambié\n` : `la sala está en pausa, ${end}; sala seguir la levanta\n`;
}

// Also removes a pause that already ended by itself.
function seguir(salaDir) {
  const removed = fs.existsSync(pauseFile(salaDir));
  fs.rmSync(pauseFile(salaDir), { force: true });
  return { paused: false, removed };
}

function seguirTexto(r) {
  return r.removed ? 'la sala ya no está en pausa\n' : 'la sala no estaba en pausa\n';
}

module.exports = { paused, readPause, parseMinutes, pausar, pausarTexto, seguir, seguirTexto };
