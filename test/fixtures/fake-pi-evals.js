'use strict';

// Plays `gentle-shell --mode rpc` for the evals tests. It answers every prompt with
// «ECO: <message>» at a cost of 0.01, unless the message carries directives:
// [[costo=N veces=M]] sends M answers of cost N, [[colgar]] never settles and
// [[pregunta]] opens a select dialog and [[bash]] runs read and then bash. Its argv, cwd, whether sala.json is there and every record go to FAKE_PI_LOG.

const fs = require('node:fs');

const logFile = process.env.FAKE_PI_LOG;
const note = (record) => fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`);
const out = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);

note({ argv: process.argv.slice(2), cwd: process.cwd(), sala: fs.existsSync('sala.json') });

function answer(text, cost) {
  const message = { role: 'assistant', content: [{ type: 'text', text }], usage: { totalTokens: 10, cost: { total: cost } } };
  out({ type: 'message_start', message: { role: 'assistant', content: [] } });
  out({ type: 'message_end', message });
  out({ type: 'turn_end', message, toolResults: [] });
}

function handle(record) {
  note(record);
  if (record.type !== 'prompt') return;
  out({ id: record.id, type: 'response', command: 'prompt', success: true });
  out({ type: 'agent_start' });
  const text = String(record.message);
  if (text.includes('[[pregunta]]')) {
    out({ type: 'extension_ui_request', id: 'n-1', method: 'setStatus', statusKey: 'x', statusText: 'pensando' });
    out({ type: 'extension_ui_request', id: 'q-1', method: 'select', title: '¿Fusiono el PR 12?', options: ['sí', 'no'] });
    return;
  }
  if (text.includes('[[bash]]')) {
    for (const toolName of ['read', 'bash']) out({ type: 'tool_execution_start', toolCallId: toolName, toolName, args: {} });
  }
  const cost = Number((text.match(/costo=([\d.]+)/) || [])[1] ?? 0.01);
  const times = Number((text.match(/veces=(\d+)/) || [])[1] ?? 1);
  for (let i = 0; i < times; i += 1) answer(`ECO: ${text}`, cost);
  if (text.includes('[[colgar]]')) return;
  out({ type: 'agent_end', messages: [] });
  out({ type: 'agent_settled', aborted: false });
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
process.stdin.on('end', () => process.exit(0));
