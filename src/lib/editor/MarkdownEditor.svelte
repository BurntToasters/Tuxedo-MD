<script lang="ts">
  import { basicSetup } from 'codemirror';
  import { markdown } from '@codemirror/lang-markdown';
  import { EditorState } from '@codemirror/state';
  import { EditorView, keymap } from '@codemirror/view';
  import { defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';

  const states = new SvelteMap<string, EditorState>();
  let {
    documentId,
    value = '',
    onchange,
    onselectionchange,
  }: {
    documentId: string;
    value?: string;
    onchange: (value: string) => void;
    onselectionchange: (selection: { anchor: number; head: number }) => void;
  } = $props();
  let host: HTMLDivElement;
  let view: EditorView | undefined;
  let localValue = $state('');
  let currentId = '';

  function createState(content: string) {
    return EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        markdown(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) {
            onselectionchange({
              anchor: update.state.selection.main.anchor,
              head: update.state.selection.main.head,
            });
          }
          if (!update.docChanged) return;
          localValue = update.state.doc.toString();
          onchange(localValue);
        }),
      ],
    });
  }

  onMount(() => {
    localValue = value;
    currentId = documentId;
    view = new EditorView({
      parent: host,
      state: states.get(documentId) ?? createState(value),
    });

    return () => view?.destroy();
  });

  $effect(() => {
    if (!view) return;
    if (documentId !== currentId) {
      states.set(currentId, view.state);
      currentId = documentId;
      const next = states.get(documentId) ?? createState(value);
      localValue = next.doc.toString();
      view.setState(next);
      return;
    }
    if (value === localValue) return;
    localValue = value;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  });
</script>

<div class="editor-host" bind:this={host}></div>
