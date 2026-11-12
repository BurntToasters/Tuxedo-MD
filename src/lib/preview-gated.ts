interface MdNode {
  type: string;
  value?: string;
  lang?: string | null;
  children?: MdNode[];
}

export interface GatedPreviewOptions {
  mermaid: boolean;
  math: boolean;
}

type KatexRender = typeof import('katex').renderToString;

export function gatedPreviewPlugin(options: GatedPreviewOptions) {
  return (tree: MdNode) => applyGatedPreview(tree, options);
}

async function applyGatedPreview(tree: MdNode, options: GatedPreviewOptions): Promise<void> {
  if (options.math) await renderMathTree(tree);
  if (options.mermaid) await renderMermaidTree(tree);
}

function treeHasDollar(node: MdNode): boolean {
  if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'html') return false;
  if (node.type === 'text') return node.value?.includes('$') ?? false;
  return node.children?.some(treeHasDollar) ?? false;
}

let katexStyles: Promise<void> | null = null;

function loadKatexStyles(): Promise<void> {
  // MathML still renders if the stylesheet fails to load.
  katexStyles ??= import('katex/dist/katex.min.css').then(
    () => undefined,
    () => undefined
  );
  return katexStyles;
}

async function renderMathTree(node: MdNode): Promise<void> {
  if (!treeHasDollar(node)) return;
  const [{ renderToString }] = await Promise.all([import('katex'), loadKatexStyles()]);
  replaceMath(node, renderToString);
}

function replaceMath(node: MdNode, renderToString: KatexRender): void {
  const children = node.children;
  if (!children) return;
  const next: MdNode[] = [];
  for (const child of children) {
    if (child.type === 'text' && child.value?.includes('$')) {
      next.push(...splitMath(child.value, renderToString));
      continue;
    }
    if (child.type !== 'code' && child.type !== 'inlineCode' && child.type !== 'html') {
      replaceMath(child, renderToString);
    }
    next.push(child);
  }
  node.children = next;
}

function canOpenMath(value: string, index: number): boolean {
  if (index === 0) return true;
  return !/[A-Za-z0-9]/.test(value[index - 1] ?? '');
}

function findInlineClose(value: string, start: number): number {
  if (start >= value.length || /\s/.test(value[start] ?? '')) return -1;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\n' || char === '\r') return -1;
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char !== '$') continue;
    if (/\s/.test(value[index - 1] ?? '')) return -1;
    if (index === start) return -1;
    return index;
  }
  return -1;
}

function withoutAnnotation(html: string): string {
  return html.replace(/<annotation\b[^>]*>[\s\S]*?<\/annotation>/gi, '');
}

function mathNode(tex: string, display: boolean, raw: string, renderToString: KatexRender): MdNode {
  try {
    const html = renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: 'ignore',
      output: 'mathml',
    });
    return { type: 'html', value: withoutAnnotation(html) };
  } catch {
    // One bad expression stays source text; neighbors still render.
    return { type: 'text', value: raw };
  }
}

function splitMath(value: string, renderToString: KatexRender): MdNode[] {
  const parts: MdNode[] = [];
  let buffer = '';
  let index = 0;

  const flush = () => {
    if (!buffer) return;
    parts.push({ type: 'text', value: buffer });
    buffer = '';
  };

  while (index < value.length) {
    if (value[index] === '\\' && value[index + 1] === '$') {
      buffer += '$';
      index += 2;
      continue;
    }

    const display = value.startsWith('$$', index);
    if ((display || value[index] === '$') && canOpenMath(value, index)) {
      if (display) {
        const end = value.indexOf('$$', index + 2);
        if (end !== -1) {
          const raw = value.slice(index, end + 2);
          flush();
          parts.push(mathNode(value.slice(index + 2, end), true, raw, renderToString));
          index = end + 2;
          continue;
        }
      } else {
        const end = findInlineClose(value, index + 1);
        if (end !== -1) {
          const raw = value.slice(index, end + 1);
          flush();
          parts.push(mathNode(value.slice(index + 1, end), false, raw, renderToString));
          index = end + 1;
          continue;
        }
      }
    }

    buffer += value[index] ?? '';
    index += 1;
  }

  flush();
  return parts;
}

type MermaidRuntime = typeof import('mermaid/dist/mermaid.core.mjs').default;

let mermaidApi: Promise<MermaidRuntime> | null = null;
let mermaidSerial = 0;
let measurementChecked = false;

