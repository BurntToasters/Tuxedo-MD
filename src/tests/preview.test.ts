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

  it('strips http links', async () => {
    const html = await renderMarkdown('[insecure](http://example.com)');
    expect(html).not.toContain('href="http://example.com"');
  });
});
