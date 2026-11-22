'use strict';

// sala preguntas and sala responder (D17, D49): the sala shows every open question
// of its members, and delivers through the inbox only the person's option to a
// one-option question. Consents and terminal questions are answered in the member's tab.

const { readFeed, sendAction, feedRoots, CONSENT, bare } = require('./feed');
const { findMember, mostrar, SalaError } = require('./abrir');
const { logOrder } = require('./enviar');
const { mask } = require('./requisitos');
const { hostCall, pipePath } = require('./hospedar');

const QUESTION_ID = /^[A-Za-z0-9_-]{1,128}$/;
// What came from the arguments is echoed masked and without control characters.
const shown = (text) => mask(String(text).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')).slice(0, 200);

// option: the sala delivers it; consent and terminal: the person answers in the tab.
// An unknown kind is answered in the tab.
function questionClass(raw) {
  if (/consent/i.test(raw.kind) || raw.options.some((o) => CONSENT.includes(bare(o)))) return 'consent';
  const option = raw.kind === 'choice' && !raw.terminalOnly && raw.id && raw.options.length > 0;
  return option ? 'option' : 'terminal';
}

// The open dialogs of the hosted members, asked to each host (D51).
async function hostedDialogs(config, salaDir) {
  const all = await Promise.all(config.members.map((m) => hostCall(pipePath(config, salaDir, m.id), { action: 'status' }).catch(() => null)));
  return Object.fromEntries(config.members.map((m, i) => [m.id, all[i] && all[i].ok ? all[i].dialogs : null]));
}

async function preguntas(config, salaDir) {
  const feed = readFeed(feedRoots(), config.members);
  const hosted = await hostedDialogs(config, salaDir);
  const questions = [];
  for (const m of config.members) {
    feed.sessions[m.id].forEach((s, i) => {
      const raw = feed.targets[m.id][i].question;
      // The hosted session's dialogs come from its host, not from its snapshot.
      if (!s.question || !raw || (hosted[m.id] && s.mode === 'rpc')) return;
      const { text, options } = s.question;
      questions.push({ member: m.id, session: s.id, id: raw.id && shown(raw.id), class: questionClass(raw), text, options });
    });
    for (const d of hosted[m.id] || []) {
      questions.push({ member: m.id, session: 'rpc', id: shown(d.id), class: d.class === 'consent' ? 'consent' : 'option', text: d.text, options: d.options });
    }
  }
  return { questions, warnings: feed.warnings };
}

function preguntasTexto(r) {
  const lines = r.questions.flatMap((q) => [
    `${q.member} (sesión ${q.session}, pregunta ${q.id || 'sin id'}): ${q.text}`,
    ...(q.options.length ? [`  opciones: ${q.options.join(' | ')}`] : []),
    q.class === 'option'
      ? `  se contesta desde la sala: sala responder ${q.member} ${q.options.length ? '<opción>' : '<texto>'} --pregunta ${q.id}`
      : q.session === 'rpc'
        ? '  es un consentimiento: el anfitrión lo retiene; lo da la persona con sala consentir (SK7c)'
        : `  ${q.class === 'consent' ? 'es un consentimiento: ' : ''}se contesta en la pestaña del miembro (sala mostrar ${q.member})`,
  ]);
  if (lines.length === 0) lines.push('ningún miembro tiene una pregunta abierta');
  return `${[...lines, ...r.warnings.map((w) => `aviso: ${w}`)].join('\n')}\n`;
}

// The question the person saw, still open in one of the member's sessions.
function openQuestion(config, id, questionId) {
  const feed = readFeed(feedRoots(), config.members);
  const i = feed.targets[id].findIndex((t) => t.question && t.question.id === questionId);
  if (i < 0) throw new SalaError(`${id}: la pregunta ${shown(questionId)} ya no está abierta; mirá sala preguntas`);
  return { session: feed.sessions[id][i], target: feed.targets[id][i] };
}

async function tabFor(config, salaDir, id) {
  try {
    const r = await mostrar(config, salaDir, id);
    return r.shown ? `se mostró la terminal «${r.title}» en Orca` : `en Windows Terminal, la pestaña «${r.title}»`;
  } catch (err) {
    return err.message.replace(`${id}: `, '');
  }
}

// D17: the sala never answers on its own. The answer has to name the question that
// sala preguntas showed and be one of its options; anything else goes nowhere.
async function responder(config, salaDir, id, answer, questionId) {
  const entry = { member: id, session: null, question: questionId ? shown(questionId) : null, text: answer };
  let found;
  let logged = false;
  let index = -1;
  try {
    findMember(config, id);
    if (!questionId) throw new SalaError('sala responder necesita --pregunta <id>, el que mostró sala preguntas');
    if (!QUESTION_ID.test(questionId)) throw new SalaError(`${id}: --pregunta no es un id de pregunta`);
    // A hosted member's dialog is answered by its host, which checks it (D51); a question it
    // does not have may still be one of a session in the feed.
    const hosted = await hostCall(pipePath(config, salaDir, id), { action: 'answer', dialog: questionId, value: answer });
    if (hosted && hosted.ok) return { member: id, session: 'rpc', question: shown(questionId), option: hosted.option, answered: true };
    if (hosted && hosted.code !== 'unknown-dialog') throw new SalaError(`${id}: ${hosted.error}`);
    found = openQuestion(config, id, questionId);
    entry.session = found.session.id;
    const raw = found.target.question;
    const kind = questionClass(raw);
    if (kind !== 'option') {
      logOrder(salaDir, { ...entry, result: 'terminal' });
      logged = true;
      const what = kind === 'consent' ? 'es un consentimiento' : 'se contesta en la terminal';
      const tab = await tabFor(config, salaDir, id);
      throw new SalaError(`${id}: la pregunta ${shown(questionId)} ${what}; contestala en la pestaña del miembro: ${tab}`);
    }
    index = raw.options.indexOf(answer.trim());
    if (index < 0) {
      throw new SalaError(`${id}: «${shown(answer)}» no es una opción de la pregunta ${shown(questionId)} (${found.session.question.options.join(', ')})`);
    }
  } catch (err) {
    if (!logged) logOrder(salaDir, { ...entry, result: 'refused' });
    throw err;
  }
  if (!logOrder(salaDir, { ...entry, result: 'answering' })) {
    throw new SalaError(`${id}: no se pudo anotar la respuesta en .sala/ordenes.log; no se mandó`);
  }
  const timeoutMs = Number(process.env.SALA_SEND_TIMEOUT_MS) || 10000;
  const res = await sendAction(found.target, 'answer_question', { toolCallId: questionId, option: index, via: 'session' }, { timeoutMs });
  logOrder(salaDir, { ...entry, result: res.ok ? 'answered' : res.error.code });
  if (!res.ok) throw new SalaError(`${id}: la sesión no aceptó la respuesta: ${res.error.message} (${res.error.code})`);
  return { member: id, session: entry.session, question: shown(questionId), option: shown(answer.trim()), answered: true };
}

function responderTexto(r) {
  return `${r.member}: respuesta «${r.option}» entregada a la pregunta ${r.question} (sesión ${r.session})\n`;
}

module.exports = { preguntas, preguntasTexto, responder, responderTexto };
