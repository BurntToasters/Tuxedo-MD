import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RELEASE_DIR = path.join(__dirname, '..', 'release');

const BUILD_ONLY_DIRECTORIES = [
  'app',
  'appimage',
  'deb',
  'dmg',
  'macos',
  'msi',
  'msix',
  'nsis',
  'rpm',
];
const BUILD_ONLY_FILES = [
  'builder-debug.yml',
  'builder-effective-config.yaml',
  '.build-session.json',
];
const HASH_BUFFER_BYTES = 1024 * 1024;

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
  const fd = fs.openSync(filePath, 'r');
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function removePath(targetPath) {
  fs.rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 100,
  });
}

export function cleanReleaseArtifacts(releaseDir = RELEASE_DIR) {
  for (const dir of BUILD_ONLY_DIRECTORIES) {
    removePath(path.join(releaseDir, dir));
  }
  for (const file of BUILD_ONLY_FILES) {
    removePath(path.join(releaseDir, file));
  }
}

export function getAfterPackLocation(env = process.env) {
  const value = env.AFTER_PACK_LOC;
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export function isBetaReleaseVersion(version) {
  const numeric = '(?:0|[1-9]\\d*)';
  return new RegExp(`^${numeric}\\.${numeric}\\.${numeric}-beta\\.${numeric}$`).test(
    String(version ?? '')
  );
}

export function readPackageVersion(repositoryRoot = path.join(__dirname, '..')) {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
  );
  return typeof packageJson.version === 'string' ? packageJson.version : '';
}

export function shouldSkipBetaMirror(env = process.env, version) {
  if (!isBetaReleaseVersion(version)) return false;
  return String(env.OVERRIDE_BETA_MIRROR_SKIP ?? '').trim() !== '1';
}

export function pathsEqual(left, right, platform = process.platform) {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  if (platform === 'win32') {
    return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase();
  }
  return resolvedLeft === resolvedRight;
}

export function isMirrorableReleaseEntry(name) {
  if (!name || name.startsWith('.')) return false;
  // Keep Pro/store packs out of AFTER_PACK_LOC mirrors (CE GitHub release only).
  if (/^TuxedoMD\.Pro_/i.test(name)) return false;
  if (/\.(?:msix|msixbundle|pkg)$/i.test(name)) return false;
  return true;
}

export function getReleaseEntries(releaseDir) {
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`release directory does not exist: ${releaseDir}`);
  }
  const entries = fs.readdirSync(releaseDir).filter(isMirrorableReleaseEntry);
  if (!entries.length) {
    throw new Error(`release directory is empty: ${releaseDir}`);
  }
  return entries;
}

export function verifyCopiedPath(sourcePath, destinationPath) {
  const source = fs.statSync(sourcePath);
  let destination;
  try {
    destination = fs.statSync(destinationPath);
  } catch {
    throw new Error(`mirrored path is missing: ${destinationPath}`);
  }

  if (source.isDirectory() !== destination.isDirectory()) {
    throw new Error(`mirrored path type differs: ${destinationPath}`);
  }
  if (source.isFile()) {
    if (source.size !== destination.size) {
      throw new Error(
        `mirrored file size differs: ${destinationPath} (${destination.size} bytes; expected ${source.size})`
      );
    }
    const sourceDigest = sha256File(sourcePath);
    const destinationDigest = sha256File(destinationPath);
    if (sourceDigest !== destinationDigest) {
      throw new Error(`mirrored file hash differs: ${destinationPath}`);
    }
  }

  if (source.isDirectory()) {
    for (const entry of fs.readdirSync(sourcePath)) {
      verifyCopiedPath(path.join(sourcePath, entry), path.join(destinationPath, entry));
    }
  }
}

function progress(logger, message) {
  if (logger && typeof logger.error === 'function') {
    logger.error(`[release:mirror] ${message}`);
  }
}

function copyFileForMirror(sourcePath, destinationPath) {
  try {
    fs.copyFileSync(sourcePath, destinationPath);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code !== 'EPERM' && code !== 'EACCES') {
      throw error;
    }
    fs.writeFileSync(destinationPath, fs.readFileSync(sourcePath));
  }
}

