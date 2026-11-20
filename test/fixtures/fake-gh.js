'use strict';

// Stands in for gh: prints FAKE_GH_OUT, or fails as gh does without a login.
if (!process.env.FAKE_GH_OUT) {
  process.stderr.write('gh: not logged in');
  process.exit(1);
}
process.stdout.write(process.env.FAKE_GH_OUT);
