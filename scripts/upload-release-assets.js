/**
 * Fallback CE-only uploader for assets already staged in release/.
 * Prefer release:sign:gpg (which uploads after staging). This script never
 * walks msstore/ or target/ and rejects Pro/store filenames.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { verifyReleaseSession } from './release-session.js';

const root = path.resolve(import.meta.dirname, '..');
verifyReleaseSession(root);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag = `v${pkg.version}`;
const repo = `${process.env.GH_REPO_OWNER || 'BurntToasters'}/${process.env.GH_REPO_NAME || 'Tuxedo-MD'}`;
const releaseDir = path.join(root, 'release');
const gh = process.platform === 'win32' ? 'gh.exe' : 'gh';
const allowPublishedReplace = /^(1|true|yes)$/i.test(String(process.env.ALLOW_ASSET_REPLACE || ''));

const CE_ALLOWED =
  /(?:\.(?:zip|dmg|AppImage|deb|rpm|exe|msi|sig|asc|json|txt)|(?:\.nsis\.zip|\.app\.tar\.gz|\.appimage\.tar\.gz))$/i;

function isStoreOrProArtifact(name) {
  if (/^TuxedoMD\.Pro_/i.test(name)) return true;
  if (/\.(?:msix|msixbundle|pkg)(?:\.asc|\.sig)?$/i.test(name)) return true;
  if (/pro/i.test(name) && !/^latest-/i.test(name) && !/^SHA256SUMS/i.test(name)) return true;
  return false;
}

function isCeUploadCandidate(name) {
  if (isStoreOrProArtifact(name)) return false;
  if (name.startsWith('.')) return false;
  if (/^SHA256SUMS(?:-[a-z0-9_-]+)?\.txt$/i.test(name)) return true;
  if (/^latest-[a-z0-9_-]+\.json$/i.test(name)) return true;
  return CE_ALLOWED.test(name);
}

const files = [];
if (!fs.existsSync(releaseDir)) {
  throw new Error('No release/ directory. Run release:sign:gpg first to stage CE artifacts.');
}
for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (!isCeUploadCandidate(entry.name)) continue;
  files.push(path.join(releaseDir, entry.name));
}

if (!files.length) throw new Error('No CE release assets found in release/.');

const releaseJson = execFileSync(
  gh,
  ['release', 'view', tag, '--repo', repo, '--json', 'isDraft'],
  { encoding: 'utf8' }
);
const release = JSON.parse(releaseJson);
if (!release?.isDraft && !allowPublishedReplace) {
  throw new Error(
    `Release ${tag} is published. Refusing to clobber assets without ALLOW_ASSET_REPLACE=true.`
  );
}

execFileSync(gh, ['release', 'upload', tag, '--repo', repo, '--clobber', ...files], {
  stdio: 'inherit',
});
console.log(
  `Uploaded ${files.length} CE assets to ${tag}. The release remains a ${
    release?.isDraft ? 'draft' : 'published release'
  } for review.`
);
