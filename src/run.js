'use strict';

const { execFile } = require('node:child_process');

// Never prompt for credentials: a prompt with no terminal hangs until the timeout.
const NO_PROMPT = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GH_PROMPT_DISABLED: '1',
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes',
};

// Credentials embedded in URLs and GitHub tokens never reach the output.
function redact(text) {
  return String(text)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '***');
}

// Runs a program without a shell; arguments go as a list. Never rejects.
function run(file, args, { cwd, timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, {
      cwd,
      timeout,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ...NO_PROMPT },
    }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      const failure = err && err.killed ? `se cortó a los ${timeout / 1000} s` : '';
      resolve({ code, stdout: String(stdout), stderr: redact(failure || String(stderr) || (err ? err.message : '')) });
    });
  });
}

function firstLine(text) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).find(Boolean) || 'sin detalle';
}

// The meaningful line of a git error, without its `fatal:` or `error:` prefix.
function gitError(stderr) {
  const lines = String(stderr).split(/\r?\n/);
  return firstLine(lines.find((l) => /^(fatal|error):/.test(l)) || stderr).replace(/^(fatal|error):\s*/, '');
}

module.exports = { run, redact, firstLine, gitError };
