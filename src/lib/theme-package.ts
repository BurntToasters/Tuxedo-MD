export const THEME_PACKAGE_KEY = 'theme-package';
export const THEME_PACKAGE_VERSION = 1;
export const THEME_CUSTOM_CLASS = 'theme-custom';
export const THEME_STYLE_ELEMENT_ID = 'tuxedo-theme-custom';
const MAX_THEME_CSS_CHARS = 256 * 1024;
const MAX_THEME_NAME_CHARS = 80;

export const THEME_TOKEN_KEYS = [
  'canvas',
  'canvas-inset',
  'surface',
  'surface-raised',
  'border',
  'border-muted',
  'text',
  'text-muted',
  'text-subtle',
  'accent',
  'accent-muted',
] as const;

export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number];
export type ThemeTokens = Record<ThemeTokenKey, string>;

export interface ThemePackage {
  version: 1;
  name: string;
  tokens: ThemeTokens;
  css: string;
}

export const THEME_TOKEN_LABELS: Record<ThemeTokenKey, string> = {
  canvas: 'Canvas',
  'canvas-inset': 'Canvas inset',
  surface: 'Surface',
  'surface-raised': 'Surface raised',
  border: 'Border',
  'border-muted': 'Border muted',
  text: 'Text',
  'text-muted': 'Text muted',
  'text-subtle': 'Text subtle',
  accent: 'Accent',
  'accent-muted': 'Accent muted',
};

/** Built-in dark values from the :root token block. Used when no package is active. */
export const builtinDarkTokens: ThemeTokens = {
  canvas: '#0d1117',
  'canvas-inset': '#010409',
  surface: '#161b22',
  'surface-raised': '#21262d',
  border: '#30363d',
  'border-muted': 'rgba(48, 54, 61, 0.72)',
  text: '#f0f6fc',
  'text-muted': '#8b949e',
  'text-subtle': '#6e7681',
  accent: '#58a6ff',
  'accent-muted': 'rgba(56, 139, 253, 0.2)',
};

