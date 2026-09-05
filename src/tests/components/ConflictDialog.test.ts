import { describe, expect, it, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import ConflictDialog from '../../lib/chrome/ConflictDialog.svelte';

describe('ConflictDialog component', () => {
  it('renders nothing when open is false', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const comp = mount(ConflictDialog, {
      target,
      props: {
        open: false,
        tabName: 'note.md',
        onresolve: vi.fn(),
        ondismiss: vi.fn(),
      },
    });

    expect(target.querySelector('dialog')).toBeNull();
    unmount(comp);
    target.remove();
  });

  it('renders conflict message with tabName and triggers reload action', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onresolve = vi.fn();
    const ondismiss = vi.fn();

    const comp = mount(ConflictDialog, {
      target,
      props: {
        open: true,
        tabName: 'Chapter1.md',
        onresolve,
        ondismiss,
      },
    });

    expect(target.querySelector('h2')?.textContent).toBe('File changed outside Tuxedo MD');
    expect(target.querySelector('p')?.textContent).toContain('"Chapter1.md" changed on disk');

    const buttons = target.querySelectorAll('button');
    const reloadBtn = buttons[0];
    reloadBtn.click();

    expect(onresolve).toHaveBeenCalledWith('reload');

    unmount(comp);
    target.remove();
  });

  it('triggers keep action when Keep my version is clicked', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onresolve = vi.fn();
    const ondismiss = vi.fn();

    const comp = mount(ConflictDialog, {
      target,
      props: {
        open: true,
        tabName: null,
        onresolve,
        ondismiss,
      },
    });

    const buttons = target.querySelectorAll('button');
    const keepBtn = buttons[1];
    keepBtn.click();

    expect(onresolve).toHaveBeenCalledWith('keep');

    unmount(comp);
    target.remove();
  });
});
