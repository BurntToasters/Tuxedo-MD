/** Focus management utilities for accessible dialog focus trapping and restoration. */

export function focusedElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

export function isElementVisible(target: HTMLElement): boolean {
  if (!target.isConnected) return false;
  let node: HTMLElement | null = target;
  while (node) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    node = node.parentElement;
  }
  return true;
}

export function restoreFocus(target: HTMLElement | null): void {
  if (target && isElementVisible(target)) queueMicrotask(() => target.focus());
}

export function trapDialogFocus(event: KeyboardEvent): void {
  const current = event.currentTarget;
  if (
    event.key !== 'Tab' ||
    !(current instanceof HTMLElement) ||
    (current.tagName !== 'DIALOG' && current.getAttribute('role') !== 'dialog')
  ) {
    return;
  }
  const focusable = Array.from(
    current.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
    )
  ).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  if (!focusable.length) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function handleDismissibleDialogKeydown(event: KeyboardEvent, close: () => void): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  trapDialogFocus(event);
}
