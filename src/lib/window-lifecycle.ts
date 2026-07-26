import { getCurrentWindow } from '@tauri-apps/api/window';

const CLOSE_CONFIRM_MESSAGE = 'You have unsaved changes. Close Tuxedo MD anyway?';

let bypassUnsavedCloseGuard = false;

export function confirmCloseWithUnsavedChanges(): boolean {
  return confirm(CLOSE_CONFIRM_MESSAGE);
}

export function shouldPreventClose(hasUnsavedChanges: boolean): boolean {
  if (bypassUnsavedCloseGuard) return false;
  if (!hasUnsavedChanges) return false;
  return !confirmCloseWithUnsavedChanges();
}

export async function requestAppClose(hasUnsavedChanges: boolean): Promise<void> {
  if (hasUnsavedChanges && !confirmCloseWithUnsavedChanges()) return;
  bypassUnsavedCloseGuard = true;
  try {
    await getCurrentWindow().close();
  } catch (error) {
    console.error('close failed', error);
  } finally {
    bypassUnsavedCloseGuard = false;
  }
}
