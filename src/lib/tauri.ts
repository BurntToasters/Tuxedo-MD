import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type {
  BuildInfo,
  DocumentFingerprint,
  DocumentReferences,
  EditionCapability,
  FileDocument,
  SearchOutcome,
  WorkspaceEntry,
} from './types';

export function isDesktop(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

export async function chooseDocument(): Promise<FileDocument | null> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }],
  });
  return path ? invoke<FileDocument>('open_document', { path }) : null;
}

export async function chooseWorkspace(): Promise<{
  root: string;
  entries: WorkspaceEntry[];
} | null> {
  const root = await open({ multiple: false, directory: true });
  if (!root) return null;
  const entries = await invoke<WorkspaceEntry[]>('scan_workspace', { root });
  return { root, entries };
}

export async function readDocument(path: string): Promise<FileDocument> {
  return invoke<FileDocument>('open_document', { path });
}

export async function scanWorkspace(root: string): Promise<WorkspaceEntry[]> {
  return invoke<WorkspaceEntry[]>('scan_workspace', { root });
}

export async function searchWorkspace(
  root: string,
  query: string,
  caseSensitive = false
): Promise<SearchOutcome> {
  return invoke<SearchOutcome>('search_workspace', { root, query, caseSensitive });
}

export async function collectWorkspaceReferences(root: string): Promise<DocumentReferences[]> {
  return invoke<DocumentReferences[]>('collect_workspace_references', { root });
}

export async function createWorkspaceDocument(
  root: string,
  path: string,
  content = ''
): Promise<WorkspaceEntry> {
  return invoke<WorkspaceEntry>('create_workspace_document', { root, path, content });
}

export async function renameWorkspaceDocument(
  root: string,
  path: string,
  newName: string
): Promise<WorkspaceEntry> {
  return invoke<WorkspaceEntry>('rename_workspace_document', { root, path, newName });
}

export async function deleteWorkspaceDocument(root: string, path: string): Promise<void> {
  await invoke('delete_workspace_document', { root, path });
}

export async function writeDocument(
  path: string,
  content: string,
  expectedFingerprint: DocumentFingerprint | null,
  force = false
): Promise<DocumentFingerprint> {
  return invoke<DocumentFingerprint>('save_document', {
    path,
    content,
    expectedFingerprint,
    force,
  });
}

export async function chooseSavePath(defaultPath?: string | null): Promise<string | null> {
  return save({
    defaultPath: defaultPath ?? 'Untitled.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
}

export async function probeDocument(path: string): Promise<FileDocument> {
  return invoke<FileDocument>('probe_document', { path });
}

export async function loadState<T>(key: string): Promise<T | null> {
  const content = await invoke<string | null>('load_app_state', { key });
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    // Corrupt state must not abort restore and wipe a good session.
    return null;
  }
}

export async function saveState(key: string, value: unknown): Promise<void> {
  await invoke('save_app_state', { key, content: JSON.stringify(value) });
}

export async function deleteState(key: string): Promise<void> {
  await invoke('delete_app_state', { key });
}

export async function takePendingOpenPaths(): Promise<string[]> {
  return invoke<string[]>('take_pending_open_paths');
}

export async function getBuildInfo(): Promise<BuildInfo> {
  return invoke<BuildInfo>('get_build_info');
}

export async function authorizeCapability(capability: EditionCapability): Promise<void> {
  await invoke('authorize_capability', { capability });
}

export async function getLicenses(): Promise<string> {
  return invoke<string>('get_licenses');
}

export async function setDocumentEdited(edited: boolean): Promise<void> {
  await invoke('set_document_edited', { edited });
}
