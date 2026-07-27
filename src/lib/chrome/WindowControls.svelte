<script lang="ts">
  import { Maximize2, Minimize2, Minus, X } from '@lucide/svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  let { onclose }: { onclose: () => void } = $props();

  let maximized = $state(false);

  function stopDrag(event: MouseEvent) {
    event.stopPropagation();
  }

  async function refreshMaximized() {
    maximized = await getCurrentWindow().isMaximized();
  }

  $effect(() => {
    const window = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void refreshMaximized();
    void window
      .onResized(() => refreshMaximized())
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  });

  function minimize(event: MouseEvent) {
    stopDrag(event);
    void getCurrentWindow().minimize();
  }

  function toggleMaximize(event: MouseEvent) {
    stopDrag(event);
    void getCurrentWindow()
      .toggleMaximize()
      .then(() => refreshMaximized())
      .catch((error) => console.error('toggleMaximize failed', error));
  }

  function close(event: MouseEvent) {
    stopDrag(event);
    onclose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="window-controls" data-tauri-no-drag onmousedown={stopDrag} onpointerdown={stopDrag}>
  <button
    type="button"
    class="window-control"
    title="Minimize"
    aria-label="Minimize"
    onclick={minimize}
  >
    <Minus size={11} strokeWidth={2.25} />
  </button>
  <button
    type="button"
    class="window-control"
    title={maximized ? 'Restore' : 'Maximize'}
    aria-label={maximized ? 'Restore' : 'Maximize'}
    onclick={toggleMaximize}
  >
    {#if maximized}
      <Minimize2 size={10} strokeWidth={2.25} />
    {:else}
      <Maximize2 size={10} strokeWidth={2.25} />
    {/if}
  </button>
  <button
    type="button"
    class="window-control close"
    title="Close"
    aria-label="Close"
    onclick={close}
  >
    <X size={11} strokeWidth={2.25} />
  </button>
</div>
