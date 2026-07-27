import type { WorkspaceEntry } from './types';

export interface WorkspaceTreeNode {
  /** Workspace-relative path, using '/' separators regardless of host platform. */
  id: string;
  name: string;
  kind: 'directory' | 'file';
  depth: number;
  /** Absolute path for files; directories are virtual and have no native path. */
  path: string | null;
  children: WorkspaceTreeNode[];
}

export interface FlatWorkspaceNode extends WorkspaceTreeNode {
  expanded: boolean;
  hasChildren: boolean;
}

function normalizeSeparators(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function compareNodes(a: WorkspaceTreeNode, b: WorkspaceTreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

function sortTree(nodes: WorkspaceTreeNode[]): WorkspaceTreeNode[] {
  nodes.sort(compareNodes);
  for (const node of nodes) if (node.children.length) sortTree(node.children);
  return nodes;
}

/**
 * Derives a directory-first nested tree from the flat native workspace scan.
 * Directories are synthesized from relative path segments, so the native payload
 * stays flat and cheap while the UI can present real nesting.
 */
export function buildWorkspaceTree(entries: WorkspaceEntry[]): WorkspaceTreeNode[] {
  const roots: WorkspaceTreeNode[] = [];
  const directories = new Map<string, WorkspaceTreeNode>();

  for (const entry of entries) {
    const relative = normalizeSeparators(entry.relativePath || entry.name);
    if (!relative) continue;
    const segments = relative.split('/').filter(Boolean);
    if (!segments.length) continue;

    let parentChildren = roots;
    let prefix = '';

    for (const [index, segment] of segments.entries()) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;

      if (isLeaf) {
        parentChildren.push({
          id: prefix,
          name: entry.name || segment,
          kind: 'file',
          depth: index,
          path: entry.path,
          children: [],
        });
        continue;
      }

      let directory = directories.get(prefix);
      if (!directory) {
        directory = {
          id: prefix,
          name: segment,
          kind: 'directory',
          depth: index,
          path: null,
          children: [],
        };
        directories.set(prefix, directory);
        parentChildren.push(directory);
      }
      parentChildren = directory.children;
    }
  }

  return sortTree(roots);
}

/** Directory ids that must be expanded for every matching descendant to be reachable. */
export function directoryIdsFor(nodes: WorkspaceTreeNode[]): string[] {
  const ids: string[] = [];
  const walk = (items: WorkspaceTreeNode[]) => {
    for (const item of items) {
      if (item.kind !== 'directory') continue;
      ids.push(item.id);
      walk(item.children);
    }
  };
  walk(nodes);
  return ids;
}

/** Keeps files matching `filter`, retaining ancestor directories of any match. */
export function filterWorkspaceTree(
  nodes: WorkspaceTreeNode[],
  filter: string
): WorkspaceTreeNode[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return nodes;

  const filterNodes = (items: WorkspaceTreeNode[]): WorkspaceTreeNode[] => {
    const result: WorkspaceTreeNode[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        if (item.id.toLowerCase().includes(needle)) result.push(item);
        continue;
      }
      const children = filterNodes(item.children);
      if (children.length) result.push({ ...item, children });
    }
    return result;
  };

  return filterNodes(nodes);
}

/**
 * Flattens the tree into the visible rows a listbox/tree widget renders,
 * so keyboard navigation can move linearly through what the user actually sees.
 */
export function flattenWorkspaceTree(
  nodes: WorkspaceTreeNode[],
  expanded: ReadonlySet<string>
): FlatWorkspaceNode[] {
  const rows: FlatWorkspaceNode[] = [];

  const walk = (items: WorkspaceTreeNode[]) => {
    for (const item of items) {
      const hasChildren = item.children.length > 0;
      const isExpanded = item.kind === 'directory' && expanded.has(item.id);
      rows.push({ ...item, expanded: isExpanded, hasChildren });
      if (isExpanded && hasChildren) walk(item.children);
    }
  };

  walk(nodes);
  return rows;
}

/** Parent directory of a workspace-relative path, or '' for the workspace root. */
export function parentDirectoryOf(relativePath: string): string {
  const normalized = normalizeSeparators(relativePath);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

export function joinWorkspacePath(directory: string, name: string): string {
  const normalized = normalizeSeparators(directory);
  return normalized ? `${normalized}/${name}` : name;
}

/** Appends '.md' unless the name already carries a supported Markdown extension. */
export function ensureMarkdownName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  return /\.(md|markdown|mdown|mkd)$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}
