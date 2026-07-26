import fs from 'node:fs';
import {
  RELEASE_DIR,
  finalizeReleaseAssets,
  getAfterPackLocation,
} from './release-mirror.js';

function banner(message) {
  fs.writeSync(2, `[release:mirror] ${message}\n`);
}

banner('starting');
banner(`platform=${process.platform}; node=${process.version}`);
banner(`cwd=${process.cwd()}`);
banner(`releaseDir=${RELEASE_DIR}`);
banner(`AFTER_PACK_LOC=${JSON.stringify(getAfterPackLocation())}`);

try {
  const result = finalizeReleaseAssets({ logger: console });
  banner(
    `finished ok; mirrored=${result.mirrored}; copied=${result.copiedEntries}; dest=${result.destination || '(skipped)'}`,
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
