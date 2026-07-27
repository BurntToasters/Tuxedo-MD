import { formatShortcut } from './shortcuts';

export type MenuCommandId =
  | 'new-document'
  | 'open-document'
  | 'save-document'
  | 'save-document-as'
  | 'quit'
  | 'find'
  | 'command-palette'
  | 'toggle-sidebar'
  | 'editor-view'
  | 'split-view'
  | 'preview-view'
  | 'settings';

export type MenuEntry =
  { type: 'item'; id: MenuCommandId; label: string; shortcut?: string } | { type: 'separator' };

export function buildFileMenu(): MenuEntry[] {
  return [
    {
      type: 'item',
      id: 'new-document',
      label: 'New Document',
      shortcut: formatShortcut({ mod: true, key: 'n' }),
    },
    {
      type: 'item',
      id: 'open-document',
      label: 'Open…',
      shortcut: formatShortcut({ mod: true, key: 'o' }),
    },
    {
      type: 'item',
      id: 'save-document',
      label: 'Save',
      shortcut: formatShortcut({ mod: true, key: 's' }),
    },
    {
      type: 'item',
      id: 'save-document-as',
      label: 'Save As…',
      shortcut: formatShortcut({ mod: true, shift: true, key: 's' }),
    },
    { type: 'separator' },
    { type: 'item', id: 'quit', label: 'Exit' },
  ];
}

export function buildEditMenu(): MenuEntry[] {
  return [
    { type: 'item', id: 'find', label: 'Find', shortcut: formatShortcut({ mod: true, key: 'f' }) },
    {
      type: 'item',
      id: 'command-palette',
      label: 'Command Palette',
      shortcut: formatShortcut({ mod: true, shift: true, key: 'p' }),
    },
  ];
}

export function buildViewMenu(): MenuEntry[] {
  return [
    {
      type: 'item',
      id: 'toggle-sidebar',
      label: 'Toggle Tools',
      shortcut: formatShortcut({ mod: true, shift: true, key: 'b' }),
    },
    {
      type: 'item',
      id: 'editor-view',
      label: 'Editor',
      shortcut: formatShortcut({ mod: true, shift: true, key: 'e' }),
    },
    {
      type: 'item',
      id: 'split-view',
      label: 'Split',
      shortcut: formatShortcut({ mod: true, shift: true, key: 'd' }),
    },
    {
      type: 'item',
      id: 'preview-view',
      label: 'Preview',
      shortcut: formatShortcut({ mod: true, shift: true, key: 'v' }),
    },
    {
      type: 'item',
      id: 'settings',
      label: 'Settings',
      shortcut: formatShortcut({ mod: true, key: ',' }),
    },
  ];
}
