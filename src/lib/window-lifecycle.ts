import { getCurrentWindow } from '@tauri-apps/api/window';
import { isDesktop } from './tauri';

type ClosePhase = 'idle' | 'flushing' | 'destroying';

let closePhase: ClosePhase = 'idle';

export function isAppClosing(): boolean {
  return closePhase !== 'idle';
}

/**
 * Quit after optional recovery flush. Dirty buffers are draft-saved by the caller —
 * no confirm dialog on window close (Notepad++-style).
 *
 * CloseRequested stays intercepted through flush+destroy so a second native close
 * cannot skip the draft write.
 */
export async function requestAppClose(beforeClose?: () => Promise<void>): Promise<void> {
  if (closePhase !== 'idle') return;
  closePhase = 'flushing';
  try {
    await beforeClose?.();
    closePhase = 'destroying';
    await getCurrentWindow().destroy();
  } catch (error) {
    closePhase = 'idle';
    console.error('close failed', error);
  }
}

/** Native chrome / Alt+F4: always intercept until destroy completes. */
export function shouldInterceptNativeClose(): boolean {
  return closePhase !== 'destroying';
}

export type DirtyTabCloseChoice = 'save' | 'discard' | 'cancel';

/** Native Save / Don't Save / Cancel for closing a dirty tab. */
export async function askDirtyTabClose(tabName: string): Promise<DirtyTabCloseChoice> {
  if (!isDesktop()) {
    const save = confirm(
      `"${tabName}" has unsaved changes.\n\nOK saves. Cancel shows more options.`
    );
    if (save) return 'save';
    const discard = confirm(
      `Discard changes to "${tabName}"?\n\nOK discards. Cancel keeps the tab open.`
    );
    return discard ? 'discard' : 'cancel';
  }

  const { message } = await import('@tauri-apps/plugin-dialog');
  const result = await message(
    `"${tabName}" has unsaved changes.\n\nSave writes the file. Don't Save discards this tab's edits. Cancel keeps the tab open.\n\nClosing the app keeps drafts and restores them next launch without writing your files.`,
    {
      title: 'Close tab',
      kind: 'warning',
      buttons: {
        yes: 'Save',
        no: "Don't Save",
        cancel: 'Cancel',
      },
    }
  );

  if (result === 'Save' || result === 'Yes') return 'save';
  if (result === "Don't Save" || result === 'No') return 'discard';
  return 'cancel';
}
