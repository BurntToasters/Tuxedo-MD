<script lang="ts">
  import { basicSetup } from 'codemirror';
  import { markdown } from '@codemirror/lang-markdown';
  import { EditorState } from '@codemirror/state';
  import { EditorView, keymap } from '@codemirror/view';
  import { defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { onMount } from 'svelte';

  let { value = '', onchange }: { value?: string; onchange: (value: string) => void } = $props();
  let host: HTMLDivElement;
  let view: EditorView | undefined;
  let localValue = $state('');

  onMount(() => {
    localValue = value;
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          markdown(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            localValue = update.state.doc.toString();
            onchange(localValue);
          }),
        ],
      }),
    });

    return () => view?.destroy();
  });

  $effect(() => {
    if (!view || value === localValue) return;
    localValue = value;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  });
</script>

<div class="editor-host" bind:this={host}></div>
