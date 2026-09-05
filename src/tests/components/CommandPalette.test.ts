import { describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import CommandPalette from '../../lib/chrome/CommandPalette.svelte';

function createMockCommands() {
  return [
    {
      id: 'cmd-save',
      label: 'Save Document',
      description: 'Save current active document',
      section: 'File',
      keywords: 'write disk',
      shortcut: 'Ctrl+S',
      run: vi.fn(),
    },
    {
      id: 'cmd-format',
      label: 'Format Bold',
      description: 'Format selected text in bold',
      section: 'Format',
      keywords: 'markdown strong',
      shortcut: 'Ctrl+B',
      run: vi.fn(),
    },
    {
      id: 'cmd-preview',
      label: 'Toggle Preview',
      description: 'Toggle preview pane',
      section: 'View',
      shortcut: 'Ctrl+P',
      run: vi.fn(),
    },
  ];
}

describe('CommandPalette component', () => {
  it('renders command list and sections', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const commands = createMockCommands();
    const onclose = vi.fn();

    const comp = mount(CommandPalette, {
      target,
      props: { commands, onclose },
    });

    const search = target.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search).not.toBeNull();
    const sections = target.querySelectorAll('.command-palette-section');
    expect(sections).toHaveLength(3);
    const options = target.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(3);

    unmount(comp);
    target.remove();
  });

  it('filters commands by search query across label, description, and keywords', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const commands = createMockCommands();
    const onclose = vi.fn();

    const comp = mount(CommandPalette, {
      target,
      props: { commands, onclose },
    });

    const search = target.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'strong';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    const options = target.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('Format Bold');

    search.value = 'nonexistent';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    expect(target.querySelector('.command-palette-empty')).not.toBeNull();

    unmount(comp);
    target.remove();
  });

  it('navigates with arrow keys and executes with Enter', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const commands = createMockCommands();
    const onclose = vi.fn();

    const comp = mount(CommandPalette, {
      target,
      props: { commands, onclose },
    });

    const search = target.querySelector<HTMLInputElement>('input[type="search"]')!;

    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await tick();

    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    await tick();

    expect(onclose).toHaveBeenCalledTimes(1);
    expect(commands[1].run).toHaveBeenCalledTimes(1);

    unmount(comp);
    target.remove();
  });

  it('executes a command when its option is clicked', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const commands = createMockCommands();
    const onclose = vi.fn();

    const comp = mount(CommandPalette, {
      target,
      props: { commands, onclose },
    });

    const options = target.querySelectorAll<HTMLButtonElement>('[role="option"]');
    options[0].click();
    await tick();
    await tick();

    expect(onclose).toHaveBeenCalledTimes(1);
    expect(commands[0].run).toHaveBeenCalledTimes(1);

    unmount(comp);
    target.remove();
  });

  it('closes when Escape is pressed or backdrop is clicked', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const commands = createMockCommands();
    const onclose = vi.fn();

    const comp = mount(CommandPalette, {
      target,
      props: { commands, onclose },
    });

    const dialog = target.querySelector<HTMLDialogElement>('dialog')!;
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onclose).toHaveBeenCalledTimes(1);

    const backdrop = target.querySelector<HTMLDivElement>('.command-palette-backdrop')!;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onclose).toHaveBeenCalledTimes(2);

    unmount(comp);
    target.remove();
  });
});
