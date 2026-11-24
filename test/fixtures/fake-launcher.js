'use strict';

// A fake `orca` or `wt` (FAKE_TOOL). Logs each call as a JSON line in FAKE_LOG.
// FAKE_ORCA_DOWN=1 makes orca fail every call. When a terminal opens and
// FAKE_SNAPSHOT names a folder, it writes the session snapshot there, as
// Gentle Shell does when it starts, with FAKE_SNAPSHOT_CWD and FAKE_PID.
// FAKE_ORCA_TERMINALS lists the open terminals; FAKE_ORCA_TERMINALS_FILE keeps them
// in a file instead, so `close` can remove one, and then the session in
// FAKE_ORCA_CLOSE_SNAPSHOT ends with it. FAKE_ORCA_CLOSE_ADDS moves another snapshot
// into FAKE_SNAPSHOT on close, FAKE_ORCA_LIST_TOUCHES creates a file on each list,
// FAKE_ORCA_CREATE_FAIL=1 makes create fail, FAKE_ORCA_SCREEN is the text `read --screen`
// answers and FAKE_ORCA_READ_FAIL=1 makes read fail.

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const tool = process.env.FAKE_TOOL;
fs.appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ tool, args })}\n`);

function terminals() {
  const file = process.env.FAKE_ORCA_TERMINALS_FILE;
  const text = file ? (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '') : process.env.FAKE_ORCA_TERMINALS || '';
  return text.split(',').filter(Boolean);
}

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
  if (group === 'terminal' && verb === 'create' && process.env.FAKE_ORCA_CREATE_FAIL === '1') {
    process.stderr.write('no se pudo crear\n');
    process.exit(1);
  } else if (group === 'terminal' && verb === 'create') {
    startSession();
    process.stdout.write(JSON.stringify({ ok: true, result: { terminal: { handle: 'term_fake1', tabId: 't1' } } }));
  } else if (group === 'terminal' && verb === 'list') {
    if (process.env.FAKE_ORCA_LIST_TOUCHES) fs.writeFileSync(process.env.FAKE_ORCA_LIST_TOUCHES, '');
    const handles = terminals();
    process.stdout.write(JSON.stringify({ ok: true, result: { terminals: handles.map((handle) => ({ handle })) } }));
  } else if (group === 'terminal' && verb === 'read') {
    if (process.env.FAKE_ORCA_READ_FAIL === '1') {
      process.stderr.write('terminal not found\n');
      process.exit(1);
    }
    const tail = (process.env.FAKE_ORCA_SCREEN || '').split('\n');
    const handle = args[args.indexOf('--terminal') + 1];
    process.stdout.write(JSON.stringify({ ok: true, result: { terminal: { handle, status: 'running', tail, source: 'screen', draft: 'no es pantalla' } } }));
  } else if (group === 'terminal' && verb === 'close') {
    const file = process.env.FAKE_ORCA_TERMINALS_FILE;
    if (file) fs.writeFileSync(file, terminals().filter((h) => h !== args[args.indexOf('--terminal') + 1]).join(','));
    if (process.env.FAKE_ORCA_CLOSE_SNAPSHOT) fs.rmSync(process.env.FAKE_ORCA_CLOSE_SNAPSHOT, { force: true });
    const adds = process.env.FAKE_ORCA_CLOSE_ADDS;
    if (adds) fs.renameSync(adds, path.join(process.env.FAKE_SNAPSHOT, path.basename(adds)));
    process.stdout.write(JSON.stringify({ ok: true, result: { closeMode: 'tab' } }));
  } else {
    process.stdout.write(JSON.stringify({ ok: true, result: { navigated: true } }));
  }
} else {
  startSession();
}
