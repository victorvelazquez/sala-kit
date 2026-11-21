'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, validateConfig, ConfigError } = require('./config');
const { MEMBER_START } = require('./requisitos');
const { version } = require('../package.json');

const TEMPLATES = path.join(__dirname, '..', 'templates');
const SALA_START = '<!-- sala-kit:sala:inicio -->';
const SALA_END = '<!-- sala-kit:sala:fin -->';
const IGNORED = '.sala/';

// A template without its leading HTML comment, which is a note for whoever edits the kit.
function template(name, family = 'sala') {
  const text = fs.readFileSync(path.join(TEMPLATES, family, name), 'utf8');
  return text.replace(/^<!--[\s\S]*?-->\r?\n/, '');
}

function salaBlock() {
  return `${SALA_START}\n${template('bloque.md')}\n${template('preguntas.md')}${SALA_END}\n`;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new ConfigError(`no se pudo leer ${path.basename(file)}: ${err.code}`);
  }
}

// `wx` fails when the file exists, so a file that appeared meanwhile is never overwritten.
function create(dir, name, text, report) {
  try {
    fs.writeFileSync(path.join(dir, name), text, { flag: 'wx' });
    report.created.push(name);
  } catch (err) {
    if (err.code === 'EEXIST') report.skipped.push({ file: name, reason: 'ya existe' });
    else throw new ConfigError(`no se pudo escribir ${name}: ${err.code}`);
  }
}

function initSalaJson(dir, current, report) {
  if (current === null) {
    const config = { schema: 1, kit: version, name: path.basename(dir) || 'sala', members: [] };
    return create(dir, 'sala.json', `${JSON.stringify(config, null, 2)}\n`, report);
  }
  report.skipped.push({ file: 'sala.json', reason: 'ya existe' });
  let valid;
  try {
    valid = validateConfig(JSON.parse(current)).errors.length === 0;
  } catch {
    valid = false;
  }
  if (!valid) report.warnings.push('sala.json ya existe pero no es válido: `sala donde` dice qué le falta');
  return undefined;
}

function initAgents(dir, current, report) {
  if (current === null) return create(dir, 'AGENTS.md', `# Reglas de la sala\n\n${salaBlock()}`, report);
  if (current.includes(SALA_START)) {
    report.skipped.push({ file: 'AGENTS.md', reason: 'ya tiene el bloque de la sala' });
    return undefined;
  }
  report.skipped.push({ file: 'AGENTS.md', reason: 'tiene reglas propias, sin las marcas del bloque' });
  report.warnings.push(
    'AGENTS.md ya tiene reglas propias y no tiene las marcas del bloque de la sala: el bloque quedó en ' +
      'AGENTS.md.sugerido. Revisá si alguna regla choca con él y pasalo a mano, con sus marcas.',
  );
  return create(dir, 'AGENTS.md.sugerido', salaBlock(), report);
}

function initGitignore(dir, current, report) {
  if (current === null) return create(dir, '.gitignore', `${IGNORED}\n`, report);
  const lines = current.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(IGNORED) || lines.includes('.sala') || lines.includes('/.sala/')) {
    report.skipped.push({ file: '.gitignore', reason: 'ya ignora .sala/' });
    return undefined;
  }
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const sep = current === '' || current.endsWith('\n') ? '' : eol;
  fs.appendFileSync(path.join(dir, '.gitignore'), `${sep}${IGNORED}${eol}`);
  report.updated.push('.gitignore');
  return undefined;
}

// Makes a new room in `dir`. It never overwrites: it says what it made and what it skipped (D41).
function init(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new ConfigError(`no se pudo crear la carpeta de la sala: ${err.code}`);
  }
  // Read everything first, so a file it cannot read stops it before it writes anything.
  const [salaJson, agents, gitignore] = ['sala.json', 'AGENTS.md', '.gitignore'].map((f) => readText(path.join(dir, f)));
  if (salaJson === null && agents !== null && agents.includes(MEMBER_START)) {
    throw new ConfigError(`${dir} es un miembro de una sala: init no lo convierte en sala`);
  }
  const report = { sala: dir, created: [], updated: [], skipped: [], warnings: [] };
  initSalaJson(dir, salaJson, report);
  initAgents(dir, agents, report);
  initGitignore(dir, gitignore, report);
  return report;
}

function initTexto(r) {
  const lines = [`Sala en ${r.sala}`];
  for (const f of r.created) lines.push(`  creado      ${f}`);
  for (const f of r.updated) lines.push(`  actualizado ${f}`);
  for (const s of r.skipped) lines.push(`  salteado    ${s.file}: ${s.reason}`);
  for (const w of r.warnings) lines.push(`  aviso: ${w}`);
  return `${lines.join('\n')}\n`;
}

// The guard of the global commands (D35): is this folder a room, a member or neither?
function donde(dir) {
  if (fs.existsSync(path.join(dir, 'sala.json'))) return { kind: 'sala', dir, name: loadConfig(dir).name };
  const agents = readText(path.join(dir, 'AGENTS.md'));
  if (agents !== null && agents.includes(MEMBER_START)) return { kind: 'miembro', dir };
  return { kind: 'ninguna', dir };
}

function dondeTexto(r) {
  if (r.kind === 'sala') return `Sala «${r.name}» en ${r.dir}\n`;
  if (r.kind === 'miembro') return `Miembro de una sala en ${r.dir}\n`;
  return `Ni sala ni miembro: ${r.dir}\n`;
}

module.exports = { init, initTexto, donde, dondeTexto, template, readText, create };