function loadMermaid(): Promise<MermaidRuntime> {
  // Package entry types import type-fest, which mermaid does not ship.
  mermaidApi ??= import('mermaid/dist/mermaid.core.mjs').then((module) => {
    const mermaid = module.default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      suppressErrorRendering: true,
      logLevel: 'fatal',
      // Diagram init blocks cannot turn HTML labels or loose security back on.
      secure: [
        'secure',
        'securityLevel',
        'startOnLoad',
        'maxTextSize',
        'suppressErrorRendering',
        'maxEdges',
        'htmlLabels',
      ],
    });
    return mermaid;
  });
  return mermaidApi;
}

function ensureSvgMeasurement(): void {
  if (measurementChecked) return;
  if (typeof document === 'undefined' || !document.body || typeof SVGElement === 'undefined') {
    return;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.textContent = 'A';
  svg.append(text);
  document.body.append(svg);
  let broken = typeof text.getBBox !== 'function';
  if (!broken) {
    try {
      text.getBBox();
    } catch {
      broken = true;
    }
  }
  svg.remove();
  measurementChecked = true;
  if (!broken) return;

  // jsdom has no SVG text metrics. Browsers that already implement getBBox skip this.
  const box = (): DOMRect =>
    ({
      x: 0,
      y: 0,
      width: 48,
      height: 16,
      top: 0,
      left: 0,
      bottom: 16,
      right: 48,
      toJSON() {
        return {};
      },
    }) as DOMRect;
  const proto = SVGElement.prototype as SVGElement & {
    getBBox: () => DOMRect;
    getComputedTextLength: () => number;
  };
  proto.getBBox = () => box();
  proto.getComputedTextLength = () => 32;
}

function presentDiagram(svg: string): string {
  if (typeof DOMParser === 'undefined') return svg;
  try {
    return paintDiagram(svg);
  } catch {
    return svg;
  }
}

const UNSAFE_TAGS = new Set(['script', 'style', 'foreignobject', 'iframe', 'object', 'embed']);

function stripActiveContent(root: Element): void {
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (el !== root && UNSAFE_TAGS.has(el.localName.toLowerCase())) {
      el.remove();
      continue;
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name === 'style' || name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === 'href' || name === 'src' || name.endsWith(':href')) &&
        /^\s*(?:javascript|vbscript|data):/i.test(attr.value)
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

function paintShape(el: Element, fill: string, stroke: string, width: string): void {
  el.setAttribute('fill', fill);
  el.setAttribute('stroke', stroke);
  if (!el.getAttribute('stroke-width')) el.setAttribute('stroke-width', width);
}

function paintDiagram(svg: string): string {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.localName.toLowerCase() !== 'svg' || root.querySelector('parsererror')) return svg;
  stripActiveContent(root);

  for (const el of root.querySelectorAll('rect, circle, ellipse, polygon, path, line, polyline')) {
    const name = el.localName.toLowerCase();
    const className = el.getAttribute('class') ?? '';
    const linked = el.getAttribute('marker-end') || el.getAttribute('marker-start');
    const edge =
      name === 'line' ||
      name === 'polyline' ||
      Boolean(linked) ||
      className.includes('edge-') ||
      className.includes('flowchart-link');
    if (el.closest('marker')) {
      paintShape(el, 'currentColor', 'currentColor', '1');
      continue;
    }
    if (edge) {
      paintShape(el, 'none', 'currentColor', '1.5');
      continue;
    }
    paintShape(el, 'transparent', 'currentColor', '1');
  }

  for (const el of root.querySelectorAll('text, tspan')) {
    el.setAttribute('fill', 'currentColor');
  }

  return root.outerHTML;
}

async function renderMermaidSvg(source: string): Promise<string | null> {
  try {
    ensureSvgMeasurement();
    const mermaid = await loadMermaid();
    const id = `tuxedoMermaid${(mermaidSerial += 1)}`;
    // securityLevel strict encodes labels and disables clicks. Do not call bindFunctions.
    const { svg } = await mermaid.render(id, source);
    if (!svg.includes('<svg')) return null;
    return presentDiagram(svg);
  } catch {
    return null;
  }
}

async function renderMermaidTree(node: MdNode): Promise<void> {
  const children = node.children;
  if (!children) return;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!child) continue;
    if (child.type === 'code' && child.lang?.toLowerCase() === 'mermaid') {
      const svg = await renderMermaidSvg(child.value ?? '');
      if (svg) children[index] = { type: 'html', value: svg };
      continue;
    }
    await renderMermaidTree(child);
  }
}
