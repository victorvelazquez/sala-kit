'use strict';

// sala proximo (SK32): the next step of each member and the exact command, read from what the
// kit already knows (git, gh, the feed and the plan), without a model. It never sends anything.

const { run, redact } = require('./run');
const { estado, ghCommand } = require('./estado');
const { plan } = require('./plan');
const { orderMismatch, TITLE_ID } = require('./veredicto');

const OUTPUT_SCHEMA = 1;

const commits = (n) => `${n} ${n === 1 ? 'commit' : 'commits'}`;
const step = (id, name, detail, command = null) => ({ id, step: name, detail, command });

// A branch whose pull request was merged already: it goes back to the base, not to a delivery.
async function mergedPr(dir, branch) {
  const [file, args] = ghCommand(['pr', 'list', '--state', 'merged', '--head', branch, '--limit', '1', '--json', 'number']);
  const res = await run(file, args, { cwd: dir });
  if (res.code !== 0) return null;
  try {
    const [pr] = JSON.parse(res.stdout);
    return pr && Number.isInteger(pr.number) ? pr.number : null;
  } catch {
    return null;
  }
}

async function nextStep(m, planned, salaDir, member) {
  const { id } = m;
  if (m.branch === undefined) return step(id, 'revisar', m.gate.reasons.join('; '));
  const sessions = m.sessions || [];
  if (sessions.length === 0) return step(id, 'abrir', 'no tiene una sesión viva', `sala abrir ${id}`);
  if (sessions.length > 1) return step(id, 'una-sesion', `tiene ${sessions.length} sesiones vivas (${sessions.map((s) => s.id).join(', ')}); dejá una sola`);
  const [s] = sessions;
  if (s.state === 'needs-you') {
    return s.question
      ? step(id, 'contestar', `te pregunta: «${s.question.text}»`, 'sala preguntas')
      : step(id, 'contestar', 'la sesión está bloqueada: mirala', `sala mostrar ${id}`);
  }
  if (s.state === 'working') return step(id, 'esperar', 'está trabajando', `sala esperar ${id}`);
  if (s.state === 'waiting') return step(id, 'esperar', 'espera a sus agentes o trabajos', `sala esperar ${id}`);

  if (!m.clean) return step(id, 'entregar', 'tiene cambios sin commit', `/sala-entregar ${id}`);
  if (!m.branch) return step(id, 'revisar', `HEAD suelto, no está en la base ${m.base}`);
  if (m.branch !== m.base) {
    if (!m.prs) return step(id, 'revisar', `no se pudieron leer los PR (${m.prsError})`);
    const pr = m.prs.find((p) => p.branch === m.branch);
    if (pr) {
      if (pr.draft) return step(id, 'ci', `el PR #${pr.number} es un borrador`);
      if (pr.ci === 'pending') return step(id, 'ci', `el CI del PR #${pr.number} está corriendo`);
      if (pr.ci === 'failing') return step(id, 'ci', `el CI del PR #${pr.number} está en rojo: hay que corregirlo`);
      // A PR of a task the sala did not ask for is never offered to merge (SK32b).
      const task = TITLE_ID.exec(String(pr.title));
      const why = task && member ? orderMismatch(salaDir, member, task[1].trim()) : null;
      if (why) return step(id, 'revisar', `el PR #${pr.number} ${why}: no se fusiona`);
      return step(id, 'fusionar', `el PR #${pr.number} «${pr.title}» tiene el CI en verde`, `/sala-fusionar ${id} ${pr.number}`);
    }
    const merged = await mergedPr(m.path, m.branch);
    if (merged !== null) {
      return step(id, 'base', `el PR #${merged} de la rama ${redact(m.branch)} ya se fusionó`, `sala enviar ${id} "/miembro-base ${m.base}"`);
    }
    return step(id, 'entregar', `está en la rama ${redact(m.branch)} sin PR abierto`, `/sala-entregar ${id}`);
  }

  if (!m.fetch.ok) return step(id, 'revisar', `no se pudo traer ${m.remote}/${m.base}: ${m.fetch.error}`);
  if (m.stash > 0) return step(id, 'revisar', `hay ${m.stash} stash en la base`);
  if (m.ahead > 0) return step(id, 'revisar', `${m.base} tiene ${commits(m.ahead)} sin subir a ${m.remote}/${m.base}`);
  if (m.behind > 0) return step(id, 'base', `${m.base} está ${commits(m.behind)} detrás de ${m.remote}/${m.base}`, `sala enviar ${id} "/miembro-base ${m.base}"`);
  if (planned && planned.next) return step(id, 'tarea', `su tarea siguiente es ${planned.next.id}`, `/sala-seguir ${id}`);
  if (planned && planned.error) return step(id, 'revisar', `no se pudo leer su roadmap (${planned.error})`);
  return step(id, 'libre', 'no tiene una tarea lista en su roadmap');
}

async function proximo(config, salaDir) {
  // One after the other: both fetch the base of each member, and two fetches of the same
  // repo at once race on its remote ref.
  const state = await estado(config);
  const planned = await plan(config);
  const byId = new Map(planned.members.map((p) => [p.id, p]));
  const members = await Promise.all(state.members.map((m) => nextStep(m, byId.get(m.id), salaDir, config.members.find((c) => c.id === m.id))));
  return { schema: OUTPUT_SCHEMA, sala: config.name, members };
}

function proximoTexto(r) {
  const idWidth = Math.max(0, ...r.members.map((m) => m.id.length));
  const stepWidth = Math.max(0, ...r.members.map((m) => m.step.length));
  const lines = [`Sala ${r.sala}: el paso siguiente de cada miembro`];
  for (const m of r.members) {
    lines.push(`  ${m.id.padEnd(idWidth)}  ${m.step.padEnd(stepWidth)} ${m.detail}${m.command ? ` → ${m.command}` : ''}`);
  }
  if (r.members.length === 0) lines.push('  la sala no tiene miembros');
  return `${lines.join('\n')}\n`;
}

module.exports = { proximo, proximoTexto };
