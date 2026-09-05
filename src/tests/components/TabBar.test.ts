import { describe, expect, it, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import TabBar from '../../lib/chrome/TabBar.svelte';
import type { DocumentTab } from '../../lib/types';

function createTestTab(overrides: Partial<DocumentTab> = {}): DocumentTab {
  return {
    id: 'tab-1',
    name: 'Doc1.md',
    path: 'C:/notes/Doc1.md',
    content: 'hello',
    savedContent: 'hello',
    fingerprint: null,
    conflict: false,
    recovered: false,
    selection: { anchor: 0, head: 0 },
    ...overrides,
  };
}

describe('TabBar component', () => {
  it('renders tabs with active class and dirty/conflict indicators', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const tabs: DocumentTab[] = [
      createTestTab({ id: 't1', name: 'Note1.md', content: 'edited', savedContent: 'orig' }),
      createTestTab({ id: 't2', name: 'Note2.md', conflict: true }),
      createTestTab({ id: 't3', name: 'Note3.md', recovered: true }),
    ];

    const comp = mount(TabBar, {
      target,
      props: {
        tabs,
        activeId: 't1',
        onselect: vi.fn(),
        onclose: vi.fn(),
        onnew: vi.fn(),
      },
    });

    const tabElements = target.querySelectorAll('.titlebar-tab');
    expect(tabElements).toHaveLength(3);
    expect(tabElements[0].classList.contains('active')).toBe(true);
    expect(tabElements[1].classList.contains('active')).toBe(false);

    expect(tabElements[1].textContent).toContain('Note2.md !');
    expect(tabElements[2].textContent).toContain('Note3.md •');

    unmount(comp);
    target.remove();
  });

  it('triggers onselect, onclose, and onnew callbacks', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onselect = vi.fn();
    const onclose = vi.fn();
    const onnew = vi.fn();

    const tabs: DocumentTab[] = [createTestTab({ id: 't1', name: 'Test.md' })];

    const comp = mount(TabBar, {
      target,
      props: {
        tabs,
        activeId: 't1',
        onselect,
        onclose,
        onnew,
      },
    });

    const selectBtn = target.querySelector('.tab-select') as HTMLButtonElement;
    selectBtn.click();
    expect(onselect).toHaveBeenCalledWith('t1');

    const closeBtn = target.querySelector('.tab-close') as HTMLButtonElement;
    closeBtn.click();
    expect(onclose).toHaveBeenCalledWith('t1');

    const newTabBtn = target.querySelector('.titlebar-new-tab') as HTMLButtonElement;
    newTabBtn.click();
    expect(onnew).toHaveBeenCalled();

    unmount(comp);
    target.remove();
  });
});
