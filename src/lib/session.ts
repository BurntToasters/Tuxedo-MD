import {
  MAX_DOCUMENT_BYTES,
  type DocumentFingerprint,
  type DocumentTab,
  type EditorMode,
  type FileDocument,
  type SessionState,
} from './types';

const MAX_TAB_CONTENT_CHARS = MAX_DOCUMENT_BYTES;
const MAX_TAB_CONTENT_BYTES = MAX_DOCUMENT_BYTES;
export const MAX_SESSION_TABS = 64;
export const MAX_RECENT = 20;
const utf8Encoder = new TextEncoder();

function exceedsTabContentLimit(value: string): boolean {
  if (value.length > MAX_TAB_CONTENT_CHARS) return true;
  return utf8Encoder.encode(value).length > MAX_TAB_CONTENT_BYTES;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asSelection(value: unknown): { anchor: number; head: number } {
  if (!value || typeof value !== 'object') return { anchor: 0, head: 0 };
  const input = value as { anchor?: unknown; head?: unknown };
  const anchor = Number(input.anchor);
  const head = Number(input.head);
  return {
    anchor: Number.isFinite(anchor) ? Math.max(0, Math.floor(anchor)) : 0,
    head: Number.isFinite(head) ? Math.max(0, Math.floor(head)) : 0,
  };
}

function asFingerprint(value: unknown): DocumentFingerprint | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<DocumentFingerprint>;
  const modifiedMs = Number(input.modifiedMs);
  const size = Number(input.size);
  const hash = asString(input.hash);
  if (!Number.isFinite(modifiedMs) || !Number.isFinite(size) || !hash) return null;
  return { modifiedMs, size, hash };
}

function asMode(value: unknown): EditorMode {
  return value === 'split' || value === 'preview' || value === 'source' ? value : 'source';
}

/** Normalize one persisted/recovered tab; returns null when unusable. */
export function normalizeDocumentTab(raw: unknown): DocumentTab | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Partial<DocumentTab>;
  const id = asString(input.id).trim();
  if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) return null;

  const content = asString(input.content);
  if (exceedsTabContentLimit(content)) return null;
  const savedContent =
    typeof input.savedContent === 'string' && !exceedsTabContentLimit(input.savedContent)
      ? input.savedContent
      : content;
  const name = asString(input.name, 'Untitled.md').slice(0, 255) || 'Untitled.md';

  return {
    id,
    name,
    path: asNullableString(input.path),
    content,
    savedContent,
    fingerprint: asFingerprint(input.fingerprint),
    conflict: asBoolean(input.conflict),
    recovered: asBoolean(input.recovered),
    selection: asSelection(input.selection),
  };
}

function normalizePathList(raw: unknown, limit: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    const path = entry.trim();
    if (out.some((existing) => pathsReferToSameFile(existing, path))) continue;
    out.push(path);
    if (out.length >= limit) break;
  }
  return out;
}

/** Normalize draft-index entries to valid state-key tab ids. */
export function normalizeDraftIndex(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const id = entry.trim();
    if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Validate session JSON; returns null when unusable. */
export function normalizeSessionState(raw: unknown): SessionState | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Partial<SessionState>;
  if (input.version !== 1) return null;
  if (!Array.isArray(input.tabs)) return null;

  const tabs: DocumentTab[] = [];
  for (const entry of input.tabs) {
    const tab = normalizeDocumentTab(entry);
    if (!tab) continue;
    if (tabs.some((existing) => existing.id === tab.id)) continue;
    tabs.push(tab);
    if (tabs.length >= MAX_SESSION_TABS) break;
  }
  if (!tabs.length) return null;

  const activeId =
    typeof input.activeId === 'string' && tabs.some((tab) => tab.id === input.activeId)
      ? input.activeId
      : tabs[0].id;

  return {
    version: 1,
    activeId,
    mode: asMode(input.mode),
    workspaceRoot: asNullableString(input.workspaceRoot) ?? '',
    tabs,
    recentFiles: normalizePathList(input.recentFiles, MAX_RECENT),
    recentWorkspaces: normalizePathList(input.recentWorkspaces, MAX_RECENT),
  };
}

/** Normalize a file path for comparison (slash, case, UNC, extended prefix, URI schemes). */
export function normalizeFilePath(value: string): string {
  let path = value.trim();
  const hadBackslash = path.includes('\\');
  // Strip file:// / file:/// so dialog vs session URIs match.
  if (path.toLowerCase().startsWith('file:///')) path = path.slice('file:///'.length);
  else if (path.toLowerCase().startsWith('file://')) path = path.slice('file://'.length);
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed URI percent-encoding kept as-is
  }
  path = path.replace(/\\/g, '/');
  // \\?\UNC\server\share\... and //?/UNC/server/... → //server/...
  path = path.replace(/^\/\/\?\/UNC\//i, '//');
  // Strip remaining Windows extended-length prefix (\\?\C:\...).
  path = path.replace(/^\/\/\?\//i, '');
  path = path.replace(/^\/\?\//i, '');
  const isWindows = /^[A-Za-z]:\//.test(path) || path.startsWith('//') || hadBackslash;
  const isMac = typeof navigator !== 'undefined' && /Macintosh/i.test(navigator.userAgent);
  if (isWindows || isMac) {
    path = path.toLowerCase();
  }
  while (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);
  return path;
}

/** Compare file paths with basic canonicalization (slash/case/UNC/extended-prefix). */
export function pathsReferToSameFile(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  if (!left || !right) return false;
  return normalizeFilePath(left) === normalizeFilePath(right);
}

/** Check if a file path resides within a workspace directory. */
export function isPathUnderWorkspace(
  filePath: string | null | undefined,
  workspaceRoot: string | null | undefined
): boolean {
  if (!filePath || !workspaceRoot) return false;
  const normFile = normalizeFilePath(filePath);
  const normRoot = normalizeFilePath(workspaceRoot);
  return normFile.startsWith(`${normRoot}/`);
}

/** Drop bodies for path-backed clean tabs so session JSON stays small. */
export function slimSessionTabs(tabs: DocumentTab[]): DocumentTab[] {
  return tabs.map((tab) => {
    if (tab.path && tab.content === tab.savedContent && !tab.conflict) {
      return { ...tab, content: '', savedContent: '' };
    }
    return tab;
  });
}

/** Reload empty path-backed tab bodies after a slim session restore. */
export async function hydrateSessionTabs(
  tabs: DocumentTab[],
  readDocument: (path: string) => Promise<FileDocument>
): Promise<DocumentTab[]> {
  const next: DocumentTab[] = [];
  for (const tab of tabs) {
    if (!tab.path || tab.content !== '') {
      next.push(tab);
      continue;
    }
    try {
      const document = await readDocument(tab.path);
      next.push({
        ...tab,
        name: document.name,
        content: document.content,
        savedContent: document.content,
        fingerprint: document.fingerprint,
      });
    } catch {
      next.push({ ...tab, recovered: true });
    }
  }
  return next;
}
