<script lang="ts">
  import {
    FilePlus2,
    FolderOpen,
    History,
    Link2,
    ListTree,
    RefreshCw,
    Search,
    Sparkles,
    X,
  } from '@lucide/svelte';
  import WorkspaceTree from '../workspace/WorkspaceTree.svelte';
  import type { FlatWorkspaceNode } from '../workspace-tree';
  import type { LinkGraph } from '../link-graph';
  import type { SearchMatch } from '../types';

  let {
    sidebarOpen = false,
    drawerOverlay = false,
    drawerPanel = $bindable('files'),
    workspaceRoot = '',
    filter = $bindable(''),
    treeRows = [],
    activePath = null,
    activeTabName = null,
    activeRelativePath = '',
    canSearchWorkspace = false,
    showReferencePanel = false,
    canUseBacklinks = false,
    canUseTags = false,
    canInspectWorkspace = false,
    searchQuery = $bindable(''),
    searchCaseSensitive = $bindable(false),
    searchRunning = false,
    searchSubmitted = false,
    searchTruncated = false,
    groupedSearchResults = [],
    referencesLoading = false,
    linkGraph = null,
    activeBacklinks = [],
    tagCounts = [],
    outline = [],
    recentFiles = [],
    recentWorkspaces = [],
    onclose,
    onopenworkspace,
    oncreatedocument,
    onrefreshworkspace,
    onopenworkspacefile,
    ontoggledirectory,
    ontreeaction,
    onsearch,
    onopenandreveal,
    onrefreshreferences,
    onopenworkspacerelative,
    onsearchfortag,
    onrevealoutlineitem,
    onopenrecentworkspace,
    capabilityMessage,
  }: {
    sidebarOpen?: boolean;
    drawerOverlay?: boolean;
    drawerPanel?: 'files' | 'search' | 'links' | 'outline' | 'recent';
    workspaceRoot?: string;
    filter?: string;
    treeRows?: FlatWorkspaceNode[];
    activePath?: string | null;
    activeTabName?: string | null;
    activeRelativePath?: string | null;
    canSearchWorkspace?: boolean;
    showReferencePanel?: boolean;
    canUseBacklinks?: boolean;
    canUseTags?: boolean;
    canInspectWorkspace?: boolean;
    searchQuery?: string;
    searchCaseSensitive?: boolean;
    searchRunning?: boolean;
    searchSubmitted?: boolean;
    searchTruncated?: boolean;
    groupedSearchResults?: Array<{ relativePath: string; matches: SearchMatch[] }>;
    referencesLoading?: boolean;
    linkGraph?: LinkGraph | null;
    activeBacklinks?: string[];
    tagCounts?: Array<{ tag: string; count: number }>;
    outline?: Array<{ level: number; title: string; line: number }>;
    recentFiles?: string[];
    recentWorkspaces?: string[];
    onclose: () => void;
    onopenworkspace: () => void;
    oncreatedocument: (directory: string) => void;
    onrefreshworkspace: () => void;
    onopenworkspacefile: (path: string) => void;
    ontoggledirectory: (node: FlatWorkspaceNode) => void;
    ontreeaction: (action: 'rename' | 'delete' | 'new', node: FlatWorkspaceNode) => void;
    onsearch: () => void;
    onopenandreveal: (path: string, line: number) => void;
    onrefreshreferences: () => void;
    onopenworkspacerelative: (path: string) => void;
    onsearchfortag: (tag: string) => void;
    onrevealoutlineitem: (item: { title: string; line: number }) => void;
    onopenrecentworkspace: (root: string) => void;
    capabilityMessage: (cap: 'workspaceSearch') => string;
  } = $props();
</script>

