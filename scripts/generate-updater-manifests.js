/**
 * Generate Tauri updater manifests (latest-*.json) from signed release artifacts.
 * Adapted from Zinnia's release signing flow for Tuxedo MD GitHub direct builds.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  normalizeUpdaterSignature,
  verifyUpdaterSignatures,
} from './updater-signature-verifier.js';
import { resolveUpdaterTargets, updaterPackageRank } from './updater-targets.js';

export { resolveUpdaterTargets, updaterPackageRank };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const VERSION = pkg.version;
const TAG = `v${VERSION}`;
const REPO_OWNER = process.env.GH_REPO_OWNER || 'BurntToasters';
const REPO_NAME = process.env.GH_REPO_NAME || 'Tuxedo-MD';
const TAG_DOWNLOAD_BASE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${encodeURIComponent(TAG)}`;
const RELEASE_DOWNLOAD_BASE_URL = (
  process.env.RELEASE_DOWNLOAD_BASE_URL || TAG_DOWNLOAD_BASE_URL
).replace(/\/+$/, '');
const RELEASE_NOTES = process.env.RELEASE_NOTES || '';
const RELEASE_PUB_DATE = process.env.RELEASE_PUB_DATE || new Date().toISOString();
const IS_PRERELEASE = /-(alpha|beta|rc)\./i.test(VERSION);

const FALLBACK_INSTALLER_PRIORITY = {
  windows: { nsis: 3, msi: 2 },
  linux: { appimage: 3, deb: 2, rpm: 1 },
  darwin: { app: 3 },
};

const UPDATER_ARTIFACT =
  /\.(?:nsis\.zip|app\.tar\.gz|appimage(?:\.tar\.gz)?|exe|msi|deb|rpm|AppImage)$/i;

function updaterChannelVariants() {
  return [
    { targetSuffix: '', baseUrl: RELEASE_DOWNLOAD_BASE_URL },
    { targetSuffix: '-beta', baseUrl: TAG_DOWNLOAD_BASE_URL },
  ];
}

function releaseAssetUrl(fileName, baseUrl = RELEASE_DOWNLOAD_BASE_URL) {
  return `${baseUrl}/${encodeURIComponent(fileName)}`;
}

function isStoreOrProArtifact(name, filePath = '') {
  const base = path.basename(name);
  const normalizedPath = String(filePath || name).replace(/\\/g, '/');
  if (/msstore\//i.test(normalizedPath)) return true;
  if (/^TuxedoMD\.Pro_/i.test(base)) return true;
  if (/\.(?:msix|msixbundle|pkg)(?:\.asc|\.sig)?$/i.test(base)) return true;
  if (/pro/i.test(base) && !/^latest-/i.test(base)) return true;
  return false;
}

function walkArtifacts(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('stage-') || /msstore/i.test(entry.name)) continue;
      walkArtifacts(full, results);
      continue;
    }
    if (isStoreOrProArtifact(entry.name, full)) continue;
    if (entry.name.endsWith('.sig') || UPDATER_ARTIFACT.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function collectSearchDirs() {
  const target = path.join(root, 'src-tauri', 'target');
  const dirs = [releaseDir, path.join(target, 'release', 'bundle')];
  if (!fs.existsSync(target)) return dirs;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      dirs.push(path.join(target, entry.name, 'release', 'bundle'));
    }
  }
  return dirs;
}

export function generateUpdaterManifests({
  files = null,
  outputDir = releaseDir,
  log = console,
} = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const discovered =
    files ??
    collectSearchDirs()
      .flatMap((dir) => walkArtifacts(dir))
      .filter((filePath) => {
        const base = path.basename(filePath);
        if (base.endsWith('.sig')) return true;
        return base.includes(VERSION) || /\.app\.tar\.gz$/i.test(base);
      });

  const byName = new Map();
  for (const filePath of discovered) {
    const name = path.basename(filePath);
    const current = byName.get(name);
    if (!current || updaterPackageRank(name) >= updaterPackageRank(path.basename(current))) {
      byName.set(name, filePath);
    }
  }

  const signatureByBaseName = new Map();
  for (const [name, filePath] of byName) {
    if (name.endsWith('.sig')) signatureByBaseName.set(name.slice(0, -4), filePath);
  }

  const manifests = new Map();
  const missingSignatures = [];
  const channelVariants = updaterChannelVariants();

  for (const [name] of byName) {
    if (name.endsWith('.sig')) continue;
    const targets = resolveUpdaterTargets(name);
    if (targets.length === 0) continue;

    const sigPath = signatureByBaseName.get(name);
    if (!sigPath) {
      missingSignatures.push(`${name}.sig`);
      continue;
    }

    const signature = normalizeUpdaterSignature(sigPath);
    for (const target of targets) {
      for (const channel of channelVariants) {
        const targetName = `${target.os}${channel.targetSuffix}`;
        const manifestName = `latest-${targetName}-${target.arch}.json`;
        if (!manifests.has(manifestName)) {
          manifests.set(manifestName, {
            version: VERSION,
            notes: RELEASE_NOTES,
            pub_date: RELEASE_PUB_DATE,
            platforms: {},
            fallbackPriority: -1,
          });
        }
        const manifest = manifests.get(manifestName);
        const url = releaseAssetUrl(name, channel.baseUrl);
        const installerKey = `${targetName}-${target.arch}-${target.installer}`;
        const fallbackKey = `${targetName}-${target.arch}`;
        const packageRank = updaterPackageRank(name);
        const ranks = (manifest._packageRanks ??= {});
        if ((ranks[installerKey] ?? -1) <= packageRank) {
          manifest.platforms[installerKey] = { url, signature };
          ranks[installerKey] = packageRank;
        }

        if (channel.targetSuffix) {
          const installerManifestName = `latest-${installerKey}.json`;
          const existingInstallerManifest = manifests.get(installerManifestName);
          if (
            !existingInstallerManifest ||
            (existingInstallerManifest._packageRanks?.[installerKey] ?? -1) <= packageRank
          ) {
            manifests.set(installerManifestName, {
              version: VERSION,
              notes: RELEASE_NOTES,
              pub_date: RELEASE_PUB_DATE,
              platforms: { [installerKey]: { url, signature } },
              fallbackPriority: -1,
              _packageRanks: { [installerKey]: packageRank },
            });
          }
        }

        const priority = FALLBACK_INSTALLER_PRIORITY[target.os]?.[target.installer] ?? 0;
        if (
          priority > 0 &&
          (!manifest.platforms[fallbackKey] ||
            priority > manifest.fallbackPriority ||
            (priority === manifest.fallbackPriority && packageRank > (ranks[fallbackKey] ?? -1)))
        ) {
          manifest.platforms[fallbackKey] = { url, signature };
          manifest.fallbackPriority = priority;
          ranks[fallbackKey] = packageRank;
        }

        if (
          channel.targetSuffix &&
          priority > 0 &&
          (!manifest.platforms[targetName] ||
            priority > (manifest._bareKeyPriority ?? -1) ||
            (priority === (manifest._bareKeyPriority ?? -1) &&
              packageRank > (ranks[targetName] ?? -1)))
        ) {
          manifest.platforms[targetName] = { url, signature };
          manifest._bareKeyPriority = priority;
          ranks[targetName] = packageRank;
        }
      }
    }
  }

  if (missingSignatures.length > 0) {
    throw new Error(
      `Missing updater signature file(s): ${Array.from(new Set(missingSignatures)).sort().join(', ')}.`
    );
  }

  verifyUpdaterSignatures({
    root,
    releaseDir: outputDir,
    byName,
    signatureByBaseName,
    resolveUpdaterTargets,
  });

  if (manifests.size === 0) {
    if (IS_PRERELEASE || process.env.ALLOW_EMPTY_UPDATER_MANIFESTS === '1') {
      log.warn?.('No updater-eligible artifacts found; skipping manifest generation.');
      return [];
    }
    throw new Error('No updater-eligible artifacts with signatures were found.');
  }

  const generated = [];
  for (const manifestName of Array.from(manifests.keys()).sort()) {
    const manifest = manifests.get(manifestName);
    const output = {
      version: manifest.version,
      pub_date: manifest.pub_date,
      platforms: manifest.platforms,
    };
    if (manifest.notes) output.notes = manifest.notes;
    const dest = path.join(outputDir, manifestName);
    fs.writeFileSync(dest, `${JSON.stringify(output, null, 2)}\n`);
    log.log?.(`  + ${manifestName} (${Object.keys(output.platforms).length} platform entries)`);
    generated.push(dest);
  }

  if (generated.length > 0) {
    const validation = spawnSync(
      process.execPath,
      [path.join(root, 'scripts', 'validate-updater-manifest.js'), ...generated],
      { cwd: root, encoding: 'utf8' }
    );
    if (validation.error) throw validation.error;
    if (validation.status !== 0) {
      throw new Error(
        `Generated updater manifest validation failed: ${validation.stderr || validation.stdout}`
      );
    }
  }

  return generated;
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  // Prefer release:sign:gpg — it applies session filtering and package-set checks.
  // This standalone path only regenerates from already-signed files in release/.
  const allowStandalone = /^(1|true|yes)$/i.test(
    String(process.env.ALLOW_STANDALONE_UPDATER_MANIFESTS || '')
  );
  if (!allowStandalone) {
    console.error(
      'Standalone updater manifest generation is gated.\n' +
        'Use `npm run release:sign:gpg` for the supported release path, or set\n' +
        'ALLOW_STANDALONE_UPDATER_MANIFESTS=1 to regenerate from signed release/ artifacts only.'
    );
    process.exit(1);
  }
  const releaseOnly = fs
    .readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(releaseDir, entry.name));
  const generated = generateUpdaterManifests({ files: releaseOnly });
  console.log(`Generated ${generated.length} updater manifest(s) from release/.`);
}
