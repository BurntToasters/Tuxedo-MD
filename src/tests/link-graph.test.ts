import { describe, expect, it } from 'vitest';
import { buildLinkGraph, resolveReference, sortedTagCounts } from '../lib/link-graph';
import type { DocumentReferences } from '../lib/types';

function doc(relativePath: string, links: string[] = [], tags: string[] = []): DocumentReferences {
  const name = relativePath.split('/').at(-1) ?? relativePath;
  return { path: `/workspace/${relativePath}`, relativePath, name, links, tags };
}

const workspace = [
  doc('index.md'),
  doc('notes/alpha.md'),
  doc('notes/deep/beta.md'),
  doc('archive/alpha.md'),
];

describe('resolveReference', () => {
  it('resolves links relative to the linking document', () => {
    expect(resolveReference('notes/alpha.md', 'deep/beta.md', workspace)).toBe(
      'notes/deep/beta.md'
    );
    expect(resolveReference('notes/deep/beta.md', '../alpha.md', workspace)).toBe('notes/alpha.md');
    expect(resolveReference('notes/alpha.md', './alpha.md', workspace)).toBe('notes/alpha.md');
  });

  it('treats a leading slash as workspace-root relative', () => {
    expect(resolveReference('notes/deep/beta.md', '/index.md', workspace)).toBe('index.md');
  });

  it('adds an implicit Markdown extension', () => {
    expect(resolveReference('index.md', 'notes/alpha', workspace)).toBe('notes/alpha.md');
  });

  it('ignores fragments and percent-encoding', () => {
    expect(resolveReference('index.md', 'notes/alpha.md#section', workspace)).toBe(
      'notes/alpha.md'
    );
    expect(resolveReference('index.md', 'notes/deep/beta.md?v=1', workspace)).toBe(
      'notes/deep/beta.md'
    );
    expect(resolveReference('index.md', 'notes%2Falpha.md', workspace)).toBe('notes/alpha.md');
  });

  it('resolves wiki titles only when the base name is unambiguous', () => {
    expect(resolveReference('index.md', 'beta', workspace)).toBe('notes/deep/beta.md');
    // 'alpha' exists in both notes/ and archive/, so it stays unresolved.
    expect(resolveReference('index.md', 'alpha', workspace)).toBeNull();
  });

  it('refuses to escape above the workspace root', () => {
    expect(resolveReference('index.md', '../../secrets.md', workspace)).toBeNull();
  });

  it('returns null for unknown targets and bare anchors', () => {
    expect(resolveReference('index.md', 'missing.md', workspace)).toBeNull();
    expect(resolveReference('index.md', '#intro', workspace)).toBeNull();
  });
});

describe('buildLinkGraph', () => {
  it('maps backlinks from resolved outbound links', () => {
    const graph = buildLinkGraph([
      doc('index.md', ['notes/alpha.md', 'notes/deep/beta.md']),
      doc('notes/alpha.md', ['deep/beta.md']),
      doc('notes/deep/beta.md'),
    ]);

    expect(graph.outbound['index.md']).toEqual(['notes/alpha.md', 'notes/deep/beta.md']);
    expect(graph.backlinks['notes/deep/beta.md']).toEqual(['index.md', 'notes/alpha.md']);
    expect(graph.backlinks['index.md']).toEqual([]);
  });

  it('records unresolved local links as broken', () => {
    const graph = buildLinkGraph([doc('index.md', ['gone.md'])]);
    expect(graph.broken).toEqual([{ from: 'index.md', target: 'gone.md' }]);
  });

  it('does not report asset references as broken documents', () => {
    const graph = buildLinkGraph([doc('index.md', ['assets/diagram.png', 'data/report.csv'])]);
    expect(graph.broken).toEqual([]);
  });

  it('lists documents with no inbound links as orphans', () => {
    const graph = buildLinkGraph([doc('index.md', ['notes/alpha.md']), doc('notes/alpha.md')]);
    expect(graph.orphans).toEqual(['index.md']);
  });

  it('does not treat a self-link as a backlink', () => {
    const graph = buildLinkGraph([doc('index.md', ['index.md'])]);
    expect(graph.outbound['index.md']).toEqual([]);
    expect(graph.backlinks['index.md']).toEqual([]);
  });

  it('indexes tags and orders them by document count', () => {
    const graph = buildLinkGraph([
      doc('a.md', [], ['project', 'draft']),
      doc('b.md', [], ['project']),
    ]);

    expect(graph.tags.project).toEqual(['a.md', 'b.md']);
    expect(sortedTagCounts(graph)).toEqual([
      { tag: 'project', count: 2 },
      { tag: 'draft', count: 1 },
    ]);
  });
});
