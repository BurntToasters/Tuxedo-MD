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
