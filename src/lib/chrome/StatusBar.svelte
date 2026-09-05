<script lang="ts">
  let {
    status = '',
    editionWarning = null,
    content = '',
  }: {
    status?: string;
    editionWarning?: string | null;
    content?: string;
  } = $props();

  let stats = $derived.by(() => {
    const text = content;
    const length = text.length;
    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    return { length, words };
  });
</script>

<footer class="statusbar" aria-label="Editor status">
  <span role="status" aria-live="polite"
    >{editionWarning ? `${status} · ${editionWarning}` : status}</span
  >
  <span aria-label="Document statistics">{stats.length} characters · {stats.words} words</span>
</footer>
