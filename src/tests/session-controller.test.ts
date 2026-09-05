import { describe, expect, it, vi } from 'vitest';
import {
  buildSessionPayload,
  draftsToPersist,
  recoverOrphanDrafts,
  shouldReplaceWelcome,
  type StateStore,
} from '../lib/session-controller';
import { defaultSettings, type DocumentTab } from '../lib/types';

function createMockTab(overrides: Partial<DocumentTab> = {}): DocumentTab {
  return {
    id: 'tab-1',
    name: 'Untitled.md',
    path: null,
    content: 'test',
    savedContent: '',
    fingerprint: null,
    conflict: false,
    recovered: false,
    selection: { anchor: 0, head: 0 },
    ...overrides,
  };
}

describe('session controller', () => {
  it('builds a session state payload with slimmed tabs', () => {
    const tab1 = createMockTab({
      id: 't1',
      path: 'C:/notes/a.md',
      content: 'abc',
      savedContent: 'abc',
    });
    const tab2 = createMockTab({ id: 't2', content: 'draft', savedContent: '' });

    const payload = buildSessionPayload({
      settings: defaultSettings,
      activeId: 't1',
      mode: 'split',
      workspaceRoot: 'C:/notes',
      tabs: [tab1, tab2],
      recentFiles: ['C:/notes/a.md'],
      recentWorkspaces: ['C:/notes'],
      sessionPersistEnabled: true,
    });

    expect(payload.version).toBe(1);
    expect(payload.activeId).toBe('t1');
    expect(payload.tabs[0].content).toBe(''); // Clean path-backed tab was slimmed
    expect(payload.tabs[1].content).toBe('draft'); // Dirty draft retained
  });

  it('filters tabs to persist while respecting cancelled saves', () => {
    const cleanTab = createMockTab({ id: 'clean', content: 'same', savedContent: 'same' });
    const dirtyTab1 = createMockTab({ id: 'dirty1', content: 'edit', savedContent: '' });
    const dirtyTab2 = createMockTab({ id: 'dirty2', content: 'edit2', savedContent: '' });

    const cancelled = new Set(['dirty2']);
    const persistList = draftsToPersist([cleanTab, dirtyTab1, dirtyTab2], cancelled);

    expect(persistList).toHaveLength(1);
    expect(persistList[0].id).toBe('dirty1');
  });

  it('identifies when to replace the default welcome document', () => {
    const welcomeTab = createMockTab({
      name: 'Welcome.md',
      content: '# Hello',
      savedContent: '# Hello',
      path: null,
    });
    const regularTab = createMockTab({ name: 'Other.md', path: 'C:/test.md' });

    expect(shouldReplaceWelcome([welcomeTab], false, '# Hello')).toBe(true);
    expect(shouldReplaceWelcome([welcomeTab], true, '# Hello')).toBe(false); // Session was restored
    expect(shouldReplaceWelcome([regularTab], false, '# Hello')).toBe(false);
  });

  it('recovers orphan drafts from draft-index', async () => {
    const existing = [createMockTab({ id: 'existing-tab' })];
    const draft1 = createMockTab({ id: 'draft-1', content: 'recovered text', savedContent: '' });
    const cleanDraft = createMockTab({ id: 'draft-2', content: 'same', savedContent: 'same' });

    const loadState: StateStore['loadState'] = vi.fn(async (_key, validate) => {
      if (_key === 'draft-index') {
        const data = ['existing-tab', 'draft-1', 'draft-2', 'missing-draft'];
        return validate ? validate(data) : (data as any);
      }
      if (_key === 'draft-draft-1') {
        return validate ? validate(draft1) : (draft1 as any);
      }
      if (_key === 'draft-draft-2') {
        return validate ? validate(cleanDraft) : (cleanDraft as any);
      }
      return null;
    });

    const recovered = await recoverOrphanDrafts(existing, { loadState });

    expect(recovered).toHaveLength(1);
    expect(recovered[0].id).toBe('draft-1');
    expect(recovered[0].recovered).toBe(true);
  });
});
