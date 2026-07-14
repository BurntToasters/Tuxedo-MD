import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const prerelease = /-(?:beta|alpha|rc)(?:[.-]?\d+)?/i.test(pkg.version);
const rawArgs = process.argv.slice(2);
const required = {
  macSigning: rawArgs.includes('--require-macos-signing'),
  macNotarization: rawArgs.includes('--require-macos-notarization'),
  tauriSigning: rawArgs.includes('--require-tauri-signing'),
};
const args = rawArgs.filter((arg) => !arg.startsWith('--require-'));
const has = (name) => Boolean(process.env[name]?.trim());
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0
    ? (args[index + 1] ?? '')
    : (args
        .find((arg) => arg.startsWith(`${flag}=`))
        ?.split('=')
        .slice(1)
        .join('=') ?? '');
};
const target = valueAfter('--target');
const macBuild = target ? target.includes('apple-darwin') : process.platform === 'darwin';
const windowsBuild = target ? target.includes('windows') : process.platform === 'win32';

if (!has('APPLE_PASSWORD') && has('APPLE_APP_SPECIFIC_PASSWORD')) {
  process.env.APPLE_PASSWORD = process.env.APPLE_APP_SPECIFIC_PASSWORD;
}

const missing = [];
if (required.tauriSigning && !args.includes('--no-bundle') && !has('TAURI_SIGNING_PRIVATE_KEY')) {
  missing.push('TAURI_SIGNING_PRIVATE_KEY');
}
if (macBuild && required.macSigning && !has('APPLE_SIGNING_IDENTITY')) {
  missing.push('APPLE_SIGNING_IDENTITY');
}
if (macBuild && required.macNotarization) {
  for (const name of ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID'])
    if (!has(name)) missing.push(name);
}
if (missing.length) {
  console.error(`[tauri-build] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

if (macBuild && required.macSigning) {
  const identities = execSync('security find-identity -v -p codesigning', { encoding: 'utf8' });
  if (!identities.includes(process.env.APPLE_SIGNING_IDENTITY)) {
    console.error(`[tauri-build] APPLE_SIGNING_IDENTITY was not found in the active keychain.`);
    process.exit(1);
  }
}

if (prerelease && windowsBuild && !args.includes('--no-bundle')) {
  const bundlesIndex = args.findIndex((arg) => arg === '--bundles' || arg.startsWith('--bundles='));
  if (bundlesIndex < 0) {
    args.push('--bundles', 'nsis');
  } else if (args[bundlesIndex] === '--bundles') {
    args[bundlesIndex + 1] =
      (args[bundlesIndex + 1] ?? '')
        .split(',')
        .filter((x) => x !== 'msi')
        .join(',') || 'nsis';
  } else {
    const filtered =
      args[bundlesIndex]
        .slice(10)
        .split(',')
        .filter((x) => x !== 'msi')
        .join(',') || 'nsis';
    args[bundlesIndex] = `--bundles=${filtered}`;
  }
  console.log(`[tauri-build] ${pkg.version} is a pre-release; MSI output is disabled.`);
}

execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tauri', 'build', ...args], {
  stdio: 'inherit',
  env: process.env,
});
