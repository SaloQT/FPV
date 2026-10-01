/**
 * Pilot options of the session flow: how the clock runs, whether a race starts with a countdown and whether the stick
 * indicator is drawn. They sit beside the render and performance settings (settingsSchema.ts) with their own saved copy,
 * so the two sets can change independently.
 */
import { CYCLE_SCALES, DEFAULT_CYCLE_SCALE, TIME_MODES, type TimeChoice, type TimeMode } from './clockModel';

export interface PilotOptions extends TimeChoice {
  /** 3-2-1-GO on the pad before a race; off is free flight. */
  raceStart: boolean;
  /** The two-box stick and throttle indicator on the OSD. */
  showSticks: boolean;
}

export const OPTIONS_KEY = 'fpv.options.v1';

export function defaultPilotOptions(): PilotOptions {
  return { timeMode: 'cycle', cycleScale: DEFAULT_CYCLE_SCALE, fixedHour: 12, raceStart: true, showSticks: true };
}

export interface OptionsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type OptionsListener = (options: PilotOptions, changed: readonly (keyof PilotOptions)[]) => void;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates an untrusted object over `base`: wrong types and unknown keys are dropped, numbers are clamped. */
export function sanitizeOptions(raw: unknown, base: PilotOptions): PilotOptions {
  if (!isRecord(raw)) return { ...base };
  const timeMode = TIME_MODES.includes(raw.timeMode as TimeMode) ? (raw.timeMode as TimeMode) : base.timeMode;
  const scale = typeof raw.cycleScale === 'number' && Number.isFinite(raw.cycleScale) ? raw.cycleScale : base.cycleScale;
  const hour = typeof raw.fixedHour === 'number' && Number.isFinite(raw.fixedHour) ? raw.fixedHour : base.fixedHour;
  return {
    timeMode,
    cycleScale: Math.min(Math.max(scale, CYCLE_SCALES[0]), CYCLE_SCALES[CYCLE_SCALES.length - 1]),
    fixedHour: Math.min(Math.max(hour, 0), 24),
    raceStart: typeof raw.raceStart === 'boolean' ? raw.raceStart : base.raceStart,
    showSticks: typeof raw.showSticks === 'boolean' ? raw.showSticks : base.showSticks,
  };
}

function browserStorage(): OptionsStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The pilot options, saved to `localStorage`. `get()` keeps its identity until something changes. */
export class PilotOptionsStore {
  private current: PilotOptions;
  private readonly listeners = new Set<OptionsListener>();

  constructor(private readonly storage: OptionsStorage | null = browserStorage()) {
    this.current = this.load();
  }

  get(): PilotOptions {
    return this.current;
  }

  patch(partial: Partial<PilotOptions>): void {
    const next = sanitizeOptions({ ...this.current, ...partial }, this.current);
    const changed = (Object.keys(next) as (keyof PilotOptions)[]).filter((k) => next[k] !== this.current[k]);
    if (changed.length === 0) return;
    this.current = next;
    this.save();
    for (const fn of [...this.listeners]) fn(next, changed);
  }

  subscribe(fn: OptionsListener): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  reset(): void {
    const defaults = defaultPilotOptions();
    const changed = (Object.keys(defaults) as (keyof PilotOptions)[]).filter((k) => defaults[k] !== this.current[k]);
    this.current = defaults;
    try {
      this.storage?.removeItem(OPTIONS_KEY);
    } catch {
      // Blocked or full storage: the session keeps working without saving.
    }
    if (changed.length > 0) for (const fn of [...this.listeners]) fn(defaults, changed);
  }

  private load(): PilotOptions {
    const base = defaultPilotOptions();
    try {
      const text = this.storage?.getItem(OPTIONS_KEY) ?? null;
      return text === null ? base : sanitizeOptions(JSON.parse(text), base);
    } catch {
      return base;
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(OPTIONS_KEY, JSON.stringify(this.current));
    } catch {
      // Blocked or full storage: the session keeps working without saving.
    }
  }
}
