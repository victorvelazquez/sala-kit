'use strict';

// The catalog of requirements for a member (D24, D42). Each check is pure: it
// gets the files read from the remote base and returns { id, ok, detail, fix }.

const { parseRoadmap } = require('./roadmap');

const STATES = ['Pendiente', 'En curso', 'Completada', 'Bloqueada'];
const HEADER = ['**Dónde está:**', '**Qué sigue:**', '**Qué lo bloquea:**'];
const AGENTS_MAX_KB = 16;
const MEMBER_START = '<!-- sala-kit:miembro:inicio -->';
const MEMBER_END = '<!-- sala-kit:miembro:fin -->';
// Blocks of older tools that a member may still carry: they warn, they never fail (D26).
const OLD_BLOCKS = [
  ['panel:entrega', 'tiene el bloque viejo panel:entrega de repo-panel; hasta la fase 5 el miembro sigue entregando con /flow-* (D26)'],
];

// Only the kind and the line are ever reported, never the matched text.
const SECRETS = [
  ['token de GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['clave sk-', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['clave de AWS', /AKIA[0-9A-Z]{16}(?![0-9A-Z])/],
  ['clave privada', /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/],
  ['URL con usuario y clave', /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i],
];

// Repository text that reaches a detail: each secret is replaced by its kind.
function mask(text) {
  return SECRETS.reduce((out, [kind, pattern]) => out.replace(new RegExp(pattern.source, `${pattern.flags}g`), `[${kind}]`), String(text));
}

function result(id, ok, detail, fix) {
  return { id, ok, detail, fix: ok ? null : fix };
}

function findSecrets(name, text) {
  const found = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    for (const [kind, pattern] of SECRETS) {
      if (pattern.test(line)) found.push({ kind, line: i + 1 });
    }
  });
  return found.map((f) => `${f.kind} en ${name}:${f.line}`);
}

function noSecrets(files) {
  const found = files.flatMap(([name, text]) => (text === null ? [] : findSecrets(name, text)));
  const names = files.map(([name]) => name).join(' y ');
  return result(
    'no-secrets',
    found.length === 0,
    found.length ? found.join('; ') : `${names} sin secretos`,
    'Sacá cada secreto de la línea indicada, rotalo (ya quedó en el historial) y guardalo fuera del repositorio.',
  );
}

function roadmapChecks(text, where) {
  if (text === null) {
    const detail = `no hay docs/ROADMAP.md en ${where}`;
    return [
      result('roadmap-table', false, detail, 'Creá docs/ROADMAP.md con la tabla de Orquestación 1.0 (columnas ID, Entrega, Resultado visible, Depende de, Estado, Notas y Ficha) y su cabecera de tres líneas.'),
      { id: 'roadmap-header', ok: null, detail: 'sin comprobar: no hay docs/ROADMAP.md', fix: null },
      { id: 'roadmap-states', ok: null, detail: 'sin comprobar: no hay docs/ROADMAP.md', fix: null },
    ];
  }
  const parsed = parseRoadmap(text);
  const missing = HEADER.filter((h) => !text.includes(h));
  const checks = [
    result('roadmap-table', !parsed.error, parsed.error || 'tabla de tareas con las columnas de Orquestación 1.0',
      'Pasá las tareas de docs/ROADMAP.md a la tabla de Orquestación 1.0, con las columnas ID, Entrega, Resultado visible, Depende de, Estado, Notas y Ficha.'),
    result('roadmap-header', missing.length === 0,
      missing.length ? `a la cabecera le faltan: ${missing.join(', ')}` : 'cabecera de tres líneas',
      `Agregá al principio de docs/ROADMAP.md las tres líneas ${HEADER.join(', ')}: dónde está el proyecto, qué sigue y qué lo bloquea.`),
  ];
  if (parsed.error) {
    checks.push({ id: 'roadmap-states', ok: null, detail: 'sin comprobar: no hay tabla', fix: null });
  } else {
    const bad = parsed.rows.filter((r) => !STATES.includes(r.estado)).map((r) => mask(`${r.id}: «${r.estado}» no es un estado`));
    checks.push(result('roadmap-states', bad.length === 0, bad.length ? bad.join('; ') : 'cada fila tiene un estado válido',
      `Dejá en la columna Estado una sola palabra entre ${STATES.join(', ')}; el detalle va en Notas.`));
  }
  return checks;
}

function agentsSize(text) {
  if (text === null) {
    return result('agents-size', false, 'no hay AGENTS.md', 'Creá AGENTS.md con las reglas para los agentes del repositorio.');
  }
  const kb = Math.round(Buffer.byteLength(text) / 1024);
  const ok = Buffer.byteLength(text) <= AGENTS_MAX_KB * 1024;
  return result('agents-size', ok, `AGENTS.md tiene ${kb} KB${ok ? '' : `; el máximo es ${AGENTS_MAX_KB} KB`}`,
    `Recortá AGENTS.md por debajo de ${AGENTS_MAX_KB} KB: pasá a docs/ lo que no es una regla para agentes.`);
}

function memberBlock(text) {
  const ok = text !== null && text.includes(MEMBER_START) && text.includes(MEMBER_END);
  return result('member-block', ok, `AGENTS.md ${ok ? 'tiene' : 'no tiene'} el bloque del miembro`,
    'En una tarea propia, corré `sala unirse` en la raíz del repositorio: pone el bloque del miembro y los bloques viejos al día, solo entre sus marcas. Si una regla de AGENTS.md fuera de las marcas choca con el bloque, mostrale a la persona el cambio exacto y aplicalo solo con su OK. Entregalo con su PR.');
}

function oldBlocks(text) {
  return text === null ? [] : OLD_BLOCKS.filter(([mark]) => text.includes(mark)).map(([, warning]) => warning);
}

// files: { roadmap, agents } as text, or null when the file is missing.
function memberRequirements(files, where) {
  return [
    ...roadmapChecks(files.roadmap, where),
    agentsSize(files.agents),
    memberBlock(files.agents),
    noSecrets([['AGENTS.md', files.agents]]),
  ];
}

module.exports = {
  memberRequirements,
  oldBlocks,
  noSecrets,
  mask,
  MEMBER_START,
  MEMBER_END,
  REQUIREMENT_IDS: ['base-remote', 'roadmap-table', 'roadmap-header', 'roadmap-states', 'agents-size', 'member-block', 'no-secrets'],
};
