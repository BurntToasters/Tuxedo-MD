import { normalizeDraftIndex, normalizeDocumentTab, slimSessionTabs } from './session';
import { shouldPersistDraft } from './tab-lifecycle';
import type { AppSettings, DocumentTab, EditorMode, SessionState } from './types';

export interface StateStore {
  loadState: <T>(key: string, validate?: (raw: unknown) => T | null) => Promise<T | null>;
  saveState: (key: string, value: unknown) => Promise<void>;
  deleteState?: (key: string) => Promise<void>;
}

export interface SessionSnapshot {
  settings: AppSettings;
  activeId: string;
  mode: EditorMode;
  workspaceRoot: string;
  tabs: DocumentTab[];
  recentFiles: string[];
  recentWorkspaces: string[];
  sessionPersistEnabled: boolean;
}

/** Recover drafts recorded in the draft-index that are missing from the restored tab set. */
export async function recoverOrphanDrafts(
  existing: DocumentTab[],
  store: Pick<StateStore, 'loadState'>
): Promise<DocumentTab[]> {
  const index = (await store.loadState('draft-index', normalizeDraftIndex)) ?? [];
  const recovered: DocumentTab[] = [];
  for (const id of index) {
    if (existing.some((tab) => tab.id === id)) continue;
    const draft = await store.loadState(`draft-${id}`, normalizeDocumentTab);
    if (!draft) continue;
    if (draft.content === draft.savedContent && !draft.conflict) continue;
    recovered.push({ ...draft, recovered: true });
  }
  return recovered;
}

/** Build a session state payload for disk persistence with slimmed tabs. */
export function buildSessionPayload(snapshot: SessionSnapshot): SessionState {
  return {
    version: 1,
    activeId: snapshot.activeId,
    mode: snapshot.mode,
    workspaceRoot: snapshot.workspaceRoot,
    tabs: slimSessionTabs(snapshot.tabs),
    recentFiles: snapshot.recentFiles,
    recentWorkspaces: snapshot.recentWorkspaces,
  };
}

/** Determine if session recovery result should replace the default welcome document. */
export function shouldReplaceWelcome(
  tabs: DocumentTab[],
  sessionRestored: boolean,
  welcomeContent: string
): boolean {
  return (
    !sessionRestored &&
    tabs.length === 1 &&
    tabs[0].name === 'Welcome.md' &&
    tabs[0].content === welcomeContent &&
    !tabs[0].path
  );
}

/** Filter tabs that require recovery draft persistence. */
export function draftsToPersist(
  tabs: DocumentTab[],
  cancelledSaveTabIds?: ReadonlySet<string>
): DocumentTab[] {
  return tabs.filter(
    (tab) => shouldPersistDraft(tab) && (!cancelledSaveTabIds || !cancelledSaveTabIds.has(tab.id))
  );
}
