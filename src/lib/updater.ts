import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { ask, message } from '@tauri-apps/plugin-dialog';
import {
  isPermissionGranted,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { isDesktop } from './tauri';
import type { UpdateChannel } from './types';

export type UpdaterSettings = {
  autoCheckUpdates: boolean;
  updateChannel: UpdateChannel;
};

type StatusSetter = (status: string) => void;

let pendingUpdate: Update | null = null;
let pendingVersion: string | null = null;
let pendingTarget: string | undefined;
let updateCheckInFlight: Promise<void> | null = null;
let inFlightCheckIsInteractive = false;
let updateGeneration = 0;
let cachedUpdatesSupported: boolean | null = null;
let settingsRef: UpdaterSettings = {
  autoCheckUpdates: true,
  updateChannel: 'auto',
};
let setStatusRef: StatusSetter = () => {};

const UPDATE_CHECK_TIMEOUT_MS = 30_000;
const UPDATE_DOWNLOAD_TIMEOUT_MS = 120_000;
const UPDATE_INSTALL_TIMEOUT_MS = 180_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function clearPendingUpdate(closeResource: boolean): void {
  const update = pendingUpdate;
  pendingUpdate = null;
  pendingVersion = null;
  pendingTarget = undefined;
  if (closeResource && update) {
    const close = (update as Update & { close?: () => Promise<void> }).close;
    if (close) {
      void close.call(update).catch(() => {});
    }
  }
}

/** Discard a downloaded update when the user changes channel. */
export function discardPendingUpdate(): void {
  updateGeneration += 1;
  clearPendingUpdate(true);
}

export function configureUpdater(options: {
  settings: UpdaterSettings;
  setStatus: StatusSetter;
}): void {
  settingsRef = options.settings;
  setStatusRef = options.setStatus;
}

export async function resolveUpdatesSupported(): Promise<boolean> {
  if (!isDesktop()) {
    cachedUpdatesSupported = false;
    return false;
  }
  if (cachedUpdatesSupported !== null) return cachedUpdatesSupported;
  try {
    cachedUpdatesSupported = await invoke<boolean>('updates_supported');
  } catch {
    cachedUpdatesSupported = false;
  }
  return cachedUpdatesSupported;
}

export function getUpdatesSupportedCached(): boolean | null {
  return cachedUpdatesSupported;
}

/** Pure helper for tests and channel selection. */
export function resolveUpdateCheckTarget(
  channel: UpdateChannel,
  version: string,
  betaTarget: string
): string | undefined {
  if (channel === 'stable') return undefined;
  if (channel === 'beta') return betaTarget;
  return /-(beta|alpha|rc)/i.test(version) ? betaTarget : undefined;
}

async function getUpdateCheckTarget(): Promise<string | undefined> {
  const channel = settingsRef.updateChannel;
  if (channel === 'stable') return undefined;
  if (channel === 'beta') {
    return invoke<string>('get_beta_updater_target');
  }
  const version = await getVersion();
  if (!/-(beta|alpha|rc)/i.test(version)) return undefined;
  return invoke<string>('get_beta_updater_target');
}

/** Installer-specific beta targets must not fall back to the default feed (wrong package). */
export function allowDefaultFeedFallback(target: string | undefined): boolean {
  return !target;
}

async function checkUpdateFeed(target: string | undefined): Promise<Update | null> {
  // No cross-feed fallback: installer-specific beta targets must not pull NSIS/AppImage/etc.
  if (allowDefaultFeedFallback(target)) {
    return await check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
  }
  return await check({
    target,
    timeout: UPDATE_CHECK_TIMEOUT_MS,
  });
}

async function notifyIfAlreadyGranted(title: string, body: string): Promise<void> {
  if (await isPermissionGranted()) {
    sendNotification({ title, body });
  }
}

async function promptInstallAndRestart(
  version: string,
  update: Update,
  generation: number
): Promise<void> {
  if (generation !== updateGeneration) {
    await update.close().catch(() => {});
    return;
  }
  pendingUpdate = update;
  pendingVersion = version;
  setStatusRef('Update ready');
  if (generation !== updateGeneration) return;
  const restart = await ask(
    `Version ${version} has been downloaded and is ready to install.\n\nRestart now to apply the update?`,
    {
      title: 'Update ready',
      kind: 'info',
      okLabel: 'Restart now',
      cancelLabel: 'Later',
    }
  );
  if (generation !== updateGeneration) return;
  if (restart) {
    setStatusRef('Installing update');
    await withTimeout(
      update.install(),
      UPDATE_INSTALL_TIMEOUT_MS,
      `Update install timed out after ${UPDATE_INSTALL_TIMEOUT_MS / 1000} seconds.`
    );
    clearPendingUpdate(false);
    await relaunch();
  } else {
    await notifyIfAlreadyGranted(
      'Tuxedo MD',
      'Update downloaded and ready to install from Check now.'
    );
    setStatusRef('Update ready');
  }
}

async function runUpdateCheck(interactive: boolean): Promise<void> {
  let checkedUpdate: Update | null = null;
  let generation = updateGeneration;
  try {
    if (!(await resolveUpdatesSupported())) {
      if (interactive) {
        await message('Updates are managed by the app store for this build.', {
          title: 'Updates unavailable',
          kind: 'info',
        });
      }
      return;
    }
    const target = await getUpdateCheckTarget();
    if (generation !== updateGeneration) return;
    if (pendingUpdate && pendingTarget !== target) {
      discardPendingUpdate();
      generation = updateGeneration;
    }
    if (pendingUpdate && pendingVersion) {
      if (interactive) {
        await promptInstallAndRestart(pendingVersion, pendingUpdate, generation);
      }
      return;
    }
    if (interactive) setStatusRef('Checking updates');
    checkedUpdate = await checkUpdateFeed(target);
    if (generation !== updateGeneration) {
      await checkedUpdate?.close().catch(() => {});
      return;
    }
    if (!checkedUpdate) {
      if (interactive) {
        await message('You are running the latest version.', {
          title: 'No updates',
        });
        setStatusRef('Ready');
      }
      return;
    }
    if (!interactive) {
      await notifyIfAlreadyGranted(
        'Tuxedo MD Update Available',
        `Version ${checkedUpdate.version} is available. Downloading in the background...`
      );
    }
    setStatusRef('Downloading update');
    await checkedUpdate.download(undefined, {
      timeout: UPDATE_DOWNLOAD_TIMEOUT_MS,
    });
    if (generation !== updateGeneration) {
      await checkedUpdate.close().catch(() => {});
      return;
    }
    pendingTarget = target;
    await promptInstallAndRestart(checkedUpdate.version, checkedUpdate, generation);
    checkedUpdate = null;
  } catch (err) {
    if (checkedUpdate && checkedUpdate !== pendingUpdate) {
      await checkedUpdate.close().catch(() => {});
    }
    const messageText = err instanceof Error ? err.message : String(err);
    setStatusRef('Ready');
    if (interactive) {
      await message(`Failed to check for updates.\n\n${messageText}`, {
        title: 'Update error',
        kind: 'error',
      });
    }
  }
}

function startUpdateCheck(interactive: boolean): Promise<void> {
  if (updateCheckInFlight) {
    if (interactive && !inFlightCheckIsInteractive) {
      return updateCheckInFlight.then(() => startUpdateCheck(true));
    }
    return updateCheckInFlight;
  }
  inFlightCheckIsInteractive = interactive;
  updateCheckInFlight = runUpdateCheck(interactive).finally(() => {
    updateCheckInFlight = null;
    inFlightCheckIsInteractive = false;
  });
  return updateCheckInFlight;
}

export function checkUpdates(): Promise<void> {
  return startUpdateCheck(true);
}

export function autoCheckUpdates(): Promise<void> {
  return startUpdateCheck(false);
}
