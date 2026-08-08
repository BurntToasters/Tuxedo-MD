<script lang="ts">
  import {
    BookOpenText,
    FilePlus2,
    FolderOpen,
    History,
    ListTree,
    PanelLeftOpen,
    Save,
    Search,
    Settings2,
    X,
    Palette,
    Link2,
    Sparkles,
    RefreshCw,
    Sliders,
    Scroll,
    ChevronDown,
    ChevronUp,
  } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { formatShortcut, modKeyLabel } from './lib/shortcuts';
  import { normalizeSettings } from './lib/settings';
  import MarkdownEditor from './lib/editor/MarkdownEditor.svelte';
  import {
    capabilityMessage,
    editionVersion,
    editionWarning,
    hasCapability,
    isFullEdition,
    requireCapability,
  } from './lib/edition';
  import { renderMarkdown } from './lib/preview';
  import {
    chooseDocument,
    chooseSavePath,
    chooseWorkspace,
    isDesktop,
    readDocument,
    writeDocument,
    probeDocument,
    loadState,
    saveState,
    deleteState,
    takePendingOpenPaths,
    getLicenses,
    setDocumentEdited,
    scanWorkspace,
    searchWorkspace,
    collectWorkspaceReferences,
    createWorkspaceDocument,
    renameWorkspaceDocument,
    deleteWorkspaceDocument,
  } from './lib/tauri';
  import {
    buildLinkGraph,
    resolveReference,
    sortedTagCounts,
    type LinkGraph,
  } from './lib/link-graph';
  import WorkspaceTree from './lib/workspace/WorkspaceTree.svelte';
  import {
    buildWorkspaceTree,
    directoryIdsFor,
    ensureMarkdownName,
    filterWorkspaceTree,
    flattenWorkspaceTree,
    joinWorkspacePath,
    parentDirectoryOf,
    type FlatWorkspaceNode,
  } from './lib/workspace-tree';
  import { applyNativeWindowEffects, resizeWindowForDrawer } from './lib/window';
  import { detectPlatform, usesCustomTitleBar, type AppPlatform } from './lib/platform';
  import { formatWindowTitle } from './lib/window-title';
  import { requestAppClose, shouldPreventClose } from './lib/window-lifecycle';
  import type { MenuCommandId } from './lib/menu-commands';
  import WindowMenubar from './lib/chrome/WindowMenubar.svelte';
  import WindowControls from './lib/chrome/WindowControls.svelte';
  import CommandPalette from './lib/chrome/CommandPalette.svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import {
    autoCheckUpdates,
    checkUpdates,
    configureUpdater,
    discardPendingUpdate,
    resolveUpdatesSupported,
  } from './lib/updater';
  import {
    defaultSettings,
    type AppSettings,
    type DocumentTab,
    type EditorMode,
    type DocumentReferences,
    type FileDocument,
    type SearchMatch,
    type SessionState,
    type UpdateChannel,
    type WorkspaceEntry,
  } from './lib/types';

  const welcomeMarkdown = `# Welcome to Tuxedo MD

A sleek, focused Markdown workspace with native desktop packaging.

## The foundation

- **Source-first editing** with a live, sanitized preview
- A workspace sidebar for Markdown folders
- Native open and crash-resistant save commands
- Community and Pro build editions from one codebase

> Dress up plain text without getting in its way.

Try editing this document, or open a Markdown file from the toolbar.`;

  const initialTab = createTab('Welcome.md', welcomeMarkdown);
  type DrawerPanel = 'files' | 'search' | 'links' | 'outline' | 'recent';
  // Pro surfaces are driven by the native capability set, never by the build flag alone.
  const canSearchWorkspace = hasCapability('workspaceSearch');
  const canUseBacklinks = hasCapability('backlinks');
  const canUseTags = hasCapability('tags');
  const canInspectWorkspace = hasCapability('workspaceIntelligence');
  const showReferencePanel = canUseBacklinks || canUseTags || canInspectWorkspace;
  let tabs = $state<DocumentTab[]>([initialTab]);
  let activeId = $state(initialTab.id);
  let mode = $state<EditorMode>('source');
  let appPlatform = $state<AppPlatform>('web');
  let customTitleBar = $derived(usesCustomTitleBar(appPlatform));
  let isWindowsChrome = $derived(appPlatform === 'windows');
  let isMacChrome = $derived(appPlatform === 'macos');
  let findRequest = $state(0);
  let preview = $state('');
  let sidebarOpen = $state(false);
  let drawerOverlay = $state(false);
  let drawerPanel = $state<DrawerPanel>('files');
  let workspaceRoot = $state('');
  let workspaceFiles = $state<WorkspaceEntry[]>([]);
  // SvelteSet is reactive on its own, so this instance is mutated rather than replaced.
  const expandedDirectories = new SvelteSet<string>();
  let revealRequest = $state<{ line: number; token: number } | null>(null);
  let filter = $state('');
  let searchQuery = $state('');
  let searchCaseSensitive = $state(false);
  let searchResults = $state<SearchMatch[]>([]);
  let searchTruncated = $state(false);
  let searchRunning = $state(false);
  let searchSubmitted = $state(false);
  let linkGraph = $state<LinkGraph | null>(null);
  let referencesLoading = $state(false);
  let referencesAttempted = $state(false);
  let namePrompt = $state<{ title: string; label: string; value: string } | null>(null);
  let namePromptInput = $state<HTMLInputElement | null>(null);
  let settingsInitialFocus = $state<HTMLButtonElement | null>(null);
  let conflictInitialFocus = $state<HTMLButtonElement | null>(null);
  let settleNamePrompt: ((value: string | null) => void) | null = null;
  let status = $state('Ready');
  let settings = $state<AppSettings>(defaultSettings);
  let settingsOpen = $state(false);
  let activeSettingsTab = $state<'appearance' | 'editor' | 'files' | 'about'>('appearance');
  let updatesSupported = $state(false);
  let previousUpdateChannel = $state<UpdateChannel>(defaultSettings.updateChannel);

  // Licensing variables
  let licenses = $state<
    Record<
      string,
      {
        licenses: string | string[];
        repository?: string;
        publisher?: string;
        licenseFile?: string;
        licenseText?: string;
      }
    >
  >({});
  let licensesLoading = $state(false);
  let licensesError = $state<string | null>(null);
  let licenseSearch = $state('');
  let expandedLicensePackage = $state<string | null>(null);

  async function loadLicenses() {
    if (Object.keys(licenses).length > 0) return;
    licensesLoading = true;
    licensesError = null;
    try {
      const raw = await getLicenses();
      licenses = JSON.parse(raw);
    } catch (err) {
      licensesError = err instanceof Error ? err.message : String(err);
    } finally {
      licensesLoading = false;
    }
  }

  $effect(() => {
    if (activeSettingsTab === 'about' && settingsOpen) {
      void loadLicenses();
    }
  });

  // Focus and preselect the name field when the prompt opens, so the dialog is usable
  // from the keyboard without relying on the autofocus attribute.
  $effect(() => {
    if (!namePrompt || !namePromptInput) return;
    namePromptInput.focus();
    namePromptInput.select();
  });

  $effect(() => {
    if (settingsOpen) settingsInitialFocus?.focus();
  });

  $effect(() => {
    if (conflictOpen) conflictInitialFocus?.focus();
  });

  // Build the link graph lazily, the first time the Links panel is opened for a
  // workspace. Guarded by an attempt flag so a failing scan is not retried forever.
  $effect(() => {
    if (drawerPanel === 'links' && workspaceRoot && !referencesAttempted) {
      referencesAttempted = true;
      void refreshReferences();
    }
  });

  let paletteOpen = $state(false);
  let conflictOpen = $state(false);
  let conflictTabId = $state<string | null>(null);
  let conflictQueue = $state<string[]>([]);
  let recentFiles = $state<string[]>([]);
  let recentWorkspaces = $state<string[]>([]);
  let persistenceReady = $state(false);
  let sessionPersistEnabled = false;
  let persistGeneration = 0;
  let persistChain: Promise<void> = Promise.resolve();
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  let previewRenderRequest = 0;
  let externalCheckInFlight = false;
  const saveInFlightIds = new Set<string>();
  const cancelledSaveTabIds = new Set<string>();
  let draftIndexChain: Promise<void> = Promise.resolve();
  let sessionRestoreComplete = false;
  const deferredOpenPaths: string[] = [];
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let searchRequestId = 0;

  let activeTab = $derived(tabs.find((tab) => tab.id === activeId) ?? tabs[0]);
  let hasUnsavedChanges = $derived(tabs.some((tab) => tab.content !== tab.savedContent));
  let workspaceTree = $derived(buildWorkspaceTree(workspaceFiles));
  let visibleTree = $derived(filterWorkspaceTree(workspaceTree, filter));
  // While filtering, every retained directory is expanded so matches stay reachable.
  let effectiveExpanded = $derived(
    filter.trim() ? new Set<string>(directoryIdsFor(visibleTree)) : expandedDirectories
  );
  let treeRows = $derived(flattenWorkspaceTree(visibleTree, effectiveExpanded));
  let activeRelativePath = $derived(
    workspaceFiles.find((file) => file.path === activeTab?.path)?.relativePath ?? null
  );
  let activeBacklinks = $derived(
    activeRelativePath ? (linkGraph?.backlinks[activeRelativePath] ?? []) : []
  );
  let tagCounts = $derived(linkGraph ? sortedTagCounts(linkGraph) : []);
  // Group flat native matches so the panel reads as files containing hits.
  let groupedSearchResults = $derived(
    Object.values(
      searchResults.reduce<Record<string, { relativePath: string; matches: SearchMatch[] }>>(
        (groups, match) => {
          groups[match.path] ??= { relativePath: match.relativePath, matches: [] };
          groups[match.path].matches.push(match);
          return groups;
        },
        {}
      )
    )
  );
  let outline = $derived(
    (activeTab?.content ?? '')
      .split('\n')
      .map((line, index) => {
        const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
        return match ? { level: match[1].length, title: match[2], line: index + 1 } : null;
      })
      .filter((item): item is { level: number; title: string; line: number } => item !== null)
  );

  let filteredLicensesList = $derived(
    Object.entries(licenses)
      .filter(([name]) => name.toLowerCase().includes(licenseSearch.toLowerCase()))
      .sort((a, b) => a[0].localeCompare(b[0]))
  );

  $effect(() => {
    const content = activeTab?.content ?? '';
    const request = ++previewRenderRequest;
    renderMarkdown(content).then((html) => {
      if (request === previewRenderRequest) preview = html;
    });
  });

  let windowEffectRequest = 0;
  let windowEffectsUpdate: Promise<void> = Promise.resolve();

  $effect(() => {
    const root = document.documentElement;
    const { fontSize, glassEffects, theme } = settings;
    const systemLight = window.matchMedia('(prefers-color-scheme: light)');
    const reducedTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)');
    const forcedColors = window.matchMedia('(forced-colors: active)');

    root.dataset.themePreference = theme;
    root.dataset.glass = glassEffects;
    root.dataset.windowFx ||= 'opaque';
    root.style.setProperty('--editor-font-size', `${fontSize}px`);

    const synchronizeAppearance = () => {
      const resolvedTheme = theme === 'system' ? (systemLight.matches ? 'light' : 'dark') : theme;
      const request = ++windowEffectRequest;
      const accessibilityFallback =
        resolvedTheme === 'contrast' || reducedTransparency.matches || forcedColors.matches;
      const effectiveGlassEffects = accessibilityFallback ? 'off' : glassEffects;

      root.dataset.theme = resolvedTheme;
      if (effectiveGlassEffects === 'off') root.dataset.windowFx = 'opaque';

      // Serialize native mutations so a slow, stale request cannot re-enable an old effect.
      windowEffectsUpdate = windowEffectsUpdate.then(async () => {
        if (request !== windowEffectRequest) return;
        const state = await applyNativeWindowEffects(
          effectiveGlassEffects,
          resolvedTheme !== 'light'
        );
        if (request === windowEffectRequest) root.dataset.windowFx = state;
      });
    };

    const markWindowActive = () => {
      root.dataset.windowActive = 'true';
    };
    const markWindowInactive = () => {
      root.dataset.windowActive = 'false';
    };

    root.dataset.windowActive = document.hasFocus() ? 'true' : 'false';
    synchronizeAppearance();
    systemLight.addEventListener('change', synchronizeAppearance);
    reducedTransparency.addEventListener('change', synchronizeAppearance);
    forcedColors.addEventListener('change', synchronizeAppearance);
    window.addEventListener('focus', markWindowActive);
    window.addEventListener('blur', markWindowInactive);

    return () => {
      windowEffectRequest += 1;
      systemLight.removeEventListener('change', synchronizeAppearance);
      reducedTransparency.removeEventListener('change', synchronizeAppearance);
      forcedColors.removeEventListener('change', synchronizeAppearance);
      window.removeEventListener('focus', markWindowActive);
      window.removeEventListener('blur', markWindowInactive);
    };
  });

  let previousRestoreSession = settings.restoreSession;
  let restoreSessionWatchReady = false;
  $effect(() => {
    const settingsSnapshot = settings;
    if (!persistenceReady || !isDesktop()) return;
    // Ignore the post-restore settings load; only honor later user toggles.
    if (!restoreSessionWatchReady) {
      previousRestoreSession = settingsSnapshot.restoreSession;
      restoreSessionWatchReady = true;
    } else if (settingsSnapshot.restoreSession !== previousRestoreSession) {
      previousRestoreSession = settingsSnapshot.restoreSession;
      sessionPersistEnabled = settingsSnapshot.restoreSession;
      if (!settingsSnapshot.restoreSession) {
        // Cancel in-flight session writes that still hold a stale enabled snapshot.
        persistGeneration += 1;
        if (recoveryTimer) {
          clearTimeout(recoveryTimer);
          recoveryTimer = undefined;
        }
      }
    }
    void saveState('settings', settingsSnapshot).catch((error) => {
      console.error('Failed to persist settings', error);
    });
  });

  $effect(() => {
    JSON.stringify({ mode, activeId, tabIds: tabs.map((tab) => tab.id), workspaceRoot });
    if (persistenceReady && isDesktop() && sessionPersistEnabled) {
      scheduleSessionPersistence();
    }
  });

  $effect(() => {
    configureUpdater({
      settings: {
        autoCheckUpdates: settings.autoCheckUpdates,
        updateChannel: settings.updateChannel,
      },
      setStatus: (next) => {
        status = next;
      },
    });
    if (previousUpdateChannel !== settings.updateChannel) {
      discardPendingUpdate();
      previousUpdateChannel = settings.updateChannel;
    }
  });

  $effect(() => {
    const tab = activeTab;
    const dirty = tab ? tab.content !== tab.savedContent : false;
    const title = formatWindowTitle(tab?.name ?? 'Untitled', dirty);
    document.title = title;
    if (!isDesktop()) return;
    void getCurrentWindow().setTitle(title);
    if (appPlatform === 'macos') {
      void setDocumentEdited(hasUnsavedChanges).catch((error) => {
        console.error('setDocumentEdited failed', error);
      });
    }
  });

  type CommandPaletteItem = {
    id: string;
    label: string;
    description: string;
    section: string;
    keywords?: string;
    shortcut?: string;
    run: () => void;
  };

  let settingsReturnFocus: HTMLElement | null = null;
  let namePromptReturnFocus: HTMLElement | null = null;
  let conflictReturnFocus: HTMLElement | null = null;

  function focusedElement(): HTMLElement | null {
    return document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  function isElementVisible(target: HTMLElement) {
    if (!target.isConnected) return false;
    let node: HTMLElement | null = target;
    while (node) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      node = node.parentElement;
    }
    return true;
  }

  function restoreFocus(target: HTMLElement | null) {
    if (target && isElementVisible(target)) queueMicrotask(() => target.focus());
  }

  function openCommandPalette() {
    if (settingsOpen || namePrompt || conflictOpen) return;
    paletteOpen = true;
  }

  function openSettings() {
    if (namePrompt || conflictOpen) return;
    if (!settingsOpen) settingsReturnFocus = focusedElement();
    settingsOpen = true;
  }

  function closeSettings() {
    settingsOpen = false;
    const target = settingsReturnFocus;
    settingsReturnFocus = null;
    restoreFocus(target);
  }

  function openConflict(tabId: string) {
    if (conflictOpen) {
      if (conflictTabId !== tabId && !conflictQueue.includes(tabId)) {
        conflictQueue = [...conflictQueue, tabId];
      }
      return;
    }
    conflictReturnFocus = focusedElement();
    conflictTabId = tabId;
    conflictOpen = true;
  }

  function requestFind() {
    if (mode === 'preview') mode = 'split';
    findRequest += 1;
  }

  async function setDraftIndexed(id: string, keep: boolean) {
    draftIndexChain = draftIndexChain.then(async () => {
      const index = (await loadState<string[]>('draft-index')) ?? [];
      const has = index.includes(id);
      if (keep && !has) await saveState('draft-index', [...index, id]);
      if (!keep && has) await saveState('draft-index', index.filter((item) => item !== id));
    });
    await draftIndexChain;
  }

  function pathsReferToSameFile(left: string | null | undefined, right: string | null | undefined) {
    if (!left || !right) return false;
    const normalize = (value: string) => value.replace(/\\/g, '/');
    const a = normalize(left);
    const b = normalize(right);
    if (a === b) return true;
    return a.toLowerCase() === b.toLowerCase();
  }

  async function recoverOrphanDrafts(existing: DocumentTab[]): Promise<DocumentTab[]> {
    const index = (await loadState<string[]>('draft-index')) ?? [];
    const recovered: DocumentTab[] = [];
    for (const id of index) {
      if (existing.some((tab) => tab.id === id)) continue;
      const draft = await loadState<DocumentTab>(`draft-${id}`);
      if (!draft || typeof draft.content !== 'string') continue;
      recovered.push({
        id: draft.id || id,
        name: draft.name || 'Untitled.md',
        path: draft.path ?? null,
        content: draft.content,
        savedContent: draft.savedContent ?? draft.content,
        fingerprint: draft.fingerprint ?? null,
        conflict: false,
        recovered: true,
        selection: draft.selection ?? { anchor: 0, head: 0 },
      });
    }
    return recovered;
  }

  function showNextConflict() {
    const nextId = conflictQueue.find((id) => tabs.some((tab) => tab.id === id && tab.conflict));
    conflictQueue = nextId ? conflictQueue.filter((id) => id !== nextId) : [];
    if (nextId) openConflict(nextId);
  }

  function dismissConflictForTab(id: string) {
    conflictQueue = conflictQueue.filter((item) => item !== id);
    if (conflictTabId !== id) return;
    conflictOpen = false;
    conflictTabId = null;
    const target = conflictReturnFocus;
    conflictReturnFocus = null;
    restoreFocus(target);
    showNextConflict();
  }

  function trapDialogFocus(event: KeyboardEvent) {
    if (event.key !== 'Tab' || !(event.currentTarget instanceof HTMLDialogElement)) return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
      )
    );
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

  function handleDismissibleDialogKeydown(event: KeyboardEvent, close: () => void) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    trapDialogFocus(event);
  }

  function commandPaletteItems(): CommandPaletteItem[] {
    const items: CommandPaletteItem[] = [
      {
        id: 'new-document',
        label: 'New document',
        description: 'Create a new untitled Markdown tab',
        section: 'File',
        keywords: 'create note tab',
        shortcut: formatShortcut({ mod: true, key: 'n' }),
        run: newDocument,
      },
      {
        id: 'open-file',
        label: 'Open file…',
        description: 'Choose a Markdown document from disk',
        section: 'File',
        keywords: 'load document markdown',
        shortcut: formatShortcut({ mod: true, key: 'o' }),
        run: () => void openFile(),
      },
      {
        id: 'open-workspace',
        label: 'Open workspace…',
        description: 'Choose a folder of Markdown documents',
        section: 'File',
        keywords: 'folder project vault',
        run: () => void openWorkspace(),
      },
      {
        id: 'save-document',
        label: 'Save document',
        description: 'Write the active document to disk',
        section: 'File',
        keywords: 'write',
        shortcut: formatShortcut({ mod: true, key: 's' }),
        run: () => void saveActive(false),
      },
      {
        id: 'save-document-as',
        label: 'Save document as…',
        description: 'Save the active document to a new path',
        section: 'File',
        keywords: 'write copy rename',
        shortcut: formatShortcut({ mod: true, shift: true, key: 's' }),
        run: () => void saveActive(true),
      },
      {
        id: 'find-document',
        label: 'Find in document',
        description: 'Search inside the active editor',
        section: 'Navigate',
        keywords: 'search text current',
        shortcut: formatShortcut({ mod: true, key: 'f' }),
        run: requestFind,
      },
      {
        id: 'toggle-tools',
        label: sidebarOpen ? 'Hide tools' : 'Show tools',
        description: 'Toggle the workspace tools sidebar',
        section: 'Navigate',
        keywords: 'sidebar drawer files outline',
        shortcut: formatShortcut({ mod: true, shift: true, key: 'b' }),
        run: () => void setSidebarOpen(!sidebarOpen),
      },
      {
        id: 'editor-view',
        label: 'Show editor',
        description: 'Use the source-only document view',
        section: 'View',
        keywords: 'source markdown mode',
        shortcut: formatShortcut({ mod: true, shift: true, key: 'e' }),
        run: () => (mode = 'source'),
      },
      {
        id: 'split-view',
        label: 'Show split view',
        description: 'Edit source alongside the rendered preview',
        section: 'View',
        keywords: 'source preview panes mode',
        shortcut: formatShortcut({ mod: true, shift: true, key: 'd' }),
        run: () => (mode = 'split'),
      },
      {
        id: 'preview-view',
        label: 'Show preview',
        description: 'Use the rendered document-only view',
        section: 'View',
        keywords: 'render markdown mode',
        shortcut: formatShortcut({ mod: true, shift: true, key: 'v' }),
        run: () => (mode = 'preview'),
      },
      {
        id: 'focus-mode',
        label: settings.focusMode ? 'Exit focus mode' : 'Enter focus mode',
        description: settings.focusMode
          ? 'Restore the full application chrome'
          : 'Hide nonessential chrome while writing',
        section: 'View',
        keywords: 'zen distraction free chrome',
        run: () => {
          settings.focusMode = !settings.focusMode;
          if (settings.focusMode) void setSidebarOpen(false);
        },
      },
      {
        id: 'open-settings',
        label: 'Open settings',
        description: 'Configure appearance, editor, and file behavior',
        section: 'Application',
        keywords: 'preferences options appearance theme',
        run: openSettings,
      },
    ];

    if (canSearchWorkspace) {
      items.splice(7, 0, {
        id: 'search-workspace',
        label: 'Search workspace',
        description: 'Search text across every Markdown document',
        section: 'Navigate',
        keywords: 'project folder files pro',
        run: () => {
          drawerPanel = 'search';
          void setSidebarOpen(true);
        },
      });
    }

    return items;
  }

  function runMenuCommand(id: MenuCommandId | string) {
    // Modals own the interaction; keep Quit available for emergency exit.
    if ((conflictOpen || namePrompt) && id !== 'quit') return;
    switch (id) {
      case 'new-document':
        newDocument();
        break;
      case 'open-document':
        void openFile();
        break;
      case 'save-document':
        void saveActive(false);
        break;
      case 'save-document-as':
        void saveActive(true);
        break;
      case 'close-tab':
        closeTab(activeId);
        break;
      case 'quit':
        if (isDesktop()) void requestAppClose(hasUnsavedChanges);
        break;
      case 'find':
        requestFind();
        break;
      case 'command-palette':
        openCommandPalette();
        break;
      case 'next-tab':
        cycleTab(1);
        break;
      case 'previous-tab':
        cycleTab(-1);
        break;
      case 'settings':
        openSettings();
        break;
      case 'editor-view':
        mode = 'source';
        break;
      case 'split-view':
        mode = 'split';
        break;
      case 'preview-view':
        mode = 'preview';
        break;
      case 'toggle-focus-mode':
        settings = { ...settings, focusMode: !settings.focusMode };
        if (settings.focusMode) void setSidebarOpen(false);
        schedulePersistence();
        break;
      case 'toggle-sidebar':
        void setSidebarOpen(!sidebarOpen);
        break;
      case 'check-updates':
        void checkUpdates();
        break;
      default:
        break;
    }
  }

  function isMarkdownPath(filePath: string): boolean {
    return /\.(md|markdown|mdown|mkd)$/i.test(filePath);
  }

  async function openPathsWhenReady(paths: string[]) {
    const markdownPaths = paths.filter(isMarkdownPath);
    if (!markdownPaths.length) return;
    if (!sessionRestoreComplete) {
      deferredOpenPaths.push(...markdownPaths);
      return;
    }
    for (const filePath of markdownPaths) void openWorkspaceFile(filePath);
  }

  function flushDeferredOpenPaths() {
    sessionRestoreComplete = true;
    const queued = deferredOpenPaths.splice(0);
    for (const filePath of queued) void openWorkspaceFile(filePath);
  }

  onMount(() => {
    appPlatform = detectPlatform();
    document.documentElement.dataset.platform = appPlatform;
    const restorePromise = restoreState().finally(() => {
      flushDeferredOpenPaths();
    });
    pollTimer = setInterval(() => void checkExternalChanges(), 2000);
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (paletteOpen) {
          paletteOpen = false;
        } else if (namePrompt) {
          resolveNamePrompt(null);
        } else if (settingsOpen) {
          closeSettings();
        } else if (sidebarOpen && drawerOverlay) {
          void setSidebarOpen(false);
        }
        return;
      }
      if (paletteOpen || settingsOpen || namePrompt || conflictOpen) return;
      // macOS/Linux native menus own accelerators; handling them here double-fires.
      if (isDesktop() && (appPlatform === 'macos' || appPlatform === 'linux')) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 'f' && !event.shiftKey) {
        event.preventDefault();
        requestFind();
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        cycleTab(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key.toLowerCase() === 'w') {
        event.preventDefault();
        closeTab(activeId);
        return;
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveActive(event.shiftKey);
      } else if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void openFile();
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        newDocument();
      } else if (event.key.toLowerCase() === 'e' && event.shiftKey) {
        event.preventDefault();
        mode = 'source';
      } else if (event.key.toLowerCase() === 'v' && event.shiftKey) {
        event.preventDefault();
        mode = 'preview';
      } else if (event.key.toLowerCase() === 'd' && event.shiftKey) {
        event.preventDefault();
        mode = 'split';
      } else if (event.key.toLowerCase() === 'b' && event.shiftKey) {
        event.preventDefault();
        void setSidebarOpen(!sidebarOpen);
      } else if (event.key.toLowerCase() === 'p' && event.shiftKey) {
        event.preventDefault();
        openCommandPalette();
      } else if (event.key === ',') {
        event.preventDefault();
        openSettings();
      }
    };
    window.addEventListener('keydown', onKeydown);
    const teardowns: (() => void)[] = [];
    if (isDesktop()) {
      void getCurrentWindow()
        .onCloseRequested((event) => {
          if (shouldPreventClose(hasUnsavedChanges)) {
            event.preventDefault();
          }
        })
        .then((unlistenClose) => teardowns.push(unlistenClose));
      void import('@tauri-apps/api/event').then(async ({ listen }) => {
        const menuUnlisten = await listen<string>('native-menu-command', ({ payload }) => {
          runMenuCommand(payload);
        });
        const openUnlisten = await listen<string[]>('open-paths', ({ payload }) => {
          void openPathsWhenReady(payload);
        });
        teardowns.push(menuUnlisten, openUnlisten);
        await restorePromise;
        await openPathsWhenReady(await takePendingOpenPaths());
      });
      void import('@tauri-apps/api/webviewWindow').then(async ({ getCurrentWebviewWindow }) => {
        const unlistenDrop = await getCurrentWebviewWindow().onDragDropEvent((event) => {
          if (event.payload.type !== 'drop') return;
          void openPathsWhenReady(event.payload.paths);
        });
        teardowns.push(unlistenDrop);
      });
    }
    return () => {
      window.removeEventListener('keydown', onKeydown);
      if (pollTimer) clearInterval(pollTimer);
      for (const teardown of teardowns) teardown();
    };
  });

  function createTab(name = 'Untitled.md', content = '', path: string | null = null): DocumentTab {
    return {
      id: crypto.randomUUID(),
      name,
      path,
      content,
      savedContent: content,
      fingerprint: null,
      conflict: false,
      recovered: false,
      selection: { anchor: 0, head: 0 },
    };
  }

  function enableSessionPersist() {
    // Do not resurrect session writes when restore is off (preserves on-disk session).
    if (settings.restoreSession) sessionPersistEnabled = true;
  }

  function updateContent(content: string) {
    enableSessionPersist();
    tabs = tabs.map((tab) => (tab.id === activeId ? { ...tab, content } : tab));
    schedulePersistence();
  }

  function updateSelection(selection: { anchor: number; head: number }) {
    tabs = tabs.map((tab) => (tab.id === activeId ? { ...tab, selection } : tab));
  }

  function newDocument() {
    enableSessionPersist();
    const tab = createTab();
    tabs = [...tabs, tab];
    activeId = tab.id;
    status = 'New document';
  }

  function addDocument(document: FileDocument) {
    enableSessionPersist();
    const existing = tabs.find((tab) => pathsReferToSameFile(tab.path, document.path));
    if (existing) {
      if (existing.content === existing.savedContent) {
        tabs = tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                name: document.name,
                content: document.content,
                savedContent: document.content,
                fingerprint: document.fingerprint,
                conflict: false,
              }
            : tab
        );
        status = `Reloaded ${document.name}`;
      } else if (existing.fingerprint?.hash !== document.fingerprint.hash) {
        tabs = tabs.map((tab) =>
          tab.id === existing.id ? { ...tab, conflict: true } : tab
        );
        openConflict(existing.id);
        status = `${document.name} changed on disk`;
      }
      activeId = existing.id;
      schedulePersistence();
      return;
    }
    const tab = {
      ...createTab(document.name, document.content, document.path),
      fingerprint: document.fingerprint,
    };
    tabs = [...tabs, tab];
    activeId = tab.id;
    status = `Opened ${document.name}`;
    recentFiles = remember(recentFiles, document.path);
    schedulePersistence();
  }

  async function openFile() {
    if (!isDesktop()) {
      status = 'Native file dialogs are available in the desktop app';
      return;
    }
    try {
      const document = await chooseDocument();
      if (document) addDocument(document);
    } catch (error) {
      status = readableError(error);
    }
  }

  async function openWorkspace() {
    if (!isDesktop()) {
      status = 'Workspace folders are available in the desktop app';
      return;
    }
    try {
      const workspace = await chooseWorkspace();
      if (!workspace) return;
      await adoptWorkspace(workspace.root, workspace.entries);
    } catch (error) {
      status = readableError(error);
    }
  }

  async function adoptWorkspace(root: string, entries: WorkspaceEntry[]) {
    enableSessionPersist();
    workspaceRoot = root;
    workspaceFiles = entries;
    expandedDirectories.clear();
    linkGraph = null;
    referencesAttempted = false;
    searchResults = [];
    searchSubmitted = false;
    if (!sidebarOpen) await setSidebarOpen(true);
    drawerPanel = 'files';
    status = `${entries.length} Markdown ${entries.length === 1 ? 'file' : 'files'} found`;
    recentWorkspaces = remember(recentWorkspaces, root);
    schedulePersistence();
  }

  async function openRecentWorkspace(root: string) {
    if (!isDesktop()) {
      status = 'Workspace folders are available in the desktop app';
      return;
    }
    try {
      await adoptWorkspace(root, await scanWorkspace(root));
    } catch (error) {
      status = readableError(error);
    }
  }

  async function refreshWorkspace() {
    if (!workspaceRoot || !isDesktop()) return;
    try {
      workspaceFiles = await scanWorkspace(workspaceRoot);
      // Both derived views describe the old file set once it changes.
      searchResults = [];
      searchSubmitted = false;
      if (linkGraph) await refreshReferences();
    } catch (error) {
      status = readableError(error);
    }
  }

  function toggleDirectory(node: FlatWorkspaceNode) {
    if (expandedDirectories.has(node.id)) expandedDirectories.delete(node.id);
    else expandedDirectories.add(node.id);
  }

  /**
   * In-app replacement for window.prompt, which WebView2 does not implement and wry
   * does not reliably provide, so native prompts would silently return null.
   */
  function askForName(title: string, label: string, value: string): Promise<string | null> {
    settleNamePrompt?.(null);
    namePromptReturnFocus = focusedElement();
    namePrompt = { title, label, value };
    return new Promise((resolve) => {
      settleNamePrompt = resolve;
    });
  }

  function resolveNamePrompt(value: string | null) {
    const settle = settleNamePrompt;
    const target = namePromptReturnFocus;
    settleNamePrompt = null;
    namePromptReturnFocus = null;
    namePrompt = null;
    settle?.(value);
    restoreFocus(target);
  }

  async function createDocumentInWorkspace(directory: string) {
    if (!workspaceRoot) {
      status = 'Open a workspace folder before creating documents';
      return;
    }
    const requested = await askForName(
      'New Markdown document',
      directory ? `Name inside ${directory}` : 'Name in workspace root',
      'Untitled.md'
    );
    if (requested === null) return;
    const fileName = ensureMarkdownName(requested);
    if (!fileName) {
      status = 'A document name is required';
      return;
    }
    try {
      const entry = await createWorkspaceDocument(
        workspaceRoot,
        joinWorkspacePath(directory, fileName)
      );
      await refreshWorkspace();
      if (directory) expandedDirectories.add(directory);
      await openWorkspaceFile(entry.path);
      status = `Created ${entry.relativePath}`;
    } catch (error) {
      status = readableError(error);
    }
  }

  async function renameWorkspaceEntry(node: FlatWorkspaceNode) {
    if (!workspaceRoot || !node.path) return;
    const requested = await askForName('Rename document', `New name for ${node.name}`, node.name);
    if (requested === null) return;
    const fileName = ensureMarkdownName(requested);
    if (!fileName || fileName === node.name) return;
    try {
      const entry = await renameWorkspaceDocument(workspaceRoot, node.path, fileName);
      const previousPath = node.path;
      // Keep any open tab pointing at the renamed file on disk.
      tabs = tabs.map((tab) =>
        pathsReferToSameFile(tab.path, previousPath)
          ? { ...tab, path: entry.path, name: entry.name, fingerprint: null }
          : tab
      );
      recentFiles = recentFiles.map((path) =>
        pathsReferToSameFile(path, previousPath) ? entry.path : path
      );
      await refreshWorkspace();
      status = `Renamed to ${entry.relativePath}`;
      schedulePersistence();
    } catch (error) {
      status = readableError(error);
    }
  }

  async function deleteWorkspaceEntry(node: FlatWorkspaceNode) {
    if (!workspaceRoot || !node.path) return;
    const openTab = tabs.find((tab) => pathsReferToSameFile(tab.path, node.path));
    const warning = openTab
      ? `\n\n${node.name} is open in Tuxedo MD. Its tab will keep your text as an unsaved draft.`
      : '';
    if (!confirm(`Delete ${node.name}? This cannot be undone.${warning}`)) return;
    try {
      await deleteWorkspaceDocument(workspaceRoot, node.path);
      // Detach the open tab so its content survives; preserve real dirty state.
      tabs = tabs.map((tab) =>
        pathsReferToSameFile(tab.path, node.path)
          ? { ...tab, path: null, fingerprint: null, conflict: false }
          : tab
      );
      recentFiles = recentFiles.filter((path) => !pathsReferToSameFile(path, node.path));
      await refreshWorkspace();
      status = `Deleted ${node.name}`;
      schedulePersistence();
    } catch (error) {
      status = readableError(error);
    }
  }

  function handleTreeAction(action: 'rename' | 'delete' | 'new', node: FlatWorkspaceNode) {
    if (action === 'rename') {
      void renameWorkspaceEntry(node);
    } else if (action === 'delete') {
      void deleteWorkspaceEntry(node);
    } else {
      const directory = node.kind === 'directory' ? node.id : parentDirectoryOf(node.id);
      void createDocumentInWorkspace(directory);
    }
  }

  async function runWorkspaceSearch() {
    if (!workspaceRoot) {
      status = 'Open a workspace folder to search it';
      return;
    }
    if (!searchQuery.trim()) {
      searchResults = [];
      searchSubmitted = false;
      return;
    }
    const requestId = ++searchRequestId;
    searchRunning = true;
    searchSubmitted = true;
    try {
      // Verified natively as well, so a tampered frontend cannot reach the index.
      await requireCapability('workspaceSearch');
      const outcome = await searchWorkspace(workspaceRoot, searchQuery, searchCaseSensitive);
      if (requestId !== searchRequestId) return;
      searchResults = outcome.matches;
      searchTruncated = outcome.truncated;
      status = `${outcome.matches.length}${outcome.truncated ? '+' : ''} ${
        outcome.matches.length === 1 ? 'match' : 'matches'
      } across ${outcome.scannedFiles} files`;
    } catch (error) {
      if (requestId !== searchRequestId) return;
      searchResults = [];
      searchTruncated = false;
      status = readableError(error);
    } finally {
      if (requestId === searchRequestId) searchRunning = false;
    }
  }

  async function refreshReferences() {
    if (!workspaceRoot || !isDesktop() || !showReferencePanel) return;
    referencesLoading = true;
    try {
      linkGraph = buildLinkGraph(await collectWorkspaceReferences(workspaceRoot));
    } catch (error) {
      linkGraph = null;
      status = readableError(error);
    } finally {
      referencesLoading = false;
    }
  }

  async function openWorkspaceRelative(relativePath: string, line?: number) {
    const entry = workspaceFiles.find((file) => file.relativePath === relativePath);
    if (!entry) {
      status = `${relativePath} is no longer in this workspace`;
      return;
    }
    if (line === undefined) await openWorkspaceFile(entry.path);
    else await openAndReveal(entry.path, line);
  }

  async function openAndReveal(path: string, line: number) {
    await openWorkspaceFile(path);
    if (mode === 'preview') mode = 'split';
    revealRequest = { line, token: (revealRequest?.token ?? 0) + 1 };
  }

  function searchForTag(tag: string) {
    searchQuery = `#${tag}`;
    drawerPanel = 'search';
    void setSidebarOpen(true);
    void runWorkspaceSearch();
  }

  function revealOutlineItem(item: { title: string; line: number }) {
    if (mode === 'preview') mode = 'split';
    revealRequest = { line: item.line, token: (revealRequest?.token ?? 0) + 1 };
    status = `Jumped to ${item.title}`;
  }

  async function openWorkspaceFile(path: string) {
    try {
      addDocument(await readDocument(path));
    } catch (error) {
      status = readableError(error);
    }
  }

  async function setSidebarOpen(open: boolean) {
    if (!open) {
      sidebarOpen = false;
      drawerOverlay = false;
      await resizeWindowForDrawer(false);
      return;
    }
    const resized = sidebarOpen ? !drawerOverlay : await resizeWindowForDrawer(true);
    drawerOverlay = !resized;
    sidebarOpen = true;
  }

  async function saveTab(tabId: string, saveAs = false) {
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    if (!isDesktop()) {
      status = 'Native saving is available in the desktop app';
      return;
    }
    if (saveInFlightIds.has(tabId)) return;
    if (cancelledSaveTabIds.has(tabId)) {
      // Sticky cancel from a prior discard — only a later non-cancelled start clears it.
      cancelledSaveTabIds.delete(tabId);
    }
    saveInFlightIds.add(tabId);
    const contentToWrite = tab.content;
    const priorFingerprint = tab.fingerprint;
    const revertContent = tab.savedContent;
    try {
      const path = saveAs || !tab.path ? await chooseSavePath(tab.path) : tab.path;
      if (!path) return;
      if (cancelledSaveTabIds.has(tabId)) {
        cancelledSaveTabIds.delete(tabId);
        return;
      }
      const owner = tabs.find(
        (candidate) => candidate.id !== tabId && pathsReferToSameFile(candidate.path, path)
      );
      if (owner) {
        status = `Already open in another tab: ${owner.name}`;
        activeId = owner.id;
        return;
      }
      const fingerprint = await writeDocument(path, contentToWrite, priorFingerprint, false);
      if (cancelledSaveTabIds.has(tabId)) {
        cancelledSaveTabIds.delete(tabId);
        // Discard won the race: put the pre-edit bytes back on disk.
        if (revertContent !== contentToWrite) {
          try {
            await writeDocument(path, revertContent, fingerprint, true);
          } catch (error) {
            console.error('Failed to revert discarded save', error);
          }
        }
        return;
      }
      const name = path.split(/[\\/]/).at(-1) ?? tab.name;
      tabs = tabs.map((item) =>
        item.id === tabId
          ? {
              ...item,
              path,
              name,
              // Mark only the written bytes as saved so mid-save edits stay dirty.
              savedContent: contentToWrite,
              fingerprint,
              conflict: false,
            }
          : item
      );
      status = `Saved ${name}`;
      recentFiles = remember(recentFiles, path);
      schedulePersistence();
    } catch (error) {
      if (cancelledSaveTabIds.has(tabId)) {
        cancelledSaveTabIds.delete(tabId);
        return;
      }
      if (readableError(error).includes('changed on disk')) {
        tabs = tabs.map((item) => (item.id === tabId ? { ...item, conflict: true } : item));
        openConflict(tabId);
        status = 'Save paused: file changed outside Tuxedo MD';
      } else status = readableError(error);
    } finally {
      saveInFlightIds.delete(tabId);
    }
  }

  async function saveActive(saveAs = false) {
    if (!activeId) return;
    await saveTab(activeId, saveAs);
  }

  async function openExternalUrl(href: string) {
    if (!/^(https?:|mailto:)/i.test(href)) {
      throw new Error('Only http(s) and mailto links can be opened externally');
    }
    if (isDesktop()) {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(href);
      return;
    }
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  async function handlePreviewClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      if (/^(https?:|mailto:)/i.test(href)) {
        await openExternalUrl(href);
        return;
      }
      if (workspaceRoot && isDesktop()) {
        const from = activeRelativePath || activeTab?.name || 'index.md';
        const refs: DocumentReferences[] = workspaceFiles.map((entry) => ({
          path: entry.path,
          relativePath: entry.relativePath,
          name: entry.name,
          links: [],
          tags: [],
        }));
        const resolved =
          resolveReference(from, href, refs) ??
          resolveReference(from, href.replace(/^\.?\//, ''), refs);
        if (!resolved) {
          status = `Could not resolve link: ${href}`;
          return;
        }
        await openWorkspaceRelative(resolved);
      }
    } catch (error) {
      status = readableError(error);
    }
  }

  function cycleTab(direction: 1 | -1) {
    if (tabs.length < 2) return;
    const index = tabs.findIndex((tab) => tab.id === activeId);
    const next = (index + direction + tabs.length) % tabs.length;
    activeId = tabs[next].id;
  }

  function closeTab(id: string) {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    enableSessionPersist();
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = undefined;
    }

    const dirty = tab.content !== tab.savedContent;
    let keepDraft = dirty && settings.keepDraftsSilently;
    if (dirty && !settings.keepDraftsSilently) {
      keepDraft = !confirm(
        `Discard the unsaved draft for ${tab.name}?\nChoose Cancel to keep it available when Tuxedo MD reopens.`
      );
    }
    if (!keepDraft) cancelledSaveTabIds.add(id);
    if (isDesktop()) {
      void (async () => {
        try {
          if (keepDraft) {
            await saveState(`draft-${id}`, tab);
            await setDraftIndexed(id, true);
          } else {
            await deleteState(`draft-${id}`);
            await setDraftIndexed(id, false);
          }
        } catch (error) {
          console.error('Failed to update recovery draft', error);
        }
      })();
    }

    dismissConflictForTab(id);

    if (tabs.length === 1) {
      const replacement = createTab();
      tabs = [replacement];
      activeId = replacement.id;
      scheduleSessionPersistence();
      return;
    }
    const index = tabs.findIndex((candidate) => candidate.id === id);
    tabs = tabs.filter((candidate) => candidate.id !== id);
    if (activeId === id) activeId = tabs[Math.max(0, index - 1)].id;
    scheduleSessionPersistence();
  }

  function scheduleSessionPersistence() {
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => void persistSession(), 500);
  }

  function schedulePersistence() {
    scheduleSessionPersistence();
    const tab = activeTab;
    if (!settings.autosave || !tab?.path || tab.conflict || tab.content === tab.savedContent)
      return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    const tabId = tab.id;
    autosaveTimer = setTimeout(() => {
      const current = tabs.find((item) => item.id === tabId);
      if (!current?.path || current.conflict || current.content === current.savedContent) return;
      void saveTab(tabId, false);
    }, settings.autosaveDelayMs);
  }

  async function persistSession() {
    if (!isDesktop()) return;
    const generation = ++persistGeneration;
    const snapshot = {
      settings,
      activeId,
      mode,
      workspaceRoot,
      tabs,
      recentFiles,
      recentWorkspaces,
      sessionPersistEnabled,
    };
    persistChain = persistChain.then(async () => {
      if (generation !== persistGeneration) return;
      try {
        await saveState('settings', snapshot.settings);
        if (generation !== persistGeneration) return;
        // Live flag cancels stale in-flight writes after restore is turned off.
        if (snapshot.sessionPersistEnabled && sessionPersistEnabled) {
          const session: SessionState = {
            version: 1,
            activeId: snapshot.activeId,
            mode: snapshot.mode,
            workspaceRoot: snapshot.workspaceRoot,
            tabs: snapshot.tabs,
            recentFiles: snapshot.recentFiles,
            recentWorkspaces: snapshot.recentWorkspaces,
          };
          await saveState('session', session);
        }
        // Draft bodies stay recoverable even when session restore is disabled.
        for (const tab of snapshot.tabs.filter(
          (item) => !item.path || item.content !== item.savedContent || item.conflict
        )) {
          if (generation !== persistGeneration) return;
          await saveState(`draft-${tab.id}`, tab);
          await setDraftIndexed(tab.id, true);
        }
      } catch (error) {
        console.error('Failed to persist session', error);
        status = `Could not save session: ${readableError(error)}`;
      }
    });
    await persistChain;
  }

  async function restoreState() {
    if (!isDesktop()) {
      persistenceReady = true;
      return;
    }
    let sessionRestored = false;
    let recoveredCount = 0;
    let restoreFailed = false;
    try {
      const loadedSettings = await loadState<AppSettings>('settings');
      if (loadedSettings?.version === 1) {
        settings = normalizeSettings(loadedSettings);
        previousUpdateChannel = settings.updateChannel;
      }
      const session = await loadState<SessionState>('session');
      if (session?.version === 1 && settings.restoreSession && session.tabs.length) {
        tabs = session.tabs;
        activeId =
          session.activeId && session.tabs.some((tab) => tab.id === session.activeId)
            ? session.activeId
            : session.tabs[0].id;
        mode = ['source', 'split', 'preview'].includes(session.mode) ? session.mode : 'source';
        workspaceRoot = session.workspaceRoot;
        recentFiles = session.recentFiles ?? [];
        recentWorkspaces = session.recentWorkspaces ?? [];
        sessionRestored = true;
      }

      const recovered = await recoverOrphanDrafts(tabs);
      recoveredCount = recovered.length;
      if (recovered.length) {
        const onlyWelcome =
          tabs.length === 1 &&
          tabs[0].name === 'Welcome.md' &&
          tabs[0].content === welcomeMarkdown &&
          !tabs[0].path;
        tabs = onlyWelcome && !sessionRestored ? recovered : [...tabs, ...recovered];
        if (onlyWelcome && !sessionRestored) activeId = recovered[0].id;
        status = sessionRestored
          ? `Session restored · ${recovered.length} draft(s) recovered`
          : `Recovered ${recovered.length} draft(s)`;
      } else if (sessionRestored) {
        status = 'Session restored';
      }

      if (workspaceRoot) {
        await refreshWorkspace();
      }
    } catch {
      restoreFailed = true;
      status = 'Started fresh: saved session could not be restored';
    } finally {
      // Never rewrite session when restore is off/failed; orphan drafts use draft-index.
      sessionPersistEnabled = !restoreFailed && settings.restoreSession;
      persistenceReady = true;
      updatesSupported = await resolveUpdatesSupported();
      if (updatesSupported && settings.autoCheckUpdates) {
        void autoCheckUpdates();
      }
    }
  }

  async function checkExternalChanges() {
    if (!isDesktop() || externalCheckInFlight) return;
    externalCheckInFlight = true;
    try {
      for (const tab of tabs.filter((item) => item.path && !item.conflict)) {
        const tabId = tab.id;
        const path = tab.path!;
        try {
          const disk = await probeDocument(path);
          const live = tabs.find((item) => item.id === tabId);
          if (!live?.path || live.conflict) continue;
          if (live.fingerprint?.hash === disk.fingerprint.hash) continue;

          // Restored tabs often lack a fingerprint; adopt it when saved bytes still match disk.
          if (!live.fingerprint && live.savedContent === disk.content) {
            tabs = tabs.map((item) =>
              item.id === tabId ? { ...item, fingerprint: disk.fingerprint } : item
            );
            continue;
          }

          if (live.content === live.savedContent) {
            tabs = tabs.map((item) =>
              item.id === tabId
                ? {
                    ...item,
                    content: disk.content,
                    savedContent: disk.content,
                    fingerprint: disk.fingerprint,
                  }
                : item
            );
            status = `${live.name} reloaded from disk`;
          } else {
            tabs = tabs.map((item) => (item.id === tabId ? { ...item, conflict: true } : item));
            openConflict(tabId);
          }
        } catch {
          /* Deleted/unavailable files remain recoverable drafts. */
        }
      }
    } finally {
      externalCheckInFlight = false;
    }
  }

  async function resolveConflict(action: 'reload' | 'keep') {
    const tab = tabs.find((item) => item.id === conflictTabId);
    if (!tab?.path) {
      dismissConflictForTab(conflictTabId ?? '');
      return;
    }
    try {
      if (action === 'reload') {
        const disk = await probeDocument(tab.path);
        tabs = tabs.map((item) =>
          item.id === tab.id
            ? {
                ...item,
                content: disk.content,
                savedContent: disk.content,
                fingerprint: disk.fingerprint,
                conflict: false,
              }
            : item
        );
      } else {
        const contentToWrite = tab.content;
        const fingerprint = await writeDocument(tab.path, contentToWrite, tab.fingerprint, true);
        tabs = tabs.map((item) =>
          item.id === tab.id
            ? { ...item, savedContent: contentToWrite, fingerprint, conflict: false }
            : item
        );
      }
      conflictOpen = false;
      conflictTabId = null;
      const target = conflictReturnFocus;
      conflictReturnFocus = null;
      restoreFocus(target);
      schedulePersistence();
      showNextConflict();
    } catch (error) {
      status = readableError(error);
    }
  }

  function remember(items: string[], value: string) {
    return [value, ...items.filter((item) => item !== value)].slice(0, 20);
  }

  function readableError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error) {
      const message = (error as { message: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  function handleDrag(e: MouseEvent) {
    if (appPlatform === 'windows') return;
    if (
      e.button === 0 &&
      customTitleBar &&
      e.target instanceof Element &&
      e.target.closest('.window-controls, .window-control') === null &&
      e.target.closest('[data-tauri-drag-region]') &&
      !e.target.closest('button, input, select, [data-tauri-no-drag], [role="menu"]') &&
      isDesktop()
    ) {
      try {
        void getCurrentWindow().startDragging();
      } catch {
        // Ignore errors if Tauri API fails
      }
    }
  }

  function handleTitlebarDoubleClick(event: MouseEvent) {
    if (!customTitleBar || !isDesktop()) return;
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest('[data-tauri-drag-region]')) return;
    if (event.target.closest('button, input, select, [data-tauri-no-drag], [role="menu"]')) return;
    void getCurrentWindow().toggleMaximize();
  }
</script>

<svelte:head><title>Tuxedo MD</title></svelte:head>
<svelte:window onmousedown={handleDrag} ondblclick={handleTitlebarDoubleClick} />

<div class="app-shell" class:custom-chrome={customTitleBar} class:focus-mode={settings.focusMode}>
  <header
    class="titlebar"
    class:mac-titlebar={isMacChrome}
    class:windows-chrome={isWindowsChrome}
    data-tauri-drag-region={isWindowsChrome ? undefined : true}
  >
    <div class="titlebar-main" data-tauri-drag-region={isWindowsChrome ? undefined : true}>
      {#if isWindowsChrome}
        <WindowMenubar oncommand={runMenuCommand} updatesSupported={updatesSupported} />
        <span class="titlebar-inline-divider" aria-hidden="true"></span>
      {:else}
        <div class="brand" data-tauri-drag-region>
          <div class="brand-mark"><BookOpenText size={18} /></div>
          <span>Tuxedo MD</span>
          <span class:pro={isFullEdition} class="edition">{isFullEdition ? 'PRO' : 'CE'}</span>
        </div>
      {/if}

      <div
        class="titlebar-tabs"
        data-tauri-drag-region={isWindowsChrome ? undefined : true}
      >
        {#each tabs as tab (tab.id)}
          <div class:active={tab.id === activeId} class="titlebar-tab">
            <button class="tab-select" onclick={() => (activeId = tab.id)}>
              <span class:dirty={tab.content !== tab.savedContent}>{tab.name}</span>
            </button>
            {#if tabs.length > 1}
              <button
                class="tab-close"
                title={`Close ${tab.name}`}
                onclick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}><X /></button
              >
            {/if}
          </div>
        {/each}
        <button class="titlebar-new-tab" onclick={newDocument} title="New tab">+</button>
      </div>

      {#if isWindowsChrome}
        <div class="titlebar-drag-fill" data-tauri-drag-region></div>
      {/if}

      <div class="toolbar">
        <div class="toolbar-quick-actions">
          <button
            class:active={sidebarOpen}
            class="icon-button"
            title="Toggle tools"
            aria-label="Toggle tools"
            aria-expanded={sidebarOpen}
            onclick={() => void setSidebarOpen(!sidebarOpen)}><PanelLeftOpen /></button
          >
          <button class="icon-button" title="New document" onclick={newDocument}
            ><FilePlus2 /></button
          >
          <button class="icon-button" title="Open file" onclick={openFile}><FolderOpen /></button>
          <button class="icon-button" title="Save" onclick={() => saveActive(false)}
            ><Save /></button
          >
        </div>
        <span class="toolbar-divider toolbar-divider-mode"></span>
        <div class="titlebar-mode-toggle" aria-label="Editor mode">
          <button class:active={mode === 'source'} onclick={() => (mode = 'source')} title="Editor"
            >Editor</button
          >
          <button
            class:active={mode === 'split'}
            onclick={() => (mode = 'split')}
            title="Split view">Split</button
          >
          <button
            class:active={mode === 'preview'}
            onclick={() => (mode = 'preview')}
            title="Preview">Preview</button
          >
        </div>
        <span class="toolbar-divider"></span>
        <button class="icon-button" title="Settings" onclick={openSettings}><Settings2 /></button>
        <button
          class="icon-button"
          title={`Command palette (${formatShortcut({ mod: true, shift: true, key: 'p' })})`}
          onclick={openCommandPalette}>{modKeyLabel()}</button
        >
      </div>
      {#if isWindowsChrome}
        <WindowControls onclose={() => void requestAppClose(hasUnsavedChanges)} />
      {/if}
    </div>
  </header>

  <div class="workspace">
    {#if sidebarOpen}
      {#if drawerOverlay}
        <button
          class="drawer-backdrop"
          aria-label="Close tools"
          onclick={() => void setSidebarOpen(false)}
        ></button>
      {/if}
      <aside class:overlay={drawerOverlay} class="sidebar" aria-label="Workspace tools">
        <div class="sidebar-heading">
          <div>
            <span>Tools</span>
            <strong>{drawerPanel}</strong>
          </div>
          <button
            class="icon-button quiet"
            onclick={() => void setSidebarOpen(false)}
            title="Hide tools"><X /></button
          >
        </div>
        <nav class="drawer-tabs" aria-label="Tool panels">
          <button class:active={drawerPanel === 'files'} onclick={() => (drawerPanel = 'files')}
            ><FolderOpen /> Files</button
          >
          {#if canSearchWorkspace}
            <button class:active={drawerPanel === 'search'} onclick={() => (drawerPanel = 'search')}
              ><Search /> Search</button
            >
          {/if}
          {#if showReferencePanel}
            <button class:active={drawerPanel === 'links'} onclick={() => (drawerPanel = 'links')}
              ><Link2 /> Links</button
            >
          {/if}
          <button class:active={drawerPanel === 'outline'} onclick={() => (drawerPanel = 'outline')}
            ><ListTree /> Outline</button
          >
          <button class:active={drawerPanel === 'recent'} onclick={() => (drawerPanel = 'recent')}
            ><History /> Recent</button
          >
        </nav>
        {#if drawerPanel === 'files'}
          <p class="drawer-context">
            {workspaceRoot
              ? (workspaceRoot.split(/[\\/]/).at(-1) ?? 'Workspace')
              : 'No workspace open'}
          </p>
          <div class="workspace-actions">
            <button class="open-workspace" onclick={openWorkspace}
              ><FolderOpen /> Open workspace</button
            >
            {#if workspaceRoot}
              <button
                class="icon-button"
                title="New document in this workspace"
                aria-label="New document in this workspace"
                onclick={() => void createDocumentInWorkspace('')}><FilePlus2 /></button
              >
              <button
                class="icon-button"
                title="Refresh workspace"
                aria-label="Refresh workspace"
                onclick={() => void refreshWorkspace()}><RefreshCw /></button
              >
            {/if}
          </div>
          <label class="search-box">
            <Search />
            <input bind:value={filter} placeholder="Filter files" />
          </label>
          <div class="file-list">
            {#if workspaceRoot}
              <WorkspaceTree
                rows={treeRows}
                activePath={activeTab?.path ?? null}
                onopen={(node) => node.path && void openWorkspaceFile(node.path)}
                ontoggle={toggleDirectory}
                oncontextaction={handleTreeAction}
              />
            {:else}
              <p class="empty-state">Open a folder to begin.</p>
            {/if}
          </div>
          {#if !canSearchWorkspace || !showReferencePanel}
            <div class="sidebar-upgrade" title={capabilityMessage('workspaceSearch')}>
              <Sparkles />
              <div>
                <strong>More in Pro</strong>
                <span>Workspace search, backlinks, wiki links, and tags.</span>
              </div>
            </div>
          {/if}
        {:else if drawerPanel === 'search'}
          <form
            class="search-form"
            onsubmit={(event) => {
              event.preventDefault();
              void runWorkspaceSearch();
            }}
          >
            <label class="search-box">
              <Search />
              <input
                bind:value={searchQuery}
                placeholder="Search workspace text"
                aria-label="Search workspace text"
              />
            </label>
            <label class="search-option">
              <input type="checkbox" bind:checked={searchCaseSensitive} />
              <span>Match case</span>
            </label>
            <button class="open-workspace" type="submit" disabled={searchRunning}>
              {searchRunning ? 'Searching…' : 'Search'}
            </button>
          </form>
          <div class="drawer-list search-results">
            {#if !workspaceRoot}
              <p class="empty-state">Open a workspace folder to search it.</p>
            {:else if searchRunning}
              <p class="empty-state">Scanning workspace…</p>
            {:else if !searchSubmitted}
              <p class="empty-state">Search Markdown text across this workspace.</p>
            {:else if !groupedSearchResults.length}
              <p class="empty-state">No matches found.</p>
            {:else}
              {#each groupedSearchResults as group (group.relativePath)}
                <div class="search-group">
                  <h3 class="search-group-heading" title={group.relativePath}>
                    {group.relativePath}
                  </h3>
                  {#each group.matches as match (`${match.path}:${match.line}`)}
                    <button
                      class="search-hit"
                      onclick={() => void openAndReveal(match.path, match.line)}
                      title={`Open at line ${match.line}`}
                    >
                      <span class="search-hit-line">{match.line}</span>
                      <span class="search-hit-preview">{match.preview}</span>
                    </button>
                  {/each}
                </div>
              {/each}
              {#if searchTruncated}
                <p class="empty-state">Showing the first 500 matches. Narrow the query for more.</p>
              {/if}
            {/if}
          </div>
        {:else if drawerPanel === 'links'}
          <div class="drawer-list link-panel">
            {#if !workspaceRoot}
              <p class="empty-state">Open a workspace folder to map its links.</p>
            {:else if referencesLoading}
              <p class="empty-state">Reading workspace links…</p>
            {:else if !linkGraph}
              <button class="open-workspace" onclick={() => void refreshReferences()}
                >Analyze workspace links</button
              >
            {:else}
              <button class="open-workspace" onclick={() => void refreshReferences()}
                ><RefreshCw /> Re-analyze</button
              >
              {#if canUseBacklinks}
                <h3 class="recent-heading">
                  Backlinks{activeRelativePath ? ` to ${activeTab?.name}` : ''}
                </h3>
                <nav class="outline-list" aria-label="Backlinks">
                  {#each activeBacklinks as source (source)}
                    <button onclick={() => void openWorkspaceRelative(source)} title={source}
                      >{source}</button
                    >
                  {:else}
                    <p class="empty-state">
                      {activeRelativePath
                        ? 'Nothing links here yet.'
                        : 'Open a workspace document to see its backlinks.'}
                    </p>
                  {/each}
                </nav>
              {/if}
              {#if canUseTags}
                <h3 class="recent-heading">Tags</h3>
                <div class="tag-cloud">
                  {#each tagCounts as item (item.tag)}
                    <button
                      class="tag-chip"
                      onclick={() => searchForTag(item.tag)}
                      disabled={!canSearchWorkspace}
                      title={canSearchWorkspace
                        ? `Search for #${item.tag}`
                        : `#${item.tag} appears in ${item.count} documents`}
                      >#{item.tag} <span>{item.count}</span></button
                    >
                  {:else}
                    <p class="empty-state">No tags in this workspace.</p>
                  {/each}
                </div>
              {/if}
              {#if canInspectWorkspace}
                <h3 class="recent-heading">Broken links ({linkGraph.broken.length})</h3>
                <nav class="outline-list" aria-label="Broken links">
                  {#each linkGraph.broken.slice(0, 50) as item (`${item.from}->${item.target}`)}
                    <button
                      onclick={() => void openWorkspaceRelative(item.from)}
                      title={`${item.from} links to ${item.target}`}
                      >{item.target} <small>in {item.from}</small></button
                    >
                  {:else}
                    <p class="empty-state">Every local link resolves.</p>
                  {/each}
                </nav>
                <h3 class="recent-heading">Orphaned notes ({linkGraph.orphans.length})</h3>
                <nav class="outline-list" aria-label="Orphaned notes">
                  {#each linkGraph.orphans.slice(0, 50) as path (path)}
                    <button onclick={() => void openWorkspaceRelative(path)} title={path}
                      >{path}</button
                    >
                  {:else}
                    <p class="empty-state">Every document has an inbound link.</p>
                  {/each}
                </nav>
              {/if}
            {/if}
          </div>
        {:else if drawerPanel === 'outline'}
          <nav class="outline-list drawer-list" aria-label="Document outline">
            {#each outline as item (item.line)}
              <button
                style={`--outline-level:${item.level}`}
                onclick={() => revealOutlineItem(item)}
                title={`Line ${item.line}`}>{item.title}</button
              >
            {:else}<p class="empty-state">No headings in this document.</p>{/each}
          </nav>
        {:else}
          <div class="recent-groups drawer-list">
            <h3 class="recent-heading">Files</h3>
            <nav class="outline-list" aria-label="Recent files">
              {#each recentFiles as path (path)}<button
                  onclick={() => openWorkspaceFile(path)}
                  title={path}>{path.split(/[\\/]/).at(-1)}</button
                >{:else}<p class="empty-state">No recent files yet.</p>{/each}
            </nav>
            <h3 class="recent-heading">Workspaces</h3>
            <nav class="outline-list" aria-label="Recent workspaces">
              {#each recentWorkspaces as root (root)}<button
                  onclick={() => void openRecentWorkspace(root)}
                  title={root}>{root.split(/[\\/]/).at(-1) || root}</button
                >{:else}<p class="empty-state">No recent workspaces yet.</p>{/each}
            </nav>
          </div>
        {/if}
      </aside>
    {/if}

    <main class="main-area">
      <section class:split-layout={mode === 'split'} class="editor-grid">
        <div class="source-pane" class:pane-hidden={mode === 'preview'} aria-hidden={mode === 'preview'}>
          <MarkdownEditor
            documentId={activeTab?.id ?? 'empty'}
            value={activeTab?.content ?? ''}
            selection={activeTab?.selection ?? { anchor: 0, head: 0 }}
            showLineNumbers={settings.showLineNumbers}
            tabSize={settings.tabSize}
            spellcheck={settings.spellcheck}
            lineWrap={settings.lineWrap}
            visible={mode !== 'preview'}
            retainedDocumentIds={tabs.map((tab) => tab.id)}
            {findRequest}
            {revealRequest}
            onchange={updateContent}
            onselectionchange={updateSelection}
          />
        </div>
        {#if mode !== 'source'}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div class="preview-pane" role="presentation" onclick={handlePreviewClick}>
            <!-- Preview HTML is produced by rehype-sanitize in src/lib/preview.ts. -->
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="markdown-body preview-{settings.previewFont}">{@html preview}</div>
          </div>
        {/if}
      </section>

      <footer class="statusbar">
        <span>{editionWarning ? `${status} · ${editionWarning}` : status}</span>
        <span
          >{activeTab?.content.length ?? 0} characters · {activeTab?.content.trim()
            ? activeTab.content.trim().split(/\s+/).length
            : 0} words</span
        >
      </footer>
    </main>
  </div>
</div>

{#if settingsOpen}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) closeSettings();
    }}
  >
    <dialog
      open
      class="settings-modal tabbed-layout"
      aria-modal="true"
      aria-labelledby="settings-title"
      onkeydown={(event) => handleDismissibleDialogKeydown(event, closeSettings)}
    >
      <header class="settings-header">
        <h2 id="settings-title">Settings</h2>
        <button
          class="icon-button"
          aria-label="Close settings"
          bind:this={settingsInitialFocus}
          onclick={closeSettings}><X /></button
        >
      </header>
      <div class="settings-body">
        <aside class="settings-sidebar">
          <button
            class:active={activeSettingsTab === 'appearance'}
            onclick={() => (activeSettingsTab = 'appearance')}
          >
            <Palette size={16} /> <span>Appearance</span>
          </button>
          <button
            class:active={activeSettingsTab === 'editor'}
            onclick={() => (activeSettingsTab = 'editor')}
          >
            <Sliders size={16} /> <span>Editor</span>
          </button>
          <button
            class:active={activeSettingsTab === 'files'}
            onclick={() => (activeSettingsTab = 'files')}
          >
            <Save size={16} /> <span>Files & AutoSave</span>
          </button>
          <button
            class:active={activeSettingsTab === 'about'}
            onclick={() => (activeSettingsTab = 'about')}
          >
            <Scroll size={16} /> <span>About & Licenses</span>
          </button>
        </aside>

        <main class="settings-content">
          {#if activeSettingsTab === 'appearance'}
            <div class="settings-section">
              <h3>Appearance</h3>

              <div class="settings-group">
                <div class="settings-label">Theme</div>
                <div class="select-wrapper">
                  <select bind:value={settings.theme}>
                    <option value="system">System</option>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="contrast">High contrast</option>
                  </select>
                </div>
              </div>

              <div class="settings-group">
                <div class="settings-label">Glass effects</div>
                <div class="select-wrapper">
                  <select bind:value={settings.glassEffects}>
                    <option value="system">Follow system</option>
                    <option value="on">Always on</option>
                    <option value="off">Off</option>
                  </select>
                </div>
              </div>

              <div class="settings-group">
                <div class="settings-label">Preview font family</div>
                <div class="select-wrapper">
                  <select bind:value={settings.previewFont}>
                    <option value="sans">Sans-Serif (Standard)</option>
                    <option value="serif">Serif (Literary)</option>
                    <option value="mono">Monospace (Code)</option>
                  </select>
                </div>
              </div>

              <div class="settings-group toggle-group">
                <label class="switch-container">
                  <span>Focus Mode (Hides UI chrome)</span>
                  <input type="checkbox" bind:checked={settings.focusMode} />
                  <span class="switch-slider"></span>
                </label>
              </div>
            </div>
          {:else if activeSettingsTab === 'editor'}
            <div class="settings-section">
              <h3>Editor</h3>

              <div class="settings-group">
                <div class="settings-label">Editor font size ({settings.fontSize}px)</div>
                <input
                  class="range-slider"
                  type="range"
                  min="12"
                  max="22"
                  bind:value={settings.fontSize}
                />
              </div>

              <div class="settings-group toggle-group">
                <label class="switch-container">
                  <span>Wrap editor lines</span>
                  <input type="checkbox" bind:checked={settings.lineWrap} />
                  <span class="switch-slider"></span>
                </label>
              </div>

              <div class="settings-group toggle-group">
                <label class="switch-container">
                  <span>Show line numbers</span>
                  <input type="checkbox" bind:checked={settings.showLineNumbers} />
                  <span class="switch-slider"></span>
                </label>
              </div>

              <div class="settings-group">
                <div class="settings-label">Tab size</div>
                <div class="segmented-control">
                  <button
                    class:active={settings.tabSize === 2}
                    onclick={() => (settings.tabSize = 2)}>2 spaces</button
                  >
                  <button
                    class:active={settings.tabSize === 4}
                    onclick={() => (settings.tabSize = 4)}>4 spaces</button
                  >
                </div>
              </div>

              <div class="settings-group toggle-group">
                <label class="switch-container">
                  <span>Enable editor spellcheck</span>
                  <input type="checkbox" bind:checked={settings.spellcheck} />
                  <span class="switch-slider"></span>
                </label>
              </div>
            </div>
          {:else if activeSettingsTab === 'files'}
            <div class="settings-section">
              <h3>Files & AutoSave</h3>

              <div class="settings-group toggle-group">
                <label class="switch-container">
                  <span>Autosave existing files</span>
                  <input type="checkbox" bind:checked={settings.autosave} />
                  <span class="switch-slider"></span>
                </label>
              </div>

              {#if settings.autosave}
                <div class="settings-group">
                  <div class="settings-label">Autosave delay</div>
                  <div class="select-wrapper">
                    <select bind:value={settings.autosaveDelayMs}>
                      <option value={500}>0.5 seconds</option>
                      <option value={1500}>1.5 seconds</option>
                      <option value={3000}>3 seconds</option>
                    </select>
                  </div>
                </div>
              {/if}

              <div class="settings-group toggle-group">
                <label class="switch-container">
                  <span>Restore full session on startup</span>
                  <input type="checkbox" bind:checked={settings.restoreSession} />
                  <span class="switch-slider"></span>
                </label>
              </div>

              <div class="settings-group toggle-group">
                <label class="switch-container">
                  <span>Keep untitled drafts silently when closing</span>
                  <input type="checkbox" bind:checked={settings.keepDraftsSilently} />
                  <span class="switch-slider"></span>
                </label>
              </div>

              <p class="settings-note">
                Recovery drafts stay locally in your operating system's app-data folder.
              </p>
            </div>
          {:else if activeSettingsTab === 'about'}
            <div class="settings-section">
              <h3>About & Licenses</h3>

              <div class="about-branding">
                <div class="about-logo"><BookOpenText size={32} /></div>
                <div class="about-meta">
                  <h4>Tuxedo MD</h4>
                  <div class="about-meta-row">
                    <span>v{editionVersion ?? '0.1.0-alpha.1'}</span>
                    <span class:pro={isFullEdition} class="edition"
                      >{isFullEdition ? 'PRO' : 'CE'}</span
                    >
                  </div>
                </div>
              </div>

              <p class="settings-note">
                {isFullEdition
                  ? 'Pro is enabled for advanced local workflows, publishing, intelligence, and customization.'
                  : 'Community includes complete local Markdown editing. Pro adds advanced local workflows, publishing, intelligence, and customization.'}
              </p>
              {#if editionWarning}
                <p class="settings-note" role="alert">
                  <strong>Edition check:</strong>
                  {editionWarning}
                </p>
              {/if}

              {#if updatesSupported}
                <h3>Updates</h3>
                <div class="settings-group toggle-group">
                  <label class="switch-container">
                    <span>Check for updates automatically</span>
                    <input type="checkbox" bind:checked={settings.autoCheckUpdates} />
                    <span class="switch-slider"></span>
                  </label>
                </div>
                <div class="settings-group">
                  <div class="settings-label">Update channel</div>
                  <div class="select-wrapper">
                    <select bind:value={settings.updateChannel}>
                      <option value="auto">Auto (follow installed build)</option>
                      <option value="stable">Stable</option>
                      <option value="beta">Beta</option>
                    </select>
                  </div>
                </div>
                <div class="settings-group">
                  <button type="button" class="settings-action" onclick={() => void checkUpdates()}
                    >Check now</button
                  >
                </div>
                <p class="settings-note">
                  GitHub releases power in-app updates for direct Windows, macOS, and Linux builds.
                  Store builds update through the Mac App Store or Microsoft Store instead.
                </p>
              {/if}

              <div class="licenses-section">
                <div class="licenses-header">
                  <h5>Third-party Licenses</h5>
                  <div class="licenses-search">
                    <Search size={14} />
                    <input
                      type="text"
                      placeholder="Search package licenses..."
                      bind:value={licenseSearch}
                    />
                  </div>
                </div>

                <div class="licenses-list">
                  {#if licensesLoading}
                    <div class="loading-state">Loading dependency licenses...</div>
                  {:else if licensesError}
                    <div class="error-state">Error loading licenses: {licensesError}</div>
                  {:else if filteredLicensesList.length === 0}
                    <div class="empty-state">No packages found matching search filter.</div>
                  {:else}
                    {#each filteredLicensesList as [pkgName, pkgInfo] (pkgName)}
                      <div class="license-card">
                        <button
                          class="license-card-header"
                          onclick={() => {
                            expandedLicensePackage =
                              expandedLicensePackage === pkgName ? null : pkgName;
                          }}
                        >
                          <div class="license-pkg-info">
                            <span class="pkg-name">{pkgName}</span>
                            <span class="pkg-license"
                              >{Array.isArray(pkgInfo.licenses)
                                ? pkgInfo.licenses.join(', ')
                                : pkgInfo.licenses || 'Unknown'}</span
                            >
                          </div>
                          <span class="expand-icon">
                            {#if expandedLicensePackage === pkgName}
                              <ChevronUp size={16} />
                            {:else}
                              <ChevronDown size={16} />
                            {/if}
                          </span>
                        </button>
                        {#if expandedLicensePackage === pkgName}
                          <div class="license-card-body">
                            {#if pkgInfo.publisher}
                              <p class="license-meta">
                                <strong>Publisher:</strong>
                                {pkgInfo.publisher}
                              </p>
                            {/if}
                            {#if pkgInfo.repository}
                              <p class="license-meta">
                                <strong>Repository:</strong>
                                <a
                                  href={pkgInfo.repository}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onclick={(event) => {
                                    event.preventDefault();
                                    void openExternalUrl(pkgInfo.repository!).catch((error) => {
                                      status = readableError(error);
                                    });
                                  }}>{pkgInfo.repository}</a
                                >
                              </p>
                            {/if}
                            {#if pkgInfo.licenseText}
                              <pre class="license-text">{pkgInfo.licenseText}</pre>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        </main>
      </div>
    </dialog>
  </div>
{/if}

{#if namePrompt}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) resolveNamePrompt(null);
    }}
  >
    <dialog
      open
      class="settings-modal"
      aria-modal="true"
      aria-labelledby="name-prompt-title"
      onkeydown={(event) => handleDismissibleDialogKeydown(event, () => resolveNamePrompt(null))}
    >
      <header>
        <h2 id="name-prompt-title">{namePrompt.title}</h2>
        <button class="icon-button" aria-label="Cancel" onclick={() => resolveNamePrompt(null)}
          ><X /></button
        >
      </header>
      <form
        class="name-prompt-form"
        onsubmit={(event) => {
          event.preventDefault();
          resolveNamePrompt(namePrompt?.value ?? null);
        }}
      >
        <label class="name-prompt-label" for="name-prompt-input">{namePrompt.label}</label>
        <input
          id="name-prompt-input"
          class="name-prompt-input"
          bind:this={namePromptInput}
          bind:value={namePrompt.value}
        />
        <p class="settings-note">A .md extension is added automatically when omitted.</p>
        <div class="modal-actions">
          <button type="button" onclick={() => resolveNamePrompt(null)}>Cancel</button>
          <button class="primary" type="submit" disabled={!namePrompt.value.trim()}>Save</button>
        </div>
      </form>
    </dialog>
  </div>
{/if}

{#if conflictOpen}
  <div class="modal-backdrop">
    <dialog
      open
      class="settings-modal"
      aria-modal="true"
      aria-labelledby="conflict-title"
      onkeydown={trapDialogFocus}
    >
      <h2 id="conflict-title">File changed outside Tuxedo MD</h2>
      <p>Autosave is paused to protect both versions.</p>
      <div class="modal-actions">
        <button bind:this={conflictInitialFocus} onclick={() => resolveConflict('reload')}
          >Reload disk version</button
        ><button class="primary" onclick={() => resolveConflict('keep')}>Keep my version</button>
      </div>
    </dialog>
  </div>
{/if}

{#if paletteOpen}
  <CommandPalette commands={commandPaletteItems()} onclose={() => (paletteOpen = false)} />
{/if}
