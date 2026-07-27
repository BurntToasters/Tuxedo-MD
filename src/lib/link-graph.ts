import type { DocumentReferences } from './types';

export interface BrokenLink {
  from: string;
  target: string;
}

export interface LinkGraph {
  /** Workspace-relative path -> resolved workspace-relative targets. */
  outbound: Record<string, string[]>;
  /** Workspace-relative path -> documents that link to it. */
  backlinks: Record<string, string[]>;
  /** Local link targets that do not resolve to a document in the workspace. */
  broken: BrokenLink[];
  /** Documents nothing else links to. */
  orphans: string[];
  /** Tag name -> documents carrying it. */
  tags: Record<string, string[]>;
}

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, '/');
}

function decodeTarget(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Malformed percent-escapes are used as-is rather than dropping the link.
    return value;
  }
}

/** Strips the fragment and query so `notes/a.md#intro` resolves to `notes/a.md`. */
function stripSuffixes(value: string): string {
  return value.split('#')[0].split('?')[0];
}

/** Applies `.` and `..` segments without allowing escape above the workspace root. */
function resolveSegments(base: string, target: string): string | null {
  const segments = target.startsWith('/') ? [] : base.split('/').filter(Boolean);

  for (const segment of stripSuffixes(target).split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.join('/') || null;
}

const MARKDOWN_PATTERN = /\.(md|markdown|mdown|mkd)$/i;
const EXTENSION_PATTERN = /\.[a-z0-9]+$/i;

function hasMarkdownExtension(value: string): boolean {
  return MARKDOWN_PATTERN.test(value);
}

/**
 * Only document-shaped targets belong in the broken-link report. A link to
 * `data.csv` or `diagram.png` is a deliberate asset reference, not a missing note.
 */
function looksLikeDocument(target: string): boolean {
  const bare = stripSuffixes(normalizeSeparators(target)).split('/').at(-1) ?? '';
  if (!bare) return false;
  return hasMarkdownExtension(bare) || !EXTENSION_PATTERN.test(bare);
}

interface DocumentIndex {
  byPath: Map<string, string>;
  byBaseName: Map<string, string[]>;
}

function buildIndex(documents: DocumentReferences[]): DocumentIndex {
  const byPath = new Map<string, string>();
  const byBaseName = new Map<string, string[]>();

  for (const document of documents) {
    const relative = normalizeSeparators(document.relativePath);
    byPath.set(relative.toLowerCase(), relative);

    const base = (relative.split('/').at(-1) ?? relative).replace(MARKDOWN_PATTERN, '');
    const key = base.toLowerCase();
    byBaseName.set(key, [...(byBaseName.get(key) ?? []), relative]);
  }

  return { byPath, byBaseName };
}

/**
 * Resolves one raw reference to a workspace-relative document path.
 *
 * Handles path-style links relative to the linking document, root-absolute links,
 * implicit `.md` extensions, and wiki links that name a document by title.
 * Returns null when nothing in the workspace matches.
 */
export function resolveReference(
  fromRelativePath: string,
  rawTarget: string,
  documents: DocumentReferences[]
): string | null {
  return resolveWithIndex(fromRelativePath, rawTarget, buildIndex(documents));
}

function resolveWithIndex(
  fromRelativePath: string,
  rawTarget: string,
  index: DocumentIndex
): string | null {
  const target = decodeTarget(normalizeSeparators(rawTarget.trim()));
  if (!target || target.startsWith('#')) return null;

  const fromDirectory = normalizeSeparators(fromRelativePath).split('/').slice(0, -1).join('/');
  const candidates: string[] = [];

  const resolved = resolveSegments(fromDirectory, target);
  if (resolved) {
    candidates.push(resolved);
    if (!hasMarkdownExtension(resolved)) candidates.push(`${resolved}.md`);
  }

  for (const candidate of candidates) {
    const match = index.byPath.get(candidate.toLowerCase());
    if (match) return match;
  }

  // Wiki-style titles carry no path, so fall back to a unique base-name match.
  const bare = stripSuffixes(target);
  if (!bare.includes('/')) {
    const key = bare.replace(MARKDOWN_PATTERN, '').toLowerCase();
    const byName = index.byBaseName.get(key);
    if (byName?.length === 1) return byName[0];
  }

  return null;
}

/**
 * Builds the workspace link graph: outbound links, backlinks, unresolved local
 * links, documents nothing links to, and the tag index.
 */
export function buildLinkGraph(documents: DocumentReferences[]): LinkGraph {
  const index = buildIndex(documents);
  const outbound: Record<string, string[]> = {};
  const backlinks: Record<string, string[]> = {};
  const tags: Record<string, string[]> = {};
  const broken: BrokenLink[] = [];

  for (const document of documents) {
    const from = normalizeSeparators(document.relativePath);
    backlinks[from] ??= [];
    const resolvedTargets = new Set<string>();

    for (const rawTarget of document.links) {
      const target = resolveWithIndex(from, rawTarget, index);
      if (!target) {
        if (looksLikeDocument(rawTarget)) broken.push({ from, target: rawTarget });
        continue;
      }
      // Self-links would make a document its own backlink.
      if (target !== from) resolvedTargets.add(target);
    }

    outbound[from] = [...resolvedTargets].sort((a, b) => a.localeCompare(b));

    for (const tag of document.tags) {
      tags[tag] = [...(tags[tag] ?? []), from];
    }
  }

  for (const [from, targets] of Object.entries(outbound)) {
    for (const target of targets) {
      backlinks[target] = [...(backlinks[target] ?? []), from];
    }
  }

  for (const key of Object.keys(backlinks)) {
    backlinks[key].sort((a, b) => a.localeCompare(b));
  }

  const orphans = Object.keys(backlinks)
    .filter((path) => backlinks[path].length === 0)
    .sort((a, b) => a.localeCompare(b));

  return { outbound, backlinks, broken, orphans, tags };
}

/** Tags ordered by document count, then name, for a stable sidebar listing. */
export function sortedTagCounts(graph: LinkGraph): Array<{ tag: string; count: number }> {
  return Object.entries(graph.tags)
    .map(([tag, paths]) => ({ tag, count: paths.length }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
