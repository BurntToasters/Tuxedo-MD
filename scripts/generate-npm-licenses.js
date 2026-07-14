import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
fs.mkdirSync(path.join(root, 'public'), { recursive: true });
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const output = execFileSync(command, ['license-checker-rseidelsohn', '--production', '--json'], {
  cwd: root,
  encoding: 'utf8',
});
const packages = JSON.parse(output);
const licenses = Object.entries(packages)
  .filter(([name]) => !name.startsWith('tuxedomd@'))
  .map(([name, metadata]) => ({
    name,
    licenses: metadata.licenses ?? 'UNKNOWN',
    repository: metadata.repository ?? null,
    publisher: metadata.publisher ?? null,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(
  path.join(root, 'public/licenses-npm.json'),
  `${JSON.stringify(licenses, null, 2)}\n`
);
console.log(`Wrote ${licenses.length} npm license records.`);
