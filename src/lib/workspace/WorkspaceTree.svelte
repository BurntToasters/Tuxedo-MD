<script lang="ts">
  import { ChevronDown, ChevronRight, FileText, FolderClosed, FolderOpen } from '@lucide/svelte';
  import type { FlatWorkspaceNode } from '../workspace-tree';

  let {
    rows,
    activePath = null,
    onopen,
    ontoggle,
    oncontextaction,
  }: {
    rows: FlatWorkspaceNode[];
    activePath?: string | null;
    onopen: (node: FlatWorkspaceNode) => void;
    ontoggle: (node: FlatWorkspaceNode) => void;
    oncontextaction?: (action: 'rename' | 'delete' | 'new', node: FlatWorkspaceNode) => void;
  } = $props();

  let focusedId = $state<string | null>(null);

  // Keep the roving tabindex anchored to a row that still exists after refiltering.
  let tabbableId = $derived(
    rows.some((row) => row.id === focusedId) ? focusedId : (rows[0]?.id ?? null)
  );

  function focusRow(index: number, element: HTMLElement) {
    const target = rows[index];
    if (!target) return;
    focusedId = target.id;
    const container = element.closest('[role="tree"]');
    const next = container?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(target.id)}"]`);
    next?.focus();
  }

  function handleKeydown(event: KeyboardEvent, node: FlatWorkspaceNode, index: number) {
    const element = event.currentTarget as HTMLElement;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusRow(index + 1, element);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusRow(index - 1, element);
        break;
      case 'Home':
        event.preventDefault();
        focusRow(0, element);
        break;
      case 'End':
        event.preventDefault();
        focusRow(rows.length - 1, element);
        break;
      case 'ArrowRight':
        if (node.kind === 'directory' && !node.expanded) {
          event.preventDefault();
          ontoggle(node);
        } else if (node.kind === 'directory') {
          event.preventDefault();
          focusRow(index + 1, element);
        }
        break;
      case 'ArrowLeft':
        if (node.kind === 'directory' && node.expanded) {
          event.preventDefault();
          ontoggle(node);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (node.kind === 'directory') ontoggle(node);
        else onopen(node);
        break;
      case 'F2':
        if (node.kind === 'file' && oncontextaction) {
          event.preventDefault();
          oncontextaction('rename', node);
        }
        break;
      case 'Delete':
        if (node.kind === 'file' && oncontextaction) {
          event.preventDefault();
          oncontextaction('delete', node);
        }
        break;
      default:
        break;
    }
  }
</script>

<div class="workspace-tree" role="tree" aria-label="Workspace files">
  {#each rows as row, index (row.id)}
    <div
      class="tree-row"
      class:is-directory={row.kind === 'directory'}
      class:is-active={row.kind === 'file' && row.path === activePath}
      role="none"
      style={`--tree-depth:${row.depth}`}
      title={row.id}
    >
      <div
        class="tree-item"
        role="treeitem"
        aria-level={row.depth + 1}
        aria-selected={row.kind === 'file' && row.path === activePath}
        aria-expanded={row.kind === 'directory' ? row.expanded : undefined}
        tabindex={row.id === tabbableId ? 0 : -1}
        data-row-id={row.id}
        onkeydown={(event) => handleKeydown(event, row, index)}
        onfocus={() => (focusedId = row.id)}
        onclick={() => (row.kind === 'directory' ? ontoggle(row) : onopen(row))}
        ondblclick={() => row.kind === 'file' && onopen(row)}
      >
        <span class="tree-twisty" aria-hidden="true">
          {#if row.kind === 'directory'}
            {#if row.expanded}<ChevronDown size={13} />{:else}<ChevronRight size={13} />{/if}
          {/if}
        </span>
        <span class="tree-icon" aria-hidden="true">
          {#if row.kind === 'directory'}
            {#if row.expanded}<FolderOpen size={13} />{:else}<FolderClosed size={13} />{/if}
          {:else}
            <FileText size={13} />
          {/if}
        </span>
        <span class="tree-label">{row.name}</span>
      </div>
      {#if oncontextaction}
        <span class="tree-actions">
          {#if row.kind === 'file'}
            <button
              type="button"
              title={`Rename ${row.name}`}
              aria-label={`Rename ${row.name}`}
              onclick={(event) => {
                event.stopPropagation();
                oncontextaction?.('rename', row);
              }}>Rename</button
            >
            <button
              type="button"
              title={`Delete ${row.name}`}
              aria-label={`Delete ${row.name}`}
              onclick={(event) => {
                event.stopPropagation();
                oncontextaction?.('delete', row);
              }}>Delete</button
            >
          {:else}
            <button
              type="button"
              title={`New document in ${row.name}`}
              aria-label={`New document in ${row.name}`}
              onclick={(event) => {
                event.stopPropagation();
                oncontextaction?.('new', row);
              }}>New</button
            >
          {/if}
        </span>
      {/if}
    </div>
  {:else}
    <p class="empty-state">No matching Markdown files.</p>
  {/each}
</div>
