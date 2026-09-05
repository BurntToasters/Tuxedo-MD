<script lang="ts">
  import { markdown } from '@codemirror/lang-markdown';
  import { EditorState } from '@codemirror/state';
  import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLineGutter,
    highlightSpecialChars,
    drawSelection,
    dropCursor,
    rectangularSelection,
    highlightActiveLine,
  } from '@codemirror/view';
  import {
    foldGutter,
    indentOnInput,
    syntaxHighlighting,
    defaultHighlightStyle,
    bracketMatching,
    foldKeymap,
    indentUnit,
  } from '@codemirror/language';
  import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
  import {
    autocompletion,
    completionKeymap,
    closeBrackets,
    closeBracketsKeymap,
  } from '@codemirror/autocomplete';
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import {
    Bold,
    Italic,
    Heading,
    Quote,
    Code,
    Link,
    List,
    ListOrdered,
    ListTodo,
  } from '@lucide/svelte';

  const states = new SvelteMap<string, EditorState>();
  let {
    documentId,
    value = '',
    selection = { anchor: 0, head: 0 },
    showLineNumbers = true,
    tabSize = 4,
    spellcheck = false,
    lineWrap = true,
    visible = true,
    retainedDocumentIds = [],
    findRequest = 0,
    revealRequest = null,
    onchange,
    onselectionchange,
  }: {
    documentId: string;
    value?: string;
    selection?: { anchor: number; head: number };
    showLineNumbers?: boolean;
    tabSize?: number;
    spellcheck?: boolean;
    lineWrap?: boolean;
    visible?: boolean;
    retainedDocumentIds?: string[];
    findRequest?: number;
    revealRequest?: { line: number; token: number } | null;
    onchange: (value: string) => void;
    onselectionchange: (selection: { anchor: number; head: number }) => void;
  } = $props();
  let host: HTMLDivElement;
  let view: EditorView | undefined;
  let localValue = $state('');
  let currentId = '';

  let lastSln: boolean | undefined = undefined;
  let lastTs: number | undefined = undefined;
  let lastSc: boolean | undefined = undefined;
  let lastLw: boolean | undefined = undefined;
  let lastVisible: boolean | undefined = undefined;
  let lastFindRequest = 0;
  let lastRevealToken = 0;

  function clampSelection(content: string, next: { anchor: number; head: number }) {
    const max = content.length;
    return {
      anchor: Math.max(0, Math.min(next.anchor, max)),
      head: Math.max(0, Math.min(next.head, max)),
    };
  }

  function createState(content: string, selectionRange?: { anchor: number; head: number }) {
    const ext = [
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      markdown(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      indentUnit.of(' '.repeat(tabSize)),
      EditorView.contentAttributes.of({ spellcheck: spellcheck ? 'true' : 'false' }),
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
    ];

    if (lineWrap) ext.push(EditorView.lineWrapping);

    if (showLineNumbers) {
      ext.push(lineNumbers());
      ext.push(highlightActiveLineGutter());
      ext.push(foldGutter());
    }

    return EditorState.create({
      doc: content,
      selection: selectionRange ? clampSelection(content, selectionRange) : undefined,
      extensions: ext,
    });
  }

  function insertFormat(
    type:
      | 'bold'
      | 'italic'
      | 'heading'
      | 'quote'
      | 'code'
      | 'link'
      | 'list'
      | 'ordered-list'
      | 'task-list'
  ) {
    if (!view) return;
    const { state, dispatch } = view;
    const { anchor, head } = state.selection.main;
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    const selectedText = state.doc.sliceString(from, to);

    let replacement = '';
    let cursorOffset = 0;

    switch (type) {
      case 'bold':
        replacement = `**${selectedText || 'bold text'}**`;
        cursorOffset = selectedText ? 0 : -2;
        break;
      case 'italic':
        replacement = `*${selectedText || 'italic text'}*`;
        cursorOffset = selectedText ? 0 : -1;
        break;
      case 'heading':
        replacement = `### ${selectedText || 'Heading'}`;
        cursorOffset = selectedText ? 0 : 0;
        break;
      case 'quote':
        replacement = `> ${selectedText || 'quote'}`;
        cursorOffset = selectedText ? 0 : 0;
        break;
      case 'code':
        replacement = `\`\`\`\n${selectedText || 'code'}\n\`\`\``;
        cursorOffset = selectedText ? 0 : 0;
        break;
      case 'link':
        replacement = `[${selectedText || 'link text'}](https://)`;
        cursorOffset = selectedText ? -1 : -11;
        break;
      case 'list':
        replacement = `- ${selectedText || 'list item'}`;
        cursorOffset = selectedText ? 0 : 0;
        break;
      case 'ordered-list':
        replacement = `1. ${selectedText || 'list item'}`;
        cursorOffset = selectedText ? 0 : 0;
        break;
      case 'task-list':
        replacement = `- [ ] ${selectedText || 'task item'}`;
        cursorOffset = selectedText ? 0 : 0;
        break;
    }

    dispatch({
      changes: { from, to, insert: replacement },
      selection: { anchor: from + replacement.length + cursorOffset },
    });
    view.focus();
  }

  const MAX_CACHED_STATES = 16;

  function pruneExcessStates() {
    if (states.size <= MAX_CACHED_STATES) return;
    for (const id of states.keys()) {
      if (id !== documentId) {
        states.delete(id);
        if (states.size <= MAX_CACHED_STATES) break;
      }
    }
  }

  function stateForDocument(id: string, content: string, sel: { anchor: number; head: number }) {
    const cached = states.get(id);
    if (cached && cached.doc.toString() === content) {
      states.delete(id);
      states.set(id, cached);
      return cached;
    }
    const selectionRange = cached
      ? {
          anchor: cached.selection.main.anchor,
          head: cached.selection.main.head,
        }
      : sel;
    const next = createState(content, selectionRange);
    states.delete(id);
    states.set(id, next);
    pruneExcessStates();
    return next;
  }

  onMount(() => {
    localValue = value;
    currentId = documentId;
    lastSln = showLineNumbers;
    lastTs = tabSize;
    lastSc = spellcheck;
    lastLw = lineWrap;
    view = new EditorView({
      parent: host,
      state: stateForDocument(documentId, value, selection),
    });

    return () => view?.destroy();
  });

  $effect(() => {
    if (!view) return;

    if (documentId !== currentId) {
      if (currentId) {
        states.set(currentId, view.state);
      }
      currentId = documentId;
      const next = stateForDocument(documentId, value, selection);
      localValue = next.doc.toString();
      view.setState(next);
      lastSln = showLineNumbers;
      lastTs = tabSize;
      lastSc = spellcheck;
      lastLw = lineWrap;
      return;
    }

    if (
      showLineNumbers !== lastSln ||
      tabSize !== lastTs ||
      spellcheck !== lastSc ||
      lineWrap !== lastLw
    ) {
      lastSln = showLineNumbers;
      lastTs = tabSize;
      lastSc = spellcheck;
      lastLw = lineWrap;

      // Drop cached states so inactive tabs rebuild with the new editor config.
      states.clear();
      const currentDoc = view.state.doc.toString();
      const { anchor, head } = view.state.selection.main;
      const nextState = createState(currentDoc, { anchor, head });
      states.set(documentId, nextState);
      view.setState(nextState);
      return;
    }

    if (value === localValue) return;
    localValue = value;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    states.set(documentId, view.state);
  });

  $effect(() => {
    if (!view || findRequest === lastFindRequest) return;
    lastFindRequest = findRequest;
    if (findRequest > 0) openSearchPanel(view);
  });

  // Moves the cursor to a 1-based line and scrolls it into view for outline navigation.
  $effect(() => {
    if (!view || !revealRequest || revealRequest.token === lastRevealToken) return;
    lastRevealToken = revealRequest.token;
    const totalLines = view.state.doc.lines;
    const lineNumber = Math.min(Math.max(revealRequest.line, 1), totalLines);
    const line = view.state.doc.line(lineNumber);
    view.dispatch({
      selection: { anchor: line.from, head: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    view.focus();
  });

  $effect(() => {
    if (!view || visible === lastVisible) return;
    lastVisible = visible;
    if (!visible) {
      view.contentDOM.blur();
      return;
    }
    view.requestMeasure();
  });

  $effect(() => {
    // Local bookkeeping only — not reactive UI state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- ephemeral prune set
    const keep = new Set(retainedDocumentIds);
    if (!keep.has(documentId)) keep.add(documentId);
    for (const id of [...states.keys()]) {
      if (!keep.has(id)) states.delete(id);
    }
  });
</script>

<div class="editor-container">
  <div class="formatting-toolbar" role="toolbar" aria-label="Formatting">
    <button class="toolbar-btn" title="Bold" aria-label="Bold" onclick={() => insertFormat('bold')}
      ><Bold size={14} /></button
    >
    <button
      class="toolbar-btn"
      title="Italic"
      aria-label="Italic"
      onclick={() => insertFormat('italic')}><Italic size={14} /></button
    >
    <button
      class="toolbar-btn"
      title="Heading"
      aria-label="Heading"
      onclick={() => insertFormat('heading')}><Heading size={14} /></button
    >
    <span class="toolbar-separator" role="separator"></span>
    <button
      class="toolbar-btn"
      title="Quote"
      aria-label="Quote"
      onclick={() => insertFormat('quote')}><Quote size={14} /></button
    >
    <button
      class="toolbar-btn"
      title="Code block"
      aria-label="Code block"
      onclick={() => insertFormat('code')}><Code size={14} /></button
    >
    <button class="toolbar-btn" title="Link" aria-label="Link" onclick={() => insertFormat('link')}
      ><Link size={14} /></button
    >
    <span class="toolbar-separator" role="separator"></span>
    <button
      class="toolbar-btn"
      title="Unordered list"
      aria-label="Unordered list"
      onclick={() => insertFormat('list')}><List size={14} /></button
    >
    <button
      class="toolbar-btn"
      title="Ordered list"
      aria-label="Ordered list"
      onclick={() => insertFormat('ordered-list')}><ListOrdered size={14} /></button
    >
    <button
      class="toolbar-btn"
      title="Task list"
      aria-label="Task list"
      onclick={() => insertFormat('task-list')}><ListTodo size={14} /></button
    >
  </div>
  <div class="editor-host" bind:this={host}></div>
</div>
