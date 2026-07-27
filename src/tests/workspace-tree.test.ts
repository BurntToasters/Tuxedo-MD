import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceTree,
  directoryIdsFor,
  ensureMarkdownName,
  filterWorkspaceTree,
  flattenWorkspaceTree,
  joinWorkspacePath,
  parentDirectoryOf,
} from '../lib/workspace-tree';
import type { WorkspaceEntry } from '../lib/types';

function entry(relativePath: string): WorkspaceEntry {
  const name = relativePath.split(/[\\/]/).at(-1) ?? relativePath;
  return { path: `/workspace/${relativePath}`, relativePath, name };
}

describe('buildWorkspaceTree', () => {
  it('nests files by folder and lists directories first', () => {
    const tree = buildWorkspaceTree([
      entry('zeta.md'),
      entry('notes/beta.md'),
      entry('notes/alpha.md'),
      entry('notes/deep/gamma.md'),
    ]);

    expect(tree.map((node) => node.name)).toEqual(['notes', 'zeta.md']);
    const notes = tree[0];
    expect(notes.kind).toBe('directory');
    expect(notes.path).toBeNull();
    expect(notes.children.map((node) => node.name)).toEqual(['deep', 'alpha.md', 'beta.md']);
  });

  it('treats Windows separators as folder boundaries', () => {
    const tree = buildWorkspaceTree([entry('notes\\windows.md')]);
    expect(tree[0].name).toBe('notes');
    expect(tree[0].children[0].name).toBe('windows.md');
  });
});

describe('flattenWorkspaceTree', () => {
  it('only emits children of expanded directories', () => {
    const tree = buildWorkspaceTree([entry('notes/alpha.md'), entry('root.md')]);

    const collapsed = flattenWorkspaceTree(tree, new Set<string>());
    expect(collapsed.map((row) => row.id)).toEqual(['notes', 'root.md']);

    const expanded = flattenWorkspaceTree(tree, new Set<string>(['notes']));
    expect(expanded.map((row) => row.id)).toEqual(['notes', 'notes/alpha.md', 'root.md']);
    expect(expanded[0].expanded).toBe(true);
    expect(expanded[1].depth).toBe(1);
  });
});

describe('filterWorkspaceTree', () => {
  it('keeps ancestors of matching files and drops empty folders', () => {
    const tree = buildWorkspaceTree([entry('notes/alpha.md'), entry('other/beta.md')]);
    const filtered = filterWorkspaceTree(tree, 'alpha');

    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('notes');
    expect(filtered[0].children.map((node) => node.name)).toEqual(['alpha.md']);
    expect(directoryIdsFor(filtered)).toEqual(['notes']);
  });

  it('returns the original tree when the filter is blank', () => {
    const tree = buildWorkspaceTree([entry('notes/alpha.md')]);
    expect(filterWorkspaceTree(tree, '   ')).toBe(tree);
  });
});

describe('path helpers', () => {
  it('derives parent directories and joins workspace paths', () => {
    expect(parentDirectoryOf('notes/deep/alpha.md')).toBe('notes/deep');
    expect(parentDirectoryOf('alpha.md')).toBe('');
    expect(joinWorkspacePath('', 'alpha.md')).toBe('alpha.md');
    expect(joinWorkspacePath('notes', 'alpha.md')).toBe('notes/alpha.md');
  });

  it('adds a Markdown extension only when one is missing', () => {
    expect(ensureMarkdownName('notes')).toBe('notes.md');
    expect(ensureMarkdownName('notes.md')).toBe('notes.md');
    expect(ensureMarkdownName('notes.MARKDOWN')).toBe('notes.MARKDOWN');
    expect(ensureMarkdownName('   ')).toBe('');
  });
});
