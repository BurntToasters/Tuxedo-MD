import { defaultSettings, type AppSettings, type Theme, type UpdateChannel } from './types';

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Clamp and allowlist persisted settings so corrupt JSON cannot break timers/CSS/updater. */
export function normalizeSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') return { ...defaultSettings };
  const input = raw as Partial<AppSettings>;
  if (input.version !== 1) return { ...defaultSettings };

  // <select>/<input type="range"> can persist numeric fields as strings.
  const delay = Number(input.autosaveDelayMs);
  const autosaveDelayMs =
    delay === 500 || delay === 1500 || delay === 3000 ? delay : defaultSettings.autosaveDelayMs;
  const tabSizeRaw = Number(input.tabSize);
  const tabSize = tabSizeRaw === 2 || tabSizeRaw === 4 ? tabSizeRaw : defaultSettings.tabSize;
  const fontSizeRaw = Number(input.fontSize);
  const fontSize = Number.isFinite(fontSizeRaw)
    ? Math.min(28, Math.max(11, Math.round(fontSizeRaw)))
    : defaultSettings.fontSize;

  return {
    version: 1,
    autosave: asBoolean(input.autosave, defaultSettings.autosave),
    autosaveDelayMs,
    restoreSession: asBoolean(input.restoreSession, defaultSettings.restoreSession),
    keepDraftsSilently: asBoolean(input.keepDraftsSilently, defaultSettings.keepDraftsSilently),
    theme: asEnum<Theme>(
      input.theme,
      ['system', 'dark', 'light', 'contrast'],
      defaultSettings.theme
    ),
    glassEffects: asEnum(
      input.glassEffects,
      ['system', 'on', 'off'] as const,
      defaultSettings.glassEffects
    ),
    fontSize,
    lineWrap: asBoolean(input.lineWrap, defaultSettings.lineWrap),
    showLineNumbers: asBoolean(input.showLineNumbers, defaultSettings.showLineNumbers),
    tabSize,
    previewFont: asEnum(
      input.previewFont,
      ['sans', 'serif', 'mono'] as const,
      defaultSettings.previewFont
    ),
    spellcheck: asBoolean(input.spellcheck, defaultSettings.spellcheck),
    focusMode: asBoolean(input.focusMode, defaultSettings.focusMode),
    autoCheckUpdates: asBoolean(input.autoCheckUpdates, defaultSettings.autoCheckUpdates),
    updateChannel: asEnum<UpdateChannel>(
      input.updateChannel,
      ['auto', 'stable', 'beta'],
      defaultSettings.updateChannel
    ),
  };
}
