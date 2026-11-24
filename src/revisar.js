'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { run, gitError } = require('./run');
const { ConfigError } = require('./config');
const { memberRequirements, oldBlocks, strayWarnings, noSecrets, REQUIREMENT_IDS } = require('./requisitos');
const { agentWarnings, agentWarningText } = require('./instalar');
const { contractCheck, contractText } = require('./contrato');

const OUTPUT_SCHEMA = 1;

function unchecked(reason) {
  return REQUIREMENT_IDS.slice(1).map((id) => ({ id, ok: null, detail: `sin comprobar: ${reason}`, fix: null }));
}

// The base and its remote come first: the other requirements read the remote base.
async function baseRemote(member) {
  const { path: dir, base, remote } = member;
  const where = `${remote}/${base}`;
  const fail = (detail, fix) => ({ ok: false, check: { id: 'base-remote', ok: false, detail, fix } });
  if (!fs.existsSync(dir)) return fail(`la carpeta no existe: ${dir}`, 'Corregí members[].path en sala.json o cloná el repositorio en esa ruta.');
  const git = (...args) => run('git', args, { cwd: dir });
  // Only the exit code of get-url is used: the URL itself may carry credentials.
  if ((await git('remote', 'get-url', remote)).code !== 0) {
    return fail(`el repositorio no tiene el remoto ${remote}`, `Agregá el remoto ${remote} (git remote add ${remote} <url>) o corregí members[].remote en sala.json.`);
  }
  const fetchBase = () => git('fetch', '--quiet', '--no-tags', remote, base);
  let fetch = await fetchBase();
  // A missing branch is a requirement that fails. Anything else (the network, the host) is
  // retried once and then reported as unread, never as failing (SK31).
  const missing = () => /couldn't find remote ref/i.test(fetch.stderr);
  if (fetch.code !== 0 && !missing()) fetch = await fetchBase();
  if (fetch.code !== 0 && missing()) {
    return fail(`no se pudo traer ${where}: ${gitError(fetch.stderr)}`, `Subí la rama base (git push -u ${remote} ${base}) o corregí members[].base en sala.json.`);
  }
  if (fetch.code !== 0) {
    return { ok: null, check: { id: 'base-remote', ok: null, detail: `no se pudo leer la base remota ${where}: ${gitError(fetch.stderr)}`, fix: null } };
  }
  return { ok: true, check: { id: 'base-remote', ok: true, detail: `${where} existe`, fix: null } };
}

async function readFile(dir, ref, file) {
  const res = await run('git', ['show', `${ref}:${file}`], { cwd: dir });
  return res.code === 0 ? res.stdout : null;
}

async function reviewMember(member, sala) {
  const where = `${member.remote}/${member.base}`;
  const base = await baseRemote(member);
  if (base.ok !== true) return { id: member.id, ok: base.ok, requirements: [base.check, ...unchecked(`no se pudo leer ${where}`)], warnings: [] };
  const ref = `refs/remotes/${where}`;
  const [roadmap, agents] = await Promise.all([
    readFile(member.path, ref, 'docs/ROADMAP.md'),
    readFile(member.path, ref, 'AGENTS.md'),
  ]);
  const requirements = [base.check, ...memberRequirements({ roadmap, agents }, where, sala)];
  return { id: member.id, ok: requirements.every((r) => r.ok === true), requirements, warnings: [...strayWarnings(roadmap), ...oldBlocks(agents)] };
}

async function revisar(config, salaDir, only) {
  let members = config.members;
  if (only) {
    members = members.filter((m) => m.id === only);
    if (members.length === 0) throw new ConfigError(`no hay un miembro «${only}» en sala.json`);
  }
  const salaText = fs.readFileSync(path.join(salaDir, 'sala.json'), 'utf8');
  const sala = [noSecrets([['sala.json', salaText]])];
  const [gentleShell, reviewed] = await Promise.all([contractCheck(), Promise.all(members.map((m) => reviewMember(m, config.name)))]);
  return {
    schema: OUTPUT_SCHEMA,
    sala: config.name,
    salaJson: { ok: sala.every((r) => r.ok), requirements: sala },
    // The kit's agents in this machine's Gentle Shell (D34): warnings, never a requirement.
    // The Gentle Shell and feed the kit was tested with (D47): warnings, never a requirement.
    kit: { agents: agentWarnings(), gentleShell },
    members: reviewed,
  };
}

function block(lines, label, requirements, warnings = []) {
  if (requirements[0].id === 'base-remote' && requirements[0].ok === null) {
    lines.push(`${label}: ${requirements[0].detail.replace(/: [\s\S]*$/, '')}; volvé a correr sala revisar`);
    return;
  }
  const passed = requirements.filter((r) => r.ok === true).length;
  lines.push(`${label}: cumple ${passed}/${requirements.length}`);
  for (const r of requirements.filter((x) => x.ok !== true)) {
    lines.push(`  ${r.id}: ${r.detail}`);
    if (r.fix) lines.push(`    orden: ${r.fix}`);
  }
  for (const w of warnings) lines.push(`  aviso: ${w}`);
}

function revisarTexto(result) {
  const lines = [`Sala ${result.sala}`];
  block(lines, 'sala.json', result.salaJson.requirements);
  for (const a of result.kit.agents.filter((x) => x.fix)) lines.push(`  aviso: ${agentWarningText(a)}`);
  lines.push(...contractText(result.kit.gentleShell));
  for (const m of result.members) block(lines, m.id, m.requirements, m.warnings);
  return `${lines.join('\n')}\n`;
}

module.exports = { revisar, revisarTexto, reviewMember };
