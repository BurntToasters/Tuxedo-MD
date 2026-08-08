import fs from 'node:fs';
import { RELEASE_DIR, finalizeReleaseAssets, getAfterPackLocation } from './release-mirror.js';

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
  const allowSkip = /^(1|true|yes)$/i.test(String(process.env.SKIP_RELEASE_MIRROR || ''));
  if (!result.mirrored && !allowSkip) {
    throw new Error(
      'AFTER_PACK_LOC is not set. Refusing to finalize without an off-box mirror (git clean would wipe release/). Set AFTER_PACK_LOC or SKIP_RELEASE_MIRROR=1.'
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
