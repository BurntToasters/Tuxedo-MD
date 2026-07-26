import { describe, expect, it } from 'vitest';
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
