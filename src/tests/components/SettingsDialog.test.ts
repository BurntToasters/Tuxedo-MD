import { describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import SettingsDialog from '../../lib/chrome/SettingsDialog.svelte';
import { defaultSettings } from '../../lib/types';

describe('SettingsDialog component', () => {
  it('renders nothing when open is false', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const comp = mount(SettingsDialog, {
      target,
      props: {
        open: false,
        settings: { ...defaultSettings },
        onclose: vi.fn(),
      },
    });

    expect(target.querySelector('dialog')).toBeNull();
    unmount(comp);
    target.remove();
  });

  it('renders dialog and switches between settings navigation tabs', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onclose = vi.fn();

    const comp = mount(SettingsDialog, {
      target,
      props: {
        open: true,
        settings: { ...defaultSettings },
        editionLabel: 'Pro',
        editionVersion: '0.1.0-alpha.1',
        isFullEdition: true,
        onclose,
      },
    });

    expect(target.querySelector('dialog')).not.toBeNull();
    const navButtons = target.querySelectorAll('.settings-sidebar button');
    expect(navButtons.length).toBe(4);

    // Switch to Editor tab
    const editorNavBtn = navButtons[1] as HTMLButtonElement;
    flushSync(() => {
      editorNavBtn.click();
    });
    expect(target.textContent).toContain('Wrap editor lines');

    // Switch to About tab
    const aboutNavBtn = navButtons[3] as HTMLButtonElement;
    flushSync(() => {
      aboutNavBtn.click();
    });
    expect(target.textContent).toContain('Tuxedo MD');
    expect(target.textContent).toContain('v0.1.0-alpha.1');
    expect(target.textContent).toContain('PRO');

    // Click close button
    const closeBtn = target.querySelector('header button.icon-button') as HTMLButtonElement;
    closeBtn.click();
    expect(onclose).toHaveBeenCalled();

    unmount(comp);
    target.remove();
  });
});
