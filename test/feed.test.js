'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir, memberRepo, writeSala, salaConfig, runSala } = require('./helpers');
const { readFeed, sendAction } = require('../src/feed');

// A pid that no longer runs: a child that already exited.
function deadPid() {
  const res = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(res.stdout);
}

// A snapshot with the fields of gentle-shell.desktop-feed/v1 the kit reads.
function snapshot(agentDir, cwd, extra = {}) {
  return {
    schema: 'gentle-shell.desktop-feed/v1',
    identity: { sessionId: 's1', cwd, realCwd: cwd, pid: process.pid, mode: 'tui', agentDir },
    context: { percent: 42, tokens: 84000, window: 200000 },
    cost: { total: 1.25 },
    activity: { state: 'idle', label: 'Idle' },
    pendingQuestion: null,
    ...extra,
  };
}

function writeSnapshot(agentDir, name, data) {
  const dir = path.join(agentDir, 'desktop', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data));
}

function inboxOf(agentDir, name) {
  const dir = path.join(agentDir, 'desktop', 'inbox', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(agentDir, 'desktop', 'outbox', name), { recursive: true });
  return dir;
}

test('sala estado shows the live session of each member and which one needs the person', (t) => {
  const dir = tempDir(t);
  const core = memberRepo(dir, 'core');
  const web = memberRepo(dir, 'web');
  const agentDir = path.join(dir, 'agent');
  const token = `ghp_${'a'.repeat(36)}`;
  writeSnapshot(agentDir, 's1', snapshot(agentDir, core.work, {
    activity: { state: 'idle', label: 'Idle' },
    pendingQuestion: {
      kind: 'choice', toolCallId: 'call-1', question: `¿Uso ${token}?`, terminalOnly: false,
      options: [{ label: 'Sí', description: 'x' }, { label: 'No', description: 'y' }],
    },
  }));
  writeSnapshot(agentDir, 's2', snapshot(agentDir, path.join(web.work, 'src'), {
    identity: { sessionId: 's2', cwd: path.join(web.work, 'src'), pid: process.pid, mode: 'rpc', agentDir },
    activity: { state: 'waiting', label: 'Waiting on 2 agents' },
  }));
  writeSala(dir, salaConfig([
    { id: 'core', prefix: 'CORE', path: core.work, base: 'main' },
    { id: 'web', prefix: 'WEB', path: web.work, base: 'main' },
  ]));
  const env = { SALA_FEED_ROOTS: agentDir };

  const res = runSala(dir, ['estado'], env);

  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stderr, '');
  assert.ok(!res.stdout.includes(token), 'a secret in a question never reaches the JSON');
  const out = JSON.parse(res.stdout);
  assert.deepEqual(out.feed, { warnings: [] });
  const [c, w] = out.members;
  assert.deepEqual(c.sessions, [{
    id: 's1',
    mode: 'tui',
    state: 'needs-you',
    label: 'Idle',
    question: { kind: 'choice', text: '¿Uso [token de GitHub]?', options: ['Sí', 'No'], terminalOnly: false, toolCallId: 'call-1' },
    context: 42,
    cost: 1.25,
  }]);
  assert.equal(w.sessions[0].state, 'waiting');
  assert.equal(w.sessions[0].question, null);

  const texto = runSala(dir, ['estado', '--texto'], env);
  assert.equal(texto.code, 0, texto.stderr);
  assert.match(texto.stdout, /sesión s1: te necesita: «¿Uso \[token de GitHub\]\?» \(contexto 42 %, costo 1\.25\)/);
  assert.match(texto.stdout, /sesión s2: esperando a sus agentes \(contexto 42 %, costo 1\.25\)/);
});

test('an unknown format warns, a dead pid and a foreign path do not count', (t) => {
  const dir = tempDir(t);
  const agentDir = path.join(dir, 'agent');
  const member = path.join(dir, 'core');
  writeSnapshot(agentDir, 'nuevo', { ...snapshot(agentDir, member), schema: 'gentle-shell.desktop-feed/v2' });
  writeSnapshot(agentDir, 'muerta', snapshot(agentDir, member, {
    identity: { sessionId: 'muerta', cwd: member, pid: deadPid(), mode: 'tui', agentDir },
  }));
  writeSnapshot(agentDir, 'otra', snapshot(agentDir, path.join(dir, 'core-otro')));
  fs.writeFileSync(path.join(agentDir, 'desktop', 'sessions', 'rota.json'), '{ no es json');

  const feed = readFeed([agentDir], [{ id: 'core', path: member }]);

  assert.deepEqual(feed.sessions, { core: [] });
  assert.deepEqual(feed.warnings, [
    'nuevo.json: formato desconocido gentle-shell.desktop-feed/v2; se lee solo gentle-shell.desktop-feed/v1',
    'rota.json: no es JSON válido',
  ]);
});

