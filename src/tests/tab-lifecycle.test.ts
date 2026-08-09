import { describe, expect, it } from 'vitest';
import { isTabDirty, neutralizeDiscardedTab, shouldPersistDraft } from '../lib/tab-lifecycle';
import type { DocumentTab } from '../lib/types';

function tab(overrides: Partial<DocumentTab> = {}): DocumentTab {
  return {
    id: 't1',
    name: 'a.md',
    path: null,
    content: '',
    savedContent: '',
    fingerprint: null,
    conflict: false,
    recovered: false,
    selection: { anchor: 0, head: 0 },
    ...overrides,
  };
}

describe('tab lifecycle helpers', () => {
  it('treats content mismatch, recovered, and conflict as dirty', () => {
    expect(isTabDirty(tab({ content: 'a', savedContent: 'b' }))).toBe(true);
    expect(isTabDirty(tab({ recovered: true }))).toBe(true);
    expect(isTabDirty(tab({ conflict: true }))).toBe(true);
    expect(isTabDirty(tab())).toBe(false);
  });

  it('does not draft clean untitled tabs', () => {
    expect(shouldPersistDraft(tab({ path: null, content: '', savedContent: '' }))).toBe(false);
    expect(shouldPersistDraft(tab({ path: null, content: 'draft', savedContent: '' }))).toBe(true);
    expect(
      shouldPersistDraft(tab({ path: 'C:/a.md', content: 'same', savedContent: 'same' }))
    ).toBe(false);
    expect(
      shouldPersistDraft(tab({ path: 'C:/a.md', content: 'edit', savedContent: 'disk' }))
    ).toBe(true);
  });

  it('neutralizes discarded path-backed and untitled tabs', () => {
    const pathTab = neutralizeDiscardedTab(
      tab({
        path: 'C:/a.md',
        content: 'edit',
        savedContent: 'disk',
        recovered: true,
        conflict: true,
      })
    );
    expect(pathTab).toMatchObject({
      path: 'C:/a.md',
      content: 'disk',
      savedContent: 'disk',
      recovered: false,
      conflict: false,
    });

    const untitled = neutralizeDiscardedTab(
      tab({
        path: null,
        content: 'scratch',
        savedContent: 'old',
        recovered: true,
      })
    );
    expect(untitled).toMatchObject({
      content: '',
      savedContent: '',
      recovered: false,
      conflict: false,
    });
  });
});
