import type { DocumentTab } from './types';

/** Unsaved edits, recovered draft, or unresolved disk conflict. */
export function isTabDirty(tab: {
  content: string;
  savedContent: string;
  recovered?: boolean;
  conflict?: boolean;
}): boolean {
  return tab.content !== tab.savedContent || !!tab.recovered || !!tab.conflict;
}

/** Persist a recovery draft only when the tab is dirty/conflict/recovered — not clean untitled. */
export function shouldPersistDraft(tab: {
  content: string;
  savedContent: string;
  recovered?: boolean;
  conflict?: boolean;
}): boolean {
  return isTabDirty(tab);
}

/** After Don't Save: align buffer with last saved bytes so quit flush won't resurrect edits. */
export function neutralizeDiscardedTab<T extends DocumentTab>(tab: T): T {
  if (tab.path) {
    return { ...tab, content: tab.savedContent, conflict: false, recovered: false };
  }
  return {
    ...tab,
    content: '',
    savedContent: '',
    conflict: false,
    recovered: false,
  };
}
