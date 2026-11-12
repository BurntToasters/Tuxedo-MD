<script lang="ts">
  import { onMount } from 'svelte';
  import { X } from '@lucide/svelte';
  import { handleDismissibleDialogKeydown } from '../focus';
  import {
    THEME_TOKEN_KEYS,
    THEME_TOKEN_LABELS,
    isThemeColor,
    normalizeThemePackage,
    tokensFromElement,
    type ThemePackage,
    type ThemeTokens,
  } from '../theme-package';

  let {
    open = false,
    initial = null,
    onsave,
    onreset,
    onimport,
    onexport,
    onclose,
  }: {
    open?: boolean;
    initial?: ThemePackage | null;
    onsave: (pkg: ThemePackage) => void | Promise<void>;
    onreset: () => void | Promise<void>;
    onimport: () => Promise<ThemePackage | null>;
    onexport: (pkg: ThemePackage) => void | Promise<void>;
    onclose: () => void;
  } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let nameInput: HTMLInputElement | undefined = $state();
  let draftName = $state('Custom');
  let draftTokens = $state<ThemeTokens>(tokensFromElement(document.documentElement));
  let draftCss = $state('');
  let formError = $state('');
  let busy = $state(false);
  let seeded = false;

  function show() {
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      queueMicrotask(() => nameInput?.focus());
    } else if (!open && dialog?.open) {
      dialog.close();
    }
  }

  $effect(() => {
    if (!open) {
      seeded = false;
      return;
    }
    if (seeded) return;
    seeded = true;
    const source = initial ?? {
      version: 1 as const,
      name: 'Custom',
      tokens: tokensFromElement(document.documentElement),
      css: '',
    };
    draftName = source.name;
    draftTokens = { ...source.tokens };
    draftCss = source.css;
    formError = '';
  });

  $effect(show);
  onMount(show);

  function previewStyle(tokens: ThemeTokens): string {
    const parts = [
      'background:var(--canvas)',
      'color:var(--text)',
      'border:1px solid var(--border)',
      'border-radius:8px',
      'padding:10px',
    ];
    for (const key of THEME_TOKEN_KEYS) {
      const value = tokens[key]?.trim() ?? '';
      if (isThemeColor(value)) parts.push(`--${key}:${value}`);
    }
    return parts.join(';');
  }

  function draftPackage(): ThemePackage | null {
    return normalizeThemePackage({
      version: 1,
      name: draftName,
      tokens: draftTokens,
      css: draftCss,
    });
  }

  function savePackage() {
    const pkg = draftPackage();
    if (!pkg) {
      formError =
        'Enter a name plus hex or rgb colors. Custom CSS cannot use imports, scripts, or external images.';
      return;
    }
    formError = '';
    void onsave(pkg);
  }

  async function resetPackage() {
    if (busy) return;
    busy = true;
    try {
      await onreset();
    } catch {
      return;
    } finally {
      busy = false;
    }
    draftName = 'Custom';
    draftTokens = tokensFromElement(document.documentElement);
    draftCss = '';
    formError = '';
  }

  async function importPackage() {
    if (busy) return;
    busy = true;
    try {
      const pkg = await onimport();
      if (!pkg) return;
      draftName = pkg.name;
      draftTokens = { ...pkg.tokens };
      draftCss = pkg.css;
      formError = '';
    } finally {
      busy = false;
    }
  }

  async function exportPackage() {
    if (busy) return;
    const pkg = draftPackage();
    if (!pkg) {
      formError =
        'Enter a name plus hex or rgb colors. Custom CSS cannot use imports, scripts, or external images.';
      return;
    }
    formError = '';
    busy = true;
    try {
      await onexport(pkg);
    } finally {
      busy = false;
    }
  }

  function setToken(key: (typeof THEME_TOKEN_KEYS)[number], event: Event) {
    const target = event.currentTarget;
    if (target instanceof HTMLInputElement) draftTokens[key] = target.value;
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
      style="width: min(480px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 48px)); overflow: auto;"
      aria-modal="true"
      aria-labelledby="theme-studio-title"
      aria-busy={busy}
      onkeydown={(event) => handleDismissibleDialogKeydown(event, onclose)}
      oncancel={(event) => {
        event.preventDefault();
        onclose();
      }}
    >
      <header>
        <h2 id="theme-studio-title">Theme Studio</h2>
        <button class="icon-button" type="button" aria-label="Close" onclick={onclose}>
          <X />
        </button>
      </header>
      <form
        class="name-prompt-form"
        onsubmit={(event) => {
          event.preventDefault();
          if (!busy) savePackage();
        }}
      >
        <p id="theme-preview-label">Preview</p>
        <div aria-labelledby="theme-preview-label" style={previewStyle(draftTokens)}>
          <strong style="color: var(--accent)">{draftName || 'Theme'}</strong>
          <p style="margin: 4px 0 0; color: var(--text)">Sample text on the canvas.</p>
          <p style="margin: 4px 0 0; color: var(--text-muted)">
            Muted and <span style="color: var(--text-subtle)">subtle</span> text.
          </p>
          <span
            style="display: inline-block; margin-top: 8px; padding: 2px 8px; border: 1px solid var(--border-muted); border-radius: 999px; background: var(--accent-muted); color: var(--accent);"
          >
            Accent
          </span>
        </div>
        <label class="name-prompt-label" for="theme-package-name">Theme name</label>
        <input
          id="theme-package-name"
          class="name-prompt-input"
          bind:this={nameInput}
          bind:value={draftName}
          maxlength="80"
          autocomplete="off"
          spellcheck="false"
          disabled={busy}
        />
        {#each THEME_TOKEN_KEYS as key (key)}
          <label class="name-prompt-label" for="theme-token-{key}">{THEME_TOKEN_LABELS[key]}</label>
          <input
            id="theme-token-{key}"
            class="name-prompt-input"
            type="text"
            value={draftTokens[key]}
            autocomplete="off"
            spellcheck="false"
            disabled={busy}
            oninput={(event) => setToken(key, event)}
          />
        {/each}
        <label class="name-prompt-label" for="theme-custom-css">Custom CSS</label>
        <textarea
          id="theme-custom-css"
          class="name-prompt-input"
          rows="6"
          bind:value={draftCss}
          spellcheck="false"
          disabled={busy}
        ></textarea>
        <p>
          Custom CSS applies under .theme-custom. Imports, scripts, and external images are
          rejected.
        </p>
        {#if formError}
          <p role="alert">{formError}</p>
        {/if}
        <div class="modal-actions">
          <button type="button" disabled={busy} onclick={() => void importPackage()}>Import</button>
          <button type="button" disabled={busy} onclick={() => void exportPackage()}>Export</button>
          <button type="button" disabled={busy} onclick={() => void resetPackage()}>Reset</button>
          <button class="primary" type="submit" disabled={busy}>Save</button>
        </div>
      </form>
    </dialog>
  </div>
{/if}
