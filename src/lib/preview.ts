import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { gatedPreviewPlugin, type GatedPreviewOptions } from './preview-gated';

const SVG_TAGS = [
  'svg',
  'g',
  'defs',
  'marker',
  'symbol',
  'clippath',
  'mask',
  'pattern',
  'lineargradient',
  'radialgradient',
  'stop',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textpath',
  'use',
  'title',
  'desc',
  'switch',
];

const MATH_TAGS = [
  'math',
  'semantics',
  'mrow',
  'mi',
  'mo',
  'mn',
  'msup',
  'msub',
  'msubsup',
  'mfrac',
  'msqrt',
  'mroot',
  'mtext',
  'mspace',
  'mtable',
  'mtr',
  'mtd',
  'mover',
  'munder',
  'munderover',
  'mstyle',
  'mpadded',
  'mphantom',
  'menclose',
  'merror',
  'mmultiscripts',
  'mprescripts',
  'none',
];

// Mermaid emits SVG. Keep the elements and presentation attributes it paints with,
// and do not allow script, style, foreignObject, or event-handler attributes.
const SVG_ATTRIBUTES = [
  'className',
  'xmlns',
  'viewBox',
  'preserveAspectRatio',
  'transform',
  'd',
  'points',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'dx',
  'dy',
  'fill',
  'fillOpacity',
  'fillRule',
  'stroke',
  'strokeWidth',
  'strokeOpacity',
  'strokeDasharray',
  'strokeDashoffset',
  'strokeLinecap',
  'strokeLinejoin',
  'strokeMiterlimit',
  'opacity',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'textAnchor',
  'dominantBaseline',
  'alignmentBaseline',
  'letterSpacing',
  'markerStart',
  'markerMid',
  'markerEnd',
  'markerWidth',
  'markerHeight',
  'markerUnits',
  'refX',
  'refY',
  'orient',
  'offset',
  'stopColor',
  'stopOpacity',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'fx',
  'fy',
  'patternUnits',
  'patternTransform',
  'clipPath',
  'clipRule',
  'clipPathUnits',
  'href',
  'pathLength',
  'textLength',
  'lengthAdjust',
  'rotate',
  'vectorEffect',
  'paintOrder',
  'visibility',
  'overflow',
];

const MATH_ATTRIBUTES = [
  'className',
  'xmlns',
  'display',
  'displaystyle',
  'scriptlevel',
  'mathvariant',
  'mathcolor',
  'mathsize',
  'stretchy',
  'fence',
  'separator',
  'lspace',
  'rspace',
  'linethickness',
  'notation',
  'accent',
  'accentunder',
  'movablelimits',
  'largeop',
  'symmetric',
  'minsize',
  'maxsize',
  'linebreak',
  'columnalign',
  'rowalign',
  'columnspacing',
  'rowspacing',
];

const schema = {
  ...defaultSchema,
  strip: [
    ...(defaultSchema.strip ?? ['script']),
    'style',
    'foreignobject',
    'foreignObject',
    'annotation',
    'annotation-xml',
  ],
  tagNames: [...(defaultSchema.tagNames ?? []), ...SVG_TAGS, ...MATH_TAGS],
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span ?? []), 'className'],
    ...Object.fromEntries(SVG_TAGS.map((tag) => [tag, SVG_ATTRIBUTES])),
    ...Object.fromEntries(MATH_TAGS.map((tag) => [tag, MATH_ATTRIBUTES])),
  },
  protocols: {
    ...defaultSchema.protocols,
    // Keep preview links aligned with the opener allowlist; drop http/irc/xmpp/etc.
    href: ['https', 'mailto'],
    // Block remote image beacons. Empty allow-lists are treated as unrestricted
    // by rehype-sanitize, so keep only data: (relative src still works).
    src: ['data'],
    // Fragment urls such as url(#id) have no scheme. A colon marks a real URL and
    // is limited to https, so javascript: cannot survive on paint attributes.
    fill: ['https'],
    stroke: ['https'],
    filter: ['https'],
    clipPath: ['https'],
    markerEnd: ['https'],
    markerStart: ['https'],
    markerMid: ['https'],
  },
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify);

