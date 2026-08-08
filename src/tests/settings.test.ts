import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../lib/settings';
import { defaultSettings } from '../lib/types';

describe('normalizeSettings', () => {
  it('returns defaults for invalid payloads', () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings);
    expect(normalizeSettings({ version: 2 })).toEqual(defaultSettings);
  });

  it('clamps and allowlists fields', () => {
    const normalized = normalizeSettings({
      ...defaultSettings,
      fontSize: 99,
      autosaveDelayMs: 999 as 500,
      theme: 'neon' as 'dark',
      updateChannel: 'nightly' as 'auto',
      tabSize: 8 as 4,
    });
    expect(normalized.fontSize).toBe(28);
    expect(normalized.autosaveDelayMs).toBe(defaultSettings.autosaveDelayMs);
    expect(normalized.theme).toBe(defaultSettings.theme);
    expect(normalized.updateChannel).toBe(defaultSettings.updateChannel);
    expect(normalized.tabSize).toBe(defaultSettings.tabSize);
  });

  it('coerces numeric strings from form controls', () => {
    const normalized = normalizeSettings({
      ...defaultSettings,
      fontSize: '18' as unknown as number,
      autosaveDelayMs: '1500' as unknown as 1500,
      tabSize: '2' as unknown as 2,
    });
    expect(normalized.fontSize).toBe(18);
    expect(normalized.autosaveDelayMs).toBe(1500);
    expect(normalized.tabSize).toBe(2);
  });
});
