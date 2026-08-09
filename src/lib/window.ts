import { isDesktop } from './tauri';

export type WindowEffectState = 'native' | 'css' | 'opaque';

function reducedTransparency(): boolean {
  return window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches ?? false;
}

const DRAWER_WIDTH = 240;
const MINIMUM_WINDOW_WIDTH = 760;
let drawerExpandedWindow = false;

export async function resizeWindowForDrawer(open: boolean): Promise<boolean> {
  if (!isDesktop()) return false;
  if (open && drawerExpandedWindow) return true;

  try {
    const { PhysicalPosition, PhysicalSize, currentMonitor, getCurrentWindow } =
      await import('@tauri-apps/api/window');
    const window = getCurrentWindow();
    const [maximized, fullscreen, size, position, monitor] = await Promise.all([
      window.isMaximized(),
      window.isFullscreen(),
      window.innerSize(),
      window.outerPosition(),
      currentMonitor(),
    ]);

    if (maximized || fullscreen) {
      drawerExpandedWindow = false;
      return false;
    }
    if (!monitor || (!open && !drawerExpandedWindow)) return false;

    const workArea = monitor.workArea;
    const targetWidth = open
      ? size.width + DRAWER_WIDTH * monitor.scaleFactor
      : Math.max(
          MINIMUM_WINDOW_WIDTH * monitor.scaleFactor,
          size.width - DRAWER_WIDTH * monitor.scaleFactor
        );

    if (open && targetWidth > workArea.size.width) return false;

    const maxX = workArea.position.x + workArea.size.width - targetWidth;
    const nextX = Math.max(workArea.position.x, Math.min(position.x, maxX));
    await window.setSize(new PhysicalSize(targetWidth, size.height));
    if (nextX !== position.x) await window.setPosition(new PhysicalPosition(nextX, position.y));
    drawerExpandedWindow = open;
    return true;
  } catch {
    return false;
  }
}

/** off/a11y/opaque→opaque; system→native else opaque; on→native else CSS frost. */
export async function applyNativeWindowEffects(
  glassEffects: 'system' | 'on' | 'off',
  dark: boolean,
  options?: { opaqueWindow?: boolean }
): Promise<WindowEffectState> {
  if (!isDesktop()) return 'opaque';

  // `system` follows OS glass or solid; only `on` may fall back to CSS frost.
  const cssFallback = glassEffects === 'on';

  try {
    const { Effect, EffectState, getCurrentWindow } = await import('@tauri-apps/api/window');
    const window = getCurrentWindow();
    const paintClear = () => window.setBackgroundColor([0, 0, 0, 0]);
    const paintOpaque = () =>
      window.setBackgroundColor(dark ? [0x1e, 0x1e, 0x1e, 0xff] : [0xf5, 0xf5, 0xf5, 0xff]);

    if (glassEffects === 'off' || reducedTransparency() || options?.opaqueWindow) {
      await window.clearEffects();
      await paintOpaque();
      return 'opaque';
    }

    if (navigator.userAgent.includes('Macintosh')) {
      try {
        await paintClear();
        await window.setEffects({
          effects: [Effect.HudWindow],
          state: EffectState.FollowsWindowActiveState,
        });
        return 'native';
      } catch {
        await window.clearEffects();
        await paintOpaque();
        return cssFallback ? 'css' : 'opaque';
      }
    }

    if (navigator.userAgent.includes('Windows')) {
      try {
        await paintClear();
        try {
          await window.setEffects({ effects: [dark ? Effect.Mica : Effect.Tabbed] });
        } catch {
          const acrylicTint: [number, number, number, number] = dark
            ? [30, 30, 30, 180]
            : [245, 245, 245, 200];
          await window.setEffects({ effects: [Effect.Acrylic], color: acrylicTint });
        }
        return 'native';
      } catch {
        await window.clearEffects();
        await paintOpaque();
        return cssFallback ? 'css' : 'opaque';
      }
    }

    // Linux (and unknown hosts): no native materials — opaque for system, CSS for on.
    await window.clearEffects();
    await paintOpaque();
    return cssFallback ? 'css' : 'opaque';
  } catch {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setBackgroundColor(
        dark ? [0x1e, 0x1e, 0x1e, 0xff] : [0xf5, 0xf5, 0xf5, 0xff]
      );
    } catch {
      // Best-effort paint for builds that reject background color.
    }
    if (glassEffects === 'off' || options?.opaqueWindow || !cssFallback) return 'opaque';
    return 'css';
  }
}
