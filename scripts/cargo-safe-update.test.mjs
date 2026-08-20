import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MIN_PUBLISH_AGE_MS,
  crateIndexPath,
  isPublishAgeAllowed,
  parseArguments,
  parsePublishTime,
} from './cargo-safe-update.mjs';

const now = Date.parse('2026-08-20T12:00:00Z');

test('allows exactly 72 hours and blocks younger versions', () => {
  assert.equal(isPublishAgeAllowed(now - MIN_PUBLISH_AGE_MS, now), true);
  assert.equal(isPublishAgeAllowed(now - MIN_PUBLISH_AGE_MS + 1, now), false);
});

test('missing or malformed pubtime is not allowed', () => {
  assert.equal(parsePublishTime(undefined), null);
  assert.equal(parsePublishTime('invalid'), null);
  assert.equal(isPublishAgeAllowed(null, now), false);
});

test('normalizes crates.io index paths', () => {
  assert.equal(crateIndexPath('serde'), 'se/rd/serde');
  assert.equal(crateIndexPath('ab'), '2/ab');
  assert.equal(crateIndexPath('a'), '1/a');
});

test('keeps exact override out of Cargo arguments', () => {
  const parsed = parseArguments(['-p', 'foo', '--allow-young=foo@1.2.3', '--reason=reviewed']);
  assert.deepEqual(parsed.cargoArgs, ['-p', 'foo']);
  assert.equal(parsed.allowYoung.has('foo@1.2.3'), true);
});

test('dependency update entry points use guarded Cargo resolution', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of ['u', 'u2']) {
    assert.doesNotMatch(packageJson.scripts[name], /\bcargo update\b/);
    assert.match(packageJson.scripts[name], /cargo-safe-update/);
  }
});
