import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
fs.mkdirSync(path.join(root, 'public'), { recursive: true });
const metadata = JSON.parse(
  execFileSync(
    'cargo',
    ['metadata', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    }
  )
);
const licenses = metadata.packages
  .filter((pkg) => pkg.name !== 'tuxedomd')
  .map((pkg) => ({
    name: `${pkg.name}@${pkg.version}`,
    licenses: pkg.license ?? 'UNKNOWN',
    repository: pkg.repository ?? null,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(
  path.join(root, 'public/licenses-cargo.json'),
  `${JSON.stringify(licenses, null, 2)}\n`
);
console.log(`Wrote ${licenses.length} Cargo license records.`);