test('the inbox takes only send_prompt and answer_question, and nothing else is written', async (t) => {
  const dir = tempDir(t);
  const agentDir = path.join(dir, 'agent');
  writeSnapshot(agentDir, 's1', snapshot(agentDir, dir));
  const inbox = inboxOf(agentDir, 's1');
  const target = { agentDir, name: 's1', sessionId: 's1' };

  for (const [kind, args] of [
    ['set_permission_mode', { mode: 'yolo' }],
    ['abort_turn', {}],
    ['cancel_job', { id: 'j1' }],
    ['cancel_subagent', { id: 'a1' }],
    ['refresh_usage', {}],
    ['apply_profile', { name: 'barato' }],
    ['answer_question', { toolCallId: 'c1', option: 'granted', via: 'session', extra: 1 }],
    ['send_prompt', { text: '   ' }],
  ]) {
    const res = await sendAction(target, kind, args, { timeoutMs: 200 });
    assert.equal(res.ok, false, kind);
    assert.equal(res.error.code, 'not_allowed', kind);
  }
  assert.deepEqual(fs.readdirSync(inbox), []);
});

test('an action reaches the inbox and its answer is read; without an answer it expires', async (t) => {
  const dir = tempDir(t);
  const agentDir = path.join(dir, 'agent');
  writeSnapshot(agentDir, 's1', snapshot(agentDir, dir));
  const inbox = inboxOf(agentDir, 's1');
  const outbox = path.join(agentDir, 'desktop', 'outbox', 's1');
  const target = { agentDir, name: 's1', sessionId: 's1' };

  // The session: answers the first action file it finds.
  const timer = setInterval(() => {
    for (const file of fs.readdirSync(inbox)) {
      const action = JSON.parse(fs.readFileSync(path.join(inbox, file), 'utf8'));
      fs.rmSync(path.join(inbox, file));
      fs.writeFileSync(path.join(outbox, file), JSON.stringify({
        schema: 'gentle-shell.desktop-action-result/v1', id: action.id, sessionId: 's1',
        kind: action.kind, ok: true, data: { queued: false, text: action.args.text },
      }));
    }
  }, 20);
  const sent = await sendAction(target, 'send_prompt', { text: '/flow-avance' }, { timeoutMs: 3000 });
  clearInterval(timer);
  assert.deepEqual(sent, { ok: true, data: { queued: false, text: '/flow-avance' } });

  const expired = await sendAction(target, 'send_prompt', { text: 'hola' }, { timeoutMs: 150 });
  assert.deepEqual(expired, { ok: false, error: { code: 'timeout', message: 'la sesión no respondió en 0.15 s' } });
  assert.deepEqual(fs.readdirSync(inbox), [], 'an expired action is removed from the inbox');

  const noInbox = await sendAction({ agentDir, name: 's9', sessionId: 's9' }, 'send_prompt', { text: 'hola' });
  assert.equal(noInbox.error.code, 'no_inbox');
});

test('C1 controls, controls in an option and a disguised consent are refused without writing', async (t) => {
  const dir = tempDir(t);
  const agentDir = path.join(dir, 'agent');
  const inbox = inboxOf(agentDir, 's1');
  const target = { agentDir, name: 's1', sessionId: 's1' };
  for (const [kind, args] of [
    ['send_prompt', { text: 'a\u009b31m' }],
    ['send_prompt', { text: 'a\u0085b' }],
    ['answer_question', { toolCallId: 'c1', option: 'a\u001b[2J', via: 'session' }],
    ['answer_question', { toolCallId: 'c1', option: 'granted\u200b', via: 'session' }],
  ]) {
    const res = await sendAction(target, kind, args, { timeoutMs: 100 });
    assert.equal(res.error.code, 'not_allowed', JSON.stringify(args));
  }
  assert.deepEqual(fs.readdirSync(inbox), []);
});

test('an answer that is not an object is refused, not thrown', async (t) => {
  const dir = tempDir(t);
  const agentDir = path.join(dir, 'agent');
  const inbox = inboxOf(agentDir, 's1');
  const outbox = path.join(agentDir, 'desktop', 'outbox', 's1');
  const timer = setInterval(() => {
    for (const f of fs.readdirSync(inbox)) {
      fs.writeFileSync(path.join(outbox, f), 'null');
      fs.rmSync(path.join(inbox, f));
    }
  }, 10);
  const res = await sendAction({ agentDir, name: 's1', sessionId: 's1' }, 'send_prompt', { text: 'hola' }, { timeoutMs: 1000 });
  clearInterval(timer);
  assert.deepEqual(res, { ok: false, error: { code: 'invalid_answer', message: 'la respuesta de la sesión no es válida' } });
});

test('target names that try to leave the inbox are refused', async (t) => {
  const dir = tempDir(t);
  const agentDir = path.join(dir, 'agent');
  inboxOf(agentDir, 's1');
  for (const name of ['..', '../../x', 'a/b', '..\\x', '']) {
    const res = await sendAction({ agentDir, name, sessionId: 's1' }, 'send_prompt', { text: 'hola' }, { timeoutMs: 50 });
    assert.equal(res.error.code, 'invalid_target', name);
  }
});

test('the same agent dir listed twice and nested members count each session once, in the deepest member', (t) => {
  const dir = tempDir(t);
  const agentDir = path.join(dir, 'agent');
  const outer = path.join(dir, 'mono');
  const inner = path.join(outer, 'web');
  writeSnapshot(agentDir, 's1', snapshot(agentDir, path.join(inner, 'src')));

  const feed = readFeed([agentDir, path.join(agentDir, '.')], [{ id: 'mono', path: outer }, { id: 'web', path: inner }]);

  assert.equal(feed.sessions.mono.length, 0);
  assert.equal(feed.sessions.web.length, 1);
});
