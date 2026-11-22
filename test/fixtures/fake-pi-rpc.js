'use strict';

// Plays `gentle-shell --mode rpc` for the host tests: JSONL on stdin and stdout.
// A prompt with «pregunta» asks two questions in a row (one select each, as SK7a measured),
// one with «consent» asks a review consent, and one with «confirmá» a confirm. Every record
// it receives goes to FAKE_PI_LOG, with its cwd and GENTLE_SHELL_INTERACTIVE_HOST first.

const fs = require('node:fs');

const logFile = process.env.FAKE_PI_LOG;
const note = (record) => fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`);
const out = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);

note({ started: true, cwd: process.cwd(), host: process.env.GENTLE_SHELL_INTERACTIVE_HOST || null, pid: process.pid });

let waiting = null;
let asked = 0;

function ask(id, method, extra) {
  // Noise that expects no answer comes before and after every dialog.
  out({ type: 'extension_ui_request', id: `n-${id}`, method: 'setStatus', statusKey: 'x', statusText: 'pensando' });
  out({ type: 'extension_ui_request', id, method, ...extra });
  out({ type: 'extension_ui_request', id: `w-${id}`, method: 'notify', message: 'listo', notifyType: 'info' });
}

function settle() {
  out({ type: 'agent_end' });
  out({ type: 'agent_settled', aborted: false });
}

function handle(record) {
  note(record);
  if (record.type === 'prompt') {
    out({ id: record.id, type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } });
    out({ type: 'agent_start' });
    const text = String(record.message);
    if (text.includes('pregunta')) {
      waiting = 'parts';
      asked = 0;
      ask('q-1', 'select', { title: '1. ¿Qué rama?\u2028(la base)', options: ['main', 'dev', 'Type something.'] });
    } else if (text.includes('consent')) {
      waiting = 'consent';
      ask('c-1', 'select', {
        title: 'Review this change?\u001b[2K\nReason: high risk\nRisk: item 2\nOwnership: provider',
        options: ['1. Review it — granted', '2. Skip it — declined', '3. Allow for this session'],
      });
    } else if (text.includes('confirmá')) {
      waiting = 'confirm';
      ask('k-1', 'confirm', { title: '¿Borro el caché?', message: 'Se rehace solo.' });
    } else {
      settle();
    }
    return;
  }
  if (record.type === 'extension_ui_response' && waiting === 'parts') {
    asked += 1;
    if (asked === 1) ask('q-2', 'select', { title: '2. ¿Con pruebas?', options: ['Sí', 'No'] });
    else {
      waiting = null;
      settle();
    }
    return;
  }
  if (record.type === 'extension_ui_response') {
    waiting = null;
    settle();
    return;
  }
  if (record.id) out({ id: record.id, type: 'response', command: record.type, success: false, error: 'unknown' });
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
process.stdin.on('end', () => {
  note({ ended: true });
  process.exit(0);
});
