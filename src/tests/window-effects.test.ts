import { beforeEach, describe, expect, it, vi } from 'vitest';

const clearEffects = vi.fn(async () => undefined);
const setEffects = vi.fn(async () => undefined);
const setBackgroundColor = vi.fn(async () => undefined);

vi.mock('@tauri-apps/api/window', () => ({
  Effect: { HudWindow: 'HudWindow', Mica: 'Mica', Tabbed: 'Tabbed', Acrylic: 'Acrylic' },
  EffectState: { FollowsWindowActiveState: 'FollowsWindowActiveState' },
  getCurrentWindow: () => ({ clearEffects, setEffects, setBackgroundColor }),
}));

vi.mock('../lib/tauri', () => ({
  isDesktop: () => true,
}));

describe('applyNativeWindowEffects', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearEffects.mockClear();
    setEffects.mockClear();
    setBackgroundColor.mockClear();
    vi.resetModules();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-transparency: reduce') ? false : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
  });

  it('forces opaque when glass is off', async () => {
    const { applyNativeWindowEffects } = await import('../lib/window');
    await expect(applyNativeWindowEffects('off', true)).resolves.toBe('opaque');
    expect(clearEffects).toHaveBeenCalled();
    expect(setBackgroundColor).toHaveBeenCalled();
  });

  it('forces opaque when opaqueWindow is set (MAS)', async () => {
    const { applyNativeWindowEffects } = await import('../lib/window');
    await expect(applyNativeWindowEffects('on', true, { opaqueWindow: true })).resolves.toBe(
      'opaque'
    );
    expect(clearEffects).toHaveBeenCalled();
  });

  it('returns native when Windows materials succeed for system', async () => {
    setEffects.mockResolvedValue(undefined);
    const { applyNativeWindowEffects } = await import('../lib/window');
    await expect(applyNativeWindowEffects('system', true)).resolves.toBe('native');
    expect(setEffects).toHaveBeenCalled();
  });

  it('falls back to opaque for system when materials fail', async () => {
    setEffects.mockRejectedValue(new Error('no mica'));
    const { applyNativeWindowEffects } = await import('../lib/window');
    await expect(applyNativeWindowEffects('system', false)).resolves.toBe('opaque');
  });

  it('falls back to css frost for on when materials fail', async () => {
    setEffects.mockRejectedValue(new Error('no mica'));
    const { applyNativeWindowEffects } = await import('../lib/window');
    await expect(applyNativeWindowEffects('on', false)).resolves.toBe('css');
  });
});