function createGatedProcessor(options: GatedPreviewOptions) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(gatedPreviewPlugin, options)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, schema)
    .use(rehypeStringify);
}

const gatedProcessors = new Map<string, ReturnType<typeof createGatedProcessor>>();

function processorFor(options: GatedPreviewOptions) {
  const key = `${options.mermaid ? 1 : 0}${options.math ? 1 : 0}`;
  const cached = gatedProcessors.get(key);
  if (cached) return cached;
  const created = createGatedProcessor(options);
  gatedProcessors.set(key, created);
  return created;
}

export interface MarkdownRenderOptions {
  mermaid?: boolean;
  math?: boolean;
}

const CLOBBER_PREFIX = 'user-content-';

function alignClobberedSvgRefs(html: string): string {
  if (!html.includes('<svg') || !html.includes('url(#')) return html;
  return html.replace(/<svg\b[\s\S]*?<\/svg>/gi, (svg) =>
    svg.replace(/url\(#([^)]+)\)/g, (match, id: string) => {
      if (id.startsWith(CLOBBER_PREFIX)) return match;
      return `url(#${CLOBBER_PREFIX}${id})`;
    })
  );
}

export async function renderMarkdown(
  markdown: string,
  options: MarkdownRenderOptions = {}
): Promise<string> {
  const mermaid = options.mermaid === true;
  const math = options.math === true;
  const active = mermaid || math ? processorFor({ mermaid, math }) : processor;
  return alignClobberedSvgRefs(String(await active.process(markdown)));
}

const MAX_PREVIEW_IMAGE_REWRITES = 40;
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]*={0,2}$/;

interface ImgSourceLocation {
  raw: string;
  decoded: string;
  valueStart: number;
  valueEnd: number;
  attrStart: number;
  attrEnd: number;
}

function isDataImageSrc(src: string): boolean {
  return src.trim().toLowerCase().startsWith('data:');
}

function isRemoteHttpSrc(src: string): boolean {
  const trimmed = src.trim().toLowerCase();
  return trimmed.startsWith('https:') || trimmed.startsWith('http:') || trimmed.startsWith('//');
}

