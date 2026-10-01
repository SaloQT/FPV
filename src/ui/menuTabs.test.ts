import { describe, expect, it } from 'vitest';
import { localSolarHours } from '../game/clock';
import { bearing, fixed, percent, solarDate, withSolarDate, type Control, type MenuTab } from './menuSchema';
import { buildTabs, TRACK_SETUP } from './menuTabs';
import { defaultAppSettings, sanitizeValue, type AppSettings } from './settingsSchema';
import { SettingsStore } from './settingsStore';

const PRESETS = [{ id: 'QUAD_5IN_6S', label: '5 inch, 6S' }, { id: 'QUAD_3IN_4S', label: '3 inch, 4S' }];
const TABS = buildTabs(PRESETS);

function controls(tabs: readonly MenuTab[]): { tab: string; control: Control }[] {
  return tabs.flatMap((t) => t.sections.flatMap((s) => s.controls.map((control) => ({ tab: t.id, control }))));
}

function applied(control: Control & { write(v: never, s: AppSettings): Partial<AppSettings> }, value: unknown): AppSettings {
  const store = new SettingsStore(null);
  store.patch(control.write(value as never, store.get()));
  return store.get();
}

describe('settings tabs', () => {
  it('cover the five areas of the brief in order', () => {
    expect(TABS.map((t) => t.id)).toEqual(['graphics', 'camera', 'controls', 'simulation', 'audio']);
    for (const t of TABS) expect(t.sections.length).toBeGreaterThan(0);
  });

  it('give every control an id that is unique within its tab and a label', () => {
    for (const t of TABS) {
      const all = t.sections.flatMap((s) => s.controls);
      const ids = all.map((c) => c.id);
      expect(new Set(ids).size, t.id).toBe(ids.length);
      for (const c of all) expect(c.label.length, c.id).toBeGreaterThan(0);
    }
  });

  it('offers the target frame rates, time scales and quality tiers the brief lists', () => {
    const values = (id: string): string[] => {
      const c = controls(TABS).map((x) => x.control).find((x) => x.id === id);
      if (c?.kind !== 'select') throw new Error(`${id} is not a select`);
      return c.options.map((o) => o.value);
    };
    expect(values('targetFps')).toEqual(['0', '60', '120', '144', '165', '240', '360']);
    expect(values('frameCap')).toEqual(['0', '240', '144', '120', '60', '30']);
    expect(values('timeScale')).toEqual(['0', '1', '10', '60', '600']);
    expect(values('quality')).toEqual(['low', 'medium', 'high', 'ultra', 'perf240']);
    expect(values('quadPreset')).toEqual(['QUAD_5IN_6S', 'QUAD_3IN_4S']);
  });

  it('read the defaults inside their own range and options', () => {
    const d = defaultAppSettings();
    for (const { tab, control: c } of controls(TABS)) {
      const where = `${tab}.${c.id}`;
      if (c.kind === 'slider') {
        const v = c.read(d);
        expect(v, where).toBeGreaterThanOrEqual(c.min);
        expect(v, where).toBeLessThanOrEqual(c.max);
        expect(c.format(v).length, where).toBeGreaterThan(0);
      } else if (c.kind === 'select' && c.id !== 'quadPreset') {
        expect(c.options.map((o) => o.value), where).toContain(c.read(d));
      }
    }
  });
});

