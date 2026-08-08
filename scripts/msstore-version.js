/**
 * Map semver (+ prerelease) onto a strictly increasing MSIX Identity Version.
 * @param {string} version
 * @returns {string}
 */
export function toMsixIdentityVersion(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/i);
  if (!match) {
    throw new Error(
      `Unsupported package version for MSIX identity: ${version}. Expected X.Y.Z or X.Y.Z-(alpha|beta|rc).N`
    );
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const preKind = (match[4] || '').toLowerCase();
  const preN = Number(match[5] || 0);
  if ([major, minor, patch, preN].some((part) => !Number.isInteger(part) || part < 0 || part > 65535)) {
    throw new Error(`MSIX version components out of range for ${version}`);
  }
  let revision = 3000; // stable sorts above prereleases of the same X.Y.Z
  if (preKind === 'alpha') revision = 1000 + preN;
  else if (preKind === 'beta') revision = 2000 + preN;
  else if (preKind === 'rc') revision = 2500 + preN;
  if (revision > 65535) {
    throw new Error(`MSIX revision overflow for ${version}`);
  }
  return `${major}.${minor}.${patch}.${revision}`;
}
