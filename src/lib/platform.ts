import { isDesktop } from './tauri';

export type AppPlatform = 'windows' | 'macos' | 'linux' | 'web';

export function detectPlatform(): AppPlatform {
  if (!isDesktop()) return 'web';
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'windows';
  if (ua.includes('Macintosh')) return 'macos';
  if (ua.includes('Linux')) return 'linux';
  return 'web';
}

/** In-window chrome (drag region, layout). Linux keeps native frame + menu. */
export function usesCustomTitleBar(platform: AppPlatform): boolean {
  return platform === 'windows' || platform === 'macos';
}
