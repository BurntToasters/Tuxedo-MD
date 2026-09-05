<script lang="ts">
  import { Search, X } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';
  import { focusedElement, restoreFocus, trapDialogFocus } from '../focus';
  import { formatShortcut } from '../shortcuts';

  type CommandPaletteItem = {
    id: string;
    label: string;
    description: string;
    section: string;
    keywords?: string;
    shortcut?: string;
    run: () => void;
  };

  type Props = {
    commands: CommandPaletteItem[];
    onclose: () => void;
  };

  let { commands, onclose }: Props = $props();
  let query = $state('');
  let selectedIndex = $state(0);
  let searchInput = $state<HTMLInputElement | null>(null);
  let returnFocus: HTMLElement | null = null;

  let filteredCommands = $derived.by(() => {
    const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return commands;

    return commands.filter((command) => {
      const searchable = [
        command.label,
        command.description,
        command.section,
        command.keywords ?? '',
      ]
        .join(' ')
        .toLocaleLowerCase();
      return tokens.every((token) => searchable.includes(token));
    });
  });
  let selectedCommand = $derived(filteredCommands[selectedIndex] ?? null);

  onMount(() => {
    returnFocus = focusedElement();
    void tick().then(() => searchInput?.focus());

    return () => {
      restoreFocus(returnFocus);
    };
  });

  function revealSelected() {
    const selected = filteredCommands[selectedIndex];
    if (!selected) return;
    document
      .getElementById(`command-palette-option-${selected.id}`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }

  function updateQuery(event: Event) {
    const input = (event.currentTarget ?? event.target) as HTMLInputElement | null;
    query = input?.value ?? '';
    selectedIndex = 0;
    void tick().then(revealSelected);
  }

  function selectIndex(index: number) {
    const count = filteredCommands.length;
    if (!count) return;
    selectedIndex = (index + count) % count;
    void tick().then(revealSelected);
  }

  async function execute(command = selectedCommand) {
    if (!command) return;
    onclose();
    await tick();
    command.run();
  }

  function handleDialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onclose();
      return;
    }
    if (event.currentTarget instanceof HTMLDialogElement) {
      trapDialogFocus(event);
    }
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectIndex(selectedIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectIndex(selectedIndex - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void execute();
    }
  }
</script>

<div
  class="modal-backdrop command-palette-backdrop"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) onclose();
  }}
>
  <dialog
    open
    class="settings-modal command-palette"
    aria-modal="true"
    aria-labelledby="command-palette-title"
    onkeydown={handleDialogKeydown}
  >
    <header class="command-palette-header">
      <div>
        <span class="command-palette-eyebrow">Quick actions</span>
        <h2 id="command-palette-title">Command palette</h2>
      </div>
      <button class="icon-button" type="button" aria-label="Close command palette" onclick={onclose}
        ><X /></button
      >
    </header>

    <label class="command-palette-search" for="command-palette-input">
      <Search aria-hidden="true" />
      <input
        id="command-palette-input"
        bind:this={searchInput}
        value={query}
        type="search"
        role="combobox"
        aria-label="Search commands"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls="command-palette-results"
        aria-activedescendant={selectedCommand
          ? `command-palette-option-${selectedCommand.id}`
          : undefined}
        placeholder="Search commands…"
        autocomplete="off"
        spellcheck={false}
        oninput={updateQuery}
        onkeydown={handleSearchKeydown}
      />
      <kbd>{formatShortcut({ mod: true, shift: true, key: 'p' })}</kbd>
    </label>

    <div
      id="command-palette-results"
      class="command-palette-results"
      role="listbox"
      aria-label="Available commands"
    >
      {#if filteredCommands.length}
        {#each filteredCommands as command, index (command.id)}
          {#if index === 0 || command.section !== filteredCommands[index - 1].section}
            <div class="command-palette-section" role="presentation">{command.section}</div>
          {/if}
          <button
            id={`command-palette-option-${command.id}`}
            type="button"
            role="option"
            tabindex="-1"
            aria-selected={index === selectedIndex}
            class:active={index === selectedIndex}
            onmouseenter={() => (selectedIndex = index)}
            onclick={() => void execute(command)}
          >
            <span class="command-palette-copy">
              <strong>{command.label}</strong>
              <small>{command.description}</small>
            </span>
            {#if command.shortcut}<kbd>{command.shortcut}</kbd>{/if}
          </button>
        {/each}
      {:else}
        <div class="command-palette-empty" role="status">
          <strong>No matching commands</strong>
          <span>Try searching for a file, view, workspace, or setting action.</span>
        </div>
      {/if}
    </div>

    <footer class="command-palette-footer" aria-hidden="true">
      <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
      <span><kbd>↵</kbd> Run</span>
      <span><kbd>Esc</kbd> Close</span>
    </footer>
  </dialog>
</div>
