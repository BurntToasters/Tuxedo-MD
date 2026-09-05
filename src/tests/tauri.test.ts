import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
const mockOpen = vi.fn();
const mockSave = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => mockOpen(...args),
  save: (...args: unknown[]) => mockSave(...args),
}));

import {
  adoptWorkspaceFolder,
  authorizeCapability,
  chooseDocument,
  chooseSavePath,
  chooseWorkspace,
  collectWorkspaceReferences,
  createWorkspaceDocument,
  deleteState,
  deleteWorkspaceDocument,
  getBuildInfo,
  getLicenses,
  isDesktop,
  loadState,
  probeDocument,
  probeDocumentMeta,
  readDocument,
  registerConsentedPath,
  renameWorkspaceDocument,
  saveState,
  scanWorkspace,
  searchWorkspace,
  setDocumentEdited,
  takePendingOpenPaths,
  writeDocument,
} from '../lib/tauri';

describe('tauri IPC bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects desktop environment based on window.__TAURI_INTERNALS__', () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    expect(isDesktop()).toBe(false);

    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    expect(isDesktop()).toBe(true);
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('handles loadState with success, validator, corrupt JSON, and null', async () => {
    mockInvoke.mockResolvedValueOnce(JSON.stringify({ hello: 'world' }));
    const parsed = await loadState<{ hello: string }>('test');
    expect(parsed).toEqual({ hello: 'world' });

    mockInvoke.mockResolvedValueOnce(JSON.stringify({ count: 42 }));
    const validated = await loadState<number>('test', (raw) => {
      if (typeof raw === 'object' && raw !== null && 'count' in raw) {
        return (raw as { count: number }).count;
      }
      return null;
    });
    expect(validated).toBe(42);

    mockInvoke.mockResolvedValueOnce('{ corrupt-json');
    const corrupt = await loadState('test');
    expect(corrupt).toBeNull();

    mockInvoke.mockResolvedValueOnce(null);
    const empty = await loadState('test');
    expect(empty).toBeNull();
  });

  it('saves and deletes state via IPC', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await saveState('k', { a: 1 });
    expect(mockInvoke).toHaveBeenCalledWith('save_app_state', { key: 'k', content: '{"a":1}' });

    await deleteState('k');
    expect(mockInvoke).toHaveBeenCalledWith('delete_app_state', { key: 'k' });
  });

  it('handles document and workspace picking', async () => {
    mockOpen.mockResolvedValueOnce('C:/notes/a.md');
    mockInvoke.mockResolvedValueOnce(undefined); // register_consented_path
    mockInvoke.mockResolvedValueOnce({ path: 'C:/notes/a.md', name: 'a.md', content: 'hi' });
    const doc = await chooseDocument();
    expect(doc?.name).toBe('a.md');

    mockOpen.mockResolvedValueOnce(null);
    expect(await chooseDocument()).toBeNull();

    mockOpen.mockResolvedValueOnce('C:/notes');
    mockInvoke.mockResolvedValueOnce('C:/notes'); // adopt_workspace_folder
    mockInvoke.mockResolvedValueOnce([{ path: 'C:/notes/a.md', name: 'a.md', isDirectory: false }]);
    const ws = await chooseWorkspace();
    expect(ws?.root).toBe('C:/notes');
    expect(ws?.entries).toHaveLength(1);

    mockOpen.mockResolvedValueOnce(null);
    expect(await chooseWorkspace()).toBeNull();
  });

  it('handles save file dialog', async () => {
    mockSave.mockResolvedValueOnce('C:/notes/saved.md');
    mockInvoke.mockResolvedValueOnce(undefined);
    const chosen = await chooseSavePath('C:/notes/default.md');
    expect(chosen).toBe('C:/notes/saved.md');

    mockSave.mockResolvedValueOnce(null);
    expect(await chooseSavePath()).toBeNull();
  });

  it('invokes filesystem and capability commands', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await registerConsentedPath('C:/notes/a.md');
    expect(mockInvoke).toHaveBeenCalledWith('register_consented_path', { path: 'C:/notes/a.md' });

    await adoptWorkspaceFolder('C:/notes');
    expect(mockInvoke).toHaveBeenCalledWith('adopt_workspace_folder', { root: 'C:/notes' });

    await readDocument('C:/notes/a.md');
    expect(mockInvoke).toHaveBeenCalledWith('open_document', { path: 'C:/notes/a.md' });

    await scanWorkspace('C:/notes');
    expect(mockInvoke).toHaveBeenCalledWith('scan_workspace', { root: 'C:/notes' });

    await searchWorkspace('C:/notes', 'query', true);
    expect(mockInvoke).toHaveBeenCalledWith('search_workspace', {
      root: 'C:/notes',
      query: 'query',
      caseSensitive: true,
    });

    await collectWorkspaceReferences('C:/notes');
    expect(mockInvoke).toHaveBeenCalledWith('collect_workspace_references', { root: 'C:/notes' });

    await createWorkspaceDocument('C:/notes', 'new.md', 'body');
    expect(mockInvoke).toHaveBeenCalledWith('create_workspace_document', {
      root: 'C:/notes',
      path: 'new.md',
      content: 'body',
    });

    await renameWorkspaceDocument('C:/notes', 'old.md', 'new.md');
    expect(mockInvoke).toHaveBeenCalledWith('rename_workspace_document', {
      root: 'C:/notes',
      path: 'old.md',
      newName: 'new.md',
    });

    await deleteWorkspaceDocument('C:/notes', 'del.md');
    expect(mockInvoke).toHaveBeenCalledWith('delete_workspace_document', {
      root: 'C:/notes',
      path: 'del.md',
    });

    await writeDocument('C:/notes/a.md', 'hello', null, true);
    expect(mockInvoke).toHaveBeenCalledWith('save_document', {
      path: 'C:/notes/a.md',
      content: 'hello',
      expectedFingerprint: null,
      force: true,
    });

    await probeDocument('C:/notes/a.md');
    expect(mockInvoke).toHaveBeenCalledWith('probe_document', { path: 'C:/notes/a.md' });

    await probeDocumentMeta('C:/notes/a.md');
    expect(mockInvoke).toHaveBeenCalledWith('probe_document_meta', { path: 'C:/notes/a.md' });

    await takePendingOpenPaths();
    expect(mockInvoke).toHaveBeenCalledWith('take_pending_open_paths');

    await getBuildInfo();
    expect(mockInvoke).toHaveBeenCalledWith('get_build_info');

    await authorizeCapability('workspaceSearch');
    expect(mockInvoke).toHaveBeenCalledWith('authorize_capability', {
      capability: 'workspaceSearch',
    });

    await getLicenses();
    expect(mockInvoke).toHaveBeenCalledWith('get_licenses');

    await setDocumentEdited(true);
    expect(mockInvoke).toHaveBeenCalledWith('set_document_edited', { edited: true });
  });
});
