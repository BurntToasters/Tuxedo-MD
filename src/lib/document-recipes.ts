export const DOCUMENT_RECIPES_KEY = 'document-recipes';

const NAME_TOKEN = '{name}';
const MAX_RECIPES = 40;
const MAX_ID_LENGTH = 80;
const MAX_NAME_LENGTH = 80;
const MAX_PATTERN_LENGTH = 120;
const MAX_BODY_LENGTH = 100_000;
const MAX_FRONTMATTER_FIELDS = 24;
const MAX_FIELD_VALUE_LENGTH = 200;
const FRONTMATTER_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const INVALID_FILE_CHARS = /[\\/:*?"<>|]/;
const RESERVED_STEMS = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'CONIN$',
  'CONOUT$',
  'COM0',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT0',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

export interface RecipeFrontmatterField {
  key: string;
  value: string;
}

export interface DocumentRecipe {
  id: string;
  name: string;
  filenamePattern: string;
  frontmatter: RecipeFrontmatterField[];
  body: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ID_LENGTH || !/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_NAME_LENGTH) return null;
  for (const char of trimmed) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return null;
  }
  return trimmed;
}

function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** True when `name` would pass the native Markdown file-name check. */
export function isAcceptableMarkdownFileName(name: string): boolean {
  if (!name || name.length > 255 || name !== name.trim()) return false;
  if (name === '.' || name === '..' || name.startsWith('.')) return false;
  if (name.endsWith('.') || name.endsWith(' ')) return false;
  if (INVALID_FILE_CHARS.test(name) || hasControlChar(name)) return false;
  if (!/\.md$/i.test(name)) return false;
  const stem = name.slice(0, -3);
  if (!stem) return false;
  return !RESERVED_STEMS.has(stem.toUpperCase());
}

function applyNameToken(pattern: string, name: string): string {
  const tokenAt = pattern.indexOf(NAME_TOKEN);
  if (tokenAt === -1) return pattern;
  return `${pattern.slice(0, tokenAt)}${name}${pattern.slice(tokenAt + NAME_TOKEN.length)}`;
}

/** Stem plus `{name}` at most once. The sample file name must already be legal. */
export function isRecipeFilenamePattern(pattern: string): boolean {
  if (!pattern || pattern !== pattern.trim() || pattern.length > MAX_PATTERN_LENGTH) return false;
  const first = pattern.indexOf(NAME_TOKEN);
  if (first !== pattern.lastIndexOf(NAME_TOKEN)) return false;
  const literal = first === -1 ? pattern : applyNameToken(pattern, '');
  if (/[{}]/.test(literal)) return false;
  const sample = applyNameToken(pattern, 'note');
  const fileName = sample.toLowerCase().endsWith('.md') ? sample : `${sample}.md`;
  return isAcceptableMarkdownFileName(fileName);
}

/** One `.md` file name, or null when the pattern or name would be rejected on disk. */
export function recipeFileName(pattern: string, name: string): string | null {
  if (name.includes('/') || name.includes('\\')) return null;
  const trimmedPattern = pattern.trim();
  const trimmedName = name.trim();
  if (!trimmedName || !isRecipeFilenamePattern(trimmedPattern)) return null;
  if (trimmedName.includes('/') || trimmedName.includes('\\')) return null;
  const stem = applyNameToken(trimmedPattern, trimmedName);
  const fileName = stem.toLowerCase().endsWith('.md') ? stem : `${stem}.md`;
  return isAcceptableMarkdownFileName(fileName) ? fileName : null;
}

function normalizeFrontmatter(raw: unknown): RecipeFrontmatterField[] {
  if (!Array.isArray(raw)) return [];
  const fields: RecipeFrontmatterField[] = [];
  for (const entry of raw) {
    if (fields.length >= MAX_FRONTMATTER_FIELDS) break;
    if (!isRecord(entry) || typeof entry.key !== 'string' || typeof entry.value !== 'string') {
      continue;
    }
    const key = entry.key.trim();
    const value = entry.value.trim();
    if (!FRONTMATTER_KEY.test(key) || !value || value.length > MAX_FIELD_VALUE_LENGTH) continue;
    if (hasControlChar(value)) continue;
    fields.push({ key, value });
  }
  return fields;
}

/** Drops recipes whose filename pattern is not a legal stem. */
export function normalizeDocumentRecipes(raw: unknown): DocumentRecipe[] {
  if (!Array.isArray(raw)) return [];
  const recipes: DocumentRecipe[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (recipes.length >= MAX_RECIPES) break;
    if (!isRecord(entry)) continue;
    const id = cleanId(entry.id);
    const name = cleanName(entry.name);
    const filenamePattern =
      typeof entry.filenamePattern === 'string' ? entry.filenamePattern.trim() : '';
    const body = entry.body === undefined ? '' : entry.body;
    if (!id || !name || seen.has(id) || typeof body !== 'string' || body.length > MAX_BODY_LENGTH) {
      continue;
    }
    if (!isRecipeFilenamePattern(filenamePattern)) continue;
    seen.add(id);
    recipes.push({
      id,
      name,
      filenamePattern,
      frontmatter: normalizeFrontmatter(entry.frontmatter),
      body,
    });
  }
  return recipes;
}

function quoteYaml(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Prepends YAML defaults when the body does not already open with `---`. */
export function composeRecipeMarkdown(recipe: {
  frontmatter: readonly RecipeFrontmatterField[];
  body: string;
}): string {
  const body = recipe.body;
  if (body.startsWith('---')) return body;
  const lines = recipe.frontmatter
    .filter(
      (field) =>
        FRONTMATTER_KEY.test(field.key.trim()) && field.value.trim() && !hasControlChar(field.value)
    )
    .map((field) => `${field.key.trim()}: ${quoteYaml(field.value.trim())}`);
  if (!lines.length) return body;
  return `---\n${lines.join('\n')}\n---\n${body}`;
}
