import { describe, expect, it } from 'vitest';
import { nearestHeadingAtOrBefore, parseMarkdownHeadings } from '../lib/headings';

const sample = ['intro', '', '# Alpha', 'body', '## Beta', 'more', '### Gamma ##'].join('\n');

describe('markdown heading map', () => {
  it('returns no headings when the document has none', () => {
    const headings = parseMarkdownHeadings('plain\ntext');
    expect(headings).toEqual([]);
    expect(nearestHeadingAtOrBefore(headings, 2)).toBeNull();
  });

  it('maps a heading on the line and one before it', () => {
    const headings = parseMarkdownHeadings(sample);
    expect(headings).toEqual([
      { level: 1, title: 'Alpha', line: 3 },
      { level: 2, title: 'Beta', line: 5 },
      { level: 3, title: 'Gamma', line: 7 },
    ]);
    expect(nearestHeadingAtOrBefore(headings, 5)).toEqual(headings[1]);
    expect(nearestHeadingAtOrBefore(headings, 6)).toEqual(headings[1]);
  });

  it('chooses the nearest earlier heading', () => {
    const headings = parseMarkdownHeadings(sample);
    expect(nearestHeadingAtOrBefore(headings, 4)?.title).toBe('Alpha');
    expect(nearestHeadingAtOrBefore(headings, 7)?.title).toBe('Gamma');
    expect(nearestHeadingAtOrBefore(headings, 8)?.title).toBe('Gamma');
  });

  it('ignores lines before the first heading', () => {
    const headings = parseMarkdownHeadings(sample);
    expect(nearestHeadingAtOrBefore(headings, 1)).toBeNull();
    expect(nearestHeadingAtOrBefore(headings, 2)).toBeNull();
  });
});
