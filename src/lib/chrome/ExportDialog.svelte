<script lang="ts">
  import { onMount } from 'svelte';
  import { X } from '@lucide/svelte';
  import { handleDismissibleDialogKeydown } from '../focus';
  import type { ExportProfile } from '../export-document';

  let {
    open = false,
    profile,
    busy = false,
    onprofile,
    onclose,
    onexport,
    onprint,
  }: {
    open?: boolean;
    profile: ExportProfile;
    busy?: boolean;
    onprofile: (profile: ExportProfile) => void;
    onclose: () => void;
    onexport: () => void;
    onprint: () => void;
  } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let pageSizeSelect: HTMLSelectElement | undefined = $state();

  function show() {
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      queueMicrotask(() => pageSizeSelect?.focus());
    } else if (!open && dialog?.open) {
      dialog.close();
    }
  }

  $effect(show);

  onMount(show);

  function fieldValue(event: Event): string {
    const target = event.currentTarget;
    return target instanceof HTMLSelectElement ? target.value : '';
  }

  function selectPageSize(event: Event) {
    const pageSize = fieldValue(event);
    if (pageSize !== 'letter' && pageSize !== 'a4') return;
    onprofile({ ...profile, pageSize });
  }

  function selectMargin(event: Event) {
    const margin = fieldValue(event);
    if (margin !== 'narrow' && margin !== 'normal' && margin !== 'wide') return;
    onprofile({ ...profile, margin });
  }

  function selectTheme(event: Event) {
    const themeId = fieldValue(event);
    if (themeId !== 'dark' && themeId !== 'light' && themeId !== 'contrast') return;
    onprofile({ ...profile, themeId });
  }
</script>

{#if open}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) onclose();
    }}
  >
    <dialog
      bind:this={dialog}
      class="settings-modal"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
      aria-busy={busy}
      onkeydown={(event) => handleDismissibleDialogKeydown(event, onclose)}
      oncancel={(event) => {
        event.preventDefault();
        onclose();
      }}
    >
      <header>
        <h2 id="export-dialog-title">Export HTML</h2>
        <button class="icon-button" type="button" aria-label="Close" onclick={onclose}>
          <X />
        </button>
      </header>
      <form
        class="name-prompt-form"
        onsubmit={(event) => {
          event.preventDefault();
          if (!busy) onexport();
        }}
      >
        <label class="name-prompt-label" for="export-page-size">Page size</label>
        <div class="select-wrapper">
          <select
            id="export-page-size"
            bind:this={pageSizeSelect}
            value={profile.pageSize}
            disabled={busy}
            onchange={selectPageSize}
          >
            <option value="letter">Letter</option>
            <option value="a4">A4</option>
          </select>
        </div>
        <label class="name-prompt-label" for="export-margin">Margin</label>
        <div class="select-wrapper">
          <select id="export-margin" value={profile.margin} disabled={busy} onchange={selectMargin}>
            <option value="narrow">Narrow</option>
            <option value="normal">Normal</option>
            <option value="wide">Wide</option>
          </select>
        </div>
        <label class="name-prompt-label" for="export-theme">Theme</label>
        <div class="select-wrapper">
          <select id="export-theme" value={profile.themeId} disabled={busy} onchange={selectTheme}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="contrast">High contrast</option>
          </select>
        </div>
        <div class="modal-actions">
          <button type="button" disabled={busy} onclick={onprint}>Print</button>
          <button class="primary" type="submit" disabled={busy}>Export HTML</button>
        </div>
      </form>
    </dialog>
  </div>
{/if}
