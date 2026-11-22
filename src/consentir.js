'use strict';

// sala consentir (D48, SK7c): the consent a hosted session asked for, given by the person.
// It runs only in an interactive terminal and takes the answer typed there, never from an
// argument: the bash of the sala's model has no terminal, so the model cannot give it.
// The host checks the rest (that it is a consent and that the answer is one of its options).

const { findMember, SalaError } = require('./abrir');
const { logOrder } = require('./enviar');
const { hostCall, pipePath } = require('./hospedar');
const { mask } = require('./requisitos');

// What the person typed is echoed masked and without control characters.
const shown = (text) => mask(text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')).slice(0, 20);

// One line typed by the person; what comes after the first LF is left alone.
function readLine(input) {
  return new Promise((resolve) => {
    let data = '';
    const done = (line) => {
      input.off('data', onData);
      input.off('end', onEnd);
      input.pause();
      resolve(line);
    };
    const onData = (chunk) => {
      data += chunk;
      const at = data.indexOf('\n');
      if (at >= 0) done(data.slice(0, at).replace(/\r$/, ''));
    };
    const onEnd = () => done(data);
    input.setEncoding('utf8');
    input.on('data', onData);
    input.on('end', onEnd);
    input.resume();
  });
}

// What pi wrote reaches the person's terminal without control characters, so it cannot
// redraw the screen and move an option to another number; the text keeps its line breaks.
const screen = (text) => String(text).replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ');

async function consentir(config, salaDir, id, { input = process.stdin, output = process.stdout, answerArg = false } = {}) {
  const log = (text, question) => logOrder(salaDir, { member: id, session: 'rpc', ...(question ? { question } : {}), text, result: 'refused', via: 'rpc' });
  if (answerArg) {
    log('(consentir con la respuesta como argumento)');
    throw new SalaError('sala consentir no lleva la respuesta como argumento: la tipea la persona en la terminal');
  }
  const member = findMember(config, id);
  const refuse = (text, reason, question) => {
    log(text, question);
    return new SalaError(`${member.id}: ${reason}`);
  };
  if (!input.isTTY || !output.isTTY) {
    throw refuse('(consentir sin terminal)', 'sala consentir se corre en una terminal interactiva: la respuesta la tipea la persona en ese momento');
  }
  const pipe = pipePath(config, salaDir, member.id);
  const status = await hostCall(pipe, { action: 'status' });
  if (!status || !status.ok) throw new SalaError(`${member.id}: no tiene una sesión hospedada`);
  const dialog = status.dialogs.find((d) => d.class === 'consent');
  if (!dialog) throw new SalaError(`${member.id}: la sesión hospedada no tiene un consentimiento abierto`);

  // The dialog comes from the host already masked and clipped.
  output.write(`${member.id} pide un consentimiento (pregunta ${screen(dialog.id)}):\n${screen(dialog.text)}\n`);
  output.write(`${dialog.options.map((o, i) => `  [${i + 1}] ${screen(o).replace(/\n/g, ' ')}`).join('\n')}\n`);
  output.write('Escribí el número de la opción y Enter (Enter solo: no contestar): ');
  const typed = (await readLine(input)).trim();
  if (typed === '') throw refuse('(sin respuesta)', 'no se contestó el consentimiento', dialog.id);
  const n = /^\d{1,3}$/.test(typed) ? Number(typed) : 0;
  if (n < 1 || n > dialog.options.length) {
    throw refuse(typed, `«${shown(typed)}» no es el número de una opción (1 a ${dialog.options.length})`, dialog.id);
  }

  // The host logs what it gives or refuses.
  const res = await hostCall(pipe, { action: 'consent', dialog: dialog.id, value: dialog.options[n - 1], tty: true });
  if (!res) throw new SalaError(`${member.id}: la sesión hospedada se cerró`);
  if (!res.ok) throw new SalaError(`${member.id}: ${res.error}`);
  return { member: member.id, session: 'rpc', question: dialog.id, option: res.option, consented: true };
}

function consentirTexto(r) {
  return `${r.member}: consentimiento «${r.option}» entregado a la pregunta ${r.question} (sesión hospedada)\n`;
}

module.exports = { consentir, consentirTexto };
