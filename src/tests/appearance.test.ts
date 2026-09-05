import { describe, expect, it, vi } from 'vitest';
import { syncAppearanceEffects } from '../lib/appearance';
import * as windowModule from '../lib/window';

describe('appearance effects synchronization', () => {
  it('delegates to applyNativeWindowEffects', async () => {
    const spy = vi.spyOn(windowModule, 'applyNativeWindowEffects').mockResolvedValue('native');

    const result = await syncAppearanceEffects('system', true, { opaqueWindow: false });

    expect(spy).toHaveBeenCalledWith('system', true, { opaqueWindow: false });
    expect(result).toBe('native');
  });
});