function copyPathRecursive(sourcePath, destinationPath) {
  const source = fs.statSync(sourcePath);
  if (source.isDirectory()) {
    fs.mkdirSync(destinationPath, { recursive: true });
    for (const entry of fs.readdirSync(sourcePath)) {
      copyPathRecursive(path.join(sourcePath, entry), path.join(destinationPath, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  copyFileForMirror(sourcePath, destinationPath);
}

export function copyReleaseAssets(
  releaseDir = RELEASE_DIR,
  destination,
  { logger = console } = {}
) {
  if (!destination) {
    throw new Error('AFTER_PACK_LOC is empty');
  }

  const resolvedReleaseDir = path.resolve(releaseDir);
  const resolvedDestination = path.resolve(destination);
  progress(logger, `copy resolve: src=${resolvedReleaseDir} dest=${resolvedDestination}`);

  if (pathsEqual(resolvedDestination, resolvedReleaseDir)) {
    throw new Error('AFTER_PACK_LOC cannot be the release directory');
  }

  const releasePrefix = `${resolvedReleaseDir}${path.sep}`;
  const destinationForComparison =
    process.platform === 'win32' ? resolvedDestination.toLowerCase() : resolvedDestination;
  const releasePrefixForComparison =
    process.platform === 'win32' ? releasePrefix.toLowerCase() : releasePrefix;
  if (destinationForComparison.startsWith(releasePrefixForComparison)) {
    throw new Error('AFTER_PACK_LOC cannot be inside the release directory');
  }

  progress(logger, `mkdir ${resolvedDestination}`);
  fs.mkdirSync(resolvedDestination, { recursive: true });
  const probePath = path.join(resolvedDestination, `.tuxedo-mirror-probe-${process.pid}`);
  fs.writeFileSync(probePath, 'ok');
  fs.rmSync(probePath, { force: true });
  progress(logger, 'destination writable');

  const entries = getReleaseEntries(resolvedReleaseDir);
  progress(logger, `copying ${entries.length} entries`);

  for (const entry of entries) {
    const sourcePath = path.join(resolvedReleaseDir, entry);
    const destinationPath = path.join(resolvedDestination, entry);
    progress(logger, `copy ${entry}`);
    copyPathRecursive(sourcePath, destinationPath);
    verifyCopiedPath(sourcePath, destinationPath);
    progress(logger, `verified ${entry}`);
  }

  return entries.length;
}

function run({
  releaseDir = RELEASE_DIR,
  env = process.env,
  logger = console,
  version = readPackageVersion(),
} = {}) {
  if (shouldSkipBetaMirror(env, version)) {
    logger.log(
      `beta version ${version}; skipping AFTER_PACK_LOC mirror (set OVERRIDE_BETA_MIRROR_SKIP=1 to force).`
    );
    return { mirrored: false, destination: '', copiedEntries: 0, skippedBetaMirror: true };
  }
  const destination = getAfterPackLocation(env);
  if (!destination) {
    logger.log('AFTER_PACK_LOC not set; skipping release mirror.');
    return { mirrored: false, destination: '', copiedEntries: 0, skippedBetaMirror: false };
  }

  progress(logger, 'cleaning build-only release artifacts');
  cleanReleaseArtifacts(releaseDir);
  progress(logger, 'clean complete');

  const copiedEntries = copyReleaseAssets(releaseDir, destination, { logger });
  return {
    mirrored: true,
    destination: path.resolve(destination),
    copiedEntries,
    skippedBetaMirror: false,
  };
}

export function finalizeReleaseAssets({
  releaseDir = RELEASE_DIR,
  env = process.env,
  logger = console,
  version = readPackageVersion(),
} = {}) {
  const result = run({ releaseDir, env, logger, version });
  if (result.mirrored) {
    logger.log(
      `Mirrored and verified ${result.copiedEntries} cleaned release entries to: ${result.destination}`
    );
  }
  return result;
}
