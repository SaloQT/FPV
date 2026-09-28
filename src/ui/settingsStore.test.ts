import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../contracts';
import { defaultGamepadConfig } from '../input/gamepadMap';
import { defaultAppSettings, sanitizeSettings, SETTING_KEYS, SETTINGS_KEY, SETTINGS_VERSION, type AppSettings } from './settingsSchema';
import { SettingsStore, type StorageLike } from './settingsStore';

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  writes = 0;
  failWrites = false;

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota');
    this.writes++;
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

function stored(mem: MemoryStorage): { version: number; settings: Record<string, unknown> } {
  return JSON.parse(mem.data.get(SETTINGS_KEY) ?? 'null');
}

describe('defaults', () => {
  it('extend the shared defaults', () => {
    const d = defaultAppSettings();
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) expect(d[k as keyof AppSettings]).toEqual(v);
    expect(d.mouseCentering).toBe(0.6);
    expect(d.camVibration).toBe(0.15);
    expect(d.physicsHz).toBe(4000);
    expect(d.gamepad).toEqual(defaultGamepadConfig());
  });

  it('hand out fresh nested objects so edits never leak into the defaults', () => {
    const a = defaultAppSettings();
    a.observer.latitudeDeg = 12;
    a.gamepad.deadzone = 0.3;
    expect(defaultAppSettings().observer.latitudeDeg).toBe(DEFAULT_SETTINGS.observer.latitudeDeg);
    expect(defaultAppSettings().gamepad.deadzone).toBe(defaultGamepadConfig().deadzone);
  });

  it('every default passes its own validation', () => {
    const d = defaultAppSettings();
    expect(sanitizeSettings(JSON.parse(JSON.stringify(d)), d)).toEqual(d);
  });
});

describe('patch and subscribe', () => {
  it('applies changes and tells listeners what changed', () => {
    const store = new SettingsStore(new MemoryStorage());
    const seen: string[][] = [];
    store.subscribe((_s, changed) => void seen.push([...changed]));
    store.patch({ fov: 120, invertY: true });
    expect(store.get().fov).toBe(120);
    expect(store.get().invertY).toBe(true);
    expect(seen).toEqual([['fov', 'invertY']]);
  });

  it('keeps the same object until something changes', () => {
    const store = new SettingsStore(new MemoryStorage());
    const a = store.get();
    store.patch({ fov: a.fov });
    expect(store.get()).toBe(a);
    store.patch({ fov: 90 });
    expect(store.get()).not.toBe(a);
    expect(a.fov).toBe(DEFAULT_SETTINGS.fov);
  });

  it('stays quiet for a patch that changes nothing, including deep-equal objects', () => {
    const store = new SettingsStore(new MemoryStorage());
    let calls = 0;
    store.subscribe(() => void calls++);
    store.patch({ fov: DEFAULT_SETTINGS.fov, observer: { ...DEFAULT_SETTINGS.observer }, gamepad: defaultGamepadConfig() });
    expect(calls).toBe(0);
  });

  it('unsubscribes', () => {
    const store = new SettingsStore(new MemoryStorage());
    let calls = 0;
    const off = store.subscribe(() => void calls++);
    store.patch({ fov: 80 });
    off();
    store.patch({ fov: 90 });
    expect(calls).toBe(1);
  });

  it('a listener may unsubscribe itself while being called', () => {
    const store = new SettingsStore(new MemoryStorage());
    const calls: number[] = [];
    const off = store.subscribe(() => {
      calls.push(1);
      off();
    });
    store.subscribe(() => void calls.push(2));
    store.patch({ fov: 80 });
    store.patch({ fov: 90 });
    expect(calls).toEqual([1, 2, 2]);
  });

  it('ignores keys it does not know and non-own keys', () => {
    const store = new SettingsStore(new MemoryStorage());
    store.patch({ bogus: 1, __proto__: { fov: 10 } } as unknown as Partial<AppSettings>);
    expect(store.get().fov).toBe(DEFAULT_SETTINGS.fov);
    expect('bogus' in store.get()).toBe(false);
  });

  it('is usable as the input layer settings store', () => {
    const store = new SettingsStore(new MemoryStorage());
    const input: { get(): { mouseSensitivity: number }; patch(p: { mode: 'angle' }): void } = store;
    input.patch({ mode: 'angle' });
    expect(input.get().mouseSensitivity).toBe(1);
    expect(store.get().mode).toBe('angle');
  });
});

