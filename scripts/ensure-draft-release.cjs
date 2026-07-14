const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const path = require('node:path');
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const tag = `v${pkg.version}`;
const owner = process.env.GH_REPO_OWNER || 'BurntToasters';
const repo = process.env.GH_REPO_NAME || 'Tuxedo-MD';
const fullRepo = `${owner}/${repo}`;
const gh = process.platform === 'win32' ? 'gh.exe' : 'gh';
const run = (args, stdio = 'pipe') => execFileSync(gh, args, { stdio, encoding: 'utf8' });

function exists() {
  try {
    run(['release', 'view', tag, '--repo', fullRepo]);
    return true;
  } catch {
    return false;
  }
}
if (!exists() && !process.argv.includes('--wait')) {
  const args = [
    'release',
    'create',
    tag,
    '--repo',
    fullRepo,
    '--draft',
    '--generate-notes',
    '--title',
    `Tuxedo MD ${pkg.version}`,
  ];
  if (pkg.version.includes('-')) args.push('--prerelease');
  run(args, 'inherit');
} else if (process.argv.includes('--wait')) {
  let attempts = 0;
  while (!exists() && attempts++ < 60)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  if (!exists()) throw new Error(`Timed out waiting for ${tag}.`);
}
console.log(`Draft release ${tag} is ready.`);