const COLOR_NUMBER = String.raw`-?(?:\d+\.\d+|\d+\.|\.\d+|\d+)%?`;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const RGB_COLOR = new RegExp(
  `^rgba?\\(\\s*${COLOR_NUMBER}(?:\\s*,\\s*${COLOR_NUMBER}){2,3}\\s*\\)$`,
  'i'
);
const RGB_SPACE_COLOR = new RegExp(
  `^rgba?\\(\\s*${COLOR_NUMBER}\\s+${COLOR_NUMBER}\\s+${COLOR_NUMBER}(?:\\s*/\\s*${COLOR_NUMBER})?\\s*\\)$`,
  'i'
);
const DATA_IMAGE_URL = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/i;
const UNSCOPED_TYPE = /(^|[\s,{}>+~])(?:body|html|:root)(?=$|[\s.#:[,{>+~])/i;

export function isThemeColor(value: string): boolean {
  const color = value.trim();
  if (!color || color.length > 80) return false;
  if (/url\s*\(|expression\s*\(|var\s*\(/i.test(color)) return false;
  return HEX_COLOR.test(color) || RGB_COLOR.test(color) || RGB_SPACE_COLOR.test(color);
}

function hasControlOrMarkup(value: string): boolean {
  for (const char of value) {
    if (char.charCodeAt(0) < 32 || char === '<' || char === '>') return true;
  }
  return false;
}

function normalizeThemeName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_THEME_NAME_CHARS || hasControlOrMarkup(trimmed)) return null;
  return trimmed;
}

export function normalizeThemePackage(raw: unknown): ThemePackage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== THEME_PACKAGE_VERSION) return null;
  if (typeof record.name !== 'string') return null;
  const name = normalizeThemeName(record.name);
  if (!name) return null;
  if (!record.tokens || typeof record.tokens !== 'object' || Array.isArray(record.tokens)) {
    return null;
  }
  const source = record.tokens as Record<string, unknown>;
  const tokens = {} as ThemeTokens;
  for (const key of THEME_TOKEN_KEYS) {
    const value = source[key];
    if (typeof value !== 'string' || !isThemeColor(value)) return null;
    tokens[key] = value.trim();
  }
  if (typeof record.css !== 'string' || record.css.length > MAX_THEME_CSS_CHARS) return null;
  if (!record.css.trim()) return { version: 1, name, tokens, css: '' };
  const css = sanitizeThemeCss(record.css);
  if (css === null) return null;
  return { version: 1, name, tokens, css };
}

export function serializeThemePackage(pkg: ThemePackage): string {
  const normalized = normalizeThemePackage(pkg);
  if (!normalized) throw new Error('Theme package is not valid');
  return JSON.stringify({
    version: normalized.version,
    name: normalized.name,
    tokens: Object.fromEntries(THEME_TOKEN_KEYS.map((key) => [key, normalized.tokens[key]])),
    css: normalized.css,
  });
}

export function themePackageFileName(name: string): string {
  let cleaned = '';
  for (const char of name) {
    cleaned += char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? ' ' : char;
  }
  const base = cleaned
    .trim()
    .replace(/\.json$/i, '')
    .trim();
  return `${base || 'theme'}.json`;
}

export function applyTokenOverrides(element: HTMLElement, tokens: ThemeTokens): void {
  for (const key of THEME_TOKEN_KEYS) {
    element.style.setProperty(`--${key}`, tokens[key]);
  }
}

export function clearTokenOverrides(element: HTMLElement): void {
  for (const key of THEME_TOKEN_KEYS) {
    element.style.removeProperty(`--${key}`);
  }
}

export function tokensFromElement(element: HTMLElement): ThemeTokens {
  const styles = getComputedStyle(element);
  const tokens = { ...builtinDarkTokens };
  for (const key of THEME_TOKEN_KEYS) {
    const value = styles.getPropertyValue(`--${key}`).trim();
    if (isThemeColor(value)) tokens[key] = value;
  }
  return tokens;
}

function hasForbiddenCss(css: string): boolean {
  return (
    css.includes('<') ||
    css.includes('\\') ||
    css.includes('\0') ||
    /@import/i.test(css) ||
    /expression\s*\(/i.test(css) ||
    /javascript:/i.test(css)
  );
}

function consumeString(css: string, start: number): number | null {
  const quote = css[start];
  if (quote !== '"' && quote !== "'") return null;
  for (let index = start + 1; index < css.length; index += 1) {
    const char = css[index];
    if (char === '\\' || char === '\n' || char === '\r' || char === '<') return null;
    if (char === quote) return index + 1;
  }
  return null;
}

function stripCssComments(css: string): string | null {
  let out = '';
  for (let index = 0; index < css.length; index += 1) {
    if (css.startsWith('/*', index)) {
      const end = css.indexOf('*/', index + 2);
      if (end < 0) return null;
      out += ' ';
      index = end + 1;
      continue;
    }
    const quote = css[index];
    if (quote === '"' || quote === "'") {
      const end = consumeString(css, index);
      if (end === null) return null;
      out += css.slice(index, end);
      index = end - 1;
      continue;
    }
    out += css[index];
  }
  return out;
}

function isAllowedImageUrl(value: string): boolean {
  const match = DATA_IMAGE_URL.exec(value.trim());
  if (!match) return false;
  return match[2].length % 4 === 0;
}

function consumeUrl(css: string, start: number): { end: number; value: string } | null {
  let index = start + 3;
  while (index < css.length && /\s/.test(css[index])) index += 1;
  if (css[index] !== '(') return null;
  index += 1;
  while (index < css.length && /\s/.test(css[index])) index += 1;
  let value: string;
  const quote = css[index];
  if (quote === '"' || quote === "'") {
    index += 1;
    const end = consumeString(css, index - 1);
    if (end === null) return null;
    value = css.slice(index, end - 1);
    index = end;
  } else {
    const valueStart = index;
    while (index < css.length && css[index] !== ')') {
      const char = css[index];
      if (/[\s"'()<\\]/.test(char)) return null;
      index += 1;
    }
    value = css.slice(valueStart, index);
  }
  while (index < css.length && /\s/.test(css[index])) index += 1;
  if (css[index] !== ')') return null;
  return { end: index + 1, value: value.trim() };
}

function urlsAllowed(css: string): boolean {
  const finder = /(^|[^A-Za-z0-9_-])url\s*\(/gi;
  for (let match = finder.exec(css); match; match = finder.exec(css)) {
    const consumed = consumeUrl(css, match.index + match[1].length);
    if (!consumed || !isAllowedImageUrl(consumed.value)) return false;
    finder.lastIndex = consumed.end;
  }
  return true;
}

function splitSelectors(list: string): string[] | null {
  const parts: string[] = [];
  let start = 0;
  let paren = 0;
  let bracket = 0;
  for (let index = 0; index < list.length; index += 1) {
    const char = list[index];
    if (char === '"' || char === "'") {
      const end = consumeString(list, index);
      if (end === null) return null;
      index = end - 1;
      continue;
    }
    if (char === '(') paren += 1;
    else if (char === ')' && paren > 0) paren -= 1;
    else if (char === '[') bracket += 1;
    else if (char === ']' && bracket > 0) bracket -= 1;
    else if (char === ',' && paren === 0 && bracket === 0) {
      parts.push(list.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(list.slice(start));
  return parts;
}

function selectorIsScoped(selector: string): boolean {
  if (!selector.startsWith('.theme-custom')) return false;
  const next = selector.charAt('.theme-custom'.length);
  return next === '' || ' \t\n\r>+~.#:[,)]'.includes(next);
}

/** Rewrites :root, html, and body so custom CSS cannot style the page outside .theme-custom. */
function rewriteSelector(selector: string, prefix: boolean): string | null {
  const trimmed = selector.trim();
  if (!trimmed) return null;
  const typeSelector = /(^|[\s>+~,(:])(:root|html|body)(?=$|[\s>+~.#:[),])/gi;
  const replaced = trimmed.replace(typeSelector, (_match, lead: string) => `${lead}.theme-custom`);
  if (!prefix || selectorIsScoped(replaced)) return replaced;
  return `.theme-custom ${replaced}`;
}

function rewriteSelectorList(list: string, prefix: boolean): string | null {
  const parts = splitSelectors(list);
  if (!parts?.length) return null;
  const rewritten: string[] = [];
  for (const part of parts) {
    const next = rewriteSelector(part, prefix);
    if (!next) return null;
    rewritten.push(next);
  }
  return rewritten.join(',');
}

function findMatchingBrace(css: string, open: number): number {
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    const char = css[index];
    if (char === '"' || char === "'") {
      const end = consumeString(css, index);
      if (end === null) return -1;
      index = end - 1;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findAtRuleEnd(
  css: string,
  start: number
): { kind: 'block' | 'statement'; index: number } | null {
  let paren = 0;
  let bracket = 0;
  for (let index = start; index < css.length; index += 1) {
    const char = css[index];
    if (char === '"' || char === "'") {
      const end = consumeString(css, index);
      if (end === null) return null;
      index = end - 1;
      continue;
    }
    if (char === '(') paren += 1;
    else if (char === ')' && paren > 0) paren -= 1;
    else if (char === '[') bracket += 1;
    else if (char === ']' && bracket > 0) bracket -= 1;
    else if (paren === 0 && bracket === 0 && char === '{') return { kind: 'block', index };
    else if (paren === 0 && bracket === 0 && char === ';') return { kind: 'statement', index };
  }
  return null;
}

function findBoundary(
  css: string,
  start: number
): { kind: 'semi' | 'brace'; index: number } | null {
  let paren = 0;
  let bracket = 0;
  for (let index = start; index < css.length; index += 1) {
    const char = css[index];
    if (char === '"' || char === "'") {
      const end = consumeString(css, index);
      if (end === null) return null;
      index = end - 1;
      continue;
    }
    if (char === '(') paren += 1;
    else if (char === ')' && paren > 0) paren -= 1;
    else if (char === '[') bracket += 1;
    else if (char === ']' && bracket > 0) bracket -= 1;
    else if (paren === 0 && bracket === 0 && (char === ';' || char === '{')) {
      return { kind: char === ';' ? 'semi' : 'brace', index };
    }
  }
  return null;
}

const GROUP_AT_RULES = new Set(['@media', '@supports', '@container', '@layer']);
const KEYFRAME_AT_RULES = new Set(['@keyframes', '@-webkit-keyframes']);

function scopeBlockBody(css: string, prefixSelectors: boolean): string | null {
  let out = '';
  for (let index = 0; index < css.length;) {
    const wsStart = index;
    while (index < css.length && /\s/.test(css[index])) index += 1;
    out += css.slice(wsStart, index);
    if (index >= css.length) break;
    if (css[index] === '}') return null;
    if (css[index] === '@') {
      const atRule = consumeAtRule(css, index);
      if (!atRule) return null;
      out += atRule.text;
      index = atRule.end;
      continue;
    }
    const boundary = findBoundary(css, index);
    if (!boundary) {
      const rest = css.slice(index);
      if (rest.includes('{') || rest.includes('}')) return null;
      out += rest;
      break;
    }
    if (boundary.kind === 'semi') {
      out += css.slice(index, boundary.index + 1);
      index = boundary.index + 1;
      continue;
    }
    const selector = rewriteSelectorList(css.slice(index, boundary.index), prefixSelectors);
    if (!selector) return null;
    const close = findMatchingBrace(css, boundary.index);
    if (close < 0) return null;
    const inner = scopeBlockBody(css.slice(boundary.index + 1, close), prefixSelectors);
    if (inner === null) return null;
    out += `${selector}{${inner}}`;
    index = close + 1;
  }
  return out;
}

function consumeAtRule(css: string, start: number): { text: string; end: number } | null {
  const nameMatch = /^@[-a-zA-Z]+/.exec(css.slice(start));
  if (!nameMatch) return null;
  const name = nameMatch[0].toLowerCase();
  const end = findAtRuleEnd(css, start + name.length);
  if (!end) return null;
  if (end.kind === 'statement') {
    if (name !== '@layer') return null;
    return { text: css.slice(start, end.index + 1), end: end.index + 1 };
  }
  if (!GROUP_AT_RULES.has(name) && !KEYFRAME_AT_RULES.has(name)) return null;
  const close = findMatchingBrace(css, end.index);
  if (close < 0) return null;
  const inner = scopeBlockBody(css.slice(end.index + 1, close), !KEYFRAME_AT_RULES.has(name));
  if (inner === null) return null;
  return { text: `${css.slice(start, end.index)}{${inner}}`, end: close + 1 };
}

export function sanitizeThemeCss(css: string): string | null {
  const source = css.charCodeAt(0) === 0xfeff ? css.slice(1) : css;
  if (hasForbiddenCss(source)) return null;
  const stripped = stripCssComments(source);
  if (stripped === null || hasForbiddenCss(stripped) || !urlsAllowed(stripped)) return null;
  const scoped = scopeBlockBody(stripped, true);
  if (scoped === null) return null;
  const trimmed = scoped.trim();
  if (UNSCOPED_TYPE.test(trimmed)) return null;
  return trimmed;
}
