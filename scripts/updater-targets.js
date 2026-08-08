/**
 * @typedef {{ os: 'windows' | 'linux' | 'darwin'; arch: string; installer: string }} UpdaterTarget
 */

/**
 * Prefer Tauri v2 updater packages over raw installers for the same target.
 * @param {string} name
 * @returns {number}
 */
export function updaterPackageRank(name) {
  if (/\.nsis\.zip$/i.test(name) || /\.app\.tar\.gz$/i.test(name)) return 2;
  if (/\.appimage\.tar\.gz$/i.test(name)) return 2;
  return 1;
}

/**
 * @param {string} name
 * @returns {string | null}
 */
function inferArchFromName(name) {
  if (/(?:^|[-_.])(aarch64|arm64)(?:[-_.]|$)/i.test(name)) return 'aarch64';
  if (/(?:^|[-_.])(x86_64|amd64|x64)(?:[-_.]|$)/i.test(name)) return 'x86_64';
  if (/(?:^|[-_.])(i686|x86)(?:[-_.]|$)/i.test(name)) return 'i686';
  if (/universal/i.test(name)) return null;
  return null;
}

/**
 * Map a release artifact basename to Tauri updater platform targets.
 * @param {string} name
 * @returns {UpdaterTarget[]}
 */
export function resolveUpdaterTargets(name) {
  /** @type {UpdaterTarget[]} */
  const targets = [];
  if (/\.app\.tar\.gz$/i.test(name)) {
    const arch = inferArchFromName(name);
    const arches = arch ? [arch] : ['x86_64', 'aarch64'];
    for (const a of arches) targets.push({ os: 'darwin', arch: a, installer: 'app' });
    return targets;
  }
  if (/\.msi$/i.test(name)) {
    const arch = inferArchFromName(name);
    if (!arch) return targets;
    targets.push({ os: 'windows', arch, installer: 'msi' });
    return targets;
  }
  if (/\.nsis\.zip$/i.test(name) || /\.exe$/i.test(name)) {
    const arch = inferArchFromName(name);
    if (!arch) return targets;
    targets.push({ os: 'windows', arch, installer: 'nsis' });
    return targets;
  }
  if (/\.appimage(?:\.tar\.gz)?$/i.test(name)) {
    const arch = inferArchFromName(name);
    if (!arch) return targets;
    targets.push({ os: 'linux', arch, installer: 'appimage' });
    return targets;
  }
  if (/\.deb$/i.test(name)) {
    const arch = inferArchFromName(name);
    if (!arch) return targets;
    targets.push({ os: 'linux', arch, installer: 'deb' });
    return targets;
  }
  if (/\.rpm$/i.test(name)) {
    const arch = inferArchFromName(name);
    if (!arch) return targets;
    targets.push({ os: 'linux', arch, installer: 'rpm' });
    return targets;
  }
  return targets;
}
