import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

if (process.platform !== 'darwin') throw new Error('The macOS ZIP must be created on macOS.');
const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const bundleRoot = path.join(root, 'src-tauri/target/universal-apple-darwin/release/bundle/macos');
const app = path.join(bundleRoot, 'Tuxedo MD.app');
if (!fs.existsSync(app)) throw new Error(`Missing ${app}; run npm run build:mac:universal first.`);
const release = path.join(root, 'release');
fs.mkdirSync(release, { recursive: true });
const output = path.join(release, `Tuxedo.MD_${pkg.version}_universal.app.zip`);
fs.rmSync(output, { force: true });
execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, output], {
  stdio: 'inherit',
});
console.log(`Created ${path.relative(root, output)}`);
