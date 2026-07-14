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
  } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import MarkdownEditor from './lib/editor/MarkdownEditor.svelte';
  import { isFullEdition } from './lib/edition';
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
  } from './lib/tauri';
  import { applyNativeWindowEffects, resizeWindowForDrawer } from './lib/window';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import {
    defaultSettings,
    type AppSettings,
    type DocumentTab,
    type EditorMode,
    type FileDocument,
    type SessionState,
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
  type DrawerPanel = 'files' | 'outline' | 'recent';
  let tabs = $state<DocumentTab[]>([initialTab]);
  let activeId = $state(initialTab.id);
  let mode = $state<EditorMode>('source');
  let isMacPlatform = $state(false);
  let preview = $state('');
  let sidebarOpen = $state(false);
  let drawerOverlay = $state(false);
  let drawerPanel = $state<DrawerPanel>('files');
  let workspaceRoot = $state('');
  let workspaceFiles = $state<WorkspaceEntry[]>([]);
  let filter = $state('');
  let status = $state('Ready');
  let settings = $state<AppSettings>(defaultSettings);
  let settingsOpen = $state(false);
  let paletteOpen = $state(false);
  let conflictOpen = $state(false);
  let conflictTabId = $state<string | null>(null);
  let recentFiles = $state<string[]>([]);
  let recentWorkspaces = $state<string[]>([]);
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  let activeTab = $derived(tabs.find((tab) => tab.id === activeId) ?? tabs[0]);
  let filteredFiles = $derived(
    workspaceFiles.filter((file) => file.relativePath.toLowerCase().includes(filter.toLowerCase()))
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

  $effect(() => {
    const content = activeTab?.content ?? '';
    renderMarkdown(content).then((html) => (preview = html));
  });

  $effect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.glass = settings.glassEffects;
    document.documentElement.style.setProperty('--editor-font-size', `${settings.fontSize}px`);
    void applyNativeWindowEffects(settings.glassEffects, settings.theme !== 'light');
  });

  onMount(() => {
    isMacPlatform = navigator.userAgent.includes('Macintosh');
    void restoreState();
    pollTimer = setInterval(() => void checkExternalChanges(), 2000);
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && sidebarOpen && drawerOverlay) {
        void setSidebarOpen(false);
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
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
      } else if (event.key.toLowerCase() === 'b' && event.shiftKey) {
        event.preventDefault();
        void setSidebarOpen(!sidebarOpen);
      } else if (event.key.toLowerCase() === 'p' && event.shiftKey) {
        event.preventDefault();
        paletteOpen = true;
      }
    };
    window.addEventListener('keydown', onKeydown);
    let unlisten: (() => void) | undefined;
    if (isDesktop()) {
      void import('@tauri-apps/api/event').then(async ({ listen }) => {
        const menuUnlisten = await listen<string>('native-menu-command', ({ payload }) => {
          if (payload === 'new-document') newDocument();
          else if (payload === 'open-document') void openFile();
          else if (payload === 'save-document') void saveActive(false);
          else if (payload === 'command-palette') paletteOpen = true;
          else if (payload === 'settings') settingsOpen = true;
          else if (payload === 'editor-view') mode = 'source';
          else if (payload === 'preview-view') mode = 'preview';
          else if (payload === 'toggle-sidebar') void setSidebarOpen(!sidebarOpen);
        });
        const openUnlisten = await listen<string[]>('open-paths', ({ payload }) => {
          for (const path of payload) void openWorkspaceFile(path);
        });
        unlisten = () => {
          menuUnlisten();
          openUnlisten();
        };
        for (const path of await takePendingOpenPaths()) void openWorkspaceFile(path);
      });
      void import('@tauri-apps/api/webviewWindow').then(async ({ getCurrentWebviewWindow }) => {
        const unlistenDrop = await getCurrentWebviewWindow().onDragDropEvent((event) => {
          if (event.payload.type !== 'drop') return;
          for (const path of event.payload.paths) void openWorkspaceFile(path);
        });
        const previousUnlisten = unlisten;
        unlisten = () => {
          previousUnlisten?.();
          unlistenDrop();
        };
      });
    }
    return () => {
      window.removeEventListener('keydown', onKeydown);
      if (pollTimer) clearInterval(pollTimer);
      unlisten?.();
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

  function updateContent(content: string) {
    tabs = tabs.map((tab) => (tab.id === activeId ? { ...tab, content } : tab));
    schedulePersistence();
  }

  function updateSelection(selection: { anchor: number; head: number }) {
    tabs = tabs.map((tab) => (tab.id === activeId ? { ...tab, selection } : tab));
  }

  function newDocument() {
    const tab = createTab();
    tabs = [...tabs, tab];
    activeId = tab.id;
    status = 'New document';
  }

  function addDocument(document: FileDocument) {
    const existing = tabs.find((tab) => tab.path === document.path);
    if (existing) {
      activeId = existing.id;
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
      workspaceRoot = workspace.root;
      workspaceFiles = workspace.entries;
      if (!sidebarOpen) await setSidebarOpen(true);
      status = `${workspace.entries.length} Markdown files found`;
      recentWorkspaces = remember(recentWorkspaces, workspace.root);
      schedulePersistence();
    } catch (error) {
      status = readableError(error);
    }
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

  async function saveActive(saveAs = false) {
    if (!activeTab) return;
    if (!isDesktop()) {
      status = 'Native saving is available in the desktop app';
      return;
    }
    try {
      const path =
        saveAs || !activeTab.path ? await chooseSavePath(activeTab.path) : activeTab.path;
      if (!path) return;
      const fingerprint = await writeDocument(
        path,
        activeTab.content,
        activeTab.fingerprint,
        false
      );
      const name = path.split(/[\\/]/).at(-1) ?? activeTab.name;
      tabs = tabs.map((tab) =>
        tab.id === activeId
          ? { ...tab, path, name, savedContent: tab.content, fingerprint, conflict: false }
          : tab
      );
      status = `Saved ${name}`;
      recentFiles = remember(recentFiles, path);
      schedulePersistence();
    } catch (error) {
      if (readableError(error).includes('changed on disk')) {
        tabs = tabs.map((tab) => (tab.id === activeId ? { ...tab, conflict: true } : tab));
        conflictTabId = activeId;
        conflictOpen = true;
        status = 'Save paused: file changed outside Tuxedo MD';
      } else status = readableError(error);
    }
  }

  function closeTab(id: string) {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (tab && tab.content !== tab.savedContent && !settings.keepDraftsSilently) {
      const discard = confirm(
        `Discard the unsaved draft for ${tab.name}?\nChoose Cancel to keep it available when Tuxedo MD reopens.`
      );
      if (discard) void deleteState(`draft-${id}`);
      else void saveState(`draft-${id}`, tab);
    }
    if (tab && (settings.keepDraftsSilently || tab.content !== tab.savedContent)) {
      void saveState(`draft-${id}`, tab);
    }
    if (tabs.length === 1) {
      const replacement = createTab();
      tabs = [replacement];
      activeId = replacement.id;
      return;
    }
    const index = tabs.findIndex((tab) => tab.id === id);
    tabs = tabs.filter((tab) => tab.id !== id);
    if (activeId === id) activeId = tabs[Math.max(0, index - 1)].id;
  }

  function schedulePersistence() {
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => void persistSession(), 500);
    const tab = activeTab;
    if (!settings.autosave || !tab?.path || tab.conflict || tab.content === tab.savedContent)
      return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => void saveActive(false), settings.autosaveDelayMs);
  }

  async function persistSession() {
    try {
      await saveState('settings', settings);
      const session: SessionState = {
        version: 1,
        activeId,
        mode,
        workspaceRoot,
        tabs,
        recentFiles,
        recentWorkspaces,
      };
      await saveState('session', session);
      for (const tab of tabs.filter(
        (item) => !item.path || item.content !== item.savedContent || item.conflict
      )) {
        await saveState(`draft-${tab.id}`, tab);
      }
    } catch {
      /* Browser preview has no native state store. */
    }
  }

  async function restoreState() {
    if (!isDesktop()) return;
    try {
      const loadedSettings = await loadState<AppSettings>('settings');
      if (loadedSettings?.version === 1) settings = { ...defaultSettings, ...loadedSettings };
      const session = await loadState<SessionState>('session');
      if (!session || session.version !== 1 || !settings.restoreSession || !session.tabs.length)
        return;
      tabs = session.tabs;
      activeId =
        session.activeId && session.tabs.some((tab) => tab.id === session.activeId)
          ? session.activeId
          : session.tabs[0].id;
      // Older sessions may have used the now-retired side-by-side layout.
      mode = session.mode === 'split' ? 'source' : session.mode;
      workspaceRoot = session.workspaceRoot;
      recentFiles = session.recentFiles ?? [];
      recentWorkspaces = session.recentWorkspaces ?? [];
      status = 'Session restored';
    } catch {
      status = 'Started fresh: saved session could not be restored';
    }
  }

  async function checkExternalChanges() {
    if (!isDesktop()) return;
    for (const tab of tabs.filter((item) => item.path && !item.conflict)) {
      try {
        const disk = await probeDocument(tab.path!);
        if (disk.fingerprint.hash === tab.fingerprint?.hash) continue;
        if (tab.content === tab.savedContent) {
          tabs = tabs.map((item) =>
            item.id === tab.id
              ? {
                  ...item,
                  content: disk.content,
                  savedContent: disk.content,
                  fingerprint: disk.fingerprint,
                }
              : item
          );
          status = `${tab.name} reloaded from disk`;
        } else {
          tabs = tabs.map((item) => (item.id === tab.id ? { ...item, conflict: true } : item));
          conflictTabId = tab.id;
          conflictOpen = true;
        }
      } catch {
        /* Deleted/unavailable files remain recoverable drafts. */
      }
    }
  }

  async function resolveConflict(action: 'reload' | 'keep') {
    const tab = tabs.find((item) => item.id === conflictTabId);
    if (!tab?.path) return;
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
        const fingerprint = await writeDocument(tab.path, tab.content, tab.fingerprint, true);
        tabs = tabs.map((item) =>
          item.id === tab.id
            ? { ...item, savedContent: item.content, fingerprint, conflict: false }
            : item
        );
      }
      conflictOpen = false;
      conflictTabId = null;
      schedulePersistence();
    } catch (error) {
      status = readableError(error);
    }
  }

  function remember(items: string[], value: string) {
    return [value, ...items.filter((item) => item !== value)].slice(0, 20);
  }

  function readableError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function handleDrag(e: MouseEvent) {
    if (
      e.button === 0 &&
      e.target instanceof Element &&
      e.target.closest('[data-tauri-drag-region]') &&
      !e.target.closest('button, input, [data-tauri-no-drag]') &&
      isDesktop()
    ) {
      try {
        void getCurrentWindow().startDragging();
      } catch {
        // Ignore errors if Tauri API fails
      }
    }
  }
