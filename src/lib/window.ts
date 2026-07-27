import { isDesktop } from './tauri';

const DRAWER_WIDTH = 240;
const MINIMUM_WINDOW_WIDTH = 760;
let drawerExpandedWindow = false;

function reducedTransparency(): boolean {
  return window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches ?? false;
}

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

    if (maximized || fullscreen || !monitor || (!open && !drawerExpandedWindow)) return false;

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

export type WindowEffectState = 'native' | 'opaque';

export async function applyNativeWindowEffects(
  glassEffects: 'system' | 'on' | 'off',
  dark: boolean
): Promise<WindowEffectState> {
  if (!isDesktop()) return 'opaque';

  try {
    const { Effect, EffectState, getCurrentWindow } = await import('@tauri-apps/api/window');
    const window = getCurrentWindow();
    if (glassEffects === 'off' || reducedTransparency()) {
      await window.clearEffects();
      return 'opaque';
    }

    if (navigator.userAgent.includes('Macintosh')) {
      await window.setEffects({
        effects: [Effect.HudWindow],
        state: EffectState.FollowsWindowActiveState,
      });
      return 'native';
    }

    if (navigator.userAgent.includes('Windows')) {
      try {
        await window.setEffects({ effects: [dark ? Effect.Mica : Effect.Tabbed] });
      } catch {
        const acrylicTint: [number, number, number, number] = dark
          ? [30, 30, 30, 180]
          : [245, 245, 245, 200];
        await window.setEffects({ effects: [Effect.Acrylic], color: acrylicTint });
      }
      return 'native';
    }

    await window.clearEffects();
    return 'opaque';
  } catch {
    // Unsupported and intentionally opaque builds retain the solid CSS surface treatment.
    return 'opaque';
  }
}
