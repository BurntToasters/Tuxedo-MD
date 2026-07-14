<script lang="ts">
  import {
    BookOpenText,
    Check,
    Columns2,
    FilePlus2,
    FolderOpen,
    PanelLeftClose,
    PanelLeftOpen,
    Save,
    Search,
    Settings2,
    Sparkles,
    X,
  } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import MarkdownEditor from './lib/editor/MarkdownEditor.svelte';
  import { editionLabel, isFullEdition } from './lib/edition';
  import { renderMarkdown } from './lib/preview';
  import {
    chooseDocument,
    chooseSavePath,
    chooseWorkspace,
    isDesktop,
    readDocument,
    writeDocument,
  } from './lib/tauri';
  import type { DocumentTab, EditorMode, FileDocument, WorkspaceEntry } from './lib/types';

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
  let tabs = $state<DocumentTab[]>([initialTab]);
  let activeId = $state(initialTab.id);
  let mode = $state<EditorMode>('split');
  let preview = $state('');
  let sidebarOpen = $state(true);
  let workspaceRoot = $state('');
  let workspaceFiles = $state<WorkspaceEntry[]>([]);
  let filter = $state('');
  let status = $state('Ready');

  let activeTab = $derived(tabs.find((tab) => tab.id === activeId) ?? tabs[0]);
  let filteredFiles = $derived(
    workspaceFiles.filter((file) => file.relativePath.toLowerCase().includes(filter.toLowerCase()))
  );

  $effect(() => {
    const content = activeTab?.content ?? '';
    renderMarkdown(content).then((html) => (preview = html));
  });

  onMount(() => {
    const onKeydown = (event: KeyboardEvent) => {
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
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });

  function createTab(name = 'Untitled.md', content = '', path: string | null = null): DocumentTab {
    return { id: crypto.randomUUID(), name, path, content, savedContent: content };
  }

  function updateContent(content: string) {
    tabs = tabs.map((tab) => (tab.id === activeId ? { ...tab, content } : tab));
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
    const tab = createTab(document.name, document.content, document.path);
    tabs = [...tabs, tab];
    activeId = tab.id;
    status = `Opened ${document.name}`;
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
      sidebarOpen = true;
      status = `${workspace.entries.length} Markdown files found`;
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
      await writeDocument(path, activeTab.content);
      const name = path.split(/[\\/]/).at(-1) ?? activeTab.name;
      tabs = tabs.map((tab) =>
        tab.id === activeId ? { ...tab, path, name, savedContent: tab.content } : tab
      );
      status = `Saved ${name}`;
    } catch (error) {
      status = readableError(error);
    }
  }

  function closeTab(id: string) {
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

  function readableError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
</script>

<svelte:head><title>Tuxedo MD</title></svelte:head>

<div class="app-shell">
  <header class="titlebar" data-tauri-drag-region>
    <div class="brand" data-tauri-drag-region>
      <div class="brand-mark"><BookOpenText size={18} /></div>
      <span>Tuxedo MD</span>
      <span class:pro={isFullEdition} class="edition">{editionLabel}</span>
    </div>

    <div class="toolbar">
      <button class="icon-button" title="New document" onclick={newDocument}><FilePlus2 /></button>
      <button class="icon-button" title="Open file" onclick={openFile}><FolderOpen /></button>
      <button class="icon-button" title="Save" onclick={() => saveActive(false)}><Save /></button>
      <span class="toolbar-divider"></span>
      <div class="mode-switcher" aria-label="Editor layout">
        <button class:active={mode === 'source'} onclick={() => (mode = 'source')} title="Source"
          >MD</button
        >
        <button class:active={mode === 'split'} onclick={() => (mode = 'split')} title="Split view"
          ><Columns2 /></button
        >
        <button class:active={mode === 'preview'} onclick={() => (mode = 'preview')} title="Preview"
          ><Sparkles /></button
        >
      </div>
      <button class="icon-button" title="Settings"><Settings2 /></button>
    </div>
  </header>

  <div class="workspace">
    {#if sidebarOpen}
      <aside class="sidebar">
        <div class="sidebar-heading">
          <div>
            <span>Workspace</span>
            <strong
              >{workspaceRoot
                ? (workspaceRoot.split(/[\\/]/).at(-1) ?? 'Folder')
                : 'No folder open'}</strong
            >
          </div>
          <button
            class="icon-button quiet"
            onclick={() => (sidebarOpen = false)}
            title="Hide sidebar"><PanelLeftClose /></button
          >
        </div>
        <button class="open-workspace" onclick={openWorkspace}><FolderOpen /> Open workspace</button
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
        <div class="sidebar-upgrade">
          <Sparkles />
          <div>
            <strong>Workspace intelligence</strong><span
              >{isFullEdition ? 'Pro features enabled' : 'Backlinks, graphs, and more in Pro'}</span
            >
          </div>
          {#if isFullEdition}<Check class="enabled" />{/if}
        </div>
      </aside>
    {:else}
      <button class="sidebar-restore" onclick={() => (sidebarOpen = true)} title="Show sidebar"
        ><PanelLeftOpen /></button
      >
    {/if}

    <main class="main-area">
      <div class="tabs">
        {#each tabs as tab (tab.id)}
          <div class:active={tab.id === activeId} class="tab">
            <button class="tab-select" onclick={() => (activeId = tab.id)}>
              <span class:dirty={tab.content !== tab.savedContent}>{tab.name}</span>
            </button>
            <button
              class="tab-close"
              title={`Close ${tab.name}`}
              onclick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}><X /></button
            >
          </div>
        {/each}
        <button class="new-tab" onclick={newDocument} title="New tab">+</button>
      </div>

      <section
        class:source-only={mode === 'source'}
        class:preview-only={mode === 'preview'}
        class="editor-grid"
      >
        {#if mode !== 'preview'}
          <div class="source-pane">
            <div class="pane-label">Markdown</div>
            <MarkdownEditor value={activeTab?.content ?? ''} onchange={updateContent} />
          </div>
        {/if}
        {#if mode !== 'source'}
          <article class="preview-pane">
            <div class="pane-label">Preview</div>
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
