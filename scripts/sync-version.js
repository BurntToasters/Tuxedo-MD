#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const tauriPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const tauri = JSON.parse(fs.readFileSync(tauriPath, 'utf8'));

if (tauri.version !== version) {
  tauri.version = version;
  fs.writeFileSync(tauriPath, `${JSON.stringify(tauri, null, 2)}\n`);
  console.log(`tauri.conf.json → ${version}`);
}

const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');
const cargo = fs.readFileSync(cargoPath, 'utf8');
const updated = cargo.replace(/(\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m, `$1"${version}"`);
if (updated !== cargo) {
  fs.writeFileSync(cargoPath, updated);
  console.log(`Cargo.toml      → ${version}`);
}
