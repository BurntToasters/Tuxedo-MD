import { beforeEach, describe, expect, it, vi } from 'vitest';

const destroy = vi.fn(async () => undefined);
const close = vi.fn(async () => undefined);
const message = vi.fn();
let desktop = true;

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ destroy, close }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  message: (...args: unknown[]) => message(...args),
}));

vi.mock('../lib/tauri', () => ({
  isDesktop: () => desktop,
}));

describe('requestAppClose', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    destroy.mockClear();
    destroy.mockResolvedValue(undefined);
    close.mockClear();
    message.mockReset();
    desktop = true;
    vi.resetModules();
  });

  it('flushes via beforeClose then destroys without a dirty confirm', async () => {
    const beforeClose = vi.fn(async () => undefined);
    const { requestAppClose } = await import('../lib/window-lifecycle');
    await requestAppClose(beforeClose);
    expect(beforeClose).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
  });

  it('keeps intercepting during flush so a second close cannot skip it', async () => {
    let resolveFlush!: () => void;
    const beforeClose = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        })
    );
    const mod = await import('../lib/window-lifecycle');
    const first = mod.requestAppClose(beforeClose);
    expect(mod.shouldInterceptNativeClose()).toBe(true);
    const second = mod.requestAppClose(beforeClose);
    resolveFlush();
    await Promise.all([first, second]);
    expect(beforeClose).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('does not intercept while destroying', async () => {
    let resolveDestroy!: () => void;
    destroy.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveDestroy = () => resolve(undefined);
        })
    );
    const mod = await import('../lib/window-lifecycle');
    const pending = mod.requestAppClose();
    await Promise.resolve();
    expect(mod.shouldInterceptNativeClose()).toBe(false);
    resolveDestroy();
    await pending;
  });

  it('resets phase when destroy fails', async () => {
    destroy.mockRejectedValueOnce(new Error('boom'));
    const mod = await import('../lib/window-lifecycle');
    await mod.requestAppClose();
    expect(mod.isAppClosing()).toBe(false);
    expect(mod.shouldInterceptNativeClose()).toBe(true);
    destroy.mockResolvedValueOnce(undefined);
    await mod.requestAppClose();
    expect(destroy).toHaveBeenCalledTimes(2);
  });
});

describe('askDirtyTabClose', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    message.mockReset();
    desktop = true;
    vi.resetModules();
  });

  it("maps Save / Don't Save / Cancel button labels", async () => {
    const { askDirtyTabClose } = await import('../lib/window-lifecycle');

    message.mockResolvedValueOnce('Save');
    expect(await askDirtyTabClose('Welcome.md')).toBe('save');

    message.mockResolvedValueOnce("Don't Save");
    expect(await askDirtyTabClose('Welcome.md')).toBe('discard');

    message.mockResolvedValueOnce('Cancel');
    expect(await askDirtyTabClose('Welcome.md')).toBe('cancel');
  });

  it('maps Yes/No aliases from native dialogs', async () => {
    const { askDirtyTabClose } = await import('../lib/window-lifecycle');

    message.mockResolvedValueOnce('Yes');
    expect(await askDirtyTabClose('Welcome.md')).toBe('save');

    message.mockResolvedValueOnce('No');
    expect(await askDirtyTabClose('Welcome.md')).toBe('discard');
  });

  it('uses two-step confirms on web for save/discard/cancel', async () => {
    desktop = false;
    const confirm = vi.spyOn(window, 'confirm');
    const { askDirtyTabClose } = await import('../lib/window-lifecycle');

    confirm.mockReturnValueOnce(true);
    expect(await askDirtyTabClose('a.md')).toBe('save');

    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true);
    expect(await askDirtyTabClose('a.md')).toBe('discard');

    confirm.mockReturnValueOnce(false).mockReturnValueOnce(false);
    expect(await askDirtyTabClose('a.md')).toBe('cancel');
  });
});
