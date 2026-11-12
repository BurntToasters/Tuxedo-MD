import { describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import FocusTimer from '../lib/chrome/FocusTimer.svelte';
import {
  FOCUS_PRESETS_KEY,
  focusTimerReading,
  formatFocusRemaining,
  normalizeFocusPreset,
  normalizeFocusPresets,
} from '../lib/focus-presets';
import { buildViewMenu } from '../lib/menu-commands';

function preset(minutes: number, id = 'sprint') {
  return {
    id,
    name: 'Sprint',
    goal: 'Draft the note',
    minutes,
    focusMode: true,
  };
}

describe('focus presets', () => {
  it('stores presets under focus-presets', () => {
    expect(FOCUS_PRESETS_KEY).toBe('focus-presets');
  });

  it('rejects 0 minutes and accepts 25', () => {
    expect(normalizeFocusPreset(preset(0))).toBeNull();
    expect(normalizeFocusPreset(preset(25))).toEqual(preset(25));
    expect(
      normalizeFocusPresets([preset(0, 'bad'), preset(25, 'ok')]).map((item) => item.id)
    ).toEqual(['ok']);
  });

  it('finishes a 1 minute preset after 61 seconds and keeps 30 seconds at the halfway mark', () => {
    expect(focusTimerReading(1, 61)).toEqual({ finished: true, remainingSeconds: 0 });
    expect(focusTimerReading(1, 30)).toEqual({ finished: false, remainingSeconds: 30 });
    expect(formatFocusRemaining(30)).toBe('0:30');
  });

  it('adds Focus Timer to the view menu without a shortcut', () => {
    const item = buildViewMenu().find(
      (entry) => entry.type === 'item' && entry.id === 'focus-timer'
    );
    expect(item).toMatchObject({ type: 'item', id: 'focus-timer', label: 'Focus Timer' });
    expect(item && item.type === 'item' ? item.shortcut : 'set').toBeUndefined();
  });
});

describe('focus timer control', () => {
  it('shows remaining time, start, pause, and stop, then a finished state', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const onresume = vi.fn();
    const onpause = vi.fn();
    const onstop = vi.fn();
    const props = {
      open: false,
      presets: [],
      onclose: vi.fn(),
      onsave: vi.fn(),
      onbegin: vi.fn(() => null),
      onresume,
      onpause,
      onstop,
    };
    const running = mount(FocusTimer, {
      target,
      props: {
        ...props,
        session: {
          name: 'Sprint',
          goal: 'Draft the note',
          finished: false,
          running: true,
          remainingText: '0:30',
        },
      },
    });

    expect(target.querySelector('[role="timer"]')?.textContent?.trim()).toBe('0:30');
    const buttons = [...target.querySelectorAll('button')];
    const start = buttons.find((button) => button.textContent?.trim() === 'Start');
    const pause = buttons.find((button) => button.textContent?.trim() === 'Pause');
    const stop = buttons.find((button) => button.textContent?.trim() === 'Stop');
    expect(start).toBeInstanceOf(HTMLButtonElement);
    expect(pause).toBeInstanceOf(HTMLButtonElement);
    expect(stop).toBeInstanceOf(HTMLButtonElement);
    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect((pause as HTMLButtonElement).disabled).toBe(false);
    (stop as HTMLButtonElement).click();
    expect(onstop).toHaveBeenCalled();
    unmount(running);

    const finished = mount(FocusTimer, {
      target,
      props: {
        ...props,
        session: {
          name: 'Sprint',
          goal: 'Draft the note',
          finished: true,
          running: false,
          remainingText: 'Finished',
        },
      },
    });
    expect(target.querySelector('[role="timer"]')?.textContent?.trim()).toBe('Finished');
    expect(target.textContent).toContain('Start');
    expect(target.textContent).toContain('Pause');
    expect(target.textContent).toContain('Stop');
    unmount(finished);
    target.remove();
  });

  it('labels preset controls, rejects 0 minutes, starts 25, and closes on Escape', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const onclose = vi.fn();
    const onbegin = vi.fn(() => null);
    const component = mount(FocusTimer, {
      target,
      props: {
        open: true,
        presets: [],
        session: null,
        onclose,
        onsave: vi.fn(),
        onbegin,
        onresume: vi.fn(),
        onpause: vi.fn(),
        onstop: vi.fn(),
      },
    });
    await tick();

    expect(target.querySelector('#focus-timer-title')?.textContent).toBe('Focus Timer');
    expect(target.querySelector('label[for="focus-preset-choice"]')?.textContent).toBe('Preset');
    expect(target.querySelector('label[for="focus-preset-name"]')?.textContent).toBe('Name');
    expect(target.querySelector('label[for="focus-preset-goal"]')?.textContent).toBe('Goal');
    expect(target.querySelector('label[for="focus-preset-minutes"]')?.textContent).toBe('Minutes');
    expect(target.querySelector('label[for="focus-preset-focus-mode"]')?.textContent).toBe(
      'Turn on focus mode'
    );

    const minutes = target.querySelector('#focus-preset-minutes');
    if (!(minutes instanceof HTMLInputElement)) throw new Error('missing minutes');
    minutes.value = '0';
    flushSync(() => {
      minutes.dispatchEvent(new Event('input', { bubbles: true }));
    });
    flushSync(() => {
      (target.querySelector('button.primary') as HTMLButtonElement).click();
    });
    expect(onbegin).not.toHaveBeenCalled();
    expect(target.textContent).toContain('Minutes must be a whole number from 1 to 180');

    minutes.value = '25';
    flushSync(() => {
      minutes.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const focusMode = target.querySelector('#focus-preset-focus-mode');
    if (focusMode instanceof HTMLInputElement) {
      focusMode.checked = true;
      flushSync(() => {
        focusMode.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    flushSync(() => {
      (target.querySelector('button.primary') as HTMLButtonElement).click();
    });
    expect(onbegin).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Focus', minutes: 25, focusMode: true, goal: '' })
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
