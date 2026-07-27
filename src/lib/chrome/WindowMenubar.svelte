<script lang="ts">
  import {
    buildEditMenu,
    buildFileMenu,
    buildViewMenu,
    type MenuCommandId,
    type MenuEntry,
  } from '../menu-commands';

  type MenuName = 'File' | 'Edit' | 'View';

  let { oncommand }: { oncommand: (id: MenuCommandId) => void } = $props();

  const menuGroups = $derived([
    { name: 'File' as const, entries: buildFileMenu() },
    { name: 'Edit' as const, entries: buildEditMenu() },
    { name: 'View' as const, entries: buildViewMenu() },
  ]);

  let openMenu = $state<MenuName | null>(null);
  let dropdownStyle = $state('');
  let menuBarActive = $state(false);

  function positionDropdown(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return;
    const rect = target.getBoundingClientRect();
    dropdownStyle = `top:${rect.bottom + 2}px;left:${rect.left}px;`;
  }

  function openAt(name: MenuName, target: EventTarget | null) {
    openMenu = name;
    positionDropdown(target);
  }

  function closeMenus() {
    openMenu = null;
    menuBarActive = false;
  }

  function onTriggerClick(name: MenuName, event: MouseEvent) {
    event.preventDefault();
    if (openMenu === name && menuBarActive) {
      closeMenus();
      return;
    }
    menuBarActive = true;
    openAt(name, event.currentTarget);
  }

  function onTriggerEnter(name: MenuName, event: MouseEvent) {
    if (!menuBarActive || openMenu === name) return;
    openAt(name, event.currentTarget);
  }

  function run(id: MenuCommandId) {
    closeMenus();
    oncommand(id);
  }

  function onItem(entry: MenuEntry) {
    if (entry.type === 'item') run(entry.id);
  }

  function onWindowPointerDown(event: MouseEvent) {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('.window-controls, .window-control')) return;
    if (!event.target.closest('.window-menubar')) closeMenus();
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeMenus();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />

<nav class="window-menubar" aria-label="Application menu" data-tauri-no-drag>
  {#each menuGroups as group (group.name)}
    <div class="menubar-group">
      <button
        type="button"
        class="menubar-trigger"
        class:open={openMenu === group.name}
        aria-haspopup="menu"
        aria-expanded={openMenu === group.name}
        onclick={(event) => onTriggerClick(group.name, event)}
        onmouseenter={(event) => onTriggerEnter(group.name, event)}>{group.name}</button
      >
      {#if openMenu === group.name}
        <div class="menubar-dropdown" role="menu" style={dropdownStyle}>
          {#each group.entries as entry, index (group.name + index)}
            {#if entry.type === 'separator'}
              <div class="menubar-separator" role="separator"></div>
            {:else}
              <button
                type="button"
                class="menubar-item"
                role="menuitem"
                onclick={() => onItem(entry)}
              >
                <span>{entry.label}</span>
                {#if entry.shortcut}<kbd>{entry.shortcut}</kbd>{/if}
              </button>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</nav>
