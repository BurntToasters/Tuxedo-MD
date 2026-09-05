import { afterEach, describe, expect, it } from 'vitest';
import { formatShortcut, modKeyLabel } from '../lib/shortcuts';

describe('shortcuts formatting', () => {
  const originalUserAgent = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
  });

  it('formats shortcuts for non-mac platforms', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Windows NT 10.0; Win64; x64',
      configurable: true,
    });

    expect(modKeyLabel()).toBe('Ctrl');
    expect(formatShortcut({ mod: true, key: 's' })).toBe('Ctrl+S');
    expect(formatShortcut({ mod: true, shift: true, key: 's' })).toBe('Ctrl+Shift+S');
    expect(formatShortcut({ key: 'F11' })).toBe('F11');
  });

  it('formats shortcuts for macOS platform', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      configurable: true,
    });

    expect(modKeyLabel()).toBe('⌘');
    expect(formatShortcut({ mod: true, key: 's' })).toBe('⌘S');
    expect(formatShortcut({ mod: true, shift: true, key: 's' })).toBe('⌘⇧S');
    expect(formatShortcut({ key: 'Escape' })).toBe('Escape');
  });
});
