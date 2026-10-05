import {
  defaultAppSettings, isSameValue, migrateStored, sanitizeSettings, sanitizeValue, SETTING_KEYS, SETTINGS_KEY, SETTINGS_VERSION, TRANSIENT_KEYS,
  type AppSettings,
} from './settingsSchema';

/** The slice of `Storage` the store uses, so tests can pass an in-memory one. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SettingsListener = (settings: AppSettings, changed: readonly (keyof AppSettings)[]) => void;

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * All pilot settings in one validated object, persisted to `localStorage`. `get()` returns the same object until a value
 * changes, so consumers can compare it by identity; `patch` swaps in a new one.
 */
export class SettingsStore {
  private current: AppSettings;
  private readonly listeners = new Set<SettingsListener>();

  constructor(private readonly storage: StorageLike | null = browserStorage()) {
    this.current = this.load();
  }

  get(): AppSettings {
    return this.current;
  }

  /** Validates and applies `partial`; listeners hear about the keys that actually changed. */
  patch(partial: Partial<AppSettings>): void {
    const next = { ...this.current };
    const target = next as Record<keyof AppSettings, unknown>;
    const changed: (keyof AppSettings)[] = [];
    for (const key of SETTING_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(partial, key)) continue;
      const value = sanitizeValue(key, partial[key], this.current[key]);
      if (isSameValue(value, this.current[key])) continue;
      target[key] = value;
      changed.push(key);
    }
    if (changed.length === 0) return;
    this.current = next;
    if (changed.some((k) => !TRANSIENT_KEYS.has(k))) this.save();
    for (const fn of [...this.listeners]) fn(next, changed);
  }

  subscribe(fn: SettingsListener): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Back to the defaults, also in storage. */
  reset(): void {
    const defaults = defaultAppSettings();
    const changed = SETTING_KEYS.filter((k) => !isSameValue(defaults[k], this.current[k]));
    this.current = defaults;
    try {
      this.storage?.removeItem(SETTINGS_KEY);
    } catch {
      // Storage can be blocked or full; the session keeps working without persistence.
    }
    if (changed.length > 0) for (const fn of [...this.listeners]) fn(defaults, changed);
  }

  private load(): AppSettings {
    const base = defaultAppSettings();
    if (this.storage === null) return base;
    try {
      const text = this.storage.getItem(SETTINGS_KEY);
      if (text === null) return base;
      const raw = JSON.parse(text);
      const stored = migrateStored(raw);
      if (stored === null) return base;
      const loaded = sanitizeSettings(stored, base);
      loaded.timeMs = base.timeMs;
      // Commit migrations once so subsequent explicit preferences are retained.
      if (typeof raw.version !== 'number' || raw.version < SETTINGS_VERSION) this.save(loaded);
      return loaded;
    } catch {
      return base;
    }
  }

  private save(current: AppSettings = this.current): void {
    if (this.storage === null) return;
    const settings: Record<string, unknown> = {};
    for (const key of SETTING_KEYS) if (!TRANSIENT_KEYS.has(key)) settings[key] = current[key];
    try {
      this.storage.setItem(SETTINGS_KEY, JSON.stringify({ version: SETTINGS_VERSION, settings }));
    } catch {
      // Storage can be blocked or full; the session keeps working without persistence.
    }
  }
}
