import { beforeEach, describe, expect, it, vi } from 'vitest';

const clearEffects = vi.fn(async () => undefined);
const setEffects = vi.fn(async () => undefined);
const setBackgroundColor = vi.fn(async () => undefined);

const isMaximized = vi.fn(async () => false);
const isFullscreen = vi.fn(async () => false);
const innerSize = vi.fn(async () => ({ width: 800, height: 600 }));
const outerPosition = vi.fn(async () => ({ x: 100, y: 100 }));
const setSize = vi.fn(async () => undefined);
const setPosition = vi.fn(async () => undefined);
const currentMonitor = vi.fn(async () => ({
  scaleFactor: 1,
  workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
}));

vi.mock('@tauri-apps/api/window', () => ({
  Effect: { HudWindow: 'HudWindow', Mica: 'Mica', Tabbed: 'Tabbed', Acrylic: 'Acrylic' },
  EffectState: { FollowsWindowActiveState: 'FollowsWindowActiveState' },
  PhysicalSize: class {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
  },
  PhysicalPosition: class {
    x: number;
    y: number;
    constructor(x: number, y: number) {
      this.x = x;
      this.y = y;
    }
  },
  currentMonitor: () => currentMonitor(),
  getCurrentWindow: () => ({
    clearEffects,
    setEffects,
    setBackgroundColor,
    isMaximized,
    isFullscreen,
    innerSize,
    outerPosition,
    setSize,
    setPosition,
  }),
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

  it('supports macOS HudWindow effects', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    });
    setEffects.mockResolvedValue(undefined);
    const { applyNativeWindowEffects } = await import('../lib/window');
    await expect(applyNativeWindowEffects('system', true)).resolves.toBe('native');
    expect(setEffects).toHaveBeenCalled();
  });

  it('handles Linux fallback to opaque or css', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (X11; Linux x86_64)',
    });
    const { applyNativeWindowEffects } = await import('../lib/window');
    await expect(applyNativeWindowEffects('system', true)).resolves.toBe('opaque');
    await expect(applyNativeWindowEffects('on', true)).resolves.toBe('css');
  });
});

describe('resizeWindowForDrawer', () => {
  beforeEach(() => {
    isMaximized.mockResolvedValue(false);
    isFullscreen.mockResolvedValue(false);
    innerSize.mockResolvedValue({ width: 800, height: 600 });
    outerPosition.mockResolvedValue({ x: 100, y: 100 });
    setSize.mockClear();
    setPosition.mockClear();
  });

  it('refuses to resize when window is maximized or fullscreen', async () => {
    isMaximized.mockResolvedValueOnce(true);
    const { resizeWindowForDrawer } = await import('../lib/window');
    expect(await resizeWindowForDrawer(true)).toBe(false);

    isFullscreen.mockResolvedValueOnce(true);
    expect(await resizeWindowForDrawer(true)).toBe(false);
  });

  it('resizes window when opening and closing drawer', async () => {
    const { resizeWindowForDrawer } = await import('../lib/window');
    const opened = await resizeWindowForDrawer(true);
    expect(opened).toBe(true);
    expect(setSize).toHaveBeenCalled();

    const closed = await resizeWindowForDrawer(false);
    expect(closed).toBe(true);
    expect(setSize).toHaveBeenCalledTimes(2);
  });
});
