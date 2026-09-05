import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  hydrateSessionTabs,
  isPathUnderWorkspace,
  normalizeDocumentTab,
  normalizeDraftIndex,
  normalizeFilePath,
  normalizeSessionState,
  pathsReferToSameFile,
  slimSessionTabs,
} from '../lib/session';
import type { DocumentTab, FileDocument } from '../lib/types';

describe('session normalization', () => {
  it('accepts a well-formed tab and rejects invalid ids/content', () => {
    const tab = normalizeDocumentTab({
      id: 'tab_1',
      name: 'Welcome.md',
      path: null,
      content: '# Hi',
      savedContent: '# Hi',
      fingerprint: null,
      conflict: false,
      recovered: false,
      selection: { anchor: 0, head: 0 },
    });
    expect(tab?.name).toBe('Welcome.md');
    expect(normalizeDocumentTab({ id: '../evil', content: 'x' })).toBeNull();
    expect(normalizeDocumentTab({ id: 'ok', content: 'x'.repeat(17 * 1024 * 1024) })).toBeNull();
  });

  it('normalizes draft-index and session payloads', () => {
    expect(normalizeDraftIndex(['a', 1, 'a', '../x', 'b'])).toEqual(['a', 'b']);
    const session = normalizeSessionState({
      version: 1,
      activeId: 'missing',
      mode: 'split',
      workspaceRoot: 'C:/notes',
      tabs: [
        {
          id: 't1',
          name: 'a.md',
          path: 'C:/notes/a.md',
          content: 'one',
          savedContent: 'one',
          fingerprint: null,
          conflict: false,
          recovered: false,
          selection: { anchor: 1, head: 1 },
        },
      ],
      recentFiles: ['C:/notes/a.md', 'C:/notes/a.md'],
      recentWorkspaces: [],
    });
    expect(session?.activeId).toBe('t1');
    expect(session?.mode).toBe('split');
    expect(session?.recentFiles).toEqual(['C:/notes/a.md']);
  });

  it('compares windows paths across slash and extended prefixes', () => {
    expect(pathsReferToSameFile('C:\\Notes\\a.md', 'c:/Notes/a.md')).toBe(true);
    expect(pathsReferToSameFile('\\\\?\\C:\\Notes\\a.md', 'C:/Notes/a.md')).toBe(true);
    expect(pathsReferToSameFile('C:/a.md', 'C:/b.md')).toBe(false);
  });

  it('normalizes file paths with normalizeFilePath across platforms and URIs', () => {
    expect(normalizeFilePath('C:\\Users\\Dev\\Notes\\')).toBe('c:/users/dev/notes');
    expect(normalizeFilePath('\\\\?\\C:\\My Docs\\Notes.md')).toBe('c:/my docs/notes.md');
    expect(normalizeFilePath('file:///C:/Notes/My%20Doc.md')).toBe('c:/notes/my doc.md');
    expect(normalizeFilePath('file:///Notes/%E0%A4%A')).toBeDefined();

    const originalUa = navigator.userAgent;
    try {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (X11; Linux x86_64)',
        configurable: true,
      });
      expect(normalizeFilePath('/home/user/MyNotes/Readme.MD')).toBe(
        '/home/user/MyNotes/Readme.MD'
      );
      expect(normalizeFilePath('/home/user/Notes/')).toBe('/home/user/Notes');

      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        configurable: true,
      });
      expect(normalizeFilePath('/Users/Dev/MyNotes/Readme.MD')).toBe(
        '/users/dev/mynotes/readme.md'
      );
    } finally {
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUa,
        configurable: true,
      });
    }
  });

  it('compares UNC and file:// path forms', () => {
    expect(pathsReferToSameFile('\\\\?\\UNC\\server\\share\\a.md', '//server/share/a.md')).toBe(
      true
    );
    expect(pathsReferToSameFile('//?/UNC/server/share/a.md', '//SERVER/share/a.md')).toBe(true);
    expect(pathsReferToSameFile('\\\\server\\share\\a.md', '//server/share/a.md')).toBe(true);
    expect(pathsReferToSameFile('file:///C:/Notes/a.md', 'C:/Notes/a.md')).toBe(true);
    expect(pathsReferToSameFile('file://C:/Notes/a.md', 'c:/Notes/a.md')).toBe(true);
    expect(pathsReferToSameFile('file:///C:/My%20Notes/a%20b.md', 'C:/My Notes/a b.md')).toBe(true);
    expect(pathsReferToSameFile('//server/share/a.md', '//server/share/b.md')).toBe(false);
  });

  it('slims clean path-backed tabs and keeps dirty/pathless bodies', () => {
    const tabs: DocumentTab[] = [
      {
        id: 'clean',
        name: 'a.md',
        path: 'C:/a.md',
        content: 'same',
        savedContent: 'same',
        fingerprint: null,
        conflict: false,
        recovered: false,
        selection: { anchor: 0, head: 0 },
      },
      {
        id: 'dirty',
        name: 'b.md',
        path: 'C:/b.md',
        content: 'edit',
        savedContent: 'disk',
        fingerprint: null,
        conflict: false,
        recovered: false,
        selection: { anchor: 0, head: 0 },
      },
      {
        id: 'untitled',
        name: 'Untitled.md',
        path: null,
        content: 'draft',
        savedContent: '',
        fingerprint: null,
        conflict: false,
        recovered: false,
        selection: { anchor: 0, head: 0 },
      },
    ];
    const slimmed = slimSessionTabs(tabs);
    expect(slimmed[0]).toMatchObject({ content: '', savedContent: '', path: 'C:/a.md' });
    expect(slimmed[1].content).toBe('edit');
    expect(slimmed[2].content).toBe('draft');
  });

  it('hydrates empty path-backed tabs and marks failed reloads recovered', async () => {
    const tabs: DocumentTab[] = [
      {
        id: 'ok',
        name: 'a.md',
        path: 'C:/a.md',
        content: '',
        savedContent: '',
        fingerprint: null,
        conflict: false,
        recovered: false,
        selection: { anchor: 0, head: 0 },
      },
      {
        id: 'untitled',
        name: 'Untitled.md',
        path: null,
        content: '# Draft',
        savedContent: '',
        fingerprint: null,
        conflict: false,
        recovered: false,
        selection: { anchor: 0, head: 0 },
      },
      {
        id: 'dirty',
        name: 'dirty.md',
        path: 'C:/dirty.md',
        content: '# modified',
        savedContent: '# original',
        fingerprint: null,
        conflict: false,
        recovered: false,
        selection: { anchor: 0, head: 0 },
      },
      {
        id: 'missing',
        name: 'gone.md',
        path: 'C:/gone.md',
        content: '',
        savedContent: '',
        fingerprint: null,
        conflict: false,
        recovered: false,
        selection: { anchor: 0, head: 0 },
      },
    ];
    const readDocument = vi.fn(async (path: string): Promise<FileDocument> => {
      if (path.endsWith('gone.md')) throw new Error('missing');
      return {
        path,
        name: 'a.md',
        content: '# restored',
        fingerprint: { modifiedMs: 1, size: 10, hash: 'h' },
      };
    });
    const hydrated = await hydrateSessionTabs(tabs, readDocument);
    expect(hydrated[0].content).toBe('# restored');
    expect(hydrated[0].savedContent).toBe('# restored');
    expect(hydrated[1].content).toBe('# Draft');
    expect(hydrated[2].content).toBe('# modified');
    expect(hydrated[3].recovered).toBe(true);
    expect(hydrated[3].content).toBe('');
  });

  it('determines if paths reside under a workspace root', () => {
    expect(isPathUnderWorkspace('/workspace/docs/guide.md', '/workspace')).toBe(true);
    expect(isPathUnderWorkspace('/other/path/guide.md', '/workspace')).toBe(false);
    expect(isPathUnderWorkspace(null, '/workspace')).toBe(false);
    expect(isPathUnderWorkspace('/workspace/docs/guide.md', null)).toBe(false);
    expect(isPathUnderWorkspace('C:\\workspace\\notes\\a.md', 'c:/workspace')).toBe(true);
  });
});

describe('edition applyBuildInfo', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('enables only shipped capabilities for full builds', async () => {
    const edition = await import('../lib/edition');
    edition.applyBuildInfo({
      edition: 'full',
      version: '0.1.0-alpha.1',
      capabilities: [
        'workspaceSearch',
        'backlinks',
        'wikiLinks',
        'tags',
        'workspaceIntelligence',
        'mermaid',
      ],
      opaqueWindow: true,
    });
    expect(edition.hasCapability('workspaceSearch')).toBe(true);
    expect(edition.hasCapability('mermaid')).toBe(false);
    expect(edition.editionState.opaqueWindow).toBe(true);
    expect(edition.isOpaqueWindow()).toBe(true);
  });

  it('falls back to community with empty capabilities', async () => {
    const edition = await import('../lib/edition');
    edition.applySafeFallback(new Error('offline'));
    expect(edition.isFullEdition()).toBe(false);
    expect(edition.editionState.isFullEdition).toBe(false);
    expect(edition.hasCapability('workspaceSearch')).toBe(false);
    expect(edition.editionState.opaqueWindow).toBe(false);
  });
});
