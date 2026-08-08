import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gpgSign = fs.readFileSync(path.join(root, 'scripts/gpg-sign.js'), 'utf8');
const upload = fs.readFileSync(path.join(root, 'scripts/upload-release-assets.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

describe('CE-only GitHub release policy', () => {
  it('keeps Pro store packs in win/mac release continue scripts', () => {
    expect(pkg.scripts['release:win:continue']).toContain('build:msstore:pack');
    expect(pkg.scripts['release:mac:continue']).toContain('build:mac:pkg');
    expect(pkg.scripts['release:mac:continue']).toContain('build:mac:universal:prepared');
  });

  it('builds Pro before CE on mac so the GitHub app bundle is community', () => {
    const mac = pkg.scripts['release:mac:continue'] as string;
    expect(mac.indexOf('build:mac:appstore:prepared')).toBeLessThan(
      mac.indexOf('build:mac:universal:prepared')
    );
    expect(mac.indexOf('build:mac:pkg')).toBeLessThan(mac.indexOf('build:mac:zip'));
  });

  it('filters store/Pro artifacts out of gpg-sign and fallback upload', () => {
    expect(gpgSign).toContain('isStoreOrProArtifact');
    expect(gpgSign).toMatch(/TuxedoMD\\.Pro_/);
    expect(gpgSign).toMatch(/msix/);
    expect(gpgSign).toContain("from \"./updater-targets.js\"");
    expect(upload).toContain('isStoreOrProArtifact');
    expect(upload).toContain("path.join(root, 'release')");
    expect(upload).not.toContain("path.join(root, 'msstore')");
    expect(upload).not.toContain('src-tauri/target');
  });

  it('uploads from gpg-sign and finalizes with mirror only', () => {
    expect(pkg.scripts['release:finalize']).toBe(
      'npm run release:mirror && git fetch origin && git reset --hard @{u} && git clean -fd'
    );
    expect(pkg.scripts['release:sync-beta-manifests']).toContain('--sync-beta-manifests');
    expect(pkg.scripts['validate:updater']).toContain('validate-updater-manifest');
    expect(pkg.scripts['validate:updater:live']).toContain('REQUIRE_UPDATER_LIVE=1');
    expect(pkg.scripts['validate:updater:live:soft']).toContain('--shape-only');
    expect(pkg.scripts['release:updater-manifests']).toContain('ALLOW_STANDALONE_UPDATER_MANIFESTS=1');
    const finalize = fs.readFileSync(path.join(root, 'scripts/finalize-release-assets.js'), 'utf8');
    expect(finalize).toContain('SKIP_RELEASE_MIRROR');
    expect(finalize).toContain('AFTER_PACK_LOC');
  });

  it('runs sync-version and licenses before release continue builds', () => {
    for (const key of ['release:win:continue', 'release:mac:continue', 'release:linux:continue']) {
      expect(pkg.scripts[key]).toContain('sync-version');
      expect(pkg.scripts[key]).toContain('licenses');
    }
  });

  it('stages MAS Pro packages outside CE release/', () => {
    const masPack = fs.readFileSync(path.join(root, 'scripts/mas-pack.js'), 'utf8');
    expect(masPack).toContain("path.join(root, 'mas')");
    expect(masPack).toContain('run.rosie.tuxedomd.pro');
    expect(masPack).not.toMatch(/path\.join\(releaseDir,\s*`TuxedoMD\.Pro_/);
  });

  it('cleans mas/ with release artifacts and refuses published clobber uploads', () => {
    const distTools = fs.readFileSync(path.join(root, 'scripts/dist-tools.js'), 'utf8');
    expect(distTools).toMatch(/clean-release-artifacts':\s*\[[^\]]*mas/);
    expect(distTools).toMatch(/clean-all':\s*\[[^\]]*mas/);
    expect(upload).toContain('ALLOW_ASSET_REPLACE');
    expect(upload).toContain('isDraft');
  });

  it('keeps MSI beta feeds optional in live verify required targets', () => {
    const live = fs.readFileSync(path.join(root, 'scripts/validate-updater-live.js'), 'utf8');
    expect(live).toContain('windows-beta-x86_64-nsis');
    expect(live).not.toMatch(/STANDARD_BETA_TARGETS\s*=\s*\[[^\]]*windows-beta-x86_64-msi/);
  });

  it('preserves pre-staged release artifacts when collecting from target bundles', () => {
    expect(gpgSign).toContain('tuxedomd-release-staged-');
    expect(gpgSign).toContain('(pre-staged)');
  });

  it('requires draft releases and encodes MSIX prerelease revisions', async () => {
    const ensureDraft = fs.readFileSync(path.join(root, 'scripts/ensure-draft-release.cjs'), 'utf8');
    expect(ensureDraft).toContain('isDraft');
    expect(ensureDraft).toContain('already published');
    const { toMsixIdentityVersion } = await import('../../scripts/msstore-version.js');
    expect(toMsixIdentityVersion('0.1.0-alpha.1')).toBe('0.1.0.1001');
    expect(toMsixIdentityVersion('0.1.0-beta.2')).toBe('0.1.0.2002');
    expect(toMsixIdentityVersion('0.1.0')).toBe('0.1.0.3000');
  });
});
