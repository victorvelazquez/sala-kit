'use strict';

// The catalog of requirements for a member (D24, D42). Each check is pure: it
// gets the files read from the remote base and returns { id, ok, detail, fix }.

const { parseRoadmap, strayRows } = require('./roadmap');
const { blockVersions } = require('./bloques');

const STATES = ['Pendiente', 'En curso', 'Completada', 'Bloqueada'];
const HEADER = ['**Dónde está:**', '**Qué sigue:**', '**Qué lo bloquea:**'];
const AGENTS_MAX_KB = 16;
const MEMBER_START = '<!-- sala-kit:miembro:inicio -->';
const MEMBER_END = '<!-- sala-kit:miembro:fin -->';

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

// D56: the member block names its sala on a line of its own, between the member marks.
const SALA_LINE = /<!-- sala-kit:sala=(\S*) -->/;
const SALA_NAME = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$/;

// The sala the member block names: undefined without a block, null when it names none.
function blockSala(text) {
  if (text === null) return undefined;
  const start = text.indexOf(MEMBER_START);
  const end = text.indexOf(MEMBER_END, start);
  if (start === -1 || end === -1) return undefined;
  const found = SALA_LINE.exec(text.slice(start, end));
  return found ? version(found[1]) : null;
}

function memberBlock(text, sala) {
  const unirse = (cmd) => `En una tarea propia, corré \`${cmd}\` en la raíz del repositorio: pone el bloque del miembro y los bloques viejos al día, solo entre sus marcas. Si una regla de AGENTS.md fuera de las marcas choca con el bloque, mostrale a la persona el cambio exacto y aplicalo solo con su OK. Entregalo con su PR.`;
  const named = blockSala(text);
  if (named === undefined) return result('member-block', false, 'AGENTS.md no tiene el bloque del miembro', unirse(`sala unirse --de ${sala}`));
  if (named === null) return result('member-block', false, 'el bloque del miembro no nombra su sala', unirse(`sala unirse --de ${sala}`));
  if (named !== sala) {
    return result('member-block', false, `el bloque del miembro es de la sala ${named}, no de ${sala}`,
      `Un repositorio es miembro de una sola sala (D56) y esta no le manda órdenes. Decide la persona: sacarlo de esta sala con \`sala soltar\`, o sacar a mano el bloque de la otra y correr \`sala unirse --de ${sala}\`.`);
  }
  return result('member-block', true, `AGENTS.md tiene el bloque del miembro de la sala ${sala}`, null);
}

// The old blocks we wrote before the sala (D52) fail until sala unirse brings them up to date.
// A version comes from the member's file: controls and invisible characters go first (one
// inside a secret would hide it from the mask, and a control would make the order unsendable),
// then it is masked and cut.
const version = (v) => mask(v.replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu, '')).slice(0, 40);

function staleDetail(text) {
  const found = blockVersions(text, [MEMBER_START, MEMBER_END]);
  if (found.broken) {
    const name = found.broken === 'miembro' ? 'del miembro' : found.broken;
    return `AGENTS.md tiene las marcas del bloque ${name} repetidas, sin cerrar o al revés`;
  }
  if (found.stale.length === 0) return null;
  return `AGENTS.md tiene bloques viejos: ${found.stale.map((b) => `${b.name} ${version(b.version)} (el kit trae ${b.kit})`).join(', ')}`;
}

function noOldBlocks(text) {
  const detail = staleDetail(text);
  return result('old-blocks', detail === null, detail || 'AGENTS.md no tiene bloques viejos',
    'En una tarea propia, corré `sala unirse` en la raíz del repositorio: pone panel:tareas, panel:entrega y orquestacion:ciclo en su versión compatible con la sala, solo entre sus marcas (si las marcas están rotas, arreglalas a mano antes). Si una regla de AGENTS.md fuera de las marcas choca con la sala, mostrale a la persona el cambio exacto, línea por línea, y aplicalo solo con su OK. Entregalo con su PR.');
}

// A task row outside the table only warns (SK25): the reader skips it, so it says where it is.
function strayWarnings(text) {
  if (text === null) return [];
  return strayRows(text, STATES).map((r) => `docs/ROADMAP.md tiene la fila ${version(r.id)} fuera de la tabla de tareas (línea ${r.line}); movela adentro de la tabla de tareas, junto a las otras filas: la sala no lee las filas de afuera`);
}

// A block newer than the kit's meets the requirement and only warns.
function oldBlocks(text) {
  return blockVersions(text).newer.map((b) => `AGENTS.md tiene ${b.name} ${version(b.version)}, más nuevo que el ${b.kit} del kit`);
}

// files: { roadmap, agents } as text, or null when the file is missing.
function memberRequirements(files, where, sala) {
  return [
    ...roadmapChecks(files.roadmap, where),
    agentsSize(files.agents),
    memberBlock(files.agents, sala),
    noOldBlocks(files.agents),
    noSecrets([['AGENTS.md', files.agents]]),
  ];
}

module.exports = {
  memberRequirements,
  blockSala,
  SALA_NAME,
  oldBlocks,
  strayWarnings,
  staleDetail,
  noSecrets,
  mask,
  MEMBER_START,
  MEMBER_END,
  REQUIREMENT_IDS: ['base-remote', 'roadmap-table', 'roadmap-header', 'roadmap-states', 'agents-size', 'member-block', 'old-blocks', 'no-secrets'],
};
