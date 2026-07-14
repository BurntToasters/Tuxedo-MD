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

export async function applyNativeWindowEffects(
  glassEffects: 'system' | 'on' | 'off',
  dark: boolean
): Promise<void> {
  if (!isDesktop()) return;

  try {
    const { Effect, EffectState, getCurrentWindow } = await import('@tauri-apps/api/window');
    const window = getCurrentWindow();
    if (glassEffects === 'off' || (glassEffects === 'system' && reducedTransparency())) {
      await window.clearEffects();
      return;
    }

    if (navigator.userAgent.includes('Macintosh')) {
      await window.setEffects({
        effects: [Effect.UnderWindowBackground],
        state: EffectState.FollowsWindowActiveState,
      });
    } else if (navigator.userAgent.includes('Windows')) {
      try {
        await window.setEffects({ effects: [dark ? Effect.Mica : Effect.Tabbed] });
      } catch {
        await window.setEffects({ effects: [Effect.Acrylic], color: [13, 17, 23, 205] });
      }
    } else {
      await window.clearEffects();
    }
  } catch {
    // Unsupported platforms retain the CSS surface treatment.
  }
}
