import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getChecks, main } from './test-all.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readPackageJsonScripts() {
  return JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts;
}

test('getChecks includes cargo safe update and policy check', () => {
  const checks = getChecks('npm');
  const safeCheck = checks.find(([label]) => label === 'Cargo safe update');
  assert.ok(safeCheck, 'Cargo safe update check must exist');
  assert.deepEqual(safeCheck.slice(1), ['npm', ['run', 'test:cargo-safe-update']]);

  const policyCheck = checks.find(([label]) => label === 'Cargo policy');
  assert.ok(policyCheck, 'Cargo policy check must exist');
  assert.deepEqual(policyCheck.slice(1), ['npm', ['run', 'check:cargo-update-policy']]);
});

test('package.json scripts define cargo safe update test and policy check', () => {
  const scripts = readPackageJsonScripts();
  assert.equal(
    scripts['test:cargo-safe-update'],
    'node --test scripts/cargo-safe-update.test.mjs scripts/check-cargo-update-policy.test.mjs'
  );
  assert.equal(scripts['check:cargo-update-policy'], 'node scripts/check-cargo-update-policy.mjs');
});

test('main prevents quality-gate proof recording when cargo safe update fails', () => {
  const calls = [];
  const exitCode = main({
    repoRoot,
    clearProof: () => calls.push('clearProof'),
    recordProof: () => {
      calls.push('recordProof');
      return { recorded: true };
    },
    runner: (cmd, args) => {
      const isSafe = args.includes('test:cargo-safe-update');
      calls.push(`run:${cmd}:${args.join(' ')}`);
      return { status: isSafe ? 1 : 0 };
    },
    log: () => {},
  });

  assert.ok(!calls.includes('recordProof'), 'failing cargo safe update must not record proof');
  assert.equal(exitCode, 1);
});

test('main prevents quality-gate proof recording when cargo policy check fails', () => {
  const calls = [];
  const exitCode = main({
    repoRoot,
    clearProof: () => calls.push('clearProof'),
    recordProof: () => {
      calls.push('recordProof');
      return { recorded: true };
    },
    runner: (cmd, args) => {
      const isPolicy = args.includes('check:cargo-update-policy');
      calls.push(`run:${cmd}:${args.join(' ')}`);
      return { status: isPolicy ? 1 : 0 };
    },
    log: () => {},
  });

  assert.ok(!calls.includes('recordProof'), 'failing cargo policy check must not record proof');
  assert.equal(exitCode, 1);
});

test('main records quality-gate proof when all checks pass', () => {
  const calls = [];
  const exitCode = main({
    repoRoot,
    clearProof: () => calls.push('clearProof'),
    recordProof: () => {
      calls.push('recordProof');
      return { recorded: true };
    },
    runner: () => ({ status: 0 }),
    log: () => {},
  });

  assert.ok(calls.includes('recordProof'));
  assert.equal(exitCode, 0);
});
