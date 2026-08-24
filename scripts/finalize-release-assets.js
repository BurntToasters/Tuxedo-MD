import fs from 'node:fs';
import {
  RELEASE_DIR,
  finalizeReleaseAssets,
  getAfterPackLocation,
  readPackageVersion,
  shouldSkipBetaMirror,
} from './release-mirror.js';

function banner(message) {
  fs.writeSync(2, `[release:mirror] ${message}\n`);
}

banner('starting');
banner(`platform=${process.platform}; node=${process.version}`);
banner(`cwd=${process.cwd()}`);
banner(`releaseDir=${RELEASE_DIR}`);
banner(`AFTER_PACK_LOC=${JSON.stringify(getAfterPackLocation())}`);
banner(`version=${JSON.stringify(readPackageVersion())}`);

try {
  const version = readPackageVersion();
  const result = finalizeReleaseAssets({ logger: console, version });
  const allowSkip = /^(1|true|yes)$/i.test(String(process.env.SKIP_RELEASE_MIRROR || ''));
  const skipBeta = shouldSkipBetaMirror(process.env, version);
  if (!result.mirrored && !allowSkip && !skipBeta) {
    throw new Error(
      `Stable release ${version} requires AFTER_PACK_LOC so artifacts are mirrored before git clean. Set AFTER_PACK_LOC or SKIP_RELEASE_MIRROR=1. Beta versions (X.Y.Z-beta.N) skip the mirror by default.`
    );
  }
  banner(
    `finished ok; mirrored=${result.mirrored}; copied=${result.copiedEntries}; dest=${result.destination || '(skipped)'}`
  );
  process.exit(0);
} catch (error) {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error);
  banner(`FAILED: ${message}`);
  process.exit(1);
}
