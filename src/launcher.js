'use strict';

// The launcher port (D14): opens and shows the terminal of a member's session.
// Two adapters, Orca and Windows Terminal; the feed adapter watches the session.

const { run, redact, firstLine } = require('./run');

// SALA_ORCA and SALA_WT swap the binaries; a .js path runs with node (used by the tests).
function tool(envVar, name, args) {
  const custom = process.env[envVar];
  if (!custom) return [name, args];
  return custom.endsWith('.js') ? [process.execPath, [custom, ...args]] : [custom, args];
}

function parse(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

// The first `handle` that looks like an Orca terminal, wherever the answer puts it.
function findHandle(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.handle === 'string' && /^term_[A-Za-z0-9_-]+$/.test(value.handle)) return value.handle;
  for (const child of Object.values(value)) {
    const found = findHandle(child);
    if (found) return found;
  }
  return null;
}

const orca = {
  name: 'orca',
  async call(args) {
    const [file, list] = tool('SALA_ORCA', 'orca', args);
    const res = await run(file, list, { timeout: 15000 });
    const data = parse(res.stdout);
    if (res.code !== 0 || !data || data.ok === false) {
      // run() redacts stderr only; an error Orca answers on stdout is redacted here.
      return { ok: false, error: redact(firstLine(res.stderr || (data && data.error && data.error.message) || res.stdout)) };
    }
    return { ok: true, data };
  },
  // The handles of the terminals Orca has open; null when Orca does not answer.
  async terminals() {
    const res = await this.call(['terminal', 'list', '--json']);
    if (!res.ok) return null;
    const list = res.data.result && Array.isArray(res.data.result.terminals) ? res.data.result.terminals : [];
    return list.map((term) => term && term.handle).filter((h) => typeof h === 'string');
  },
  async open(member) {
    const res = await this.call([
      'terminal', 'create', '--worktree', `path:${member.path}`, '--title', member.id, '--command', 'gentle-shell', '--json',
    ]);
    if (!res.ok) return { ok: false, error: `Orca no pudo abrir la terminal: ${res.error}` };
    const handle = findHandle(res.data);
    if (!handle) return { ok: false, error: 'Orca abrió la terminal, pero no devolvió su handle' };
    return { ok: true, handle, title: member.id };
  },
  // After `close`, `show` still answers, so a live terminal is one that `list` names (SK2a).
  async show(record) {
    const open = await this.terminals();
    if (!open) return { ok: false, error: 'Orca no responde' };
    if (!open.includes(record.handle)) return { ok: false, gone: true, error: `la terminal ${record.handle} ya no existe en Orca` };
    const res = await this.call(['terminal', 'switch', '--terminal', record.handle, '--json']);
    if (!res.ok) return { ok: false, error: `Orca no pudo mostrar la terminal: ${res.error}` };
    return { ok: true, shown: true };
  },
};

// wt returns as soon as it hands the tab over, with no handle: the tab is known by its title.
const wt = {
  name: 'wt',
  async open(member) {
    // wt reads `;` as the start of another command, even inside a path.
    if (member.path.includes(';')) return { ok: false, error: 'Windows Terminal no abre una ruta con «;»; usá Orca' };
    const title = `sala-${member.id}`;
    const [file, args] = tool('SALA_WT', 'wt', [
      '-w', '0', 'new-tab', '-d', member.path, '--title', title, 'powershell', '-NoExit', '-Command', 'gentle-shell',
    ]);
    const res = await run(file, args, { timeout: 15000 });
    if (res.code !== 0) return { ok: false, error: `Windows Terminal no pudo abrir la pestaña: ${firstLine(res.stderr)}` };
    return { ok: true, handle: null, title };
  },
  async show() {
    return { ok: true, shown: false };
  },
};

const LAUNCHERS = { orca, wt };

// options.launcher: auto takes Orca when it answers, otherwise Windows Terminal.
async function pickLauncher(choice = 'auto') {
  if (choice !== 'auto') return LAUNCHERS[choice];
  return (await orca.terminals()) ? orca : wt;
}

module.exports = { pickLauncher, LAUNCHERS };
