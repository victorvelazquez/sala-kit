'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./helpers');
const { readFeed, FEED_SCHEMA } = require('../src/feed');

const CONTRACT = path.join(__dirname, '..', 'contrato');
const tested = JSON.parse(fs.readFileSync(path.join(CONTRACT, 'gentle-shell.json'), 'utf8'));

// The sample snapshots of the tested feed, placed in a live session of a member.
test('the sample snapshots of the tested feed read as the states the kit expects', (t) => {
  const dir = tempDir(t);
  const member = path.join(dir, 'ejemplo');
  const sessions = path.join(dir, 'agent', 'desktop', 'sessions');
  fs.mkdirSync(path.join(member, 'src'), { recursive: true });
  fs.mkdirSync(sessions, { recursive: true });
  const samples = path.join(CONTRACT, 'feed-v1');
  for (const file of fs.readdirSync(samples)) {
    const snap = JSON.parse(fs.readFileSync(path.join(samples, file), 'utf8'));
    const cwd = path.join(member, ...snap.identity.cwd.split('\\').slice(3));
    snap.identity = { ...snap.identity, cwd, realCwd: cwd, pid: process.pid };
    fs.writeFileSync(path.join(sessions, file), JSON.stringify(snap));
  }

  const { sessions: found, warnings } = readFeed([path.join(dir, 'agent')], [{ id: 'ejemplo', path: member }]);

  assert.equal(tested.feed, FEED_SCHEMA);
  assert.deepEqual(warnings, []);
  const byId = Object.fromEntries(found.ejemplo.map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(byId).sort(), ['muestra-esperando', 'muestra-libre', 'muestra-pregunta', 'muestra-trabajando']);
  assert.deepEqual(byId['muestra-libre'], { id: 'muestra-libre', mode: 'tui', state: 'idle', label: 'Idle', question: null, context: 12, cost: 0.31 });
  assert.equal(byId['muestra-trabajando'].state, 'working');
  assert.equal(byId['muestra-esperando'].state, 'waiting');
  assert.deepEqual(byId['muestra-pregunta'].question, {
    kind: 'choice', text: '¿Arranco la tarea?', options: ['Empezar', 'Cancelar'], terminalOnly: false, toolCallId: 'call-muestra-1',
  });
  assert.equal(byId['muestra-pregunta'].state, 'needs-you');
});
