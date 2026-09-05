import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../lib/preview';

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
});
