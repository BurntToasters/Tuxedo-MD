import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const command = process.argv[2];
const groups = {
  clean: ['dist', 'coverage', 'coverage-headless'],
  'clean-release': ['release'],
  'clean-release-artifacts': ['release', 'msstore'],
  'clean-all': ['dist', 'coverage', 'coverage-headless', 'release', 'msstore', 'src-tauri/target'],
};
if (!groups[command]) {
  console.error(`Usage: node scripts/dist-tools.js ${Object.keys(groups).join('|')}`);
  process.exit(1);
}
for (const relative of groups[command]) {
  fs.rmSync(path.join(root, relative), { recursive: true, force: true });
  console.log(`Removed ${relative}`);
}
