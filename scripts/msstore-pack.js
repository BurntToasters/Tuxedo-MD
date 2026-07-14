import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

if (process.platform !== 'win32') throw new Error('MSIX packaging must run on Windows.');
const arch = process.argv[2] ?? 'x64';
if (arch !== 'x64') throw new Error('Tuxedo MD currently publishes x64 MSIX packages only.');
const required = ['MSSTORE_IDENTITY_NAME', 'MSSTORE_PUBLISHER', 'MSSTORE_PUBLISHER_DISPLAY_NAME'];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const numericVersion = pkg.version
  .replace(/-.+$/, '')
  .split('.')
  .concat('0', '0', '0', '0')
  .slice(0, 4)
  .join('.');
const stage = path.join(root, 'msstore/stage-x64');
const assets = path.join(stage, 'Assets');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(assets, { recursive: true });

const executable = path.join(root, 'src-tauri/target/x86_64-pc-windows-msvc/release/tuxedomd.exe');
if (!fs.existsSync(executable))
  throw new Error(`Missing ${executable}; run npm run build:msstore:win:x64 first.`);
fs.copyFileSync(executable, path.join(stage, 'TuxedoMD.exe'));
for (const [source, target] of [
  ['Square30x30Logo.png', 'Square44x44Logo.png'],
  ['Square142x142Logo.png', 'Square150x150Logo.png'],
  ['Square284x284Logo.png', 'Square310x310Logo.png'],
  ['StoreLogo.png', 'StoreLogo.png'],
]) {
  const from = path.join(root, 'src-tauri/icons', source);
  if (!fs.existsSync(from))
    throw new Error(`Missing store icon ${from}; run npm run icons:normalize.`);
  fs.copyFileSync(from, path.join(assets, target));
}
const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" IgnorableNamespaces="uap">
  <Identity Name="${process.env.MSSTORE_IDENTITY_NAME}" Publisher="${process.env.MSSTORE_PUBLISHER}" Version="${numericVersion}" ProcessorArchitecture="x64" />
  <Properties><DisplayName>Tuxedo MD Pro</DisplayName><PublisherDisplayName>${process.env.MSSTORE_PUBLISHER_DISPLAY_NAME}</PublisherDisplayName><Logo>Assets\\StoreLogo.png</Logo></Properties>
  <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" /></Dependencies>
  <Resources><Resource Language="en-us" /></Resources>
  <Applications><Application Id="TuxedoMD" Executable="TuxedoMD.exe" EntryPoint="Windows.FullTrustApplication"><uap:VisualElements DisplayName="Tuxedo MD Pro" Description="A sleek Markdown editor" Square44x44Logo="Assets\\Square44x44Logo.png" Square150x150Logo="Assets\\Square150x150Logo.png" BackgroundColor="transparent"><uap:DefaultTile Square310x310Logo="Assets\\Square310x310Logo.png" /></uap:VisualElements></Application></Applications>
</Package>\n`;
fs.writeFileSync(path.join(stage, 'AppxManifest.xml'), manifest);
const outputDir = path.join(root, 'msstore');
const output = path.join(outputDir, `TuxedoMD.Pro_${numericVersion}_x64.msix`);
fs.rmSync(output, { force: true });
execFileSync('makeappx.exe', ['pack', '/d', stage, '/p', output, '/o'], { stdio: 'inherit' });
console.log(`Created ${path.relative(root, output)}`);
