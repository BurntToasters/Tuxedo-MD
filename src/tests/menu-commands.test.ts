import { describe, expect, it } from 'vitest';
import { buildEditMenu, buildFileMenu, buildHelpMenu, buildViewMenu } from '../lib/menu-commands';

describe('menu commands builder', () => {
  it('builds file menu with standard entries and separators', () => {
    const menu = buildFileMenu();
    expect(menu.length).toBeGreaterThan(5);
    const ids = menu.filter((item) => item.type === 'item').map((item) => item.id);
    expect(ids).toContain('new-document');
    expect(ids).toContain('open-document');
    expect(ids).toContain('save-document');
    expect(ids).toContain('save-document-as');
    expect(ids).toContain('close-tab');
    expect(ids).toContain('quit');
    expect(menu.some((item) => item.type === 'separator')).toBe(true);
  });

  it('builds edit menu with find, command palette, and tab cycling', () => {
    const menu = buildEditMenu();
    const ids = menu.filter((item) => item.type === 'item').map((item) => item.id);
    expect(ids).toEqual(['find', 'command-palette', 'next-tab', 'previous-tab']);
  });

  it('builds view menu with layout and settings options', () => {
    const menu = buildViewMenu();
    const ids = menu.filter((item) => item.type === 'item').map((item) => item.id);
    expect(ids).toContain('toggle-sidebar');
    expect(ids).toContain('editor-view');
    expect(ids).toContain('split-view');
    expect(ids).toContain('preview-view');
    expect(ids).toContain('toggle-focus-mode');
    expect(ids).toContain('settings');
  });

  it('builds help menu conditionally based on updatesSupported', () => {
    expect(buildHelpMenu(false)).toEqual([]);
    const helpMenu = buildHelpMenu(true);
    expect(helpMenu).toHaveLength(1);
    expect(helpMenu[0]).toMatchObject({ id: 'check-updates' });
  });
});
