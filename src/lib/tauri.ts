import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { FileDocument, WorkspaceEntry } from './types';

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

export async function writeDocument(path: string, content: string): Promise<void> {
  await invoke('save_document', { path, content });
}

export async function chooseSavePath(defaultPath?: string | null): Promise<string | null> {
  return save({
    defaultPath: defaultPath ?? 'Untitled.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
}
