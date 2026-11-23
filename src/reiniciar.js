'use strict';

// sala reiniciar (D29) and sala modelo (D28). A member gets a clean session per unit:
// the sala closes the Orca terminal it opened and opens a new one, only when nothing can
// be lost. The sala's own session takes the profile of options.roomModel, for that
// session only, by the feed's apply_profile; a confirmation is always the person's.

const { readFeed, sendAction, feedRoots } = require('./feed');
const { LAUNCHERS } = require('./launcher');
const { findMember, SalaError, openMember, adoptSession, readState, takeLock, liveSessions } = require('./abrir');
const { onlySession, paused, logOrder } = require('./enviar');
const { veredicto } = require('./veredicto');
const { mask } = require('./requisitos');

const HANDLE = /^term_[A-Za-z0-9_-]+$/;
// Never a member id (config ids start with a letter or digit): the key of the sala's own sessions.
const SALA_KEY = '.sala';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Only an Orca terminal the sala recorded can be closed: wt has no handle, and anything
// else is a terminal of the person.
function ownTerminal(record) {
  return Boolean(record && record.launcher === 'orca' && typeof record.handle === 'string' && HANDLE.test(record.handle));
}

// The live session is the one the sala opened, and it is free: no work, no agents, no question.
function checkClosable(config, member, record) {
  const { session, target } = onlySession(config, member);
  const no = (why) => new SalaError(`${member.id}: ${why}; no la cierra`);
  if (session.id !== record.session) throw no(`la sesión viva ${session.id} no es la que abrió la sala`);
  if (session.state === 'needs-you' || session.question) throw no(`la sesión ${session.id} te necesita`);
  if (session.state === 'working') throw no(`la sesión ${session.id} está trabajando`);
  if (session.state === 'waiting') throw no(`la sesión ${session.id} espera a sus agentes o trabajos`);
  // The feed reads an unknown state as idle; a close takes only a session that says idle.
  if (target.activity !== 'idle') throw no(`la sesión ${session.id} no dice que esté libre`);
  return session;
}

async function waitUntilGone(member, sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!liveSessions(member).some((s) => s.id === sessionId)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(Math.min(100, timeoutMs));
  }
}

async function reiniciar(config, salaDir, id) {
  const member = findMember(config, id);
  if (paused(salaDir)) throw new SalaError('la sala está en pausa (.sala/PAUSA): no cierra ni abre sesiones');
  let record = readState(salaDir).members[id];
  if (!ownTerminal(record)) throw new SalaError(`${id}: la sala no abrió una terminal de Orca para este miembro; no cierra nada`);
  // A first abrir that gave up left no session: it is taken only by the rule of adoptSession.
  if (record.session === null) {
    const release = takeLock(salaDir);
    let refused;
    try {
      ({ refused } = await adoptSession(salaDir, member));
    } finally {
      release();
    }
    if (refused) throw new SalaError(`${id}: la sesión de la terminal ${record.handle} no está anotada y la sala no la toma como suya (${refused}); no la cierra`);
    record = readState(salaDir).members[id];
  }
  checkClosable(config, member, record);
  // The task is merged and nothing is left in the tree: the member is back on its clean base.
  const gate = await veredicto(config, id, 'base');
  if (!gate.ok) {
    const why = gate.checks.filter((c) => !c.ok).map((c) => c.detail).join('; ');
    throw new SalaError(`${id}: la tarea no está fusionada o el árbol no está limpio (${why}); no la cierra`);
  }
  const open = await LAUNCHERS.orca.terminals();
  if (!open) throw new SalaError(`${id}: Orca no responde; no la cierra`);
  if (!open.includes(record.handle)) throw new SalaError(`${id}: la terminal ${record.handle} ya no está en Orca; no la cierra`);

  const release = takeLock(salaDir);
  try {
    // The gate took a while: the pause and the session are checked again right before closing.
    if (paused(salaDir)) throw new SalaError('la sala está en pausa (.sala/PAUSA): no cierra ni abre sesiones');
    const session = checkClosable(config, member, record);
    const closed = await LAUNCHERS.orca.close(record);
    if (!closed.ok) throw new SalaError(`${id}: ${closed.error}`);
    const timeoutMs = Number(process.env.SALA_CLOSE_TIMEOUT_MS) || 15000;
    if (!(await waitUntilGone(member, session.id, timeoutMs))) {
      throw new SalaError(`${id}: Orca cerró la terminal ${record.handle}, pero la sesión ${session.id} sigue viva; no se abre otra`);
    }
    let opened;
    try {
      opened = await openMember(config, salaDir, member, LAUNCHERS.orca);
    } catch (err) {
      throw new SalaError(`${id}: la terminal ${record.handle} ya se cerró, pero no se pudo abrir otra (${err.message}); corré sala abrir ${id}`);
    }
    // A session that showed up meanwhile is not the sala's: it gets no order.
    if (opened.action === 'reused') {
      throw new SalaError(`${id}: la terminal ${record.handle} ya se cerró, pero apareció otra sesión (${opened.session}) que no abrió la sala; no se abre otra ni se le manda nada`);
    }
    return { member: id, closed: record.handle, launcher: opened.launcher, handle: opened.handle, session: opened.session };
  } finally {
    release();
  }
}

function reiniciarTexto(r) {
  return `${r.member}: cerrada la terminal ${r.closed}; sesión nueva ${r.session} en ${r.handle}\n`;
}

async function modelo(config, salaDir) {
  const name = config.options.roomModel;
  if (typeof name !== 'string' || name.trim() === '') throw new SalaError('options.roomModel no nombra un perfil; no hay nada que aplicar');
  // The members are read too, so a member folder inside the sala keeps its own sessions.
  const feed = readFeed(feedRoots(), [...config.members, { id: SALA_KEY, path: salaDir }]);
  const sessions = feed.sessions[SALA_KEY];
  if (sessions.length === 0) throw new SalaError('la sala no tiene una sesión viva de Gentle Shell');
  if (sessions.length > 1) {
    throw new SalaError(`la sala tiene ${sessions.length} sesiones vivas (${sessions.map((s) => s.id).join(', ')}); dejá una sola`);
  }
  const [session] = sessions;
  const shown = mask(name);
  const timeoutMs = Number(process.env.SALA_SEND_TIMEOUT_MS) || 10000;
  const res = await sendAction(feed.targets[SALA_KEY][0], 'apply_profile', { name }, { timeoutMs });
  const status = res.ok && res.data && typeof res.data === 'object' ? res.data.status : null;
  logOrder(salaDir, { member: 'sala', session: session.id, text: `apply_profile ${name}`, result: res.ok ? String(status) : res.error.code });
  if (!res.ok) throw new SalaError(`la sesión no aplicó el perfil: ${res.error.message} (${res.error.code})`);
  if (status === 'confirmation_required') {
    throw new SalaError(`el perfil ${shown} pide una confirmación; aplicalo vos con /gentle:profiles en la terminal de la sala`);
  }
  if (status !== 'applied') throw new SalaError(`Gentle Shell no aplicó el perfil ${shown}`);
  return { sala: config.name, session: session.id, profile: shown, status };
}

function modeloTexto(r) {
  return `Sala ${r.sala}: el perfil ${r.profile} quedó solo en la sesión ${r.session}\n`;
}

module.exports = { reiniciar, reiniciarTexto, modelo, modeloTexto, ownTerminal };
