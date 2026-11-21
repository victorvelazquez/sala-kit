'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { run, gitError } = require('./run');
const { ConfigError } = require('./config');
const { memberRequirements, oldBlocks, noSecrets, REQUIREMENT_IDS } = require('./requisitos');

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
  const fetch = await git('fetch', '--quiet', '--no-tags', remote, base);
  if (fetch.code !== 0) {
    return fail(`no se pudo traer ${where}: ${gitError(fetch.stderr)}`, `Subí la rama base (git push -u ${remote} ${base}) o corregí members[].base en sala.json.`);
  }
  return { ok: true, check: { id: 'base-remote', ok: true, detail: `${where} existe`, fix: null } };
}

async function readFile(dir, ref, file) {
  const res = await run('git', ['show', `${ref}:${file}`], { cwd: dir });
  return res.code === 0 ? res.stdout : null;
}

async function reviewMember(member) {
  const where = `${member.remote}/${member.base}`;
  const base = await baseRemote(member);
  if (!base.ok) return { id: member.id, ok: false, requirements: [base.check, ...unchecked(`no se pudo leer ${where}`)], warnings: [] };
  const ref = `refs/remotes/${where}`;
  const [roadmap, agents] = await Promise.all([
    readFile(member.path, ref, 'docs/ROADMAP.md'),
    readFile(member.path, ref, 'AGENTS.md'),
  ]);
  const requirements = [base.check, ...memberRequirements({ roadmap, agents }, where)];
  return { id: member.id, ok: requirements.every((r) => r.ok === true), requirements, warnings: oldBlocks(agents) };
}

async function revisar(config, salaDir, only) {
  let members = config.members;
  if (only) {
    members = members.filter((m) => m.id === only);
    if (members.length === 0) throw new ConfigError(`no hay un miembro «${only}» en sala.json`);
  }
  const salaText = fs.readFileSync(path.join(salaDir, 'sala.json'), 'utf8');
  const sala = [noSecrets([['sala.json', salaText]])];
  return {
    schema: OUTPUT_SCHEMA,
    sala: config.name,
    salaJson: { ok: sala.every((r) => r.ok), requirements: sala },
    members: await Promise.all(members.map(reviewMember)),
  };
}

function block(lines, label, requirements, warnings = []) {
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
  for (const m of result.members) block(lines, m.id, m.requirements, m.warnings);
  return `${lines.join('\n')}\n`;
}

module.exports = { revisar, revisarTexto, reviewMember };
