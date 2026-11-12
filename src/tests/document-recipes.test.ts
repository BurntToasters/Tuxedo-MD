import { describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import RecipeDialog from '../lib/chrome/RecipeDialog.svelte';
import {
  DOCUMENT_RECIPES_KEY,
  composeRecipeMarkdown,
  normalizeDocumentRecipes,
  recipeFileName,
} from '../lib/document-recipes';
import { buildFileMenu } from '../lib/menu-commands';

describe('document recipes', () => {
  it('stores recipes under document-recipes', () => {
    expect(DOCUMENT_RECIPES_KEY).toBe('document-recipes');
  });

  it('drops a bad filename pattern and keeps a valid one', () => {
    const recipes = normalizeDocumentRecipes([
      {
        id: 'bad',
        name: 'Nested',
        filenamePattern: 'notes/{name}',
        frontmatter: [],
        body: 'nope',
      },
      {
        id: 'good',
        name: 'Journal',
        filenamePattern: '{name}',
        frontmatter: [
          { key: 'title', value: 'Standup' },
          { key: '', value: 'skip' },
        ],
        body: 'Talking points',
      },
    ]);

    expect(recipes).toEqual([
      {
        id: 'good',
        name: 'Journal',
        filenamePattern: '{name}',
        frontmatter: [{ key: 'title', value: 'Standup' }],
        body: 'Talking points',
      },
    ]);
  });

  it('includes frontmatter defaults and the body in composed markdown', () => {
    const markdown = composeRecipeMarkdown({
      frontmatter: [
        { key: 'title', value: 'Standup' },
        { key: 'status', value: 'draft' },
      ],
      body: 'Talking points',
    });

    expect(markdown.startsWith('---\n')).toBe(true);
    expect(markdown).toContain('title: "Standup"');
    expect(markdown).toContain('status: "draft"');
    expect(markdown).toContain('Talking points');

    const fenced = '---\ntitle: Old\n---\nKeep';
    expect(
      composeRecipeMarkdown({
        frontmatter: [{ key: 'title', value: 'New' }],
        body: fenced,
      })
    ).toBe(fenced);
  });

  it('turns a pattern plus a name into one markdown file name and rejects a slash', () => {
    expect(recipeFileName('{name}', 'Weekly')).toBe('Weekly.md');
    expect(recipeFileName('journal-{name}', 'Standup')).toBe('journal-Standup.md');
    expect(recipeFileName('{name}', 'a/b')).toBeNull();
    expect(recipeFileName('{name}', 'a\\b')).toBeNull();
    expect(recipeFileName('{name}', 'CON')).toBeNull();
  });

  it('adds New from Recipe without a shortcut that collides with New or Save', () => {
    const menu = buildFileMenu();
    const ids = menu.filter((item) => item.type === 'item').map((item) => item.id);
    expect(ids).toContain('new-document');
    expect(ids).toContain('save-document');
    const recipe = menu.find((item) => item.type === 'item' && item.id === 'new-from-recipe');
    expect(recipe).toMatchObject({
      type: 'item',
      id: 'new-from-recipe',
      label: 'New from Recipe…',
    });
    expect(recipe && recipe.type === 'item' ? recipe.shortcut : 'set').toBeUndefined();
  });
});

describe('recipe dialog', () => {
  it('labels every control, rejects a slash, creates from a valid name, and closes on Escape', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const onclose = vi.fn();
    const onsave = vi.fn();
    const oncreate = vi.fn(async () => null);
    const component = mount(RecipeDialog, {
      target,
      props: { open: true, recipes: [], onclose, onsave, oncreate },
    });
    await tick();

    expect(target.querySelector('#recipe-dialog-title')?.textContent).toBe('New from Recipe');
    expect(target.querySelector('label[for="recipe-choice"]')?.textContent).toBe('Recipe');
    expect(target.querySelector('label[for="recipe-name"]')?.textContent).toBe('Recipe name');
    expect(target.querySelector('label[for="recipe-pattern"]')?.textContent).toBe(
      'Filename pattern'
    );
    expect(target.querySelector('label[for="recipe-body"]')?.textContent).toBe('Markdown body');
    expect(target.querySelector('label[for="recipe-document-name"]')?.textContent).toBe(
      'Document name'
    );

    const documentName = target.querySelector('#recipe-document-name');
    if (!(documentName instanceof HTMLInputElement)) throw new Error('missing document name');
    documentName.value = 'a/b';
    flushSync(() => {
      documentName.dispatchEvent(new Event('input', { bubbles: true }));
    });
    flushSync(() => {
      (target.querySelector('button.primary') as HTMLButtonElement).click();
    });
    expect(oncreate).not.toHaveBeenCalled();
    expect(target.textContent).toContain('That name cannot be used for a Markdown file');

    documentName.value = 'Weekly';
    flushSync(() => {
      documentName.dispatchEvent(new Event('input', { bubbles: true }));
    });
    flushSync(() => {
      (target.querySelector('button.primary') as HTMLButtonElement).click();
    });
    expect(oncreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New recipe', filenamePattern: '{name}' }),
      'Weekly'
    );
    expect(onsave).toHaveBeenCalled();

    target
      .querySelector('dialog')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    expect(onclose).toHaveBeenCalled();

    unmount(component);
    target.remove();
  });
});