function isSvgSource(src: string): boolean {
  const path = (src.split(/[?#]/, 1)[0] ?? '').trim().toLowerCase();
  return path.endsWith('.svg');
}

function isRelativeImageSrc(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    return false;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return false;
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return false;
  return true;
}

function decodeHtmlAttribute(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, body: string) => {
    const key = body.toLowerCase();
    if (key === 'amp') return '&';
    if (key === 'quot') return '"';
    if (key === 'apos') return "'";
    if (key === 'lt') return '<';
    if (key === 'gt') return '>';
    const code = key.startsWith('#x')
      ? Number.parseInt(key.slice(2), 16)
      : Number.parseInt(key.slice(1), 10);
    if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return entity;
    return String.fromCodePoint(code);
  });
}

function decodeImageSource(value: string): string {
  const text = decodeHtmlAttribute(value);
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function skipWhitespace(tag: string, index: number): number {
  let cursor = index;
  while (cursor < tag.length && /\s/.test(tag[cursor] ?? '')) cursor += 1;
  return cursor;
}

function isAttributeBoundary(char: string): boolean {
  return char === '=' || char === '>' || char === '/' || /\s/.test(char);
}

function readImgSource(tag: string): ImgSourceLocation | null {
  let index = 4;
  while (index < tag.length) {
    index = skipWhitespace(tag, index);
    const marker = tag[index];
    if (index >= tag.length || marker === '>' || marker === '/') return null;
    const nameStart = index;
    while (index < tag.length && !isAttributeBoundary(tag[index] ?? '')) index += 1;
    const name = tag.slice(nameStart, index);
    index = skipWhitespace(tag, index);
    if (index >= tag.length || tag[index] !== '=') continue;
    index += 1;
    index = skipWhitespace(tag, index);
    const quote = tag[index];
    const quoted = quote === '"' || quote === "'";
    let valueStart = index;
    let valueEnd: number;
    if (quoted) {
      valueStart = index + 1;
      const end = tag.indexOf(quote, valueStart);
      if (end < 0) return null;
      valueEnd = end;
      index = end + 1;
    } else {
      while (index < tag.length && tag[index] !== '>' && !/\s/.test(tag[index] ?? '')) index += 1;
      valueEnd = index;
    }
    if (name.toLowerCase() !== 'src') continue;
    let attrStart = nameStart;
    while (attrStart > 0 && /\s/.test(tag[attrStart - 1] ?? '')) attrStart -= 1;
    const raw = tag.slice(valueStart, valueEnd);
    return {
      raw,
      decoded: decodeImageSource(raw),
      valueStart,
      valueEnd,
      attrStart,
      attrEnd: index,
    };
  }
  return null;
}

function tagWithSource(tag: string, source: ImgSourceLocation, next: string): string {
  return tag.slice(0, source.valueStart) + next + tag.slice(source.valueEnd);
}

function tagWithoutSource(tag: string, source: ImgSourceLocation): string {
  return tag.slice(0, source.attrStart) + tag.slice(source.attrEnd);
}

function isImgTagStart(html: string, start: number): boolean {
  if (html.slice(start, start + 4).toLowerCase() !== '<img') return false;
  const next = html[start + 4];
  return next === undefined || /[\s/>]/.test(next);
}

function findTagEnd(html: string, start: number): number {
  let quote = '';
  for (let index = start; index < html.length; index += 1) {
    const char = html[index] ?? '';
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return index + 1;
  }
  return -1;
}

async function rewriteImgTag(
  tag: string,
  resolveSource: (src: string) => Promise<string | null>,
  claimRewrite: () => boolean
): Promise<string> {
  const source = readImgSource(tag);
  if (!source) return tag;
  if (isDataImageSrc(source.raw) || isDataImageSrc(source.decoded)) return tag;
  if (
    isSvgSource(source.raw) ||
    isSvgSource(source.decoded) ||
    isRemoteHttpSrc(source.raw) ||
    isRemoteHttpSrc(source.decoded)
  ) {
    return tagWithoutSource(tag, source);
  }
  if (!isRelativeImageSrc(source.decoded)) return tag;
  if (!claimRewrite()) return tag;
  let resolved: string | null;
  try {
    resolved = await resolveSource(source.decoded);
  } catch {
    return tag;
  }
  if (!resolved || !SAFE_DATA_IMAGE.test(resolved)) return tag;
  return tagWithSource(tag, source, resolved);
}

export async function rewritePreviewImages(
  html: string,
  resolveSource: (src: string) => Promise<string | null>
): Promise<string> {
  const lower = html.toLowerCase();
  let cursor = 0;
  let rewrites = 0;
  let result = '';

  while (cursor < html.length) {
    const start = lower.indexOf('<img', cursor);
    if (start < 0) {
      result += html.slice(cursor);
      break;
    }
    if (!isImgTagStart(html, start)) {
      result += html.slice(cursor, start + 4);
      cursor = start + 4;
      continue;
    }
    const end = findTagEnd(html, start);
    if (end < 0) {
      result += html.slice(cursor);
      break;
    }
    result += html.slice(cursor, start);
    result += await rewriteImgTag(html.slice(start, end), resolveSource, () => {
      if (rewrites >= MAX_PREVIEW_IMAGE_REWRITES) return false;
      rewrites += 1;
      return true;
    });
    cursor = end;
  }

  return result;
}
