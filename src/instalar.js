'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { SalaError } = require('./abrir');
const { version } = require('../package.json');

const OUTPUT_SCHEMA = 1;
const KIT_DIR = path.resolve(__dirname, '..');
const KIT_AGENTS = path.join(KIT_DIR, 'agents');
const MARK = '<!-- sala-kit: version ';
const MARK_RE = /^<!-- sala-kit: version (\S+) sha256 ([0-9a-f]{64}) -->\n$/;

// D34: a pi package does not install agents, so the kit copies its own to the Gentle Shell home.
// SALA_GENTLE_AGENT_DIR is for the tests, which never touch the real home.
function gentleAgentDir() {
  return process.env.SALA_GENTLE_AGENT_DIR || path.join(os.homedir(), '.gentle-shell', 'agent');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// The body the kit would install now: its agent with the kit's own path filled in.
function kitAgents() {
  return fs.readdirSync(KIT_AGENTS).filter((f) => f.endsWith('.md')).sort().map((file) => ({
    name: file.slice(0, -3),
    file,
    body: fs.readFileSync(path.join(KIT_AGENTS, file), 'utf8').replaceAll('{{KIT}}', KIT_DIR.replaceAll('\\', '/')),
  }));
}

// What the installed copy is, compared with the body the kit would install now:
// falta, al-dia, vieja (an older kit wrote it), editada (its mark no longer matches) or ajena.
function copyState(target, body) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (err) {
    if (err.code === 'ENOENT') return 'falta';
    throw err;
  }
  if (!stat.isFile()) return 'ajena';
  const text = fs.readFileSync(target, 'utf8');
  const at = text.lastIndexOf(MARK);
  if (at === -1) return 'ajena';
  const mark = MARK_RE.exec(text.slice(at));
  if (!mark) return 'editada';
  const installed = text.slice(0, at);
  if (sha256(installed) !== mark[2]) return 'editada';
  return installed === body ? 'al-dia' : 'vieja';
}

const FIX = { falta: 'sala instalar', vieja: 'sala instalar', editada: 'sala instalar --forzar', ajena: 'sala instalar --forzar', 'al-dia': null };

function writeCopy(target, body) {
  const tmp = `${target}.sala-${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${body}${MARK}${version} sha256 ${sha256(body)} -->\n`);
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

function instalar({ forzar = false } = {}) {
  const agentDir = gentleAgentDir();
  if (!fs.existsSync(agentDir)) throw new SalaError(`no está Gentle Shell: falta ${agentDir}; instalalo antes de sala instalar`);
  const dir = path.join(agentDir, 'agents');
  fs.mkdirSync(dir, { recursive: true });
  const agents = kitAgents().map(({ name, file, body }) => {
    const target = path.join(dir, file);
    const found = copyState(target, body);
    if (found === 'al-dia') return { name, state: 'al-dia' };
    if ((found === 'editada' || found === 'ajena') && !forzar) {
      return { name, state: found, fix: FIX[found] };
    }
    // A link is never followed: it is removed and a file is written in its place.
    if (found === 'ajena') fs.rmSync(target, { force: true });
    writeCopy(target, body);
    const done = { falta: 'instalado', vieja: 'actualizado' };
    return { name, state: done[found] || 'forzado' };
  });
  return { schema: OUTPUT_SCHEMA, version, dir, ok: agents.every((a) => !a.fix), agents };
}

// For sala revisar: only reads. Without Gentle Shell there is nothing to warn about.
function agentWarnings() {
  const dir = path.join(gentleAgentDir(), 'agents');
  return kitAgents().map(({ name, file, body }) => {
    if (!fs.existsSync(gentleAgentDir())) return { name, state: 'sin-gentle-shell', fix: null };
    const found = copyState(path.join(dir, file), body);
    return { name, state: found, fix: FIX[found] };
  });
}

const WARNING = {
  falta: (n) => `el agente ${n} no está instalado`,
  vieja: (n) => `el agente ${n} instalado es de una versión vieja del kit`,
  editada: (n) => `el agente ${n} instalado fue editado`,
  ajena: (n) => `hay un agente ${n} que no instaló el kit`,
};

function agentWarningText(agent) {
  return `${WARNING[agent.state](agent.name)}; orden: ${agent.fix}`;
}

const LABEL = {
  instalado: 'instalado',
  actualizado: 'actualizado',
  forzado: 'reemplazado (--forzar)',
  'al-dia': 'al día',
  editada: 'no se tocó: fue editado',
  ajena: 'no se tocó: no lo instaló el kit',
};

function instalarTexto(result) {
  const lines = [`Agentes del kit ${result.version} en ${result.dir}`];
  for (const a of result.agents) lines.push(`  ${a.name}: ${LABEL[a.state]}${a.fix ? `; orden: ${a.fix}` : ''}`);
  return `${lines.join('\n')}\n`;
}

module.exports = { instalar, instalarTexto, agentWarnings, agentWarningText };
