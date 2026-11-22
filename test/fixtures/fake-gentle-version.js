'use strict';

// Plays `gentle-shell --version`: prints FAKE_GENTLE_VERSION and FAKE_PI_VERSION, or fails without them.
const version = process.env.FAKE_GENTLE_VERSION;
if (!version) {
  process.stderr.write('gentle-shell: no se encontró\n');
  process.exit(1);
}
process.stdout.write(`gentle-shell ${version}\npi ${process.env.FAKE_PI_VERSION || '0.0.0'}\nhome isolated /home/persona/.gentle-shell/agent\n`);
