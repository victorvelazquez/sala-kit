'use strict';

// Stands in for gh in sala fusionar: answers `pr view`, `repo view`, `pr merge` and `pr list`,
// and writes every call to FAKE_GH_LOG so a test can tell whether the merge was asked for.
const fs = require('node:fs');

const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify(args)}\n`);
const key = args.slice(0, 2).join(' ');
const delay = key === 'pr view' ? Number(process.env.FAKE_GH_DELAY_MS) || 0 : 0;

setTimeout(() => {
  // After the merge the sala asks only for the state: it is MERGED unless the merge was a no-op.
  if (key === 'pr view' && args.includes('state')) process.stdout.write(JSON.stringify({ state: process.env.FAKE_GH_MERGE_NOOP ? 'OPEN' : 'MERGED' }));
  else if (key === 'pr view') process.stdout.write(process.env.FAKE_GH_PR);
  else if (key === 'repo view') process.stdout.write(process.env.FAKE_GH_REPO);
  else if (key === 'pr list') process.stdout.write('[]');
  else if (key === 'pr merge') {
    // A file the merge leaves behind, like a pause the person sets while the chain runs.
    if (process.env.FAKE_GH_ON_MERGE) fs.writeFileSync(process.env.FAKE_GH_ON_MERGE, '');
    // A log that turns into a folder cannot be written any more.
    if (process.env.FAKE_GH_BREAK_LOG) {
      fs.rmSync(process.env.FAKE_GH_BREAK_LOG, { force: true });
      fs.mkdirSync(process.env.FAKE_GH_BREAK_LOG);
    }
    if (process.env.FAKE_GH_MERGE_FAIL) {
      process.stderr.write(process.env.FAKE_GH_MERGE_FAIL);
      process.exit(1);
    }
  } else {
    process.stderr.write(`fake gh: no sabe ${key}`);
    process.exit(1);
  }
}, delay);
