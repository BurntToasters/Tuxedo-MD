import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

if (!process.env.GPG_KEY_ID) throw new Error('Missing GPG_KEY_ID.');
const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, 'src-tauri/target');
const targetRoots = fs.existsSync(target)
  ? [
      path.join(target, 'release/bundle'),
      ...fs
        .readdirSync(target, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(target, entry.name, 'release/bundle')),
    ]
  : [];
const roots = [path.join(root, 'release'), path.join(root, 'msstore'), ...targetRoots];
const extensions = new Set([
  '.zip',
  '.dmg',
  '.AppImage',
  '.deb',
  '.rpm',
  '.exe',
  '.msi',
  '.msix',
  '.sig',
]);
const artifacts = [];
function walk(folder) {
  if (!fs.existsSync(folder)) return;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const item = path.join(folder, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('stage-')) walk(item);
    else if (extensions.has(path.extname(entry.name)) && !entry.name.endsWith('.asc'))
      artifacts.push(item);
  }
}
roots.forEach(walk);
if (!artifacts.length) throw new Error('No release artifacts found to sign.');
for (const artifact of artifacts) {
  const args = [
    '--batch',
    '--yes',
    '--armor',
    '--local-user',
    process.env.GPG_KEY_ID,
    '--detach-sign',
    artifact,
  ];
  if (process.env.GPG_PASSPHRASE)
    args.unshift('--pinentry-mode', 'loopback', '--passphrase', process.env.GPG_PASSPHRASE);
  execFileSync('gpg', args, { stdio: 'inherit' });
}
console.log(`Signed ${artifacts.length} artifacts.`);
