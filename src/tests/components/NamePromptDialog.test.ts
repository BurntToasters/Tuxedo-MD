import { describe, expect, it, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import NamePromptDialog from '../../lib/chrome/NamePromptDialog.svelte';

describe('NamePromptDialog component', () => {
  it('renders nothing when open is false', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const comp = mount(NamePromptDialog, {
      target,
      props: {
        open: false,
        title: 'Rename File',
        label: 'New file name',
        value: 'test.md',
        onsubmit: vi.fn(),
        oncancel: vi.fn(),
      },
    });

    expect(target.querySelector('dialog')).toBeNull();
    unmount(comp);
    target.remove();
  });

  it('renders title, input, and submits value when valid', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onsubmit = vi.fn();
    const oncancel = vi.fn();

    const comp = mount(NamePromptDialog, {
      target,
      props: {
        open: true,
        title: 'Rename Document',
        label: 'File name',
        value: 'NewNote',
        onsubmit,
        oncancel,
      },
    });

    expect(target.querySelector('h2')?.textContent).toBe('Rename Document');
    const input = target.querySelector('input');
    expect(input?.value).toBe('NewNote');

    const form = target.querySelector('form');
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(onsubmit).toHaveBeenCalledWith('NewNote');

    unmount(comp);
    target.remove();
  });

  it('triggers oncancel when cancel button or backdrop is clicked', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const oncancel = vi.fn();

    const comp = mount(NamePromptDialog, {
      target,
      props: {
        open: true,
        title: 'New File',
        label: 'Name',
        value: 'note',
        onsubmit: vi.fn(),
        oncancel,
      },
    });

    const cancelButton = target.querySelector(
      '.modal-actions button[type="button"]'
    ) as HTMLButtonElement;
    cancelButton?.click();
    expect(oncancel).toHaveBeenCalledTimes(1);

    const backdrop = target.querySelector('.modal-backdrop') as HTMLElement;
    backdrop?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(oncancel).toHaveBeenCalledTimes(2);

    unmount(comp);
    target.remove();
  });
});
