<script lang="ts">
  import { X } from '@lucide/svelte';
  import { isTabDirty } from '../tab-lifecycle';
  import type { DocumentTab } from '../types';

  let {
    tabs = [],
    activeId = null,
    isWindowsChrome = false,
    onselect,
    onclose,
    onnew,
  }: {
    tabs: DocumentTab[];
    activeId: string | null;
    isWindowsChrome?: boolean;
    onselect: (id: string) => void;
    onclose: (id: string) => void;
    onnew: () => void;
  } = $props();
</script>

<div
  class="titlebar-tabs"
  role="tablist"
  aria-label="Document tabs"
  data-tauri-drag-region={isWindowsChrome ? undefined : true}
>
  {#each tabs as tab (tab.id)}
    {@const dirty = isTabDirty(tab)}
    <div class:active={tab.id === activeId} class="titlebar-tab" role="presentation">
      <button
        class="tab-select"
        role="tab"
        aria-selected={tab.id === activeId}
        onclick={() => onselect(tab.id)}
      >
        <span
          class:dirty
          title={tab.conflict
            ? `${tab.name} (conflict with disk)`
            : tab.recovered
              ? `${tab.name} (recovered draft)`
              : undefined}>{tab.name}{tab.conflict ? ' !' : tab.recovered ? ' •' : ''}</span
        >
      </button>
      <button
        class="tab-close"
        title={`Close ${tab.name}`}
        aria-label={`Close ${tab.name}`}
        onclick={(event) => {
          event.stopPropagation();
          onclose(tab.id);
        }}
      >
        <X />
      </button>
    </div>
  {/each}
  <button class="titlebar-new-tab" onclick={onnew} title="New tab" aria-label="New tab">+</button>
</div>
