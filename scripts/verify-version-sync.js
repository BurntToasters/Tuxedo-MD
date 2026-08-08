#!/usr/bin/env node
/**
 * Fail if package.json, tauri.conf.json, and Cargo.toml versions diverge.
 * Unlike sync-version.js, this never writes files (safe for CI).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const tauri = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const cargo = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
const cargoMatch = cargo.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);

const errors = [];
if (tauri.version !== version) {
  errors.push(`tauri.conf.json has ${tauri.version}, expected ${version}`);
}
if (!cargoMatch) {
  errors.push('Cargo.toml [package].version not found');
} else if (cargoMatch[1] !== version) {
  errors.push(`Cargo.toml has ${cargoMatch[1]}, expected ${version}`);
}

if (errors.length) {
  console.error('version-sync: mismatch');
  for (const error of errors) console.error(`  - ${error}`);
  console.error('Run npm run sync-version before committing.');
  process.exit(1);
}

console.log(`version-sync: ok (${version})`);
