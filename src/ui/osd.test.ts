import { describe, expect, it } from 'vitest';
import { createSessionSnapshot, type SessionSnapshot } from '../game/sessionTypes';
import { makeQuadState } from '../game/testKit';
import { buildHud, createHudModel, type HudModel, type HudSettings } from './hud';
import { OsdRenderer } from './osd';
import { COLOR_AMBER, COLOR_GREEN, COLOR_RED } from './osdPainter';
import { makeSurface, rayWorldY, RecordingContext } from './osdTestKit';

const SETTINGS: HudSettings = { mode: 'acro', showOsd: true, osdScale: 1, fov: 100, cameraTiltDeg: 30, autoRespawn: false };

function flying(): SessionSnapshot {
  const s = createSessionSnapshot();
  s.state = 'flying';
  return s;
}

function setup(cssW = 1280, cssH = 720, dpr = 1) {
  const surface = makeSurface(cssW, cssH);
  const g = new RecordingContext();
  const osd = new OsdRenderer(surface, g, () => dpr);
  return { surface, g, osd };
}

function model(snap: SessionSnapshot = flying(), over: Partial<HudModel> = {}): HudModel {
  const m = buildHud(makeQuadState({ armed: true, batteryVoltage: 23.22, batteryMah: 312, batteryCurrent: 27.4 }), snap, SETTINGS, 3.2, createHudModel());
  return Object.assign(m, over);
}

describe('OsdRenderer canvas handling', () => {
  it('fills its parent through CSS and sizes the backing store in device pixels', () => {
    const { surface, osd } = setup(1280, 720, 2);
    expect(surface.style.width).toBe('100%');
    expect(surface.style.height).toBe('100%');
    expect(osd.resize()).toBe(true);
    expect(surface.width).toBe(2560);
    expect(surface.height).toBe(1440);
    expect(osd.resize()).toBe(false);
  });

  it('keeps the old size for a canvas that is not laid out yet', () => {
    const { surface, osd } = setup(0, 0);
    expect(osd.resize()).toBe(false);
    expect(surface.width).toBe(300);
  });

  it('follows a change of the displayed size', () => {
    const { surface, osd } = setup(1280, 720);
    osd.resize();
    surface.cssW = 800;
    surface.cssH = 600;
    expect(osd.resize()).toBe(true);
    expect([surface.width, surface.height]).toEqual([800, 600]);
  });

  it('clears the whole backing store and draws nothing while hidden', () => {
    const { g, osd } = setup();
    osd.draw(model(createSessionSnapshot()), 0);
    expect(g.clears).toBe(1);
    expect(g.texts).toHaveLength(0);
    expect(g.lines).toHaveLength(0);
  });

  it('throws a clear error when a canvas has no 2D context', () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => OsdRenderer.forCanvas(canvas)).toThrow(/2D canvas/);
  });
});

describe('OSD readouts', () => {
  it('draws the battery, timer, arm state, mode and motion values', () => {
    const { g, osd } = setup();
    const snap = flying();
    snap.flightTime = 75.4;
    snap.throttle = 0.42;
    osd.draw(buildHud(makeQuadState({ armed: true, batteryVoltage: 23.22, batteryMah: 312, batteryCurrent: 27.4, vel: [0, 0, -20], pos: [0, 6.4, 0] }), snap, SETTINGS, 3.2, createHudModel()), 0);
    for (const s of ['3.87V', '23.2V', '312mAh', '1:15', 'ARMED', 'ACRO', '27A', '72km/h', '42%', '3.2m', 'FLY', 'THR', 'AGL']) {
      expect(g.has(s), s).toBe(true);
    }
    expect(g.find('ARMED')?.color).toBe(COLOR_GREEN);
  });

  it('says DISARMED and ALT when disarmed and the ground is unknown', () => {
    const { g, osd } = setup();
    const m = buildHud(makeQuadState(), flying(), SETTINGS, NaN, createHudModel());
    osd.draw(m, 0);
    expect(g.has('DISARMED')).toBe(true);
    expect(g.has('ALT')).toBe(true);
    expect(g.has('AGL')).toBe(false);
  });

  it('puts the corners where a flight controller OSD has them', () => {
    const { g, osd } = setup(1280, 720);
    osd.draw(model(), 0);
    const cell = g.find('3.87V')!;
    const armed = g.find('ARMED')!;
    const speed = g.find('0km/h')!;
    expect(cell.align).toBe('left');
    expect(cell.x).toBeLessThan(200);
    expect(cell.y).toBeLessThan(120);
    expect(armed.align).toBe('right');
    expect(armed.x).toBeGreaterThan(1080);
    expect(speed.y).toBeGreaterThan(560);
  });

  it('scales text with the canvas height and the OSD scale', () => {
    const small = setup(1280, 720);
    small.osd.draw(model(), 0);
    const big = setup(2560, 1440);
    big.osd.draw(model(), 0);
    expect(big.g.fontPx('3.87V') / small.g.fontPx('3.87V')).toBeGreaterThan(1.9);
    expect(big.g.fontPx('3.87V') / small.g.fontPx('3.87V')).toBeLessThan(2.1);
    const scaled = setup(1280, 720);
    scaled.osd.draw(model(flying(), { osdScale: 1.5 }), 0);
    expect(scaled.g.fontPx('3.87V')).toBeGreaterThan(small.g.fontPx('3.87V'));
  });

  it('keeps the text on the picture at small and odd sizes', () => {
    for (const [w, h] of [[320, 180], [800, 1200], [3840, 2160]]) {
      const { g, osd } = setup(w, h);
      osd.draw(model(), 0);
      for (const t of g.texts) {
        expect(t.y).toBeGreaterThan(0);
        expect(t.y).toBeLessThan(h + 1);
        expect(t.x).toBeGreaterThan(0);
        expect(t.x).toBeLessThan(w);
      }
    }
  });
});

