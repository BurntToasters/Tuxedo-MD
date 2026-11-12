import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { applyThemePackage, clearThemePackage } from '../lib/appearance';
import ThemeStudio from '../lib/chrome/ThemeStudio.svelte';
import { buildViewMenu } from '../lib/menu-commands';
import {
  THEME_PACKAGE_KEY,
  THEME_STYLE_ELEMENT_ID,
  THEME_TOKEN_KEYS,
  builtinDarkTokens,
  isThemeColor,
  normalizeThemePackage,
  sanitizeThemeCss,
  serializeThemePackage,
  themePackageFileName,
  type ThemePackage,
} from '../lib/theme-package';

const BARE_BODY_RULE = /(^|[\s,{}>+~])body\s*\{/i;

function packageWith(css: string, canvas = '#112233'): ThemePackage {
  return {
    version: 1,
    name: 'Midnight',
    tokens: { ...builtinDarkTokens, canvas },
    css,
  };
}

describe('theme color tokens', () => {
  it('accepts 3, 6, and 8 digit hex plus numeric rgb and rgba', () => {
    expect(isThemeColor('#abc')).toBe(true);
    expect(isThemeColor('#AbC')).toBe(true);
    expect(isThemeColor('#aabbcc')).toBe(true);
    expect(isThemeColor('#aabbccdd')).toBe(true);
    expect(isThemeColor('rgb(1, 2, 3)')).toBe(true);
    expect(isThemeColor('RGB(1,2,3)')).toBe(true);
    expect(isThemeColor('rgba(56, 139, 253, 0.2)')).toBe(true);
    expect(isThemeColor('rgba(48, 54, 61, 0.72)')).toBe(true);
    expect(isThemeColor('rgb(1 2 3)')).toBe(true);
    expect(isThemeColor('rgb(1 2 3 / 0.4)')).toBe(true);
    expect(isThemeColor('rgb(10%, 20%, 30%)')).toBe(true);
    for (const value of Object.values(builtinDarkTokens)) {
      expect(isThemeColor(value)).toBe(true);
    }
  });

  it('rejects urls, expressions, variables, and other color forms', () => {
    expect(isThemeColor('url(#fff)')).toBe(false);
    expect(isThemeColor('expression(#fff)')).toBe(false);
    expect(isThemeColor('var(--accent)')).toBe(false);
    expect(isThemeColor('rgb(var(--a), 1, 2)')).toBe(false);
    expect(isThemeColor('#ffff')).toBe(false);
    expect(isThemeColor('#ab')).toBe(false);
    expect(isThemeColor('red')).toBe(false);
    expect(isThemeColor('hsl(0, 0%, 0%)')).toBe(false);
  });
});

describe('theme packages', () => {
  it('stores the package under theme-package', () => {
    expect(THEME_PACKAGE_KEY).toBe('theme-package');
  });

  it('normalizes a version 1 package and drops invalid input', () => {
    expect(normalizeThemePackage(null)).toBeNull();
    expect(normalizeThemePackage({ version: 2, name: 'A', tokens: {}, css: '' })).toBeNull();
    expect(normalizeThemePackage({ ...packageWith(''), name: '   ' })).toBeNull();
    expect(
      normalizeThemePackage({
        ...packageWith(''),
        tokens: { ...builtinDarkTokens, canvas: 'var(--canvas)' },
      })
    ).toBeNull();
    expect(
      normalizeThemePackage({
        ...packageWith(''),
        tokens: { ...builtinDarkTokens, accent: 'url(#fff)' },
      })
    ).toBeNull();
    expect(
      normalizeThemePackage({
        ...packageWith(''),
        tokens: { ...builtinDarkTokens, text: 'expression(#fff)' },
      })
    ).toBeNull();

    const normalized = normalizeThemePackage({
      ...packageWith(''),
      extra: true,
      name: '  Midnight  ',
    });
    expect(normalized).toEqual({
      version: 1,
      name: 'Midnight',
      tokens: { ...builtinDarkTokens, canvas: '#112233' },
      css: '',
    });
    expect(JSON.parse(serializeThemePackage(normalized!))).toEqual(normalized);
    expect(themePackageFileName('Midnight')).toBe('Midnight.json');
    expect(themePackageFileName('a/b')).toBe('a b.json');
  });
});

describe('custom CSS sanitizer', () => {
  it('rejects @import', () => {
    expect(sanitizeThemeCss('@import "theme.css";')).toBeNull();
    expect(sanitizeThemeCss('body { color: #fff } @IMPORT url("x.css");')).toBeNull();
  });

  it('rejects expression(', () => {
    expect(sanitizeThemeCss('body { color: expression(alert(1)) }')).toBeNull();
    expect(sanitizeThemeCss('body { color: Expression (alert(1)) }')).toBeNull();
  });

  it('rejects javascript:', () => {
    expect(sanitizeThemeCss('a { background: url(javascript:alert(1)) }')).toBeNull();
    expect(sanitizeThemeCss('a { background: url("JavaScript:alert(1)") }')).toBeNull();
  });

  it('rejects url( values that are not base64 raster images', () => {
    expect(sanitizeThemeCss('a { background: url(https://example.com/a.png) }')).toBeNull();
    expect(sanitizeThemeCss('a { background: URL("http://example.com/a.png") }')).toBeNull();
    expect(sanitizeThemeCss('a { background: url(data:image/svg+xml;base64,aaaa) }')).toBeNull();
    expect(sanitizeThemeCss('a { background: url(data:image/png,aaaa) }')).toBeNull();
    expect(sanitizeThemeCss('a { background: url(data:image/jpg;base64,aaaa) }')).toBeNull();
  });

  it('rejects < so a style element cannot be closed', () => {
    expect(sanitizeThemeCss('body { content: "<" }')).toBeNull();
    expect(sanitizeThemeCss('</style><script>alert(1)</script>')).toBeNull();
  });

  it('allows a base64 png and scopes body under .theme-custom', () => {
    const css =
      'body { background: url("data:image/png;base64,aaaa") } :root { color: #fff } html { color: #000 }';
    const sanitized = sanitizeThemeCss(css);
    expect(sanitized).toContain('.theme-custom');
    expect(sanitized).toContain('data:image/png;base64,aaaa');
    expect(sanitized).not.toMatch(BARE_BODY_RULE);
    expect(sanitized).not.toMatch(/(^|[\s,{}>+~]):root\s*\{/i);
    expect(sanitized).not.toMatch(/(^|[\s,{}>+~])html\s*\{/i);
    expect(sanitizeThemeCss('body { background: url( "data:image/png;base64,aaaa" ) }')).toContain(
      'data:image/png;base64,aaaa'
    );
    for (const mime of ['jpeg', 'gif', 'webp']) {
      expect(sanitizeThemeCss(`div { background: url(data:image/${mime};base64,aaaa) }`)).toContain(
        `data:image/${mime};base64,aaaa`
      );
    }
  });

  it('rewrites page selectors into .theme-custom and prefixes other rules', () => {
    const body = sanitizeThemeCss('body.panel { color: #fff }');
    expect(body).toContain('.theme-custom.panel');
    expect(body).not.toContain('body');

    const card = sanitizeThemeCss('.card { color: #fff }');
    expect(card).toContain('.theme-custom .card');

    const media = sanitizeThemeCss('@media (max-width: 20px) { body { color: #fff } }');
    expect(media).toContain('.theme-custom');
    expect(media).not.toMatch(BARE_BODY_RULE);

    const once = sanitizeThemeCss('body { color: #ffffff }');
    expect(sanitizeThemeCss(once!)).toBe(once);
  });

  it('stores sanitized css and rejects a package whose css escapes the scope', () => {
    const saved = normalizeThemePackage(packageWith('body { color: #fff }'));
    expect(saved?.css).toContain('.theme-custom');
    expect(saved?.css).not.toMatch(BARE_BODY_RULE);
    expect(normalizeThemePackage(packageWith('@import "x.css";'))).toBeNull();
  });
});

describe('theme application', () => {
  afterEach(() => {
    clearThemePackage();
    document.getElementById('app-styles')?.remove();
  });

  it('sets inline token overrides and removes them without touching other styles', () => {
    const owned = document.createElement('style');
    owned.id = 'app-styles';
    document.head.append(owned);
    document.documentElement.style.setProperty('--editor-font-size', '14px');

    applyThemePackage(packageWith('body { color: #fff }', '#abcdef'));
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe('#abcdef');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(
      builtinDarkTokens.accent
    );
    expect(document.documentElement.classList.contains('theme-custom')).toBe(true);
    const style = document.getElementById(THEME_STYLE_ELEMENT_ID);
    expect(style?.textContent).toContain('.theme-custom');
    expect(style?.textContent).not.toMatch(BARE_BODY_RULE);
    expect(document.getElementById('app-styles')).toBe(owned);

    applyThemePackage(packageWith('body { color: expression(alert(1)) }', '#abcdef'));
    expect(document.documentElement.classList.contains('theme-custom')).toBe(false);
    expect(document.getElementById(THEME_STYLE_ELEMENT_ID)).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe('#abcdef');

    clearThemePackage();
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('14px');
    expect(document.documentElement.classList.contains('theme-custom')).toBe(false);
    expect(document.getElementById(THEME_STYLE_ELEMENT_ID)).toBeNull();
    expect(document.getElementById('app-styles')).toBe(owned);
    document.documentElement.style.removeProperty('--editor-font-size');
  });
});

describe('Theme Studio menu and dialog', () => {
  it('adds Theme Studio to the view menu without a shortcut', () => {
    const item = buildViewMenu().find(
      (entry) => entry.type === 'item' && entry.id === 'theme-studio'
    );
    expect(item).toMatchObject({ type: 'item', id: 'theme-studio', label: 'Theme Studio' });
    expect(item && item.type === 'item' ? item.shortcut : 'set').toBeUndefined();
  });

  it('labels every control, previews tokens, saves a package, and closes on Escape', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const onsave = vi.fn();
    const onclose = vi.fn();
    const component = mount(ThemeStudio, {
      target,
      props: {
        open: true,
        initial: packageWith(''),
        onsave,
        onreset: vi.fn(),
        onimport: vi.fn(async () => null),
        onexport: vi.fn(),
        onclose,
      },
    });
    await tick();

    expect(target.querySelector('#theme-studio-title')?.textContent).toBe('Theme Studio');
    expect(target.querySelector('label[for="theme-package-name"]')?.textContent).toBe('Theme name');
    expect(target.querySelector('label[for="theme-custom-css"]')?.textContent).toBe('Custom CSS');
    for (const key of THEME_TOKEN_KEYS) {
      expect(target.querySelector(`label[for="theme-token-${key}"]`)).not.toBeNull();
      expect(target.querySelector(`#theme-token-${key}`)).not.toBeNull();
    }
    expect(target.textContent).toContain('Sample text on the canvas.');
    expect((target.querySelector('#theme-token-canvas') as HTMLInputElement).value).toBe('#112233');

    (target.querySelector('button.primary') as HTMLButtonElement).click();
    expect(onsave).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1, name: 'Midnight', css: '' })
    );

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
