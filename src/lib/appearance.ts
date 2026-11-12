import {
  THEME_CUSTOM_CLASS,
  THEME_STYLE_ELEMENT_ID,
  applyTokenOverrides,
  clearTokenOverrides,
  sanitizeThemeCss,
  type ThemePackage,
} from './theme-package';
import { applyNativeWindowEffects, type WindowEffectState } from './window';

/**
 * Thin wrapper around window materials.
 * opaqueWindow / MAS opaque enforcement lives in window.ts (applyNativeWindowEffects).
 */
export async function syncAppearanceEffects(
  glassEffects: 'system' | 'on' | 'off',
  dark: boolean,
  options?: { opaqueWindow?: boolean }
): Promise<WindowEffectState> {
  return applyNativeWindowEffects(glassEffects, dark, options);
}

function customStyleElement(): HTMLStyleElement {
  const existing = document.getElementById(THEME_STYLE_ELEMENT_ID);
  if (existing instanceof HTMLStyleElement) return existing;
  existing?.remove();
  const style = document.createElement('style');
  style.id = THEME_STYLE_ELEMENT_ID;
  document.head.append(style);
  return style;
}

function removeCustomStyle(root: HTMLElement): void {
  root.classList.remove(THEME_CUSTOM_CLASS);
  document.getElementById(THEME_STYLE_ELEMENT_ID)?.remove();
}

/** Layer package tokens on the built-in theme and scope custom CSS under .theme-custom. */
export function applyThemePackage(pkg: ThemePackage): void {
  const root = document.documentElement;
  applyTokenOverrides(root, pkg.tokens);
  const safe = pkg.css.trim() ? sanitizeThemeCss(pkg.css) : '';
  if (!safe) {
    removeCustomStyle(root);
    return;
  }
  root.classList.add(THEME_CUSTOM_CLASS);
  customStyleElement().textContent = safe;
}

export function clearThemePackage(): void {
  const root = document.documentElement;
  clearTokenOverrides(root);
  removeCustomStyle(root);
}