describe('OSD attitude', () => {
  it('draws the crosshair and horizon for the FPV camera and only the readouts otherwise', () => {
    const fpv = setup();
    fpv.osd.draw(model(), 0);
    expect(fpv.g.lines.length).toBeGreaterThan(6);
    const chase = setup();
    chase.osd.draw(model(flying(), { fpv: false }), 0);
    expect(chase.g.lines).toHaveLength(0);
    expect(chase.g.has('3.87V')).toBe(true);
  });

  it('draws the aiming cross around the middle of the picture', () => {
    const { g, osd } = setup(1280, 720);
    osd.draw(model(), 0);
    const near = g.lines.filter((l) => Math.abs(l.x0 - 640) < 40 && Math.abs(l.y0 - 360) < 40 && Math.abs(l.x1 - 640) < 40 && Math.abs(l.y1 - 360) < 40);
    expect(near.length).toBeGreaterThanOrEqual(4);
  });
});

describe('OSD horizon', () => {
  it('lies on the true horizon of a banked, pitched quad with a tilted camera', () => {
    const quat: [number, number, number, number] = [0.15, 0.35, -0.5, 0];
    const n = Math.hypot(quat[0], quat[1], quat[2], 1);
    for (let i = 0; i < 3; i++) quat[i] /= n;
    quat[3] = 1 / n;
    const { g, osd } = setup(1280, 720);
    const settings = { ...SETTINGS, cameraTiltDeg: 30 };
    osd.draw(buildHud(makeQuadState({ quat }), flying(), settings, NaN, createHudModel()), 0);
    const tilt = (30 * Math.PI) / 180, fovY = (settings.fov * Math.PI) / 180;
    const onHorizon = g.lines.filter((l) => Math.abs(rayWorldY(quat, tilt, fovY, 1280, 720, l.x0, l.y0)) < 1e-6 && Math.abs(rayWorldY(quat, tilt, fovY, 1280, 720, l.x1, l.y1)) < 1e-6);
    expect(onHorizon.length).toBeGreaterThanOrEqual(2);
    const tiltedInPicture = onHorizon.some((l) => Math.abs(l.y1 - l.y0) > 1);
    expect(tiltedInPicture).toBe(true);
  });
});

