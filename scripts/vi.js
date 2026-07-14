import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const run = (command, args = []) => {
  try {
    return execFileSync(command, args, { encoding: 'utf8' }).trim();
  } catch {
    return 'unavailable';
  }
};
console.log(`Tuxedo MD ${pkg.version}`);
console.log(
  `Node ${process.version} · npm ${run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'])}`
);
console.log(`Rust ${run('rustc', ['--version'])}`);
console.log(
  `Tauri ${run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tauri', '--version'])}`
);
