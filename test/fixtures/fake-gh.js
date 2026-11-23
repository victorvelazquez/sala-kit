'use strict';

// Stands in for gh: prints FAKE_GH_OUT, or fails as gh does without a login. A list of
// merged pull requests (`--state merged`) prints FAKE_GH_MERGED, empty by default.
if (!process.env.FAKE_GH_OUT) {
  process.stderr.write('gh: not logged in');
  process.exit(1);
}
const args = process.argv.slice(2);
const state = args[args.indexOf('--state') + 1];
process.stdout.write(args.includes('--state') && state === 'merged' ? process.env.FAKE_GH_MERGED || '[]' : process.env.FAKE_GH_OUT);
