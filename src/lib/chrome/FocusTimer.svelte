<script lang="ts">
  import { onMount } from 'svelte';
  import { X } from '@lucide/svelte';
  import { handleDismissibleDialogKeydown } from '../focus';
  import {
    MAX_FOCUS_MINUTES,
    MIN_FOCUS_MINUTES,
    normalizeFocusPreset,
    normalizeFocusPresets,
    type FocusPreset,
  } from '../focus-presets';

  export interface FocusSessionView {
    name: string;
    goal: string;
    finished: boolean;
    running: boolean;
    remainingText: string;
  }

  let {
    open = false,
    presets = [],
    session = null,
    onclose,
    onsave,
    onbegin,
    onresume,
    onpause,
    onstop,
  }: {
    open?: boolean;
    presets?: FocusPreset[];
    session?: FocusSessionView | null;
    onclose: () => void;
    onsave: (presets: FocusPreset[]) => void;
    onbegin: (preset: FocusPreset) => string | null;
    onresume: () => void;
    onpause: () => void;
    onstop: () => void;
  } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let nameInput: HTMLInputElement | undefined = $state();
  let drafts = $state<FocusPreset[]>([]);
  let selectedId = $state('');
  let draftName = $state('');
  let draftGoal = $state('');
  let minutesInput = $state('25');
  let draftFocusMode = $state(false);
  let formError = $state('');
  let seeded = false;

  function show() {
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      queueMicrotask(() => nameInput?.focus());
    } else if (!open && dialog?.open) {
      dialog.close();
    }
  }

  function blankPreset(): FocusPreset {
    return {
      id: crypto.randomUUID(),
      name: 'Focus',
      goal: '',
      minutes: 25,
      focusMode: false,
    };
  }

  function loadPreset(preset: FocusPreset) {
    selectedId = preset.id;
    draftName = preset.name;
    draftGoal = preset.goal;
    minutesInput = String(preset.minutes);
    draftFocusMode = preset.focusMode;
  }

  $effect(() => {
    if (!open) {
      seeded = false;
      return;
    }
    if (seeded) return;
    seeded = true;
    formError = '';
    drafts = presets.map((preset) => ({ ...preset }));
    if (!drafts.length) drafts = [blankPreset()];
    loadPreset(drafts[0]);
  });

  $effect(show);
  onMount(show);

  function wholeMinutes(value: string): number | null {
    if (!/^\d+$/.test(value.trim())) return null;
    const minutes = Number(value.trim());
    if (minutes < MIN_FOCUS_MINUTES || minutes > MAX_FOCUS_MINUTES) return null;
    return minutes;
  }

  function checkedPreset(): { preset: FocusPreset } | { error: string } {
    const name = draftName.trim();
    if (!name) return { error: 'A preset name is required' };
    const minutes = wholeMinutes(minutesInput);
    if (minutes === null) {
      return { error: 'Minutes must be a whole number from 1 to 180' };
    }
    const id = selectedId || crypto.randomUUID();
    const preset = normalizeFocusPreset({
      id,
      name,
      goal: draftGoal.trim(),
      minutes,
      focusMode: draftFocusMode,
    });
    if (!preset) return { error: 'That focus preset is not valid' };
    selectedId = preset.id;
    return { preset };
  }

  function replaceDraft(preset: FocusPreset): FocusPreset[] {
    if (!drafts.some((item) => item.id === preset.id)) return [...drafts, preset];
    return drafts.map((item) => (item.id === preset.id ? preset : item));
  }

  function savePresets() {
    const checked = checkedPreset();
    if ('error' in checked) {
      formError = checked.error;
      return;
    }
    drafts = replaceDraft(checked.preset);
    formError = '';
    onsave(normalizeFocusPresets(drafts));
  }

  function beginPreset() {
    const checked = checkedPreset();
    if ('error' in checked) {
      formError = checked.error;
      return;
    }
    drafts = replaceDraft(checked.preset);
    formError = '';
    onsave(normalizeFocusPresets(drafts));
    const message = onbegin(checked.preset);
    if (message) formError = message;
  }

  function selectPreset(event: Event) {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) return;
    const checked = checkedPreset();
    if ('error' in checked) {
      formError = checked.error;
      target.value = selectedId;
      return;
    }
    drafts = replaceDraft(checked.preset);
    const next = drafts.find((preset) => preset.id === target.value);
    if (!next) return;
    formError = '';
    loadPreset(next);
  }

  function addPreset() {
    if (selectedId || draftName.trim()) {
      const checked = checkedPreset();
      if ('error' in checked) {
        formError = checked.error;
        return;
      }
      drafts = replaceDraft(checked.preset);
    }
    const preset = blankPreset();
    drafts = [...drafts, preset];
    formError = '';
    loadPreset(preset);
  }

  function deletePreset() {
    if (!selectedId) return;
    drafts = drafts.filter((preset) => preset.id !== selectedId);
    onsave(normalizeFocusPresets(drafts));
    formError = '';
    if (drafts.length) {
      loadPreset(drafts[0]);
      return;
    }
    selectedId = '';
    draftName = '';
    draftGoal = '';
    minutesInput = '25';
    draftFocusMode = false;
  }

  function fieldValue(event: Event): string {
    const target = event.currentTarget;
    return target instanceof HTMLInputElement ? target.value : '';
  }
