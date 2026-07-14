import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'src-tauri/icons/icon.svg');
const required = ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.icns', 'icon.ico'];
if (!fs.existsSync(source)) throw new Error('Missing src-tauri/icons/icon.svg');
if (required.some((name) => !fs.existsSync(path.join(root, 'src-tauri/icons', name)))) {
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tauri', 'icon', source], {
    cwd: root,
    stdio: 'inherit',
  });
}
console.log('Application icon set is complete.');
