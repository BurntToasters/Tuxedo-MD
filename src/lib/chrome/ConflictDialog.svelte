<script lang="ts">
  import { onMount } from 'svelte';
  import { trapDialogFocus } from '../focus';

  let {
    open = false,
    tabName = null,
    onresolve,
    ondismiss,
  }: {
    open?: boolean;
    tabName?: string | null;
    onresolve: (action: 'reload' | 'keep') => void;
    ondismiss: () => void;
  } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let initialFocusButton: HTMLButtonElement | undefined = $state();

  $effect(() => {
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      queueMicrotask(() => initialFocusButton?.focus());
    } else if (!open && dialog?.open) {
      dialog.close();
    }
  });

  onMount(() => {
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      queueMicrotask(() => initialFocusButton?.focus());
    }
  });
</script>

{#if open}
  <div class="modal-backdrop" role="presentation">
    <dialog
      bind:this={dialog}
      class="settings-modal"
      aria-modal="true"
      aria-labelledby="conflict-title"
      onkeydown={trapDialogFocus}
      oncancel={(event) => {
        event.preventDefault();
        ondismiss();
      }}
    >
      <h2 id="conflict-title">File changed outside Tuxedo MD</h2>
      <p>
        {#if tabName}
          "{tabName}" changed on disk. Autosave is paused to protect both versions.
        {:else}
          Autosave is paused to protect both versions.
        {/if}
      </p>
      <div class="modal-actions">
        <button bind:this={initialFocusButton} onclick={() => onresolve('reload')}>
          Reload disk version
        </button>
        <button class="primary" onclick={() => onresolve('keep')}> Keep my version </button>
      </div>
    </dialog>
  </div>
{/if}
