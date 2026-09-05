import { describe, expect, it } from 'vitest';
import { mount, unmount } from 'svelte';
import StatusBar from '../../lib/chrome/StatusBar.svelte';

describe('StatusBar component', () => {
  it('renders status and character/word statistics', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const component = mount(StatusBar, {
      target,
      props: {
        status: 'Ready',
        editionWarning: null,
        content: 'Hello beautiful world',
      },
    });

    expect(target.textContent).toContain('Ready');
    expect(target.textContent).toContain('21 characters · 3 words');

    unmount(component);
    target.remove();
  });

  it('renders edition warning when provided', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const component = mount(StatusBar, {
      target,
      props: {
        status: 'Saved',
        editionWarning: 'Safeguards active',
        content: '',
      },
    });

    expect(target.textContent).toContain('Saved · Safeguards active');
    expect(target.textContent).toContain('0 characters · 0 words');

    unmount(component);
    target.remove();
  });
});
