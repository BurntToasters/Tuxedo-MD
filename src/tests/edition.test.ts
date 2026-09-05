import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  applyBuildInfo,
  applySafeFallback,
  capabilityMessage,
  capabilityRegistry,
  editionState,
  getEdition,
  getEditionLabel,
  getEditionSnapshot,
  getEditionVersion,
  getEditionWarning,
  hasCapability,
  initializeEdition,
  isFullEdition,
  isOpaqueWindow,
  requireCapability,
  resolveBuildInfo,
  resolveSafeFallback,
} from '../lib/edition';

describe('edition subsystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('provides capability messaging for shipped and unshipped capabilities', () => {
    applySafeFallback(new Error('test'));
    expect(hasCapability('workspaceSearch')).toBe(false);

    const communityMsg = capabilityMessage('workspaceSearch');
    expect(communityMsg).toContain('available in Tuxedo MD Pro');

    const unshippedMsg = capabilityMessage('mermaid');
    expect(unshippedMsg).toContain('planned for a future Tuxedo MD Pro release');

    applyBuildInfo({
      edition: 'full',
      version: '0.1.0-alpha.1',
      capabilities: ['workspaceSearch'],
    });
    expect(hasCapability('workspaceSearch')).toBe(true);
    expect(capabilityRegistry.workspaceSearch.label).toBe('Indexed workspace search');
    expect(editionState.edition).toBe('full');
    const proMsg = capabilityMessage('workspaceSearch');
    expect(proMsg).toContain('enabled in Tuxedo MD Pro');
  });

  it('authorizes capabilities through requireCapability when enabled', async () => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    mockInvoke.mockResolvedValue(undefined);

    applyBuildInfo({
      edition: 'full',
      version: '0.1.0-alpha.1',
      capabilities: ['workspaceSearch'],
    });

    await expect(requireCapability('workspaceSearch')).resolves.toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledWith('authorize_capability', {
      capability: 'workspaceSearch',
    });

    await expect(requireCapability('mermaid')).rejects.toThrow();
  });

  it('handles initializeEdition on desktop and non-desktop', async () => {
    // Non-desktop does nothing
    await initializeEdition();
    expect(mockInvoke).not.toHaveBeenCalled();

    // Desktop retrieves build info
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    mockInvoke.mockResolvedValueOnce({
      edition: 'full',
      version: '1.0.0',
      capabilities: ['workspaceSearch', 'backlinks'],
      opaqueWindow: true,
    });

    await initializeEdition();
    expect(getEdition()).toBe('full');
    expect(isFullEdition()).toBe(true);
    expect(getEditionLabel()).toBe('Pro');
    expect(getEditionVersion()).toBe('1.0.0');
    expect(isOpaqueWindow()).toBe(true);

    const snapshot = getEditionSnapshot();
    expect(snapshot.edition).toBe('full');
    expect(snapshot.opaqueWindow).toBe(true);
  });

  it('handles initializeEdition error by falling back safely', async () => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    mockInvoke.mockRejectedValueOnce(new Error('IPC failed'));

    await initializeEdition();
    expect(getEdition()).toBe('community');
    expect(isFullEdition()).toBe(false);
    expect(getEditionLabel()).toBe('Community');
    expect(getEditionWarning()).toContain('Community safeguards are in force');
  });

  it('pure resolveBuildInfo generates warnings on unknown edition or mismatch', () => {
    const resUnknown = resolveBuildInfo(
      { edition: 'beta' as any, version: '1.0', capabilities: [] },
      'full'
    );
    expect(resUnknown.editionWarning).toContain('unknown edition');

    const resMismatch = resolveBuildInfo(
      { edition: 'community', version: '1.0', capabilities: [] },
      'full'
    );
    expect(resMismatch.editionWarning).toContain('frontend requested Pro');
  });

  it('pure resolveSafeFallback handles non-Error objects', () => {
    const fallback = resolveSafeFallback('network offline');
    expect(fallback.editionWarning).toContain('network offline');
  });
});
