export interface MarkdownHeading {
  level: number;
  title: string;
  line: number;
}

export function parseMarkdownHeadings(content: string): MarkdownHeading[] {
  return content
    .split('\n')
    .map((line, index) => {
      const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
      return match ? { level: match[1].length, title: match[2], line: index + 1 } : null;
    })
    .filter((item): item is MarkdownHeading => item !== null);
}

export function nearestHeadingAtOrBefore(
  headings: readonly MarkdownHeading[],
  line: number
): MarkdownHeading | null {
  let nearest: MarkdownHeading | null = null;
  for (const heading of headings) {
    if (heading.line > line) break;
    nearest = heading;
  }
  return nearest;
}
