'use strict';

// A fake `orca` or `wt` (FAKE_TOOL). Logs each call as a JSON line in FAKE_LOG.
// FAKE_ORCA_DOWN=1 makes orca fail every call. When a terminal opens and
// FAKE_SNAPSHOT names a folder, it writes the session snapshot there, as
// Gentle Shell does when it starts, with FAKE_SNAPSHOT_CWD and FAKE_PID.

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const tool = process.env.FAKE_TOOL;
fs.appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ tool, args })}\n`);

function startSession() {
  const dir = process.env.FAKE_SNAPSHOT;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const cwd = process.env.FAKE_SNAPSHOT_CWD;
  fs.writeFileSync(path.join(dir, 'nueva.json'), JSON.stringify({
    schema: 'gentle-shell.desktop-feed/v1',
    identity: { sessionId: 'nueva', cwd, realCwd: cwd, pid: Number(process.env.FAKE_PID), mode: 'tui' },
    activity: { state: 'idle', label: 'Idle' },
    pendingQuestion: null,
  }));
}

if (tool === 'orca') {
  if (process.env.FAKE_ORCA_DOWN === '1') {
    process.stderr.write('Orca is not running\n');
    process.exit(1);
  }
  const [group, verb] = args;
  if (group === 'terminal' && verb === 'create') {
    startSession();
    process.stdout.write(JSON.stringify({ ok: true, result: { terminal: { handle: 'term_fake1', tabId: 't1' } } }));
  } else if (group === 'terminal' && verb === 'list') {
    const handles = (process.env.FAKE_ORCA_TERMINALS || '').split(',').filter(Boolean);
    process.stdout.write(JSON.stringify({ ok: true, result: { terminals: handles.map((handle) => ({ handle })) } }));
  } else {
    process.stdout.write(JSON.stringify({ ok: true, result: { navigated: true } }));
  }
} else {
  startSession();
}
