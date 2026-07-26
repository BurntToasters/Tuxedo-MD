import { describe, expect, it, vi, beforeEach } from 'vitest';
import { shouldPreventClose } from '../lib/window-lifecycle';

describe('shouldPreventClose', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not prevent when there are no unsaved changes', () => {
    expect(shouldPreventClose(false)).toBe(false);
  });

  it('prevents when the user declines the confirmation dialog', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(shouldPreventClose(true)).toBe(true);
  });

  it('allows close when the user accepts the confirmation dialog', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(shouldPreventClose(true)).toBe(false);
  });
});