describe('validation', () => {
  it('clamps numbers into their range', () => {
    const store = new SettingsStore(new MemoryStorage());
    store.patch({ fov: 500, renderScale: 0, mouseCentering: -3, laps: 99.6, gateCount: 1, windSpeed: 1e9, osdScale: 10 });
    const s = store.get();
    expect(s.fov).toBe(150);
    expect(s.renderScale).toBe(0.25);
    expect(s.mouseCentering).toBe(0);
    expect(s.laps).toBe(10);
    expect(s.gateCount).toBe(4);
    expect(s.windSpeed).toBe(30);
    expect(s.osdScale).toBe(2);
  });

  it('rounds integer settings', () => {
    const store = new SettingsStore(new MemoryStorage());
    store.patch({ targetFps: 143.6, seed: 12.4 });
    expect(store.get().targetFps).toBe(144);
    expect(store.get().seed).toBe(12);
  });

  it('keeps the old value for the wrong type, NaN or Infinity', () => {
    const store = new SettingsStore(new MemoryStorage());
    store.patch({ fov: 'wide', renderScale: Number.NaN, vsync: 1, quality: 'ludicrous', mode: 3 } as unknown as Partial<AppSettings>);
    const s = store.get();
    expect(s.fov).toBe(DEFAULT_SETTINGS.fov);
    expect(s.renderScale).toBe(DEFAULT_SETTINGS.renderScale);
    expect(s.vsync).toBe(DEFAULT_SETTINGS.vsync);
    expect(s.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(s.mode).toBe(DEFAULT_SETTINGS.mode);
    store.patch({ windSpeed: Infinity });
    expect(store.get().windSpeed).toBe(0);
  });

  it('accepts the enum values', () => {
    const store = new SettingsStore(new MemoryStorage());
    store.patch({ quality: 'ultra', mode: 'horizon', trackStyle: 'mountain' });
    expect(store.get()).toMatchObject({ quality: 'ultra', mode: 'horizon', trackStyle: 'mountain' });
  });

  it('validates the observer field by field', () => {
    const store = new SettingsStore(new MemoryStorage());
    store.patch({ observer: { latitudeDeg: 200, longitudeDeg: 'x', altitudeM: 50 } } as unknown as Partial<AppSettings>);
    expect(store.get().observer).toEqual({ latitudeDeg: 90, longitudeDeg: DEFAULT_SETTINGS.observer.longitudeDeg, altitudeM: 50 });
  });

  it('runs the gamepad config through its own sanitiser and ignores non-objects', () => {
    const store = new SettingsStore(new MemoryStorage());
    store.patch({ gamepad: { ...defaultGamepadConfig(), deadzone: 9, profile: 'nonsense' } } as unknown as Partial<AppSettings>);
    expect(store.get().gamepad.deadzone).toBe(0.4);
    expect(store.get().gamepad.profile).toBe('auto');
    const before = store.get().gamepad;
    store.patch({ gamepad: 'oops' } as unknown as Partial<AppSettings>);
    expect(store.get().gamepad).toEqual(before);
  });

  it('rejects an empty or absurdly long airframe name', () => {
    const store = new SettingsStore(new MemoryStorage());
    store.patch({ quadPreset: '' });
    expect(store.get().quadPreset).toBe('QUAD_5IN_6S');
    store.patch({ quadPreset: 'x'.repeat(100) });
    expect(store.get().quadPreset).toBe('QUAD_5IN_6S');
    store.patch({ quadPreset: 'QUAD_3IN' });
    expect(store.get().quadPreset).toBe('QUAD_3IN');
  });
});

describe('persistence', () => {
  it('writes a versioned payload and a second store loads it', () => {
    const mem = new MemoryStorage();
    const a = new SettingsStore(mem);
    a.patch({ fov: 110, invertY: true, seed: 42, trackStyle: 'sprint', windSpeed: 7 });
    expect(stored(mem).version).toBe(SETTINGS_VERSION);
    const b = new SettingsStore(mem);
    expect(b.get()).toMatchObject({ fov: 110, invertY: true, seed: 42, trackStyle: 'sprint', windSpeed: 7 });
  });

  it('round-trips every key that is persisted', () => {
    const mem = new MemoryStorage();
    const a = new SettingsStore(mem);
    a.patch({ timeScale: 60, observer: { latitudeDeg: 10, longitudeDeg: -20, altitudeM: 30 }, gamepad: { ...defaultGamepadConfig(), expo: 0.4 } });
    const b = new SettingsStore(mem);
    for (const key of SETTING_KEYS) if (key !== 'timeMs') expect(b.get()[key]).toEqual(a.get()[key]);
  });

  it('does not persist the sim time of day', () => {
    const mem = new MemoryStorage();
    const a = new SettingsStore(mem);
    a.patch({ fov: 90 });
    a.patch({ timeMs: 123456789 });
    expect('timeMs' in stored(mem).settings).toBe(false);
    expect(new SettingsStore(mem).get().timeMs).toBe(DEFAULT_SETTINGS.timeMs);
  });

  it('skips the write when only the time changed', () => {
    const mem = new MemoryStorage();
    const a = new SettingsStore(mem);
    a.patch({ timeMs: 1 });
    a.patch({ timeMs: 2 });
    expect(mem.writes).toBe(0);
    a.patch({ fov: 90 });
    expect(mem.writes).toBe(1);
  });

  it('still tells listeners about a time change', () => {
    const a = new SettingsStore(new MemoryStorage());
    let seen = 0;
    a.subscribe((s) => void (seen = s.timeMs));
    a.patch({ timeMs: 5000 });
    expect(seen).toBe(5000);
  });

  it('survives corrupt JSON, wrong shapes and a hostile payload', () => {
    for (const text of ['{not json', 'null', '42', '"str"', '[1,2]', '{"version":1,"settings":7}']) {
      const mem = new MemoryStorage();
      mem.data.set(SETTINGS_KEY, text);
      expect(new SettingsStore(mem).get()).toEqual(defaultAppSettings());
    }
  });

  it('validates and clamps what it loads and drops unknown keys', () => {
    const mem = new MemoryStorage();
    mem.data.set(SETTINGS_KEY, JSON.stringify({ version: 1, settings: { fov: 9000, quality: 'nope', invertY: true, evil: 'x', renderScale: 0.5 } }));
    const s = new SettingsStore(mem).get();
    expect(s.fov).toBe(150);
    expect(s.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(s.invertY).toBe(true);
    expect(s.renderScale).toBe(0.5);
    expect('evil' in s).toBe(false);
  });

  it('migrates the bare, unversioned layout of older builds', () => {
    const mem = new MemoryStorage();
    mem.data.set(SETTINGS_KEY, JSON.stringify({ fov: 88, vsync: true }));
    expect(new SettingsStore(mem).get()).toMatchObject({ fov: 88, vsync: true });
  });

  it('reads a newer version best-effort', () => {
    const mem = new MemoryStorage();
    mem.data.set(SETTINGS_KEY, JSON.stringify({ version: 9, settings: { fov: 70, brandNewThing: true } }));
    const s = new SettingsStore(mem).get();
    expect(s.fov).toBe(70);
    expect('brandNewThing' in s).toBe(false);
  });

  it('a stored time is ignored on load', () => {
    const mem = new MemoryStorage();
    mem.data.set(SETTINGS_KEY, JSON.stringify({ version: 1, settings: { timeMs: 5 } }));
    expect(new SettingsStore(mem).get().timeMs).toBe(DEFAULT_SETTINGS.timeMs);
  });

  it('keeps working when the storage throws', () => {
    const mem = new MemoryStorage();
    mem.failWrites = true;
    const store = new SettingsStore(mem);
    expect(() => store.patch({ fov: 90 })).not.toThrow();
    expect(store.get().fov).toBe(90);
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const b = new SettingsStore(broken);
    expect(b.get()).toEqual(defaultAppSettings());
    expect(() => b.patch({ fov: 70 })).not.toThrow();
    expect(() => b.reset()).not.toThrow();
  });

  it('works with no storage at all', () => {
    const store = new SettingsStore(null);
    store.patch({ fov: 70 });
    expect(store.get().fov).toBe(70);
  });
});

describe('reset', () => {
  it('restores the defaults, clears storage and notifies with the changed keys', () => {
    const mem = new MemoryStorage();
    const store = new SettingsStore(mem);
    store.patch({ fov: 70, invertY: true });
    const seen: string[][] = [];
    store.subscribe((_s, changed) => void seen.push([...changed]));
    store.reset();
    expect(store.get()).toEqual(defaultAppSettings());
    expect(mem.data.has(SETTINGS_KEY)).toBe(false);
    expect(seen).toEqual([['fov', 'invertY']]);
  });

  it('does not notify when already at the defaults', () => {
    const store = new SettingsStore(new MemoryStorage());
    let calls = 0;
    store.subscribe(() => void calls++);
    store.reset();
    expect(calls).toBe(0);
  });
});
