import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearQualityGateProof, recordSuccessfulQualityGate } from './release-session.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function getChecks(npmCmd = npm) {
  return [
    ['Version sync', 'node', ['scripts/verify-version-sync.js']],
    ['Typecheck', npmCmd, ['run', 'typecheck']],
    ['Test typecheck', npmCmd, ['run', 'typecheck:test']],
    ['Lint', npmCmd, ['run', 'lint:prod']],
    ['Test lint', npmCmd, ['run', 'lint:test']],
    ['Format', npmCmd, ['run', 'format:check']],
    ['Cargo safe update', npmCmd, ['run', 'test:cargo-safe-update']],
    ['Cargo policy', npmCmd, ['run', 'check:cargo-update-policy']],
    ['Tests', npmCmd, ['run', 'test:cov']],
    ['Updater fixtures', npmCmd, ['run', 'validate:updater']],
    ['Prod audit', npmCmd, ['run', 'audit:prod']],
    ['Rust check', 'cargo', ['check', '--locked', '--manifest-path', 'src-tauri/Cargo.toml']],
    [
      'Rust clippy',
      'cargo',
      [
        'clippy',
        '--locked',
        '--manifest-path',
        'src-tauri/Cargo.toml',
        '--all-targets',
        '--',
        '-D',
        'warnings',
      ],
    ],
    [
      'MAS rust check',
      'cargo',
      ['check', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--features', 'mas'],
    ],
    [
      'Rust tests',
      'cargo',
      ['test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--all-targets'],
    ],
    ['Edition gate tests', npmCmd, ['run', 'test:edition']],
  ];
}

function main({
  repoRoot = root,
  clearProof = clearQualityGateProof,
  recordProof = recordSuccessfulQualityGate,
  runner = (command, args) =>
    spawnSync(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32' && /\.cmd$/i.test(command),
    }),
  log = console.log,
} = {}) {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  clearProof(repoRoot);
  log(`\nTUXEDO MD TEST SUITE · ${version}\n`);
  const checks = getChecks();
  let failed = false;
  for (const [label, command, args] of checks) {
    if (log === console.log) process.stdout.write(`▶ ${label}\n`);
    const result = runner(command, args);
    if (result.status !== 0) {
      failed = true;
      if (log === console.log) console.error(`✗ ${label} failed\n`);
    } else {
      log(`✓ ${label}\n`);
    }
  }

  if (failed) return 1;
  log('✓ All checks passed.');
  const qualityGate = recordProof(repoRoot);
  if (qualityGate.recorded) {
    log('Release quality-gate proof recorded for this clean commit.');
  } else {
    log('Release quality-gate proof not recorded because the working tree is dirty.');
    if (qualityGate.dirtyFiles) {
      log('Dirty files:');
      log(qualityGate.dirtyFiles);
    }
  }
  return 0;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isDirectExecution()) {
  const exitCode = main();
  if (exitCode !== 0) process.exit(exitCode);
}

export { getChecks, main };