describe('OSD warnings', () => {
  it('shows CRASH in red and offers the respawn', () => {
    const { g, osd } = setup();
    osd.draw(model(flying(), { crash: true, respawn: true }), 0);
    expect(g.find('CRASH')?.color).toBe(COLOR_RED);
    expect(g.has('PRESS R TO RESPAWN')).toBe(true);
    const crash = g.find('CRASH')!, hint = g.find('PRESS R TO RESPAWN')!;
    expect(hint.y).toBeGreaterThan(crash.y);
  });

  it('shows no warnings in normal flight', () => {
    const { g, osd } = setup();
    osd.draw(model(), 0);
    for (const s of ['CRASH', 'LOW BATTERY', 'THROTTLE HIGH', 'TURTLE MODE', 'PAUSED', 'PRESS R TO RESPAWN']) expect(g.has(s), s).toBe(false);
  });

  it('shows throttle-high, turtle and pause notices, stacked without overlap', () => {
    const { g, osd } = setup();
    osd.draw(model(flying(), { throttleHigh: true, turtle: true, paused: true, message: 'Hello' }), 0);
    const a = g.find('THROTTLE HIGH')!, b = g.find('TURTLE MODE')!, c = g.find('Hello')!;
    expect(a.color).toBe(COLOR_AMBER);
    expect(b.y).toBeGreaterThan(a.y);
    expect(c.y).toBeGreaterThan(b.y);
    expect(g.has('PAUSED')).toBe(true);
  });

  it('flashes LOW BATTERY and flashes faster when critical', () => {
    const low = { lowBattery: true, cellText: '3.40V' };
    const a = setup();
    a.osd.draw(model(flying(), low), 100);
    expect(a.g.find('LOW BATTERY')?.color).toBe(COLOR_AMBER);
    expect(a.g.find('3.40V')?.color).toBe(COLOR_AMBER);
    const b = setup();
    b.osd.draw(model(flying(), low), 700);
    expect(b.g.has('LOW BATTERY')).toBe(false);
    expect(b.g.find('3.40V')?.color).toBe('#fff');
    const crit = { lowBattery: true, criticalBattery: true, cellText: '3.20V' };
    const c = setup();
    c.osd.draw(model(flying(), crit), 100);
    expect(c.g.find('LOW BATTERY')?.color).toBe(COLOR_RED);
    const d = setup();
    d.osd.draw(model(flying(), crit), 300);
    expect(d.g.has('LOW BATTERY')).toBe(false);
    const e = setup();
    e.osd.draw(model(flying(), crit), 600);
    expect(e.g.has('LOW BATTERY')).toBe(true);
  });
});

describe('OSD race', () => {
  function race(over: Partial<SessionSnapshot['race']> = {}): SessionSnapshot {
    const snap = flying();
    Object.assign(snap.race, { active: true, gateCount: 12, nextGate: 2, lap: 2, laps: 3, started: true, lapTime: 12.345, bestLap: 41.2 }, over);
    return snap;
  }

  it('lists gate, lap, lap time and best in the right column', () => {
    const { g, osd } = setup();
    osd.draw(model(race()), 0);
    for (const s of ['GATE 3/12', 'LAP 2/3', '0:12.35', '0:41.200', 'TIME', 'BEST']) expect(g.has(s), s).toBe(true);
    expect(g.find('GATE 3/12')!.align).toBe('right');
    expect(g.find('LAP 2/3')!.y).toBeGreaterThan(g.find('GATE 3/12')!.y);
    expect(g.find('GATE 3/12')!.y).toBeGreaterThan(g.find('ACRO')!.y);
  });

  it('colours the split green when ahead and red when behind', () => {
    const ahead = setup();
    ahead.osd.draw(model(race({ splitDelta: -0.42, splitAt: 0 })), 0);
    expect(ahead.g.find('-0.420')?.color).toBe(COLOR_GREEN);
    const behind = setup();
    behind.osd.draw(model(race({ splitDelta: 0.3, splitAt: 0 })), 0);
    expect(behind.g.find('+0.300')?.color).toBe(COLOR_RED);
  });

  it('announces a missed gate', () => {
    const { g, osd } = setup();
    osd.draw(model(race({ missedGate: 4, missedAt: 0 })), 0);
    expect(g.find('MISSED GATE 5')?.color).toBe(COLOR_AMBER);
  });

  it('leaves the panel out on a free-flight track', () => {
    const { g, osd } = setup();
    osd.draw(model(), 0);
    expect(g.texts.some((t) => t.text.startsWith('GATE'))).toBe(false);
  });

  it('shows the finish card with every lap and a backdrop', () => {
    const { g, osd } = setup();
    osd.draw(model(race({ finished: true, totalTime: 125.5, lapTimes: [42, 43.4, 40.1] })), 0);
    for (const s of ['FINISHED', '2:05.500', 'LAP 1  0:42.000', 'LAP 2  0:43.400', 'LAP 3  0:40.100']) expect(g.has(s), s).toBe(true);
    expect(g.find('FINISHED')?.color).toBe(COLOR_GREEN);
    expect(g.rects).toHaveLength(1);
    const r = g.rects[0];
    expect(r.x).toBeGreaterThan(0);
    expect(r.x + r.w).toBeLessThan(1280);
    expect(r.y + r.h).toBeLessThan(720);
  });

  it('caps a long lap list so the card stays on screen', () => {
    const { g, osd } = setup();
    const lapTimes = Array.from({ length: 30 }, (_, i) => 40 + i);
    osd.draw(model(race({ finished: true, totalTime: 999, laps: 30, lapTimes })), 0);
    expect(g.texts.filter((t) => t.text.startsWith('LAP 1') || t.text.startsWith('LAP 2')).length).toBeGreaterThan(0);
    expect(g.texts.filter((t) => /^LAP \d+ {2}/.test(t.text))).toHaveLength(10);
    const r = g.rects[0];
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.h).toBeLessThanOrEqual(720);
  });
});
