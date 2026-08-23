const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { assertGitHubCliAuthenticated, runGitHub } = require('./github-cli.cjs');

const path = require('node:path');
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const tag = `v${pkg.version}`;
const owner = process.env.GH_REPO_OWNER || 'BurntToasters';
const repo = process.env.GH_REPO_NAME || 'Tuxedo-MD';
const fullRepo = `${owner}/${repo}`;
const run = (args) => runGitHub(args).stdout;

function draftStatus() {
  try {
    const raw = run(['release', 'view', tag, '--repo', fullRepo, '--json', 'isDraft,tagName']);
    const release = JSON.parse(raw);
    return release?.isDraft === true ? 'draft' : 'published';
  } catch (error) {
    if (/release not found|HTTP 404/i.test(error?.message || '')) return 'missing';
    throw error;
  }
}

function ensureDraft() {
  const status = draftStatus();
  if (status === 'draft') return;
  if (status === 'published') {
    throw new Error(
      `Release ${tag} is already published. Refusing to treat it as a draft. Bump the version or delete/retarget the release.`
    );
  }
  const target = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
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
    '--target',
    target,
  ];
  if (pkg.version.includes('-')) args.push('--prerelease');
  run(args);
}

assertGitHubCliAuthenticated();
if (process.argv.includes('--wait')) {
  let attempts = 0;
  let status = draftStatus();
  while (status !== 'draft' && attempts++ < 60) {
    if (status === 'published') {
      throw new Error(
        `Release ${tag} is already published. Refusing to wait for a draft with the same tag.`
      );
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
    status = draftStatus();
  }
  if (status !== 'draft') throw new Error(`Timed out waiting for draft ${tag}.`);
} else {
  ensureDraft();
}
console.log(`Draft release ${tag} is ready.`);
