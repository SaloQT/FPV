import { describe, expect, it } from 'vitest';
import { localSolarHours } from '../game/clock';
import { PilotOptionsStore } from '../ui/pilotOptions';
import { SettingsStore } from '../ui/settingsStore';
import { applyBootTime, onTimeNudged, raceStartEnabled, updateHints } from './flow';
import type { AppCtx } from './state';

interface FakeCtx {
  store: SettingsStore;
  params: { autostart: boolean; countdown?: boolean; hours?: number };
  ui: { options: PilotOptionsStore; lockHint: { visible: boolean } };
  session: { state: string };
  input: { pointerLocked: boolean; gamepad: { connected: boolean } };
}

function fake(over: Partial<FakeCtx['params']> = {}): { ctx: AppCtx; f: FakeCtx } {
  const f: FakeCtx = {
    store: new SettingsStore(null),
    params: { autostart: false, ...over },
    ui: { options: new PilotOptionsStore(null), lockHint: { visible: false } },
    session: { state: 'flying' },
    input: { pointerLocked: false, gamepad: { connected: false } },
  };
  return { ctx: f as unknown as AppCtx, f };
}

describe('raceStartEnabled', () => {
  it('follows the option, but scripted autostart runs skip the countdown unless the URL asks', () => {
    expect(raceStartEnabled(fake().ctx)).toBe(true);
    const off = fake();
    off.f.ui.options.patch({ raceStart: false });
    expect(raceStartEnabled(off.ctx)).toBe(false);
    expect(raceStartEnabled(fake({ autostart: true }).ctx)).toBe(false);
    expect(raceStartEnabled(fake({ autostart: true, countdown: true }).ctx)).toBe(true);
    expect(raceStartEnabled(fake({ countdown: false }).ctx)).toBe(false);
  });
});

describe('applyBootTime', () => {
  it('a day cycle keeps the start time and takes the saved speed', () => {
    const { ctx, f } = fake();
    f.ui.options.patch({ timeMode: 'cycle', cycleScale: 200 });
    const t = f.store.get().timeMs;
    applyBootTime(ctx);
    expect(f.store.get()).toMatchObject({ timeMs: t, timeScale: 200 });
  });

  it('a fixed time freezes the clock at the saved hour on the default date', () => {
    const { ctx, f } = fake();
    f.ui.options.patch({ timeMode: 'fixed', fixedHour: 21.5 });
    applyBootTime(ctx);
    const s = f.store.get();
    expect(s.timeScale).toBe(0);
    expect(localSolarHours(s.timeMs, s.observer.longitudeDeg)).toBeCloseTo(21.5, 9);
  });

  it('real time starts from the wall clock at real speed', () => {
    const { ctx, f } = fake();
    f.ui.options.patch({ timeMode: 'real' });
    const before = Date.now();
    applyBootTime(ctx);
    const s = f.store.get();
    expect(s.timeScale).toBe(1);
    expect(s.timeMs).toBeGreaterThanOrEqual(before);
    expect(s.timeMs).toBeLessThanOrEqual(Date.now());
  });

  it('a t= hour in the URL keeps its time and only the speed follows the saved choice', () => {
    const { ctx, f } = fake({ hours: 3 });
    f.store.patch({ timeMs: Date.UTC(2026, 5, 21, 3, 0, 0) });
    f.ui.options.patch({ timeMode: 'fixed', fixedHour: 21.5 });
    applyBootTime(ctx);
    expect(f.store.get()).toMatchObject({ timeMs: Date.UTC(2026, 5, 21, 3, 0, 0), timeScale: 0 });
  });
});

describe('onTimeNudged', () => {
  it('turns real time into a real-speed cycle (the clock no longer matches the wall) and leaves other modes alone', () => {
    const { ctx, f } = fake();
    f.ui.options.patch({ timeMode: 'real' });
    onTimeNudged(ctx);
    expect(f.ui.options.get()).toMatchObject({ timeMode: 'cycle', cycleScale: 1 });
    f.ui.options.patch({ timeMode: 'fixed' });
    onTimeNudged(ctx);
    expect(f.ui.options.get().timeMode).toBe('fixed');
  });
});

describe('updateHints', () => {
  it('asks for a click while flying with a free mouse, and not under a menu, with a pad, locked, or in scripted runs', () => {
    const { ctx, f } = fake();
    updateHints(ctx);
    expect(f.ui.lockHint.visible).toBe(true);
    f.input.pointerLocked = true;
    updateHints(ctx);
    expect(f.ui.lockHint.visible).toBe(false);
    f.input.pointerLocked = false;
    f.session.state = 'menu';
    updateHints(ctx);
    expect(f.ui.lockHint.visible).toBe(false);
    f.session.state = 'ready';
    f.input.gamepad.connected = true;
    updateHints(ctx);
    expect(f.ui.lockHint.visible).toBe(false);
    f.input.gamepad.connected = false;
    f.params.autostart = true;
    updateHints(ctx);
    expect(f.ui.lockHint.visible).toBe(false);
  });
});
