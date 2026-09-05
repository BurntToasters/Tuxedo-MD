<script lang="ts">
  import {
    BookOpenText,
    Command,
    FilePlus2,
    FolderOpen,
    PanelLeftOpen,
    Save,
    Settings2,
  } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { formatShortcut } from './lib/shortcuts';
  import { normalizeSettings } from './lib/settings';
  import MarkdownEditor from './lib/editor/MarkdownEditor.svelte';
  import TabBar from './lib/chrome/TabBar.svelte';
  import WorkspaceSidebar from './lib/chrome/WorkspaceSidebar.svelte';
  import StatusBar from './lib/chrome/StatusBar.svelte';
  import SettingsDialog from './lib/chrome/SettingsDialog.svelte';
  import NamePromptDialog from './lib/chrome/NamePromptDialog.svelte';
  import ConflictDialog from './lib/chrome/ConflictDialog.svelte';
  import { focusedElement, restoreFocus } from './lib/focus';
  import { capabilityMessage, editionState, hasCapability, requireCapability } from './lib/edition';
  import { setDraftIndexed as writeDraftIndex } from './lib/draft-index';
  import { renderMarkdown } from './lib/preview';
  import {
    hydrateSessionTabs,
    isPathUnderWorkspace,
    MAX_SESSION_TABS,
    normalizeSessionState,
    pathsReferToSameFile,
  } from './lib/session';
  import {
    buildSessionPayload,
    draftsToPersist,
    recoverOrphanDrafts,
    shouldReplaceWelcome,
  } from './lib/session-controller';
  import { isTabDirty, neutralizeDiscardedTab } from './lib/tab-lifecycle';
  import {
    chooseDocument,
    chooseSavePath,
    chooseWorkspace,
    isDesktop,
    readDocument,
    writeDocument,
    probeDocument,
    probeDocumentMeta,
    loadState,
    saveState,
    deleteState,
    takePendingOpenPaths,
    setDocumentEdited,
    scanWorkspace,
    adoptWorkspaceFolder,
    registerConsentedPath,
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
  import { resizeWindowForDrawer } from './lib/window';
  import { syncAppearanceEffects } from './lib/appearance';
  import { detectPlatform, usesCustomTitleBar, type AppPlatform } from './lib/platform';
  import { formatWindowTitle } from './lib/window-title';
  import {
    askDirtyTabClose,
    requestAppClose,
    shouldInterceptNativeClose,
  } from './lib/window-lifecycle';
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
  const canUseWikiLinks = hasCapability('wikiLinks');
  const canUseTags = hasCapability('tags');
  const canInspectWorkspace = hasCapability('workspaceIntelligence');
  const showReferencePanel =
    canUseBacklinks || canUseTags || canInspectWorkspace || canUseWikiLinks;
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
  let namePromptValue = $state('');
  let settleNamePrompt: ((value: string | null) => void) | null = null;
  let status = $state('Ready');
  let settings = $state<AppSettings>(defaultSettings);
  let settingsOpen = $state(false);
  let updatesSupported = $state(false);
  let previousUpdateChannel = $state<UpdateChannel>(defaultSettings.updateChannel);

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
  const saveInFlightIds = new SvelteSet<string>();
  const cancelledSaveTabIds = new SvelteSet<string>();
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
  let outline = $derived.by(() => {
    if (!sidebarOpen || drawerPanel !== 'outline') return [];
    return (activeTab?.content ?? '')
      .split('\n')
      .map((line, index) => {
        const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
        return match ? { level: match[1].length, title: match[2], line: index + 1 } : null;
      })
      .filter((item): item is { level: number; title: string; line: number } => item !== null);
  });

  $effect(() => {
    const content = activeTab?.content ?? '';
    const request = ++previewRenderRequest;
    renderMarkdown(content)
      .then((html) => {
        if (request === previewRenderRequest) preview = html;
      })
      .catch((error) => {
        if (request !== previewRenderRequest) return;
        preview = '';
        status = `Preview failed: ${readableError(error)}`;
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
        const state = await syncAppearanceEffects(
          effectiveGlassEffects,
          resolvedTheme !== 'light',
          { opaqueWindow: editionState.opaqueWindow }
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

  let previousRestoreSession: boolean | undefined;
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

  let conflictTab = $derived(
    conflictTabId ? (tabs.find((item) => item.id === conflictTabId) ?? null) : null
  );

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
    if (!settingsOpen) return;
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
    await writeDraftIndex(id, keep, { loadState, saveState });
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
        void closeTab(activeId);
        break;
      case 'quit':
        if (isDesktop()) void quitApp();
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
    if (!markdownPaths.length) {
      if (paths.length === 1 && isDesktop()) {
        try {
          await openRecentWorkspace(paths[0]);
        } catch {
          // Non-workspace path ignored.
        }
      }
      return;
    }
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
    let pollTick = 0;
    pollTimer = setInterval(() => {
      pollTick = (pollTick + 1) % 5;
      void checkExternalChanges(pollTick === 0);
    }, 2000);
    const onWindowFocus = () => void checkExternalChanges(true);
    window.addEventListener('focus', onWindowFocus);
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
        void closeTab(activeId);
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
          if (!shouldInterceptNativeClose()) return;
          event.preventDefault();
          void quitApp();
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
      window.removeEventListener('focus', onWindowFocus);
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
    const current = tabs.find((tab) => tab.id === activeId);
    if (current) {
      current.content = content;
    }
    schedulePersistence();
  }

  function updateSelection(selection: { anchor: number; head: number }) {
    const current = tabs.find((tab) => tab.id === activeId);
    if (current) {
      current.selection = selection;
    }
  }

  function newDocument() {
    if (tabs.length >= MAX_SESSION_TABS) {
      status = `Maximum tab limit (${MAX_SESSION_TABS}) reached. Close a tab to open another.`;
      return;
    }
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
        tabs = tabs.map((tab) => (tab.id === existing.id ? { ...tab, conflict: true } : tab));
        openConflict(existing.id);
        status = `${document.name} changed on disk`;
      }
      activeId = existing.id;
      schedulePersistence();
      return;
    }
    if (tabs.length >= MAX_SESSION_TABS) {
      status = `Maximum tab limit (${MAX_SESSION_TABS}) reached. Close a tab to open another.`;
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
      const adopted = await adoptWorkspaceFolder(root);
      await adoptWorkspace(adopted, await scanWorkspace(adopted));
    } catch (error) {
      status = readableError(error);
    }
  }

  async function refreshWorkspace() {
    if (!workspaceRoot || !isDesktop()) return;
    try {
      // Re-pin adopt in case the process lost state; scan requires a prior adopt.
      workspaceRoot = await adoptWorkspaceFolder(workspaceRoot);
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
    namePromptValue = value;
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
    const confirmMessage = `Delete ${node.name}? This cannot be undone.${warning}`;
    const shouldDelete = isDesktop()
      ? await (async () => {
          const { ask } = await import('@tauri-apps/plugin-dialog');
          return ask(confirmMessage, {
            title: 'Delete document',
            kind: 'warning',
          });
        })()
      : confirm(confirmMessage);
    if (!shouldDelete) return;
    try {
      await deleteWorkspaceDocument(workspaceRoot, node.path);
      // Detach the open tab so its content survives as a dirty recovered draft.
      tabs = tabs.map((tab) =>
        pathsReferToSameFile(tab.path, node.path)
          ? {
              ...tab,
              path: null,
              savedContent: '',
              recovered: true,
              fingerprint: null,
              conflict: false,
            }
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
      const isUnderCurrent = Boolean(workspaceRoot && isPathUnderWorkspace(path, workspaceRoot));
      if (!isUnderCurrent) {
        await registerConsentedPath(path);
      }
      try {
        addDocument(await readDocument(path));
      } catch {
        if (isUnderCurrent) {
          await registerConsentedPath(path);
          addDocument(await readDocument(path));
        }
      }
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

  async function saveTab(tabId: string, saveAs = false): Promise<boolean> {
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return false;
    if (!isDesktop()) {
      status = 'Native saving is available in the desktop app';
      return false;
    }
    if (saveInFlightIds.has(tabId)) return false;
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
      if (!path) return false;
      if (cancelledSaveTabIds.has(tabId)) {
        cancelledSaveTabIds.delete(tabId);
        return false;
      }
      const owner = tabs.find(
        (candidate) => candidate.id !== tabId && pathsReferToSameFile(candidate.path, path)
      );
      if (owner) {
        status = `Already open in another tab: ${owner.name}`;
        activeId = owner.id;
        return false;
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
        return false;
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
      if (isDesktop()) {
        try {
          await deleteState(`draft-${tabId}`);
          await setDraftIndexed(tabId, false);
        } catch (error) {
          console.error('Failed to clear recovery draft after save', error);
        }
      }
      schedulePersistence();
      return true;
    } catch (error) {
      if (cancelledSaveTabIds.has(tabId)) {
        cancelledSaveTabIds.delete(tabId);
        return false;
      }
      if (readableError(error).includes('changed on disk')) {
        tabs = tabs.map((item) => (item.id === tabId ? { ...item, conflict: true } : item));
        openConflict(tabId);
        status = 'Save paused: file changed outside Tuxedo MD';
      } else status = readableError(error);
      return false;
    } finally {
      saveInFlightIds.delete(tabId);
    }
  }

  async function saveActive(saveAs = false) {
    if (!activeId) return;
    await saveTab(activeId, saveAs);
  }

  async function openExternalUrl(href: string) {
    if (!/^(https:|mailto:)/i.test(href)) {
      throw new Error('Only https and mailto links can be opened externally');
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
    if (!href) return;
    if (href.startsWith('#')) {
      event.preventDefault();
      event.stopPropagation();
      const targetId = decodeURIComponent(href.slice(1));
      const targetEl =
        document.getElementById(targetId) ??
        document.querySelector(`[name="${CSS.escape(targetId)}"]`);
      targetEl?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    try {
      if (/^(https:|mailto:)/i.test(href)) {
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

  async function closeTab(id: string) {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    enableSessionPersist();
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = undefined;
    }

    const dirty = isTabDirty(tab);
    let keepDraft = false;
    if (dirty) {
      if (settings.keepDraftsSilently && !tab.path) {
        keepDraft = true;
      } else {
        const choice = await askDirtyTabClose(tab.name);
        if (choice === 'cancel') return;
        if (choice === 'save') {
          const saved = await saveTab(id, false);
          if (!saved) return;
          keepDraft = false;
        } else {
          keepDraft = false;
        }
      }
    }
    if (!keepDraft) cancelledSaveTabIds.add(id);
    if (isDesktop()) {
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
    }

    dismissConflictForTab(id);

    // Neutralize before last-tab quit so persistSession cannot resurrect discarded edits.
    if (!keepDraft) {
      tabs = tabs.map((item) => (item.id === id ? neutralizeDiscardedTab(item) : item));
    }

    if (tabs.length === 1) {
      // Closing the last tab quits on desktop (dirty prompt already handled above).
      if (isDesktop()) {
        await quitApp();
        return;
      }
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

  /** Flush recovery drafts/session immediately; never write dirty content to real files. */
  async function flushRecoveryStateForQuit() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = undefined;
    }
    if (recoveryTimer) {
      clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
    }
    // Ensure session + drafts land even if restore was toggled mid-session.
    if (settings.restoreSession) sessionPersistEnabled = true;
    await persistSession();
  }

  async function quitApp() {
    if (!isDesktop()) return;
    await requestAppClose(() => flushRecoveryStateForQuit());
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
          const session = buildSessionPayload(snapshot);
          await saveState('session', session);
        }
        // Draft bodies stay recoverable even when session restore is disabled.
        for (const tab of draftsToPersist(snapshot.tabs, cancelledSaveTabIds)) {
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
    let restoreFailed = false;
    try {
      const loadedSettings = await loadState('settings', normalizeSettings);
      if (loadedSettings?.version === 1) {
        settings = loadedSettings;
        previousUpdateChannel = settings.updateChannel;
      }
      const session = await loadState('session', normalizeSessionState);
      if (session && settings.restoreSession) {
        // Adopt before hydrate/scan — scan no longer auto-adopts.
        if (session.workspaceRoot) {
          try {
            session.workspaceRoot = await adoptWorkspaceFolder(session.workspaceRoot);
          } catch {
            session.workspaceRoot = '';
          }
        }
        for (const tab of session.tabs) {
          if (tab.path) {
            try {
              await registerConsentedPath(tab.path);
            } catch {
              // Missing / junction-escaped paths stay unrestorable until reopened.
            }
          }
        }
        tabs = await hydrateSessionTabs(session.tabs, readDocument);
        activeId =
          typeof session.activeId === 'string' && tabs.some((tab) => tab.id === session.activeId)
            ? session.activeId
            : tabs[0].id;
        mode = session.mode;
        workspaceRoot = session.workspaceRoot;
        recentFiles = session.recentFiles;
        recentWorkspaces = session.recentWorkspaces;
        sessionRestored = true;
      }

      const recovered = settings.restoreSession
        ? await recoverOrphanDrafts(tabs, { loadState })
        : [];
      if (recovered.length) {
        const onlyWelcome = shouldReplaceWelcome(tabs, sessionRestored, welcomeMarkdown);
        tabs = onlyWelcome ? recovered : [...tabs, ...recovered];
        if (onlyWelcome) activeId = recovered[0].id;
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

  async function checkExternalChanges(allTabs = false) {
    if (!isDesktop() || externalCheckInFlight) return;
    externalCheckInFlight = true;
    try {
      const candidates = tabs.filter(
        (item) => item.path && !item.conflict && (allTabs || item.id === activeId)
      );
      for (const tab of candidates) {
        const tabId = tab.id;
        const path = tab.path!;
        try {
          let live = tabs.find((item) => item.id === tabId);
          if (!live?.path || live.conflict) continue;

          // Dirty tabs always full-probe so same size/mtime replacements are still detected.
          if (live.content !== live.savedContent) {
            const disk = await probeDocument(path);
            live = tabs.find((item) => item.id === tabId);
            if (!live?.path || live.conflict) continue;
            if (live.fingerprint?.hash === disk.fingerprint.hash) continue;
            tabs = tabs.map((item) => (item.id === tabId ? { ...item, conflict: true } : item));
            openConflict(tabId);
            continue;
          }

          const meta = await probeDocumentMeta(path);
          live = tabs.find((item) => item.id === tabId);
          if (!live?.path || live.conflict) continue;
          // Light meta probe omits hash; compare mtime + size when hash is empty.
          const metaUnchanged =
            live.fingerprint &&
            live.fingerprint.modifiedMs === meta.fingerprint.modifiedMs &&
            live.fingerprint.size === meta.fingerprint.size &&
            (meta.fingerprint.hash === '' || live.fingerprint.hash === meta.fingerprint.hash);
          if (metaUnchanged) continue;

          const disk = await probeDocument(path);
          live = tabs.find((item) => item.id === tabId);
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
            try {
              await deleteState(`draft-${tabId}`);
              await setDraftIndexed(tabId, false);
            } catch (error) {
              console.error('Failed to clear recovery draft after external reload', error);
            }
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
    return [value, ...items.filter((item) => !pathsReferToSameFile(item, value))].slice(0, 20);
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
        <WindowMenubar oncommand={runMenuCommand} {updatesSupported} />
        <span
          class:pro={editionState.isFullEdition}
          class="edition titlebar-edition-chip"
          title={editionState.editionLabel}
          aria-label={`${editionState.editionLabel} edition`}
          >{editionState.isFullEdition ? 'PRO' : 'CE'}</span
        >
        <span class="titlebar-inline-divider" aria-hidden="true"></span>
      {:else}
        <div class="brand" data-tauri-drag-region>
          <div class="brand-mark"><BookOpenText size={18} /></div>
          <span>Tuxedo MD</span>
          <span class:pro={editionState.isFullEdition} class="edition"
            >{editionState.isFullEdition ? 'PRO' : 'CE'}</span
          >
        </div>
      {/if}

      <TabBar
        {tabs}
        {activeId}
        {isWindowsChrome}
        onselect={(id) => (activeId = id)}
        onclose={(id) => void closeTab(id)}
        onnew={newDocument}
      />

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
        <div class="titlebar-mode-toggle" role="radiogroup" aria-label="Editor mode">
          <button
            role="radio"
            aria-checked={mode === 'source'}
            class:active={mode === 'source'}
            onclick={() => (mode = 'source')}
            title="Editor">Editor</button
          >
          <button
            role="radio"
            aria-checked={mode === 'split'}
            class:active={mode === 'split'}
            onclick={() => (mode = 'split')}
            title="Split view">Split</button
          >
          <button
            role="radio"
            aria-checked={mode === 'preview'}
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
          aria-label={`Command palette (${formatShortcut({ mod: true, shift: true, key: 'p' })})`}
          onclick={openCommandPalette}><Command /></button
        >
      </div>
      {#if isWindowsChrome}
        <WindowControls onclose={() => void quitApp()} />
      {/if}
    </div>
  </header>

  <div class="workspace">
    <WorkspaceSidebar
      {sidebarOpen}
      {drawerOverlay}
      bind:drawerPanel
      {workspaceRoot}
      bind:filter
      {treeRows}
      activePath={activeTab?.path ?? null}
      activeTabName={activeTab?.name ?? null}
      {activeRelativePath}
      {canSearchWorkspace}
      {showReferencePanel}
      {canUseBacklinks}
      {canUseTags}
      {canInspectWorkspace}
      bind:searchQuery
      bind:searchCaseSensitive
      {searchRunning}
      {searchSubmitted}
      {searchTruncated}
      {groupedSearchResults}
      {referencesLoading}
      {linkGraph}
      {activeBacklinks}
      {tagCounts}
      {outline}
      {recentFiles}
      {recentWorkspaces}
      onclose={() => void setSidebarOpen(false)}
      onopenworkspace={openWorkspace}
      oncreatedocument={(dir) => void createDocumentInWorkspace(dir)}
      onrefreshworkspace={() => void refreshWorkspace()}
      onopenworkspacefile={(path) => void openWorkspaceFile(path)}
      ontoggledirectory={toggleDirectory}
      ontreeaction={handleTreeAction}
      onsearch={() => void runWorkspaceSearch()}
      onopenandreveal={(path, line) => void openAndReveal(path, line)}
      onrefreshreferences={() => void refreshReferences()}
      onopenworkspacerelative={(path) => void openWorkspaceRelative(path)}
      onsearchfortag={searchForTag}
      onrevealoutlineitem={revealOutlineItem}
      onopenrecentworkspace={(root) => void openRecentWorkspace(root)}
      {capabilityMessage}
    />

    <main class="main-area">
      <section class:split-layout={mode === 'split'} class="editor-grid">
        <div
          class="source-pane"
          class:pane-hidden={mode === 'preview'}
          aria-hidden={mode === 'preview'}
        >
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
          <div class="preview-pane" role="presentation" onclick={handlePreviewClick}>
            <!-- Preview HTML is produced by rehype-sanitize in src/lib/preview.ts. -->
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="markdown-body preview-{settings.previewFont}">{@html preview}</div>
          </div>
        {/if}
      </section>

      <StatusBar
        {status}
        editionWarning={editionState.editionWarning}
        content={activeTab?.content ?? ''}
      />
    </main>
  </div>
</div>

<SettingsDialog
  bind:settings
  open={settingsOpen}
  editionLabel={editionState.editionLabel}
  editionVersion={editionState.editionVersion}
  editionWarning={editionState.editionWarning}
  isFullEdition={editionState.isFullEdition}
  {updatesSupported}
  oncheckupdates={() => void checkUpdates()}
  onclose={closeSettings}
  onopenexternalurl={openExternalUrl}
/>

<NamePromptDialog
  open={!!namePrompt}
  title={namePrompt?.title ?? ''}
  label={namePrompt?.label ?? ''}
  bind:value={namePromptValue}
  onsubmit={(value) => resolveNamePrompt(value)}
  oncancel={() => resolveNamePrompt(null)}
/>

<ConflictDialog
  open={conflictOpen}
  tabName={conflictTab?.name ?? null}
  onresolve={(action) => void resolveConflict(action)}
  ondismiss={() => dismissConflictForTab(conflictTabId ?? '')}
/>

{#if paletteOpen}
  <CommandPalette commands={commandPaletteItems()} onclose={() => (paletteOpen = false)} />
{/if}
