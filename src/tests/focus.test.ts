import { describe, expect, it, vi } from 'vitest';
import {
  focusedElement,
  handleDismissibleDialogKeydown,
  isElementVisible,
  restoreFocus,
  trapDialogFocus,
} from '../lib/focus';

describe('focus utilities', () => {
  it('returns document.activeElement when HTMLElement', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    expect(focusedElement()).toBe(button);
    button.remove();
  });

  it('checks element visibility correctly', () => {
    const parent = document.createElement('div');
    const child = document.createElement('button');
    parent.appendChild(child);
    document.body.appendChild(parent);

    expect(isElementVisible(child)).toBe(true);

    parent.style.display = 'none';
    expect(isElementVisible(child)).toBe(false);

    parent.style.display = 'block';
    child.style.visibility = 'hidden';
    expect(isElementVisible(child)).toBe(false);

    parent.remove();
    expect(isElementVisible(child)).toBe(false);
  });

  it('restores focus asynchronously to visible targets', async () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    const focusSpy = vi.spyOn(button, 'focus');

    restoreFocus(button);
    await Promise.resolve();

    expect(focusSpy).toHaveBeenCalled();
    button.remove();
  });

  it('traps focus inside dialog on tab and shift-tab', () => {
    const dialog = document.createElement('dialog');
    const first = document.createElement('button');
    const middle = document.createElement('input');
    const last = document.createElement('button');
    dialog.appendChild(first);
    dialog.appendChild(middle);
    dialog.appendChild(last);
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);

    first.id = 'first';
    middle.id = 'middle';
    last.id = 'last';

    last.focus();
    expect(document.activeElement?.id).toBe('last');
    const tabForward = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(tabForward, 'currentTarget', { value: dialog });
    trapDialogFocus(tabForward);
    expect(document.activeElement?.id).toBe('first');

    first.focus();
    expect(document.activeElement?.id).toBe('first');
    const tabBackward = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(tabBackward, 'currentTarget', { value: dialog });
    trapDialogFocus(tabBackward);
    expect(document.activeElement?.id).toBe('last');

    dialog.remove();
  });

  it('handles empty dialogs on tab', () => {
    const dialog = document.createElement('dialog');
    document.body.appendChild(dialog);
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    Object.defineProperty(event, 'currentTarget', { value: dialog });
    trapDialogFocus(event);
    expect(event.defaultPrevented).toBe(true);
    dialog.remove();
  });

  it('handles dismissible dialog keydown for Escape and Tab', () => {
    const closeSpy = vi.fn();
    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    handleDismissibleDialogKeydown(escapeEvent, closeSpy);
    expect(closeSpy).toHaveBeenCalled();
    expect(escapeEvent.defaultPrevented).toBe(true);

    const otherEvent = new KeyboardEvent('keydown', { key: 'Enter' });
    handleDismissibleDialogKeydown(otherEvent, closeSpy);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
