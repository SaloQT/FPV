import { describe, expect, it } from 'vitest';
import { defaultPilotOptions, OPTIONS_KEY, PilotOptionsStore, sanitizeOptions, type OptionsStorage } from './pilotOptions';

function memory(initial?: string): OptionsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(OPTIONS_KEY, initial);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('sanitizeOptions', () => {
  const base = defaultPilotOptions();

  it('keeps good values and clamps numbers', () => {
    const o = sanitizeOptions({ timeMode: 'real', cycleScale: 5000, fixedHour: -3, raceStart: false, showSticks: false }, base);
    expect(o).toEqual({ timeMode: 'real', cycleScale: 1000, fixedHour: 0, raceStart: false, showSticks: false });
  });

  it('falls back per field for wrong types and unknown modes', () => {
    const o = sanitizeOptions({ timeMode: 'warp', cycleScale: 'fast', fixedHour: NaN, raceStart: 1, showSticks: null, extra: true }, base);
    expect(o).toEqual(base);
  });

  it('survives non-objects', () => {
    expect(sanitizeOptions(null, base)).toEqual(base);
    expect(sanitizeOptions([1], base)).toEqual(base);
  });
});

describe('PilotOptionsStore', () => {
  it('starts from the defaults and saves only real changes', () => {
    const mem = memory();
    const store = new PilotOptionsStore(mem);
    expect(store.get()).toEqual(defaultPilotOptions());
    const first = store.get();
    store.patch({ raceStart: true });
    expect(store.get()).toBe(first);
    expect(mem.data.has(OPTIONS_KEY)).toBe(false);
    store.patch({ raceStart: false });
    expect(store.get()).not.toBe(first);
    expect(JSON.parse(mem.data.get(OPTIONS_KEY)!)).toMatchObject({ raceStart: false });
  });

  it('tells listeners which keys changed and loads what was saved', () => {
    const mem = memory();
    const store = new PilotOptionsStore(mem);
    const seen: string[][] = [];
    store.subscribe((_o, changed) => seen.push([...changed]));
    store.patch({ timeMode: 'fixed', fixedHour: 21.5 });
    expect(seen).toEqual([['timeMode', 'fixedHour']]);
    const again = new PilotOptionsStore(mem);
    expect(again.get()).toMatchObject({ timeMode: 'fixed', fixedHour: 21.5 });
  });

  it('survives corrupt storage and a blocked storage', () => {
    expect(new PilotOptionsStore(memory('{nope')).get()).toEqual(defaultPilotOptions());
    const throwing: OptionsStorage = {
      getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); },
    };
    const store = new PilotOptionsStore(throwing);
    expect(() => store.patch({ showSticks: false })).not.toThrow();
    expect(store.get().showSticks).toBe(false);
    expect(() => store.reset()).not.toThrow();
  });

  it('resets to the defaults and says what moved', () => {
    const mem = memory();
    const store = new PilotOptionsStore(mem);
    store.patch({ showSticks: false, timeMode: 'real' });
    const seen: string[][] = [];
    store.subscribe((_o, changed) => seen.push([...changed]));
    store.reset();
    expect(store.get()).toEqual(defaultPilotOptions());
    expect(seen).toEqual([['timeMode', 'showSticks']]);
    expect(mem.data.has(OPTIONS_KEY)).toBe(false);
  });
});