{#if sidebarOpen}
  {#if drawerOverlay}
    <button class="drawer-backdrop" aria-label="Close tools" onclick={onclose}></button>
  {/if}
  <aside class:overlay={drawerOverlay} class="sidebar" aria-label="Workspace tools">
    <div class="sidebar-heading">
      <div>
        <span>Tools</span>
        <strong>{drawerPanel}</strong>
      </div>
      <button class="icon-button quiet" onclick={onclose} title="Hide tools"><X /></button>
    </div>
    <div class="drawer-tabs" role="tablist" aria-label="Tool panels">
      <button
        role="tab"
        aria-selected={drawerPanel === 'files'}
        class:active={drawerPanel === 'files'}
        onclick={() => (drawerPanel = 'files')}><FolderOpen /> Files</button
      >
      {#if canSearchWorkspace}
        <button
          role="tab"
          aria-selected={drawerPanel === 'search'}
          class:active={drawerPanel === 'search'}
          onclick={() => (drawerPanel = 'search')}><Search /> Search</button
        >
      {/if}
      {#if showReferencePanel}
        <button
          role="tab"
          aria-selected={drawerPanel === 'links'}
          class:active={drawerPanel === 'links'}
          onclick={() => (drawerPanel = 'links')}><Link2 /> Links</button
        >
      {/if}
      <button
        role="tab"
        aria-selected={drawerPanel === 'outline'}
        class:active={drawerPanel === 'outline'}
        onclick={() => (drawerPanel = 'outline')}><ListTree /> Outline</button
      >
      <button
        role="tab"
        aria-selected={drawerPanel === 'recent'}
        class:active={drawerPanel === 'recent'}
        onclick={() => (drawerPanel = 'recent')}><History /> Recent</button
      >
    </div>
    {#if drawerPanel === 'files'}
      <p class="drawer-context">
        {workspaceRoot ? (workspaceRoot.split(/[\\/]/).at(-1) ?? 'Workspace') : 'No workspace open'}
      </p>
      <div class="workspace-actions">
        <button class="open-workspace" onclick={onopenworkspace}>
          <FolderOpen /> Open workspace
        </button>
        {#if workspaceRoot}
          <button
            class="icon-button"
            title="New document in this workspace"
            aria-label="New document in this workspace"
            onclick={() => oncreatedocument('')}><FilePlus2 /></button
          >
          <button
            class="icon-button"
            title="Refresh workspace"
            aria-label="Refresh workspace"
            onclick={onrefreshworkspace}><RefreshCw /></button
          >
        {/if}
      </div>
      <label class="search-box">
        <Search />
        <input
          type="search"
          aria-label="Filter files"
          bind:value={filter}
          placeholder="Filter files"
        />
      </label>
      <div class="file-list">
        {#if workspaceRoot}
          <WorkspaceTree
            rows={treeRows}
            {activePath}
            onopen={(node) => node.path && onopenworkspacefile(node.path)}
            ontoggle={ontoggledirectory}
            oncontextaction={ontreeaction}
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
          onsearch();
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
                  onclick={() => onopenandreveal(match.path, match.line)}
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
          <button class="open-workspace" onclick={onrefreshreferences}>
            Analyze workspace links
          </button>
        {:else}
          <button class="open-workspace" onclick={onrefreshreferences}>
            <RefreshCw /> Re-analyze
          </button>
          {#if canUseBacklinks}
            <h3 class="recent-heading">
              Backlinks{activeRelativePath ? ` to ${activeTabName}` : ''}
            </h3>
            <nav class="outline-list" aria-label="Backlinks">
              {#each activeBacklinks as source (source)}
                <button onclick={() => onopenworkspacerelative(source)} title={source}
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
                  onclick={() => onsearchfortag(item.tag)}
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
                  onclick={() => onopenworkspacerelative(item.from)}
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
                <button onclick={() => onopenworkspacerelative(path)} title={path}>{path}</button>
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
            onclick={() => onrevealoutlineitem(item)}
            title={`Line ${item.line}`}>{item.title}</button
          >
        {:else}<p class="empty-state">No headings in this document.</p>{/each}
      </nav>
    {:else}
      <div class="recent-groups drawer-list">
        <h3 class="recent-heading">Files</h3>
        <nav class="outline-list" aria-label="Recent files">
          {#each recentFiles as path (path)}
            <button onclick={() => onopenworkspacefile(path)} title={path}>
              {path.split(/[\\/]/).at(-1)}
            </button>
          {:else}<p class="empty-state">No recent files yet.</p>{/each}
        </nav>
        <h3 class="recent-heading">Workspaces</h3>
        <nav class="outline-list" aria-label="Recent workspaces">
          {#each recentWorkspaces as root (root)}
            <button onclick={() => onopenrecentworkspace(root)} title={root}>
              {root.split(/[\\/]/).at(-1) || root}
            </button>
          {:else}<p class="empty-state">No recent workspaces yet.</p>{/each}
        </nav>
      </div>
    {/if}
  </aside>
{/if}
