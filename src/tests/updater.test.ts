import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowDefaultFeedFallback, resolveUpdateCheckTarget } from '../lib/updater';
import {
  resolveUpdaterTargets,
  updaterPackageRank,
} from '../../scripts/updater-targets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('resolveUpdateCheckTarget', () => {
  it('uses default feed for stable', () => {
    expect(resolveUpdateCheckTarget('stable', '0.1.0', 'windows-beta-x86_64-nsis')).toBeUndefined();
  });

  it('uses beta target when channel is beta', () => {
    expect(resolveUpdateCheckTarget('beta', '0.1.0', 'windows-beta-x86_64-nsis')).toBe(
      'windows-beta-x86_64-nsis'
    );
  });

  it('auto follows prerelease versions onto the beta target', () => {
    expect(resolveUpdateCheckTarget('auto', '0.1.0-alpha.1', 'darwin-beta-aarch64-app')).toBe(
      'darwin-beta-aarch64-app'
    );
    expect(resolveUpdateCheckTarget('auto', '0.1.0-beta.2', 'linux-beta-x86_64-appimage')).toBe(
      'linux-beta-x86_64-appimage'
    );
    expect(resolveUpdateCheckTarget('auto', '0.1.0', 'windows-beta-x86_64-nsis')).toBeUndefined();
  });

  it('never falls back to the default feed for installer-specific targets', () => {
    expect(allowDefaultFeedFallback(undefined)).toBe(true);
    expect(allowDefaultFeedFallback('windows-beta-x86_64-nsis')).toBe(false);
    expect(allowDefaultFeedFallback('linux-beta-x86_64-deb')).toBe(false);
  });
});

describe('resolveUpdaterTargets', () => {
  it('maps Windows NSIS and MSI artifacts', () => {
    expect(resolveUpdaterTargets('Tuxedo MD_0.1.0_x64-setup.exe')).toEqual([
      { os: 'windows', arch: 'x86_64', installer: 'nsis' },
    ]);
    expect(resolveUpdaterTargets('Tuxedo MD_0.1.0_x64_en-US.msi')).toEqual([
      { os: 'windows', arch: 'x86_64', installer: 'msi' },
    ]);
    expect(resolveUpdaterTargets('Tuxedo MD_0.1.0_x64-setup.nsis.zip')).toEqual([
      { os: 'windows', arch: 'x86_64', installer: 'nsis' },
    ]);
  });

  it('maps macOS app archives for both arches when universal', () => {
    expect(resolveUpdaterTargets('Tuxedo MD.app.tar.gz')).toEqual([
      { os: 'darwin', arch: 'x86_64', installer: 'app' },
      { os: 'darwin', arch: 'aarch64', installer: 'app' },
    ]);
  });

  it('maps Linux installers', () => {
    expect(resolveUpdaterTargets('tuxedomd_0.1.0_amd64.AppImage')).toEqual([
      { os: 'linux', arch: 'x86_64', installer: 'appimage' },
    ]);
    expect(resolveUpdaterTargets('tuxedomd_0.1.0_amd64.AppImage.tar.gz')).toEqual([
      { os: 'linux', arch: 'x86_64', installer: 'appimage' },
    ]);
    expect(resolveUpdaterTargets('tuxedomd_0.1.0_amd64.deb')).toEqual([
      { os: 'linux', arch: 'x86_64', installer: 'deb' },
    ]);
    expect(resolveUpdaterTargets('tuxedomd-0.1.0-1.x86_64.rpm')).toEqual([
      { os: 'linux', arch: 'x86_64', installer: 'rpm' },
    ]);
  });

  it('keeps gpg-sign on the shared updater target mapper', () => {
    const gpgSign = fs.readFileSync(path.join(root, 'scripts/gpg-sign.js'), 'utf8');
    expect(gpgSign).toContain('from "./updater-targets.js"');
    expect(gpgSign).not.toMatch(/function resolveUpdaterTargets\(/);
    expect(resolveUpdaterTargets('Tuxedo MD_0.1.0_x64-setup.nsis.zip')).toEqual([
      { os: 'windows', arch: 'x86_64', installer: 'nsis' },
    ]);
    expect(updaterPackageRank('Tuxedo MD_0.1.0_x64-setup.nsis.zip')).toBeGreaterThan(
      updaterPackageRank('Tuxedo MD_0.1.0_x64-setup.exe')
    );
  });
});
