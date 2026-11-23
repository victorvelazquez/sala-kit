'use strict';

// A fake pnpm or npm for sala dependencias: it logs its arguments and folder to FAKE_LOG
// and, like a real install, leaves the manager's mark in node_modules. FAKE_PM_FAIL=1
// makes it fail as an install that cannot reach the registry.
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ args, cwd: process.cwd() })}\n`);
if (process.env.FAKE_PM_FAIL === '1') {
  process.stderr.write('ERR_PNPM_FETCH_404 no se pudo bajar un paquete\nmás detalle\n');
  process.exit(1);
}
const mark = args[0] === 'ci' ? '.package-lock.json' : '.modules.yaml';
fs.mkdirSync('node_modules', { recursive: true });
fs.writeFileSync(path.join('node_modules', mark), 'instalado\n');