describe('control writes', () => {
  it('slider ends are accepted by the settings schema unchanged, so no input is silently clamped', () => {
    for (const { tab, control: c } of controls(TABS)) {
      if (c.kind !== 'slider') continue;
      for (const v of [c.min, c.max]) expect(c.read(applied(c, v)), `${tab}.${c.id} at ${v}`).toBeCloseTo(v, 9);
    }
  });

  it('round-trip every slider, toggle and select through the store', () => {
    for (const { tab, control: c } of controls(TABS)) {
      const where = `${tab}.${c.id}`;
      if (c.kind === 'slider') {
        const mid = c.min + Math.round((c.max - c.min) / 2 / c.step) * c.step;
        expect(c.read(applied(c, mid)), where).toBeCloseTo(mid, 9);
      } else if (c.kind === 'toggle') {
        for (const v of [true, false]) expect(c.read(applied(c, v)), where).toBe(v);
      } else if (c.kind === 'select') {
        for (const o of c.options) expect(c.read(applied(c, o.value)), where).toBe(o.value);
      }
    }
  });

  it('Performance 240 is High with the preset on; any real tier turns the preset off again', () => {
    const q = controls(TABS).map((c) => c.control).find((c) => c.id === 'quality');
    if (q?.kind !== 'select') throw new Error('missing quality select');
    const base = { ...defaultAppSettings(), quality: 'ultra' as const };
    expect(q.write('perf240', base)).toEqual({ quality: 'high', performance240: true });
    expect(q.write('low', { ...base, performance240: true })).toEqual({ quality: 'low', performance240: false });
  });

  it('the old v-sync toggle is gone and the frame cap says what browsers can do', () => {
    const all = controls(TABS).map((c) => c.control);
    expect(all.some((c) => c.id === 'vsync')).toBe(false);
    const cap = all.find((c) => c.id === 'frameCap');
    expect(cap?.hint ?? '').toMatch(/cannot turn v-sync off/i);
  });

  it('write only the gamepad calibration of the axis they name', () => {
    const inv = controls(TABS).map((c) => c.control).find((c) => c.id === 'gamepad.invert.yaw');
    if (inv?.kind !== 'toggle') throw new Error('missing invert toggle');
    const next = applied(inv, true);
    expect(next.gamepad.cal.yaw.invert).toBe(true);
    expect(next.gamepad.cal.roll.invert).toBe(false);
    expect(next.gamepad.cal.yaw.max).toBe(defaultAppSettings().gamepad.cal.yaw.max);
  });

  it('keep the seed inside the schema and offer a random button for it', () => {
    const seed = TRACK_SETUP.find((c) => c.kind === 'number');
    if (seed?.kind !== 'number') throw new Error('missing seed');
    expect(seed.random).toBe(true);
    expect(sanitizeValue('seed', seed.max, 0)).toBe(seed.max);
    expect(seed.read(applied(seed, 424242))).toBe(424242);
  });
});

describe('time of day and date', () => {
  const noon = Date.UTC(2026, 5, 21, 12, 0, 0);

  it('the slider moves the solar time and leaves the date alone', () => {
    const slider = controls(TABS).map((c) => c.control).find((c) => c.id === 'timeOfDay');
    const date = controls(TABS).map((c) => c.control).find((c) => c.id === 'date');
    if (slider?.kind !== 'slider' || date?.kind !== 'date') throw new Error('missing controls');
    const s = { ...defaultAppSettings(), timeMs: noon };
    const before = date.read(s);
    const next = { ...s, ...slider.write(23.75, s) };
    expect(slider.read(next)).toBeCloseTo(23.75, 9);
    expect(date.read(next)).toBe(before);
    expect(slider.read({ ...s, ...slider.write(0, s) })).toBeCloseTo(0, 9);
  });

  it('the date changes the day and keeps the solar time', () => {
    const lon = 8;
    const t = noon + 3 * 3600000;
    const moved = withSolarDate(t, lon, '2026-12-21');
    expect(solarDate(moved, lon)).toBe('2026-12-21');
    expect(localSolarHours(moved, lon)).toBeCloseTo(localSolarHours(t, lon), 9);
  });

  it('reads the calendar day at the site, not in UTC', () => {
    const t = Date.UTC(2026, 5, 21, 23, 0, 0);
    expect(solarDate(t, 0)).toBe('2026-06-21');
    expect(solarDate(t, 90)).toBe('2026-06-22');
    expect(solarDate(t, -90)).toBe('2026-06-21');
  });

  it('ignores dates that do not exist or are out of range', () => {
    for (const bad of ['', 'nonsense', '2026-02-30', '2026-13-01', '1800-01-01', '2500-01-01', '2026-6-1']) expect(withSolarDate(noon, 8, bad), bad).toBe(noon);
    expect(withSolarDate(noon, 8, '2024-02-29')).not.toBe(noon);
  });
});

describe('value formats', () => {
  it('names the compass point of a wind bearing', () => {
    expect(bearing(0)).toBe('0° N');
    expect(bearing(90)).toBe('90° E');
    expect(bearing(225)).toBe('225° SW');
    expect(bearing(359.6)).toBe('0° N');
    expect(bearing(-90)).toBe('270° W');
  });

  it('formats percentages and fixed decimals', () => {
    expect(percent(0.155)).toBe('16%');
    expect(fixed(1, ' m/s')(12)).toBe('12.0 m/s');
  });
});
