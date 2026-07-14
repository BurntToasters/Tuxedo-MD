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
});
