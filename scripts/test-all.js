import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const checks = [
  ['Typecheck', npm, ['run', 'typecheck']],
  ['Test typecheck', npm, ['run', 'typecheck:test']],
  ['Lint', npm, ['run', 'lint:prod']],
  ['Test lint', npm, ['run', 'lint:test']],
  ['Format', npm, ['run', 'format:check']],
  ['Tests', npm, ['run', 'test:cov']],
  ['Rust check', 'cargo', ['check', '--manifest-path', 'src-tauri/Cargo.toml']],
  [
    'Rust clippy',
    'cargo',
    ['clippy', '--manifest-path', 'src-tauri/Cargo.toml', '--all-targets', '--', '-D', 'warnings'],
  ],
  ['Rust tests', 'cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--all-targets']],
];

console.log(`\nTUXEDO MD TEST SUITE · ${version}\n`);
let failed = false;
for (const [label, command, args] of checks) {
  process.stdout.write(`▶ ${label}\n`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    failed = true;
    console.error(`✗ ${label} failed\n`);
  } else {
    console.log(`✓ ${label}\n`);
  }
}

if (failed) process.exit(1);
console.log('✓ All checks passed.');
