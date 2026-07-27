/** Label for the primary modifier (Windows/Linux: Ctrl, macOS: ⌘). */
export function modKeyLabel(): string {
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh')) {
    return '⌘';
  }
  return 'Ctrl';
}

export function formatShortcut(options: { mod?: boolean; shift?: boolean; key: string }): string {
  const mac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh');
  const key = options.key.length === 1 ? options.key.toUpperCase() : options.key;
  if (mac) {
    let label = '';
    if (options.mod) label += '⌘';
    if (options.shift) label += '⇧';
    return `${label}${key}`;
  }
  const parts: string[] = [];
  if (options.mod) parts.push('Ctrl');
  if (options.shift) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}
