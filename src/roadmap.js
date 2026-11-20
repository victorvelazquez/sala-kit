'use strict';

// Reads the task table of a docs/ROADMAP.md in the Orquestación 1.0 format.

const REQUIRED = ['ID', 'Entrega', 'Depende de', 'Estado'];
const NO_DEPS = new Set(['', '—', '-']);

function cells(line) {
  const parts = line.trim().split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  return parts.slice(1, parts.length - 1);
}

function parseDeps(cell) {
  if (NO_DEPS.has(cell)) return [];
  return cell.split(',').map((d) => d.trim()).filter((d) => !NO_DEPS.has(d));
}

function parseRoadmap(text) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().startsWith('|') && REQUIRED.every((name) => cells(l).includes(name)));
  if (start === -1) {
    return { error: `docs/ROADMAP.md no tiene la tabla con las columnas ${REQUIRED.slice(0, -1).join(', ')} y Estado` };
  }
  const header = cells(lines[start]);
  const col = (name) => header.indexOf(name);
  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.trim().startsWith('|')) break;
    const c = cells(line);
    const id = c[col('ID')];
    if (!id) continue;
    rows.push({
      id,
      entrega: c[col('Entrega')] || '',
      deps: parseDeps(c[col('Depende de')] || ''),
      estado: c[col('Estado')] || '',
      notas: col('Notas') === -1 ? '' : c[col('Notas')] || '',
    });
  }
  return { rows };
}

module.exports = { parseRoadmap };
