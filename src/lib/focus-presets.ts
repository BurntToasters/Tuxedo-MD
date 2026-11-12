export const FOCUS_PRESETS_KEY = 'focus-presets';
export const MIN_FOCUS_MINUTES = 1;
export const MAX_FOCUS_MINUTES = 180;

const MAX_PRESETS = 40;
const MAX_ID_LENGTH = 80;
const MAX_NAME_LENGTH = 80;
const MAX_GOAL_LENGTH = 200;

export interface FocusPreset {
  id: string;
  name: string;
  goal: string;
  minutes: number;
  focusMode: boolean;
}

export interface FocusTimerReading {
  finished: boolean;
  remainingSeconds: number;
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

function cleanText(value: unknown, maxLength: number, allowEmpty: boolean): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if ((trimmed.length === 0 && !allowEmpty) || trimmed.length > maxLength) return null;
  for (const char of trimmed) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return null;
  }
  return trimmed;
}

/** Whole minutes from 1 to 180. Zero and fractional values are rejected. */
export function normalizeFocusPreset(raw: unknown): FocusPreset | null {
  if (!isRecord(raw)) return null;
  const id = cleanId(raw.id);
  const name = cleanText(raw.name, MAX_NAME_LENGTH, false);
  const goal = cleanText(raw.goal, MAX_GOAL_LENGTH, true);
  if (!id || !name || goal === null) return null;
  if (typeof raw.minutes !== 'number' || !Number.isInteger(raw.minutes)) return null;
  if (raw.minutes < MIN_FOCUS_MINUTES || raw.minutes > MAX_FOCUS_MINUTES) return null;
  if (typeof raw.focusMode !== 'boolean') return null;
  return { id, name, goal, minutes: raw.minutes, focusMode: raw.focusMode };
}

export function normalizeFocusPresets(raw: unknown): FocusPreset[] {
  if (!Array.isArray(raw)) return [];
  const presets: FocusPreset[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (presets.length >= MAX_PRESETS) break;
    const preset = normalizeFocusPreset(entry);
    if (!preset || seen.has(preset.id)) continue;
    seen.add(preset.id);
    presets.push(preset);
  }
  return presets;
}

/** Remaining whole seconds. Elapsed time is an input, so this does not wait. */
export function focusTimerReading(minutes: number, elapsedSeconds: number): FocusTimerReading {
  const totalSeconds = minutes * 60;
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, Math.floor(elapsedSeconds)) : 0;
  const remainingSeconds = totalSeconds - elapsed;
  if (remainingSeconds <= 0) return { finished: true, remainingSeconds: 0 };
  return { finished: false, remainingSeconds };
}

export function formatFocusRemaining(remainingSeconds: number): string {
  const total = Math.max(0, Math.floor(remainingSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
