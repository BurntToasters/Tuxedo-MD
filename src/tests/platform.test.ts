import { afterEach, describe, expect, it } from 'vitest';
import { usesCustomTitleBar } from '../lib/platform';
import { formatWindowTitle } from '../lib/window-title';
import { formatShortcut } from '../lib/shortcuts';

describe('usesCustomTitleBar', () => {
  it('enables custom chrome on Windows and macOS only', () => {
    expect(usesCustomTitleBar('windows')).toBe(true);
    expect(usesCustomTitleBar('macos')).toBe(true);
    expect(usesCustomTitleBar('linux')).toBe(false);
    expect(usesCustomTitleBar('web')).toBe(false);
  });
});

describe('detectPlatform', () => {
  const originalUserAgent = navigator.userAgent;

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
  });

  it('detects web when not in desktop mode', async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const { detectPlatform } = await import('../lib/platform');
    expect(detectPlatform()).toBe('web');
  });

  it('detects windows, macos, and linux in desktop mode', async () => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    const { detectPlatform } = await import('../lib/platform');

    Object.defineProperty(navigator, 'userAgent', {
      value: 'Windows NT 10.0; Win64; x64',
      configurable: true,
    });
    expect(detectPlatform()).toBe('windows');

    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      configurable: true,
    });
    expect(detectPlatform()).toBe('macos');

    Object.defineProperty(navigator, 'userAgent', {
      value: 'X11; Linux x86_64',
      configurable: true,
    });
    expect(detectPlatform()).toBe('linux');

    Object.defineProperty(navigator, 'userAgent', {
      value: 'Unknown OS',
      configurable: true,
    });
    expect(detectPlatform()).toBe('web');
  });
});

describe('formatWindowTitle', () => {
  it('includes tab name and app name', () => {
    expect(formatWindowTitle('Notes.md', false)).toBe('Notes.md — Tuxedo MD');
  });

  it('marks dirty tabs', () => {
    expect(formatWindowTitle('Notes.md', true)).toBe('• Notes.md — Tuxedo MD');
  });
});

describe('formatShortcut', () => {
  it('uses Ctrl on non-Mac user agents', () => {
    expect(formatShortcut({ mod: true, key: 's' })).toBe('Ctrl+S');
  });
});
