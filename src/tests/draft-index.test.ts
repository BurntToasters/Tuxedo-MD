import { describe, expect, it, vi } from 'vitest';
import { setDraftIndexed } from '../lib/draft-index';
import type { StateStore } from '../lib/session-controller';

describe('draft index management', () => {
  it('adds an unindexed draft id to the draft index', async () => {
    let storedIndex: unknown = ['tab-1'];
    const loadState: StateStore['loadState'] = vi.fn(async (_key, validate) => {
      return validate ? validate(storedIndex) : (storedIndex as any);
    });
    const saveState = vi.fn(async (_key: string, value: unknown) => {
      storedIndex = value;
    });

    await setDraftIndexed('tab-2', true, { loadState, saveState });

    expect(saveState).toHaveBeenCalledWith('draft-index', ['tab-1', 'tab-2']);
  });

  it('does not re-save if draft id is already present when keep is true', async () => {
    const loadState: StateStore['loadState'] = vi.fn(async (_key, validate) => {
      const data = ['tab-1', 'tab-2'];
      return validate ? validate(data) : (data as any);
    });
    const saveState = vi.fn();

    await setDraftIndexed('tab-1', true, { loadState, saveState });

    expect(saveState).not.toHaveBeenCalled();
  });

  it('removes a draft id when keep is false', async () => {
    let storedIndex: unknown = ['tab-1', 'tab-2'];
    const loadState: StateStore['loadState'] = vi.fn(async (_key, validate) => {
      return validate ? validate(storedIndex) : (storedIndex as any);
    });
    const saveState = vi.fn(async (_key: string, value: unknown) => {
      storedIndex = value;
    });

    await setDraftIndexed('tab-1', false, { loadState, saveState });

    expect(saveState).toHaveBeenCalledWith('draft-index', ['tab-2']);
  });

  it('does not re-save if draft id is not present when keep is false', async () => {
    const loadState: StateStore['loadState'] = vi.fn(async (_key, validate) => {
      const data = ['tab-1'];
      return validate ? validate(data) : (data as any);
    });
    const saveState = vi.fn();

    await setDraftIndexed('tab-999', false, { loadState, saveState });

    expect(saveState).not.toHaveBeenCalled();
  });
});