</script>

<svelte:head><title>Tuxedo MD</title></svelte:head>
<svelte:window onmousedown={handleDrag} />

<div class="app-shell">
  <header class:mac-titlebar={isMacPlatform} class="titlebar" data-tauri-drag-region>
    <div class="brand" data-tauri-drag-region>
      <div class="brand-mark"><BookOpenText size={18} /></div>
      {#if !isMacPlatform}
        <span>Tuxedo MD</span>
      {/if}
      <span class:pro={isFullEdition} class="edition">{isFullEdition ? 'PRO' : 'CE'}</span>
    </div>

    <div class="titlebar-tabs" data-tauri-drag-region>
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

    <div class="toolbar">
      <button
        class:active={sidebarOpen}
        class="icon-button"
        title="Toggle tools"
        aria-label="Toggle tools"
        aria-expanded={sidebarOpen}
        onclick={() => void setSidebarOpen(!sidebarOpen)}><PanelLeftOpen /></button
      >
      <button class="icon-button" title="New document" onclick={newDocument}><FilePlus2 /></button>
      <button class="icon-button" title="Open file" onclick={openFile}><FolderOpen /></button>
      <button class="icon-button" title="Save" onclick={() => saveActive(false)}><Save /></button>
      <span class="toolbar-divider"></span>
      <div class="titlebar-mode-toggle" aria-label="Editor mode">
        <button class:active={mode === 'source'} onclick={() => (mode = 'source')} title="Editor"
          >Editor</button
        >
        <button class:active={mode === 'split'} onclick={() => (mode = 'split')} title="Split view"
          >Split</button
        >
        <button class:active={mode === 'preview'} onclick={() => (mode = 'preview')} title="Preview"
          >Preview</button
        >
      </div>
      <span class="toolbar-divider"></span>
      <button class="icon-button" title="Settings" onclick={() => (settingsOpen = true)}
        ><Settings2 /></button
      >
      <button class="icon-button" title="Command palette" onclick={() => (paletteOpen = true)}
        >⌘</button
      >
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
          <button class="open-workspace" onclick={openWorkspace}
            ><FolderOpen /> Open workspace</button
          >
          <label class="search-box">
            <Search />
            <input bind:value={filter} placeholder="Filter files" />
          </label>
          <nav class="file-list" aria-label="Workspace files">
            {#each filteredFiles as file (file.path)}
              <button onclick={() => openWorkspaceFile(file.path)} title={file.relativePath}>
                <span>{file.name}</span><small>{file.relativePath}</small>
              </button>
            {:else}
              <p class="empty-state">
                {workspaceRoot ? 'No matching Markdown files.' : 'Open a folder to begin.'}
              </p>
            {/each}
          </nav>
        {:else if drawerPanel === 'outline'}
          <nav class="outline-list drawer-list" aria-label="Document outline">
            {#each outline as item (item.line)}
              <button
                style={`--outline-level:${item.level}`}
                onclick={() => {
                  status = `Heading: ${item.title}`;
                }}
                title={`Line ${item.line}`}>{item.title}</button
              >
            {:else}<p class="empty-state">No headings in this document.</p>{/each}
          </nav>
        {:else}
          <nav class="outline-list drawer-list" aria-label="Recent files">
            {#each recentFiles as path (path)}<button onclick={() => openWorkspaceFile(path)}
                >{path.split(/[\\/]/).at(-1)}</button
              >{:else}<p class="empty-state">No recent files yet.</p>{/each}
          </nav>
        {/if}
      </aside>
    {/if}

    <main class="main-area">
      <section class:split-layout={mode === 'split'} class="editor-grid">
        {#if mode !== 'preview'}
          <div class:nowrap={!settings.lineWrap} class="source-pane">
            <MarkdownEditor
              documentId={activeTab?.id ?? 'empty'}
              value={activeTab?.content ?? ''}
              onchange={updateContent}
              onselectionchange={updateSelection}
            />
          </div>
        {/if}
        {#if mode !== 'source'}
          <article class="preview-pane">
            <!-- Preview HTML is produced by rehype-sanitize in src/lib/preview.ts. -->
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="markdown-body">{@html preview}</div>
          </article>
        {/if}
      </section>

      <footer class="statusbar">
        <span>{status}</span>
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
      if (event.target === event.currentTarget) settingsOpen = false;
    }}
  >
    <dialog open class="settings-modal" aria-label="Settings">
      <header>
        <h2>Settings</h2>
        <button class="icon-button" onclick={() => (settingsOpen = false)}><X /></button>
      </header>
      <label
        >Theme <select bind:value={settings.theme}
          ><option value="system">System</option><option value="dark">Dark</option><option
            value="light">Light</option
          ><option value="contrast">High contrast</option></select
        ></label
      >
      <label
        >Glass effects <select bind:value={settings.glassEffects}
          ><option value="system">Follow system</option><option value="on">Always on</option><option
            value="off">Off</option
          ></select
        ></label
      >
      <label
        >Editor font size <input type="range" min="12" max="22" bind:value={settings.fontSize} />
        {settings.fontSize}px</label
      >
      <label><input type="checkbox" bind:checked={settings.lineWrap} /> Wrap editor lines</label>
      <label
        ><input type="checkbox" bind:checked={settings.autosave} /> Autosave existing files</label
      >
      <label
        >Autosave delay <select bind:value={settings.autosaveDelayMs}
          ><option value={500}>0.5 seconds</option><option value={1500}>1.5 seconds</option><option
            value={3000}>3 seconds</option
          ></select
        ></label
      >
      <label
        ><input type="checkbox" bind:checked={settings.restoreSession} /> Restore full session</label
      >
      <label
        ><input type="checkbox" bind:checked={settings.keepDraftsSilently} /> Keep untitled drafts silently
        when closing</label
      >
      <p>Recovery drafts stay locally in your operating system's app-data folder.</p>
    </dialog>
  </div>
{/if}

{#if conflictOpen}
  <div class="modal-backdrop">
    <dialog open class="settings-modal" aria-label="External file conflict">
      <h2>File changed outside Tuxedo MD</h2>
      <p>Autosave is paused to protect both versions.</p>
      <div class="modal-actions">
        <button onclick={() => resolveConflict('reload')}>Reload disk version</button><button
          class="primary"
          onclick={() => resolveConflict('keep')}>Keep my version</button
        >
      </div>
    </dialog>
  </div>
{/if}

{#if paletteOpen}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) paletteOpen = false;
    }}
  >
    <dialog open class="settings-modal command-palette" aria-label="Command palette">
      <header>
        <h2>Command palette</h2>
        <button class="icon-button" onclick={() => (paletteOpen = false)}><X /></button>
      </header>
      <button
        onclick={() => {
          newDocument();
          paletteOpen = false;
        }}>New document <kbd>⌘N</kbd></button
      >
      <button
        onclick={() => {
          void openFile();
          paletteOpen = false;
        }}>Open file <kbd>⌘O</kbd></button
      >
      <button
        onclick={() => {
          void saveActive(false);
          paletteOpen = false;
        }}>Save document <kbd>⌘S</kbd></button
      >
      <button
        onclick={() => {
          settingsOpen = true;
          paletteOpen = false;
        }}>Open settings</button
      >
      <button
        onclick={() => {
          mode = 'source';
          paletteOpen = false;
        }}>Show editor <kbd>⌘⇧E</kbd></button
      >
      <button
        onclick={() => {
          mode = 'preview';
          paletteOpen = false;
        }}>Show preview <kbd>⌘⇧V</kbd></button
      >
    </dialog>
  </div>
{/if}
