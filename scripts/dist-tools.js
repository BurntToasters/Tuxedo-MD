#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createReleaseSession, verifyQualityGate } from './release-session.js';

const TAURI_TARGET_DIR = path.join('src-tauri', 'target');
const RELEASE_BUILD_SESSION = '.build-session.json';

const CLEAN_TARGETS = {
  clean: ['dist', 'coverage', 'coverage-headless'],
  'clean-release': ['release'],
  'clean-release-artifacts': ['release', 'dist', 'msstore', 'mas'],
  'clean-all': ['dist', 'coverage', 'coverage-headless', 'release', 'msstore', 'mas', 'src-tauri/target'],
};

function listTauriBundleDirs(cwd) {
  const targetRoot = path.join(cwd, TAURI_TARGET_DIR);
  if (!fs.existsSync(targetRoot)) return [];

  const results = [];
  const addIfDir = (fullPath) => {
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        results.push(path.relative(cwd, fullPath));
      }
    } catch {
      // Ignore bundle paths that disappear while cleaning or cannot be inspected.
    }
  };

  addIfDir(path.join(targetRoot, 'release', 'bundle'));
  addIfDir(path.join(targetRoot, 'debug', 'bundle'));

  try {
    for (const entry of fs.readdirSync(targetRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const base = path.join(targetRoot, entry.name);
      addIfDir(path.join(base, 'release', 'bundle'));
      addIfDir(path.join(base, 'debug', 'bundle'));
      addIfDir(path.join(base, 'bundle'));
    }
  } catch {
    // Missing or unreadable target directories simply contain no bundle outputs.
  }

  return Array.from(new Set(results));
}

function getCleanTargets(mode, cwd) {
  const baseTargets = CLEAN_TARGETS[mode];
  if (!baseTargets) {
    throw new Error(`Unknown clean mode "${mode}"`);
  }

  if (mode === 'clean-release-artifacts' || mode === 'clean-all') {
    return Array.from(new Set([...baseTargets, ...listTauriBundleDirs(cwd)]));
  }

  return baseTargets;
}

function cleanDirs(mode) {
  const cwd = process.cwd();
  const dirs = getCleanTargets(mode, cwd);

  if (mode === 'clean-release-artifacts') {
    verifyQualityGate(cwd);
  }

  for (const relativeDir of dirs) {
    const dir = path.resolve(cwd, relativeDir);
    try {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 100,
      });
      console.log(`Removed ${relativeDir}`);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      const message =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error);
      throw new Error(`Failed to clean "${relativeDir}": ${message}`, { cause: error });
    }
  }

  if (mode === 'clean-release-artifacts') {
    const releaseDir = path.join(cwd, 'release');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(releaseDir, RELEASE_BUILD_SESSION),
      `${JSON.stringify(createReleaseSession(cwd))}\n`,
      { flag: 'wx', mode: 0o600 }
    );
  }
}

const mode = process.argv[2];
if (
  mode === 'clean' ||
  mode === 'clean-release' ||
  mode === 'clean-release-artifacts' ||
  mode === 'clean-all'
) {
  cleanDirs(mode);
  process.exit(0);
}

console.error(
  'Usage: node scripts/dist-tools.js <clean|clean-release|clean-release-artifacts|clean-all>'
);
process.exit(1);
