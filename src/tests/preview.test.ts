import { describe, expect, it } from 'vitest';
import { renderMarkdown, rewritePreviewImages } from '../lib/preview';

describe('renderMarkdown', () => {
  it('renders GitHub-flavored markdown', async () => {
    const html = await renderMarkdown('# Tuxedo\n\n- [x] Polished');
    expect(html).toContain('<h1>Tuxedo</h1>');
    expect(html).toContain('type="checkbox"');
  });

  it('sanitizes unsafe HTML', async () => {
    const html = await renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
  });

  it('strips remote image beacons and exotic link protocols', async () => {
    const html = await renderMarkdown(
      '![tracker](https://evil.example/pixel.png)\n\n[chat](irc://irc.example/tuxedo)'
    );
    expect(html).not.toContain('https://evil.example/pixel.png');
    expect(html).not.toContain('irc://');
    expect(html).toContain('<img');
  });

  it('keeps https and mailto links', async () => {
    const html = await renderMarkdown('[site](https://example.com) [mail](mailto:a@b.c)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="mailto:a@b.c"');
  });

  it('keeps relative paths and anchor fragment links', async () => {
    const html = await renderMarkdown('[Section](#heading) [Guide](docs/guide.md)');
    expect(html).toContain('href="#heading"');
    expect(html).toContain('href="docs/guide.md"');
  });

  it('strips http links', async () => {
    const html = await renderMarkdown('[insecure](http://example.com)');
    expect(html).not.toContain('href="http://example.com"');
  });

  it('strips javascript and vbscript link schemes', async () => {
    const js = await renderMarkdown('[xss](javascript:alert(1))');
    expect(js).not.toContain('javascript:');
    expect(js).not.toContain('alert(1)');

    const vbs = await renderMarkdown('[xss](vbscript:msgbox(1))');
    expect(vbs).not.toContain('vbscript:');
  });

  it('strips inline event handler attributes on elements', async () => {
    const html = await renderMarkdown('<img src="data:image/png;base64,123" onerror="alert(1)">');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(1)');
  });

  it('strips svg scripts and dangerous tags', async () => {
    const html = await renderMarkdown('<svg><script>alert(1)</script></svg>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  it('strips style tags preventing css injection', async () => {
    const html = await renderMarkdown('<style>body { display: none; }</style>');
    expect(html).not.toContain('<style>');
    expect(html).not.toContain('display: none');
  });

  it('preserves safe semantic HTML tags through rehype-raw', async () => {
    const html = await renderMarkdown(
      '<kbd>Ctrl</kbd> + <kbd>S</kbd>\n\n<details><summary>Details</summary>Content</details>'
    );
    expect(html).toContain('<kbd>Ctrl</kbd>');
    expect(html).toContain('<details>');
    expect(html).toContain('<summary>Details</summary>');
  });

  it('renders GFM tables and strikethrough', async () => {
    const html = await renderMarkdown(
      '| Head 1 | Head 2 |\n|---|---|\n| Cell 1 | Cell 2 |\n\n~~deleted~~'
    );
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Head 1</th>');
    expect(html).toContain('<td>Cell 1</td>');
    expect(html).toContain('<del>deleted</del>');
  });

  it('handles empty and whitespace-only markdown gracefully', async () => {
    expect(await renderMarkdown('')).toBe('');
    expect(await renderMarkdown('   \n\n  ')).toBe('');
  });

  it('keeps mermaid fences and dollar math as source by default', async () => {
    const html = await renderMarkdown('```mermaid\ngraph TD; A-->B\n```\n\nEnergy $E=mc^2$.');
    expect(html).toContain('language-mermaid');
    expect(html).toContain('graph TD');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('katex');
    expect(html).toContain('$E=mc^2$');
  });

  it('renders a mermaid diagram to svg without script when enabled', async () => {
    const html = await renderMarkdown('```mermaid\ngraph TD; A-->B\n```', { mermaid: true });
    expect(html).toContain('<svg');
    expect(html).not.toContain('<script');
    expect(html.toLowerCase()).not.toContain('<style');
    expect(html.toLowerCase()).not.toContain('foreignobject');
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it('renders katex markup for inline math without script', async () => {
    const html = await renderMarkdown('Energy $E=mc^2$.', { math: true });
    expect(html).toContain('katex');
    expect(html).toContain('<math');
    expect(html).not.toContain('<script');
  });

  it('leaves a failed expression as text and still renders its neighbor', async () => {
    const html = await renderMarkdown('$E=mc^2$ and $\\frac{1}$', { math: true });
    expect(html).toContain('katex');
    expect(html).toContain('\\frac{1}');
    expect(html).not.toContain('<script');
  });

  it('strips script from hostile mermaid and math', async () => {
    const diagram = await renderMarkdown(
      '```mermaid\ngraph TD\nA["<script>alert(1)</script>"]\nclick A href "javascript:alert(1)"\n```',
      { mermaid: true }
    );
    expect(diagram).not.toContain('<script');
    expect(diagram).not.toMatch(/\son[a-z]+\s*=/i);
    expect(diagram).not.toMatch(/(?:href|src)\s*=\s*["'][^"']*javascript:/i);

    const math = await renderMarkdown(
      '<script>alert(1)</script>\n\n$\\href{javascript:alert(1)}{click}$',
      { math: true }
    );
    expect(math).toContain('katex');
    expect(math).not.toContain('<script');
    expect(math).not.toContain('javascript:');
    expect(math).not.toMatch(/\son[a-z]+\s*=/i);
  });
});

describe('rewritePreviewImages', () => {
  const png = 'data:image/png;base64,aaaa';

  it('rewrites relative sources and leaves markdown without images unchanged', async () => {
    const plain = await renderMarkdown('# Tuxedo');
    expect(await rewritePreviewImages(plain, async () => png)).toBe(plain);

    const html = await renderMarkdown('![Plot](images/plot.png)');
    const seen: string[] = [];
    const rewritten = await rewritePreviewImages(html, async (src) => {
      seen.push(src);
      return png;
    });
    expect(seen).toEqual(['images/plot.png']);
    expect(rewritten).toContain(`src="${png}"`);
    expect(rewritten).not.toContain('images/plot.png');
  });

  it('drops svg and remote sources and ignores data urls', async () => {
    const svg = await rewritePreviewImages('<img alt="icon" src="icon.svg">', async () => png);
    expect(svg).toBe('<img alt="icon">');
    expect(svg).not.toContain('.svg');

    const encoded = await rewritePreviewImages(
      '<img src="icon%2Esvg" alt="icon">',
      async () => png
    );
    expect(encoded).not.toMatch(/src\s*=\s*["'][^"']*svg/i);
    expect(encoded).not.toContain(png);

    let remoteCalls = 0;
    const remote = await rewritePreviewImages(
      '<img src="https://evil.example/a.png" alt="t">',
      async () => {
        remoteCalls += 1;
        return png;
      }
    );
    expect(remoteCalls).toBe(0);
    expect(remote).not.toContain('https://');
    expect(remote).not.toContain('evil.example');

    const markdown = await renderMarkdown('![tracker](https://evil.example/pixel.png)');
    const stillRemote = await rewritePreviewImages(markdown, async () => png);
    expect(stillRemote).not.toContain('https://evil.example/pixel.png');
    expect(stillRemote).not.toContain('http://');

    let dataCalls = 0;
    const data = await rewritePreviewImages(
      '<img src="data:image/png;base64,123" alt="x">',
      async () => {
        dataCalls += 1;
        return png;
      }
    );
    expect(dataCalls).toBe(0);
    expect(data).toContain('src="data:image/png;base64,123"');
  });

  it('decodes relative sources and keeps a failed image unchanged', async () => {
    const seen: string[] = [];
    const rewritten = await rewritePreviewImages(
      '<img alt="src=nope.png" src="my%20plot.png"><img src="a&amp;b.png" alt="b"><img src="bad.png" alt="c">',
      async (src) => {
        seen.push(src);
        if (src === 'bad.png') throw new Error('refused');
        if (src === 'a&b.png') return null;
        return png;
      }
    );
    expect(seen).toEqual(['my plot.png', 'a&b.png', 'bad.png']);
    expect(rewritten).toContain('alt="src=nope.png"');
    expect(rewritten).toContain(`src="${png}"`);
    expect(rewritten).toContain('src="a&amp;b.png"');
    expect(rewritten).toContain('src="bad.png"');
    expect(rewritten).not.toContain('javascript:');
  });

  it('leaves sources past the rewrite cap and rejects unsafe data urls', async () => {
    const tags = Array.from(
      { length: 41 },
      (_, index) => `<img src="img-${index}.png" alt="">`
    ).join('');
    let calls = 0;
    const rewritten = await rewritePreviewImages(tags, async () => {
      calls += 1;
      return 'data:image/png;base64,qq==';
    });
    expect(calls).toBe(40);
    expect(rewritten.match(/src="data:image\/png;base64,qq=="/g)).toHaveLength(40);
    expect(rewritten).toContain('src="img-40.png"');

    const unsafe = await rewritePreviewImages('<img src="a.png" alt="a">', async () => {
      return 'data:image/png;base64,aaa" onerror="alert(1)';
    });
    expect(unsafe).toContain('src="a.png"');
    expect(unsafe).not.toContain('onerror');
  });
});
