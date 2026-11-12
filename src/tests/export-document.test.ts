import { describe, expect, it } from 'vitest';
import {
  EXPORT_PROFILE_KEY,
  buildExportDocument,
  defaultExportProfile,
  htmlExportDefaultPath,
  htmlFileNameForDocument,
  normalizeExportProfile,
} from '../lib/export-document';

function styleBlock(html: string): string {
  const start = html.indexOf('<style>');
  const end = html.indexOf('</style>');
  return html.slice(start, end);
}

describe('export profiles', () => {
  it('stores the profile under export-profile', () => {
    expect(EXPORT_PROFILE_KEY).toBe('export-profile');
  });

  it('fills defaults for missing or invalid profile fields', () => {
    expect(normalizeExportProfile(null)).toEqual(defaultExportProfile);
    expect(normalizeExportProfile('a4')).toEqual(defaultExportProfile);
    expect(normalizeExportProfile([])).toEqual(defaultExportProfile);
    expect(normalizeExportProfile({})).toEqual(defaultExportProfile);
    expect(
      normalizeExportProfile({
        pageSize: 'legal',
        margin: 'huge',
        themeId: 'system',
      })
    ).toEqual(defaultExportProfile);
    expect(
      normalizeExportProfile({
        pageSize: 'a4',
        margin: 'wide',
        themeId: 'nope',
        version: 9,
      })
    ).toEqual({
      pageSize: 'a4',
      margin: 'wide',
      themeId: 'dark',
    });
    expect(normalizeExportProfile({ themeId: 'contrast' })).toEqual({
      pageSize: 'letter',
      margin: 'normal',
      themeId: 'contrast',
    });
  });

  it('names the export from the note and keeps the note directory', () => {
    expect(htmlFileNameForDocument('Welcome.md')).toBe('Welcome.html');
    expect(htmlFileNameForDocument('Guide.markdown')).toBe('Guide.html');
    expect(htmlFileNameForDocument('  ')).toBe('Untitled.html');
    expect(htmlExportDefaultPath('Welcome.md', null)).toBe('Welcome.html');
    expect(htmlExportDefaultPath('Welcome.md', 'C:\\notes\\Welcome.md')).toBe(
      'C:\\notes\\Welcome.html'
    );
    expect(htmlExportDefaultPath('Welcome.md', '/notes/Welcome.md')).toBe('/notes/Welcome.html');
  });
});

describe('export HTML shell', () => {
  it('omits script from the markdown and keeps two builds identical', async () => {
    const input = {
      markdown: '# Title\n\n<script>alert(1)</script>\n\nSafe text',
      title: 'Notes.md',
      profile: { pageSize: 'nope', margin: 'nope', themeId: 'nope' },
    };
    const first = await buildExportDocument(input);
    const second = await buildExportDocument(input);

    expect(first).toBe(second);
    expect(first.startsWith('<!DOCTYPE html>\n')).toBe(true);
    expect(first).toContain('<meta charset="utf-8">');
    expect(first).toContain('<title>Notes.md</title>');
    expect(first).toContain('<h1>Title</h1>');
    expect(first).toContain('Safe text');
    expect(first).not.toContain('<script');
    expect(first).not.toContain('alert(1)');
    expect(first).toContain('size: letter');
    expect(first).toContain('margin: 1in');
    expect(first).toContain('#0d1117');
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('bakes the chosen page and theme and leaves note text out of the style block', async () => {
    const marker = 'EXPORT_MARKER_body{color:red}';
    const attack = 'letter; } body { background: url(javascript:alert(1))';
    const html = await buildExportDocument({
      markdown: marker,
      title: '</title><script>alert(1)</script>',
      profile: { pageSize: 'a4', margin: 'narrow', themeId: 'light' },
    });
    const injected = await buildExportDocument({
      markdown: 'Hello',
      title: 'Note',
      profile: { pageSize: attack, margin: attack, themeId: attack },
    });
    const style = styleBlock(html);

    expect(style).toContain('size: A4');
    expect(style).toContain('margin: 0.5in');
    expect(style).toContain('#f6f8fa');
    expect(style).not.toContain(marker);
    expect(html).toContain(marker);
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script');
    expect(injected).not.toContain(attack);
    expect(injected).not.toContain('javascript');
    expect(styleBlock(injected)).toContain('size: letter');
    expect(styleBlock(injected)).toContain('margin: 1in');
  });

  it('uses wide margins and contrast colors from a valid profile', async () => {
    const html = await buildExportDocument({
      markdown: 'Body',
      title: 'Body',
      profile: { pageSize: 'letter', margin: 'wide', themeId: 'contrast' },
    });
    const style = styleBlock(html);
    expect(style).toContain('margin: 1.5in');
    expect(style).toContain('#000000');
    expect(style).toContain('#ffffff');
    expect(style).toContain('#ffff00');
  });
});
