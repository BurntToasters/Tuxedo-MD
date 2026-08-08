<script lang="ts">
  import { Maximize2, Minimize2, Minus, X } from '@lucide/svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  let { onclose }: { onclose: () => void } = $props();

  let maximized = $state(false);

  function stopChromeCapture(event: Event) {
    event.stopPropagation();
  }

  async function refreshMaximized() {
    try {
      maximized = await getCurrentWindow().isMaximized();
    } catch (error) {
      console.error('isMaximized failed', error);
    }
  }

  $effect(() => {
    const window = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void refreshMaximized();
    void window
      .onResized(() => {
        void refreshMaximized();
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((error) => console.error('onResized failed', error));
    return () => unlisten?.();
  });

  function minimize(event: PointerEvent) {
    if (event.button !== 0) return;
    stopChromeCapture(event);
    event.preventDefault();
    void getCurrentWindow()
      .minimize()
      .catch((error) => console.error('minimize failed', error));
  }

  function toggleMaximize(event: PointerEvent) {
    if (event.button !== 0) return;
    stopChromeCapture(event);
    event.preventDefault();
    void getCurrentWindow()
      .toggleMaximize()
      .then(() => refreshMaximized())
      .catch((error) => console.error('toggleMaximize failed', error));
  }

  function close(event: PointerEvent) {
    if (event.button !== 0) return;
    stopChromeCapture(event);
    event.preventDefault();
    onclose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="window-controls"
  data-tauri-no-drag
  onmousedown={stopChromeCapture}
  onpointerdown={stopChromeCapture}
>
  <button
    type="button"
    class="window-control"
    title="Minimize"
    aria-label="Minimize"
    data-tauri-no-drag
    onpointerdown={minimize}
  >
    <Minus size={11} strokeWidth={2.25} />
  </button>
  <button
    type="button"
    class="window-control"
    title={maximized ? 'Restore' : 'Maximize'}
    aria-label={maximized ? 'Restore' : 'Maximize'}
    data-tauri-no-drag
    onpointerdown={toggleMaximize}
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
    data-tauri-no-drag
    onpointerdown={close}
  >
    <X size={11} strokeWidth={2.25} />
  </button>
</div>