</script>

{#if session}
  <div class="focus-timer-bar" role="region" aria-label="Focus timer">
    <span>{session.name}</span>
    {#if session.goal}
      <span class="focus-timer-goal">{session.goal}</span>
    {/if}
    {#if !session.finished}
      <span>Remaining</span>
    {/if}
    <strong
      role="timer"
      aria-label={session.finished ? 'Finished' : `${session.remainingText} remaining`}
    >
      {session.remainingText}
    </strong>
    <button type="button" onclick={onresume} disabled={session.running}>Start</button>
    <button type="button" onclick={onpause} disabled={!session.running}>Pause</button>
    <button type="button" onclick={onstop}>Stop</button>
  </div>
{/if}

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
      style="width: min(440px, calc(100vw - 32px)); max-height: min(640px, calc(100vh - 48px)); overflow: auto;"
      aria-modal="true"
      aria-labelledby="focus-timer-title"
      onkeydown={(event) => handleDismissibleDialogKeydown(event, onclose)}
      oncancel={(event) => {
        event.preventDefault();
        onclose();
      }}
    >
      <header>
        <h2 id="focus-timer-title">Focus Timer</h2>
        <button class="icon-button" type="button" aria-label="Close" onclick={onclose}>
          <X />
        </button>
      </header>
      <form
        class="name-prompt-form"
        onsubmit={(event) => {
          event.preventDefault();
          beginPreset();
        }}
      >
        <label class="name-prompt-label" for="focus-preset-choice">Preset</label>
        <div class="select-wrapper">
          <select id="focus-preset-choice" value={selectedId} onchange={selectPreset}>
            {#each drafts as preset (preset.id)}
              <option value={preset.id}>{preset.name}</option>
            {/each}
          </select>
        </div>
        <label class="name-prompt-label" for="focus-preset-name">Name</label>
        <input
          id="focus-preset-name"
          class="name-prompt-input"
          bind:this={nameInput}
          value={draftName}
          maxlength="80"
          oninput={(event) => (draftName = fieldValue(event))}
        />
        <label class="name-prompt-label" for="focus-preset-goal">Goal</label>
        <input
          id="focus-preset-goal"
          class="name-prompt-input"
          value={draftGoal}
          maxlength="200"
          oninput={(event) => (draftGoal = fieldValue(event))}
        />
        <label class="name-prompt-label" for="focus-preset-minutes">Minutes</label>
        <input
          id="focus-preset-minutes"
          class="name-prompt-input"
          inputmode="numeric"
          value={minutesInput}
          maxlength="3"
          oninput={(event) => (minutesInput = fieldValue(event))}
        />
        <label class="name-prompt-label" for="focus-preset-focus-mode">Turn on focus mode</label>
        <input id="focus-preset-focus-mode" type="checkbox" bind:checked={draftFocusMode} />
        {#if formError}
          <p class="settings-note" role="alert">{formError}</p>
        {/if}
        <div class="modal-actions">
          <button type="button" onclick={addPreset}>New preset</button>
          <button type="button" disabled={!selectedId} onclick={deletePreset}>Delete preset</button>
          <button type="button" onclick={savePresets}>Save preset</button>
          <button class="primary" type="submit">Start</button>
        </div>
      </form>
    </dialog>
  </div>
{/if}

<style>
  .focus-timer-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    padding: 6px 12px;
    border-top: 1px solid var(--border-muted);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
  }

  .focus-timer-goal {
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .focus-timer-bar strong {
    min-width: 4.5rem;
    font-variant-numeric: tabular-nums;
  }

  .focus-timer-bar button {
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--canvas-inset);
    color: var(--text);
    cursor: pointer;
  }

  .focus-timer-bar button:disabled {
    cursor: default;
    opacity: 0.55;
  }
</style>
