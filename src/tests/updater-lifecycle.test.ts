import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn(async (_cmd: string, _args?: unknown) => null as unknown);
const mockGetVersion = vi.fn(async () => '0.1.0');
const mockAsk = vi.fn(async (_msg: string, _opts?: unknown) => true);
const mockMessage = vi.fn(async (_msg: string, _opts?: unknown) => undefined);
const mockIsPermissionGranted = vi.fn(async () => true);
const mockSendNotification = vi.fn((_opts?: unknown) => undefined);
const mockRelaunch = vi.fn(async () => undefined);
const mockCheck = vi.fn();
let mockIsDesktop = true;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) =>
    args !== undefined ? mockInvoke(cmd, args) : mockInvoke(cmd),
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: () => mockGetVersion(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  ask: (msg: string, opts?: unknown) => mockAsk(msg, opts),
  message: (msg: string, opts?: unknown) => mockMessage(msg, opts),
}));

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: () => mockIsPermissionGranted(),
  sendNotification: (options: unknown) => mockSendNotification(options),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: () => mockRelaunch(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: (...args: unknown[]) => mockCheck(...args),
}));

vi.mock('../lib/tauri', () => ({
  isDesktop: () => mockIsDesktop,
}));

describe('updater lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockIsDesktop = true;
    mockInvoke.mockResolvedValue(true);
    mockCheck.mockResolvedValue(null);
  });

  it('reports unsupported updates on non-desktop platforms', async () => {
    mockIsDesktop = false;
    const { resolveUpdatesSupported, getUpdatesSupportedCached } = await import('../lib/updater');
    await expect(resolveUpdatesSupported()).resolves.toBe(false);
    expect(getUpdatesSupportedCached()).toBe(false);
  });

  it('resolves and caches native updates_supported command', async () => {
    mockInvoke.mockResolvedValueOnce(true);
    const { resolveUpdatesSupported, getUpdatesSupportedCached } = await import('../lib/updater');
    await expect(resolveUpdatesSupported()).resolves.toBe(true);
    expect(getUpdatesSupportedCached()).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('updates_supported');

    // Cached hit does not re-invoke IPC
    await expect(resolveUpdatesSupported()).resolves.toBe(true);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('handles IPC failure gracefully when checking updates support', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('IPC unavailable'));
    const { resolveUpdatesSupported } = await import('../lib/updater');
    await expect(resolveUpdatesSupported()).resolves.toBe(false);
  });

  it('informs user when updates are unsupported in interactive check', async () => {
    mockInvoke.mockResolvedValue(false);
    const { checkUpdates } = await import('../lib/updater');
    await checkUpdates();
    expect(mockMessage).toHaveBeenCalledWith(
      expect.stringContaining('app store'),
      expect.objectContaining({ title: 'Updates unavailable' })
    );
  });

  it('reports latest version when no update is found', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'updates_supported') return true;
      if (cmd === 'get_beta_updater_target') return 'darwin-beta-aarch64-app';
      return null;
    });
    mockCheck.mockResolvedValueOnce(null);

    const statuses: string[] = [];
    const { configureUpdater, checkUpdates } = await import('../lib/updater');
    configureUpdater({
      settings: { autoCheckUpdates: true, updateChannel: 'stable' },
      setStatus: (s) => statuses.push(s),
    });

    await checkUpdates();
    expect(mockMessage).toHaveBeenCalledWith(
      expect.stringContaining('latest version'),
      expect.objectContaining({ title: 'No updates' })
    );
    expect(statuses).toContain('Checking updates');
    expect(statuses[statuses.length - 1]).toBe('Ready');
  });

  it('downloads and restarts when an update is accepted', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'updates_supported') return true;
      if (cmd === 'get_beta_updater_target') return 'windows-beta-x86_64-nsis';
      return null;
    });

    const mockUpdate = {
      version: '0.2.0',
      download: vi.fn(async () => undefined),
      install: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    mockCheck.mockResolvedValueOnce(mockUpdate);
    mockAsk.mockResolvedValueOnce(true);

    const statuses: string[] = [];
    const { configureUpdater, checkUpdates } = await import('../lib/updater');
    configureUpdater({
      settings: { autoCheckUpdates: true, updateChannel: 'beta' },
      setStatus: (s) => statuses.push(s),
    });

    await checkUpdates();

    expect(statuses).toContain('Downloading update');
    expect(mockUpdate.download).toHaveBeenCalled();
    expect(mockAsk).toHaveBeenCalled();
    expect(mockUpdate.install).toHaveBeenCalled();
    expect(mockRelaunch).toHaveBeenCalled();
  });

  it('notifies and keeps update ready when user chooses Later', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'updates_supported') return true;
      return null;
    });

    const mockUpdate = {
      version: '0.2.0',
      download: vi.fn(async () => undefined),
      install: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    mockCheck.mockResolvedValueOnce(mockUpdate);
    mockAsk.mockResolvedValueOnce(false);

    const statuses: string[] = [];
    const { configureUpdater, checkUpdates, discardPendingUpdate } = await import('../lib/updater');
    configureUpdater({
      settings: { autoCheckUpdates: true, updateChannel: 'stable' },
      setStatus: (s) => statuses.push(s),
    });

    await checkUpdates();

    expect(statuses).toContain('Update ready');
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Tuxedo MD' })
    );

    // Discarding clears pending update
    discardPendingUpdate();
    expect(mockUpdate.close).toHaveBeenCalled();
  });

  it('performs background download in autoCheckUpdates without interactive prompts', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'updates_supported') return true;
      return null;
    });

    const mockUpdate = {
      version: '0.3.0',
      download: vi.fn(async () => undefined),
      install: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    mockCheck.mockResolvedValueOnce(mockUpdate);
    mockAsk.mockResolvedValueOnce(false);

    const { configureUpdater, autoCheckUpdates } = await import('../lib/updater');
    configureUpdater({
      settings: { autoCheckUpdates: true, updateChannel: 'stable' },
      setStatus: vi.fn(),
    });

    await autoCheckUpdates();
    expect(mockSendNotification).toHaveBeenCalled();
    expect(mockUpdate.download).toHaveBeenCalled();
  });
});
