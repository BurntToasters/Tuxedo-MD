<script lang="ts">
  import { onMount } from 'svelte';
  import { X } from '@lucide/svelte';
  import { handleDismissibleDialogKeydown } from '../focus';

  let {
    title = '',
    label = '',
    value = $bindable(''),
    open = false,
    onsubmit,
    oncancel,
  }: {
    title?: string;
    label?: string;
    value?: string;
    open?: boolean;
    onsubmit: (value: string) => void;
    oncancel: () => void;
  } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let inputElement: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      queueMicrotask(() => {
        inputElement?.focus();
        inputElement?.select();
      });
    } else if (!open && dialog?.open) {
      dialog.close();
    }
  });

  onMount(() => {
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      queueMicrotask(() => {
        inputElement?.focus();
        inputElement?.select();
      });
    }
  });
</script>

{#if open}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) oncancel();
    }}
  >
    <dialog
      bind:this={dialog}
      class="settings-modal"
      aria-modal="true"
      aria-labelledby="name-prompt-title"
      onkeydown={(event) => handleDismissibleDialogKeydown(event, oncancel)}
      oncancel={(event) => {
        event.preventDefault();
        oncancel();
      }}
    >
      <header>
        <h2 id="name-prompt-title">{title}</h2>
        <button class="icon-button" aria-label="Cancel" onclick={oncancel}>
          <X />
        </button>
      </header>
      <form
        class="name-prompt-form"
        onsubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onsubmit(value);
        }}
      >
        <label class="name-prompt-label" for="name-prompt-input">{label}</label>
        <input
          id="name-prompt-input"
          class="name-prompt-input"
          bind:this={inputElement}
          bind:value
        />
        <p class="settings-note">A .md extension is added automatically when omitted.</p>
        <div class="modal-actions">
          <button type="button" onclick={oncancel}>Cancel</button>
          <button class="primary" type="submit" disabled={!value.trim()}>Save</button>
        </div>
      </form>
    </dialog>
  </div>
{/if}
