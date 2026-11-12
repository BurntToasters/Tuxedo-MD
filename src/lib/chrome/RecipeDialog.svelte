<script lang="ts">
  import { onMount } from 'svelte';
  import { X } from '@lucide/svelte';
  import { handleDismissibleDialogKeydown } from '../focus';
  import {
    isRecipeFilenamePattern,
    normalizeDocumentRecipes,
    recipeFileName,
    type DocumentRecipe,
    type RecipeFrontmatterField,
  } from '../document-recipes';

  let {
    open = false,
    recipes = [],
    onclose,
    onsave,
    oncreate,
  }: {
    open?: boolean;
    recipes?: DocumentRecipe[];
    onclose: () => void;
    onsave: (recipes: DocumentRecipe[]) => void;
    oncreate: (
      recipe: DocumentRecipe,
      documentName: string
    ) => Promise<string | null> | string | null;
  } = $props();

  interface FrontmatterRow {
    id: string;
    key: string;
    value: string;
  }

  let dialog: HTMLDialogElement | undefined = $state();
  let nameInput: HTMLInputElement | undefined = $state();
  let drafts = $state<DocumentRecipe[]>([]);
  let selectedId = $state('');
  let draftName = $state('');
  let draftPattern = $state('{name}');
  let draftBody = $state('');
  let draftFrontmatter = $state<FrontmatterRow[]>([]);
  let documentName = $state('');
  let formError = $state('');
  let creating = $state(false);
  let seeded = false;

  const FRONTMATTER_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

  function show() {
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      queueMicrotask(() => nameInput?.focus());
    } else if (!open && dialog?.open) {
      dialog.close();
    }
  }

  function blankRecipe(): DocumentRecipe {
    return {
      id: crypto.randomUUID(),
      name: 'New recipe',
      filenamePattern: '{name}',
      frontmatter: [],
      body: '',
    };
  }

  function loadRecipe(recipe: DocumentRecipe) {
    selectedId = recipe.id;
    draftName = recipe.name;
    draftPattern = recipe.filenamePattern;
    draftBody = recipe.body;
    draftFrontmatter = recipe.frontmatter.map((field) => ({
      id: crypto.randomUUID(),
      key: field.key,
      value: field.value,
    }));
  }

  $effect(() => {
    if (!open) {
      seeded = false;
      return;
    }
    if (seeded) return;
    seeded = true;
    creating = false;
    formError = '';
    documentName = '';
    drafts = recipes.map((recipe) => ({
      ...recipe,
      frontmatter: recipe.frontmatter.map((field) => ({ ...field })),
    }));
    if (!drafts.length) drafts = [blankRecipe()];
    loadRecipe(drafts[0]);
  });

  $effect(show);
  onMount(show);

  function frontmatterFields(): RecipeFrontmatterField[] {
    const fields: RecipeFrontmatterField[] = [];
    for (const row of draftFrontmatter) {
      const key = row.key.trim();
      const value = row.value.trim();
      if (!key && !value) continue;
      fields.push({ key, value });
    }
    return fields;
  }

  function checkedRecipe(): { recipe: DocumentRecipe } | { error: string } {
    const name = draftName.trim();
    if (!name) return { error: 'A recipe name is required' };
    const filenamePattern = draftPattern.trim();
    if (!isRecipeFilenamePattern(filenamePattern)) {
      return { error: 'Filename pattern must be a stem and may include {name} once' };
    }
    const filled = frontmatterFields();
    if (filled.some((field) => !field.key || !field.value)) {
      return { error: 'Each frontmatter field needs a key and a value' };
    }
    if (filled.some((field) => !FRONTMATTER_KEY.test(field.key))) {
      return { error: 'Frontmatter keys must be plain words without spaces' };
    }
    const id = selectedId || crypto.randomUUID();
    const normalized = normalizeDocumentRecipes([
      { id, name, filenamePattern, frontmatter: filled, body: draftBody },
    ]);
    if (normalized.length !== 1 || normalized[0].frontmatter.length !== filled.length) {
      return { error: 'That recipe cannot be saved' };
    }
    selectedId = normalized[0].id;
    return { recipe: normalized[0] };
  }

  function replaceDraft(recipe: DocumentRecipe): DocumentRecipe[] {
    if (!drafts.some((item) => item.id === recipe.id)) return [...drafts, recipe];
    return drafts.map((item) => (item.id === recipe.id ? recipe : item));
  }

  function saveRecipes() {
    const checked = checkedRecipe();
    if ('error' in checked) {
      formError = checked.error;
      return;
    }
    drafts = replaceDraft(checked.recipe);
    formError = '';
    onsave(normalizeDocumentRecipes(drafts));
  }

  async function createDocument() {
    if (creating) return;
    const checked = checkedRecipe();
    if ('error' in checked) {
      formError = checked.error;
      return;
    }
    const requestedName = documentName.trim();
    if (!requestedName) {
      formError = 'A document name is required';
      return;
    }
    if (!recipeFileName(checked.recipe.filenamePattern, requestedName)) {
      formError = 'That name cannot be used for a Markdown file';
      return;
    }
    drafts = replaceDraft(checked.recipe);
    formError = '';
    onsave(normalizeDocumentRecipes(drafts));
    creating = true;
    try {
      const message = await oncreate(checked.recipe, requestedName);
      if (message) formError = message;
    } finally {
      creating = false;
    }
  }

  function selectRecipe(event: Event) {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) return;
    const checked = checkedRecipe();
    if ('error' in checked) {
      formError = checked.error;
      target.value = selectedId;
      return;
    }
    drafts = replaceDraft(checked.recipe);
    const next = drafts.find((recipe) => recipe.id === target.value);
    if (!next) return;
    formError = '';
    loadRecipe(next);
  }

  function addRecipe() {
    if (selectedId || draftName.trim()) {
      const checked = checkedRecipe();
      if ('error' in checked) {
        formError = checked.error;
        return;
      }
      drafts = replaceDraft(checked.recipe);
    }
    const recipe = blankRecipe();
    drafts = [...drafts, recipe];
    formError = '';
    loadRecipe(recipe);
  }

  function deleteRecipe() {
    if (!selectedId) return;
    drafts = drafts.filter((recipe) => recipe.id !== selectedId);
    onsave(normalizeDocumentRecipes(drafts));
    formError = '';
    if (drafts.length) {
      loadRecipe(drafts[0]);
      return;
    }
    selectedId = '';
    draftName = '';
    draftPattern = '{name}';
    draftBody = '';
    draftFrontmatter = [];
  }

  function addFrontmatter() {
    draftFrontmatter = [...draftFrontmatter, { id: crypto.randomUUID(), key: '', value: '' }];
  }

  function removeFrontmatter(id: string) {
    draftFrontmatter = draftFrontmatter.filter((row) => row.id !== id);
  }

  function setRow(id: string, patch: Partial<Pick<FrontmatterRow, 'key' | 'value'>>) {
    draftFrontmatter = draftFrontmatter.map((row) => (row.id === id ? { ...row, ...patch } : row));
  }

  function fieldValue(event: Event): string {
    const target = event.currentTarget;
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      ? target.value
      : '';
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
      style="width: min(520px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 48px)); overflow: auto;"
      aria-modal="true"
      aria-labelledby="recipe-dialog-title"
      aria-busy={creating}
      onkeydown={(event) => handleDismissibleDialogKeydown(event, onclose)}
      oncancel={(event) => {
        event.preventDefault();
        onclose();
      }}
    >
      <header>
        <h2 id="recipe-dialog-title">New from Recipe</h2>
        <button class="icon-button" type="button" aria-label="Close" onclick={onclose}>
          <X />
        </button>
      </header>
      <form
        class="name-prompt-form"
        onsubmit={(event) => {
          event.preventDefault();
          if (!creating) void createDocument();
        }}
      >
        <label class="name-prompt-label" for="recipe-choice">Recipe</label>
        <div class="select-wrapper">
          <select id="recipe-choice" value={selectedId} disabled={creating} onchange={selectRecipe}>
            {#each drafts as recipe (recipe.id)}
              <option value={recipe.id}>{recipe.name}</option>
            {/each}
          </select>
        </div>
        <label class="name-prompt-label" for="recipe-name">Recipe name</label>
        <input
          id="recipe-name"
          class="name-prompt-input"
          bind:this={nameInput}
          value={draftName}
          maxlength="80"
          disabled={creating}
          oninput={(event) => (draftName = fieldValue(event))}
        />
        <label class="name-prompt-label" for="recipe-pattern">Filename pattern</label>
        <input
          id="recipe-pattern"
          class="name-prompt-input"
          value={draftPattern}
          maxlength="120"
          disabled={creating}
          aria-describedby="recipe-pattern-hint"
          oninput={(event) => (draftPattern = fieldValue(event))}
        />
        <p class="settings-note" id="recipe-pattern-hint">
          Use {'{name}'} for the document name. The result is one Markdown file.
        </p>
        <p class="name-prompt-label" id="recipe-frontmatter-label">Frontmatter defaults</p>
        {#each draftFrontmatter as row, index (row.id)}
          <label class="name-prompt-label" for={`recipe-frontmatter-key-${row.id}`}>
            Key {index + 1}
          </label>
          <input
            id={`recipe-frontmatter-key-${row.id}`}
            class="name-prompt-input"
            value={row.key}
            maxlength="64"
            disabled={creating}
            oninput={(event) => setRow(row.id, { key: fieldValue(event) })}
          />
          <label class="name-prompt-label" for={`recipe-frontmatter-value-${row.id}`}>
            Value {index + 1}
          </label>
          <input
            id={`recipe-frontmatter-value-${row.id}`}
            class="name-prompt-input"
            value={row.value}
            maxlength="200"
            disabled={creating}
            oninput={(event) => setRow(row.id, { value: fieldValue(event) })}
          />
          <button
            type="button"
            disabled={creating}
            aria-label={`Remove frontmatter ${index + 1}`}
            onclick={() => removeFrontmatter(row.id)}
          >
            Remove
          </button>
        {/each}
        <button type="button" disabled={creating} onclick={addFrontmatter}>
          Add frontmatter field
        </button>
        <label class="name-prompt-label" for="recipe-body">Markdown body</label>
        <textarea
          id="recipe-body"
          class="name-prompt-input"
          rows="6"
          value={draftBody}
          disabled={creating}
          oninput={(event) => (draftBody = fieldValue(event))}
        ></textarea>
        <label class="name-prompt-label" for="recipe-document-name">Document name</label>
        <input
          id="recipe-document-name"
          class="name-prompt-input"
          value={documentName}
          maxlength="120"
          disabled={creating}
          oninput={(event) => (documentName = fieldValue(event))}
        />
        {#if formError}
          <p class="settings-note" role="alert">{formError}</p>
        {/if}
        <div class="modal-actions">
          <button type="button" disabled={creating} onclick={addRecipe}>New recipe</button>
          <button type="button" disabled={creating || !selectedId} onclick={deleteRecipe}>
            Delete recipe
          </button>
          <button type="button" disabled={creating} onclick={saveRecipes}>Save recipe</button>
          <button class="primary" type="submit" disabled={creating}>Create document</button>
        </div>
      </form>
    </dialog>
  </div>
{/if}
