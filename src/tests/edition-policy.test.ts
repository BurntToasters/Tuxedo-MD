import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilityRegistry, requestedEdition } from '../lib/edition';
import { shippedCapabilities, type EditionCapability } from '../lib/types';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

const COMMUNITY_SCRIPTS = [
  'tauri:dev',
  'tauri:build',
  'build:win:x64:prepared',
  'build:win:arm64:prepared',
  'build:mac:universal:prepared',
] as const;

const FULL_SCRIPTS = [
  'tauri:dev:pro',
  'tauri:build:pro:smoke',
  'build:msstore:win:x64:prepared',
  'build:msstore:win:arm64:prepared',
  'build:msstore:legacy-msix',
  'build:mac:appstore:prepared',
  'build:linux:x64:prepared',
] as const;

function editionEnvPair(script: string): { tuxedo: string | null; vite: string | null } {
  const tuxedo = script.match(/\bTUXEDO_EDITION=(\w+)/)?.[1] ?? null;
  const vite = script.match(/\bVITE_TUXEDO_EDITION=(\w+)/)?.[1] ?? null;
  return { tuxedo, vite };
}

describe('edition build script policy', () => {
  it('sets community edition on GitHub Win/Mac and default Tauri lanes', () => {
    for (const key of COMMUNITY_SCRIPTS) {
      const script = pkg.scripts[key];
      expect(script, key).toBeTruthy();
      const { tuxedo, vite } = editionEnvPair(script);
      expect(tuxedo, key).toBe('community');
      expect(vite, key).toBe('community');
    }
  });

  it('sets full edition on Pro/store/Linux and Pro smoke lanes', () => {
    for (const key of FULL_SCRIPTS) {
      const script = pkg.scripts[key];
      expect(script, key).toBeTruthy();
      const { tuxedo, vite } = editionEnvPair(script);
      expect(tuxedo, key).toBe('full');
      expect(vite, key).toBe('full');
    }
  });

  it('keeps start aliases pointed at the matching Tauri edition scripts', () => {
    expect(pkg.scripts.start).toBe('npm run tauri:dev');
    expect(pkg.scripts['start:pro']).toBe('npm run tauri:dev:pro');
  });

  it('exposes dual-edition and mas cargo gate tests', () => {
    expect(pkg.scripts['test:edition:community']).toContain('TUXEDO_EDITION=community');
    expect(pkg.scripts['test:edition:full']).toContain('TUXEDO_EDITION=full');
    expect(pkg.scripts['test:edition:mas']).toContain('--features mas');
    expect(pkg.scripts['test:edition']).toContain('test:edition:community');
    expect(pkg.scripts['test:edition']).toContain('test:edition:full');
    expect(pkg.scripts['test:edition']).toContain('test:edition:mas');
  });

  it('keeps macos-private-api on the tauri dependency for desktop conf allowlist', () => {
    const cargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
    expect(cargo).toMatch(/tauri = \{[^}]*macos-private-api/);
    expect(cargo).toMatch(/^\s*mas = \[\]/m);
    const tauriBuild = fs.readFileSync(path.join(root, 'scripts/tauri-build.js'), 'utf8');
    expect(tauriBuild).toContain("'--features', 'mas'");
  });
});

describe('frontend edition registry', () => {
  it('derives requestedEdition from VITE_TUXEDO_EDITION (full → Pro, else Community)', () => {
    const expected: 'full' | 'community' =
      import.meta.env.VITE_TUXEDO_EDITION === 'full' ? 'full' : 'community';
    expect(requestedEdition).toBe(expected);
  });

  it('registers shipped and planned capabilities with correct flags', () => {
    const names = Object.keys(capabilityRegistry) as EditionCapability[];
    expect(names).toHaveLength(11);
    for (const name of names) {
      expect(capabilityRegistry[name].minimumEdition).toBe('full');
    }
    expect(capabilityRegistry.workspaceSearch.shipped).toBe(true);
    expect(capabilityRegistry.mermaid.shipped).toBe(false);
  });

  it('ships exactly five capabilities and keeps mermaid unshipped', () => {
    const expected: EditionCapability[] = [
      'workspaceSearch',
      'backlinks',
      'wikiLinks',
      'tags',
      'workspaceIntelligence',
    ];
    expect(shippedCapabilities).toHaveLength(5);
    expect(shippedCapabilities).toEqual(expected);
    expect(capabilityRegistry.mermaid.shipped).toBe(false);

    const registryShipped = (Object.keys(capabilityRegistry) as EditionCapability[]).filter(
      (name) => capabilityRegistry[name].shipped
    );
    expect([...registryShipped].sort()).toEqual([...shippedCapabilities].sort());
  });

  it('keeps App Store overlay opaque and private-API off', () => {
    const appstore = JSON.parse(
      fs.readFileSync(path.join(root, 'src-tauri/tauri.appstore.conf.json'), 'utf8')
    ) as {
      app: { macOSPrivateApi?: boolean; windows: Array<{ transparent?: boolean }> };
    };
    expect(appstore.app.windows[0]?.transparent).toBe(false);
    expect(appstore.app.macOSPrivateApi).toBe(false);
  });
});
