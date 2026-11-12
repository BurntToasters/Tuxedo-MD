import { renderMarkdown } from './preview';

export const EXPORT_PROFILE_KEY = 'export-profile';

export type ExportPageSize = 'letter' | 'a4';
export type ExportMargin = 'narrow' | 'normal' | 'wide';
export type ExportThemeId = 'dark' | 'light' | 'contrast';

export interface ExportProfile {
  pageSize: ExportPageSize;
  margin: ExportMargin;
  themeId: ExportThemeId;
}

export const defaultExportProfile: ExportProfile = {
  pageSize: 'letter',
  margin: 'normal',
  themeId: 'dark',
};

const PAGE_SIZES: readonly ExportPageSize[] = ['letter', 'a4'];
const MARGINS: readonly ExportMargin[] = ['narrow', 'normal', 'wide'];
const THEME_IDS: readonly ExportThemeId[] = ['dark', 'light', 'contrast'];

const PAGE_SIZE_CSS: Record<ExportPageSize, string> = {
  letter: 'letter',
  a4: 'A4',
};

const MARGIN_CSS: Record<ExportMargin, string> = {
  narrow: '0.5in',
  normal: '1in',
  wide: '1.5in',
};

const THEME_COLORS: Record<
  ExportThemeId,
  { background: string; text: string; muted: string; accent: string; border: string; code: string }
> = {
  dark: {
    background: '#0d1117',
    text: '#f0f6fc',
    muted: '#8b949e',
    accent: '#58a6ff',
    border: '#30363d',
    code: '#161b22',
  },
  light: {
    background: '#f6f8fa',
    text: '#1f2328',
    muted: '#57606a',
    accent: '#0969da',
    border: '#d0d7de',
    code: '#ffffff',
  },
  contrast: {
    background: '#000000',
    text: '#ffffff',
    muted: '#ffffff',
    accent: '#ffff00',
    border: '#ffffff',
    code: '#000000',
  },
};

const MARKDOWN_EXTENSION = /\.(?:md|markdown|mdown|mkd)$/i;

function allowed<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Fill missing or invalid profile fields. Extra keys are ignored. */
export function normalizeExportProfile(raw: unknown): ExportProfile {
  const input = isRecord(raw) ? raw : {};
  return {
    pageSize: allowed(input.pageSize, PAGE_SIZES, defaultExportProfile.pageSize),
    margin: allowed(input.margin, MARGINS, defaultExportProfile.margin),
    themeId: allowed(input.themeId, THEME_IDS, defaultExportProfile.themeId),
  };
}

export function htmlFileNameForDocument(name: string): string {
  const stem = name.trim().replace(MARKDOWN_EXTENSION, '').trim();
  return `${stem || 'Untitled'}.html`;
}

export function htmlExportDefaultPath(name: string, documentPath: string | null): string {
  const fileName = htmlFileNameForDocument(name);
  if (!documentPath) return fileName;
  const slash = Math.max(documentPath.lastIndexOf('/'), documentPath.lastIndexOf('\\'));
  if (slash < 0) return fileName;
  return `${documentPath.slice(0, slash + 1)}${fileName}`;
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function exportStyle(profile: ExportProfile): string {
  const colors = THEME_COLORS[profile.themeId];
  const scheme = profile.themeId === 'light' ? 'light' : 'dark';
  return [
    `@page { size: ${PAGE_SIZE_CSS[profile.pageSize]}; margin: ${MARGIN_CSS[profile.margin]}; }`,
    `html { color-scheme: ${scheme}; }`,
    `body { margin: 0; background: ${colors.background}; color: ${colors.text}; font: 16px/1.6 Georgia, "Times New Roman", serif; }`,
    'article { max-width: 70ch; margin: 0 auto; }',
    `a { color: ${colors.accent}; }`,
    `pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: ${colors.code}; }`,
    `pre { padding: 12px; overflow: auto; border: 1px solid ${colors.border}; white-space: pre-wrap; }`,
    'code { padding: 0.1em 0.3em; }',
    'pre code { padding: 0; background: none; }',
    `blockquote { margin-left: 0; padding-left: 1em; border-left: 3px solid ${colors.accent}; color: ${colors.muted}; }`,
    'img, svg { max-width: 100%; height: auto; }',
    'table { border-collapse: collapse; }',
    `th, td { border: 1px solid ${colors.border}; padding: 4px 8px; }`,
    '@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }',
  ].join('\n');
}

function wrapExportHtml(fragment: string, title: string, profile: ExportProfile): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtmlText(title)}</title>`,
    '<style>',
    exportStyle(profile),
    '</style>',
    '</head>',
    '<body>',
    '<article class="markdown-body">',
    fragment,
    '</article>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export interface ExportDocumentInput {
  markdown: string;
  title: string;
  profile: unknown;
  mermaid?: boolean;
  math?: boolean;
  rewriteImages?: (html: string) => Promise<string>;
}

export async function buildExportDocument(input: ExportDocumentInput): Promise<string> {
  const profile = normalizeExportProfile(input.profile);
  let fragment = await renderMarkdown(input.markdown, {
    mermaid: input.mermaid === true,
    math: input.math === true,
  });
  if (input.rewriteImages) fragment = await input.rewriteImages(fragment);
  return wrapExportHtml(fragment, input.title, profile);
}

/** Print the export document, not the editor window that hosts the iframe. */
export function printExportHtml(html: string): void {
  const frame = document.createElement('iframe');
  frame.title = 'Print document';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.style.opacity = '0';
  document.body.append(frame);
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win || !doc) {
    frame.remove();
    throw new Error('Print preview could not be opened');
  }
  const remove = () => frame.remove();
  win.addEventListener('afterprint', remove, { once: true });
  // about:blank keeps the print document same-origin under the app content policy.
  doc.open();
  doc.write(html);
  doc.close();
  try {
    win.focus();
    win.print();
  } catch (error) {
    remove();
    throw error;
  }
}
