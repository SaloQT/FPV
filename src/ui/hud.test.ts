import { describe, expect, it } from 'vitest';
import type { QuadState } from '../contracts';
import { createSessionSnapshot, type SessionSnapshot } from '../game/sessionTypes';
import { makeQuadState } from '../game/testKit';
import { buildHud, createHudModel, MISSED_SHOW_S, SPLIT_SHOW_S, type HudModel, type HudSettings } from './hud';
import { horizonOffsetPx } from './hudFormat';
import { rayWorldY } from './osdTestKit';

const SETTINGS: HudSettings = { mode: 'acro', showOsd: true, osdScale: 1, fov: 100, cameraTiltDeg: 30, autoRespawn: false };

function flying(): SessionSnapshot {
  const s = createSessionSnapshot();
  s.state = 'flying';
  return s;
}

function run(state: QuadState, snap: SessionSnapshot, over: Partial<HudSettings> = {}, ground = NaN, out = createHudModel()): HudModel {
  return buildHud(state, snap, { ...SETTINGS, ...over }, ground, out);
}

describe('buildHud basics', () => {
  it('is hidden in the menu and when the OSD is switched off', () => {
    expect(run(makeQuadState(), createSessionSnapshot()).visible).toBe(false);
    expect(run(makeQuadState(), flying()).visible).toBe(true);
    expect(run(makeQuadState(), flying(), { showOsd: false }).visible).toBe(false);
  });

  it('fills the model passed in and returns it', () => {
    const out = createHudModel();
    expect(buildHud(makeQuadState(), flying(), SETTINGS, NaN, out)).toBe(out);
  });

  it('carries the OSD scale, the mode label and the arm state', () => {
    const m = run(makeQuadState({ armed: true }), flying(), { osdScale: 1.5, mode: 'horizon' });
    expect(m.osdScale).toBe(1.5);
    expect(m.modeText).toBe('HORIZON');
    expect(m.armed).toBe(true);
    expect(run(makeQuadState(), flying(), { mode: 'angle' }).modeText).toBe('ANGLE');
  });

  it('marks the FPV camera only', () => {
    const out = createHudModel();
    expect(buildHud(makeQuadState(), flying(), SETTINGS, NaN, out, 'chase').fpv).toBe(false);
    expect(buildHud(makeQuadState(), flying(), SETTINGS, NaN, out, 'fpv').fpv).toBe(true);
  });
});

describe('battery', () => {
  it('shows per-cell and pack voltage and the mAh drawn', () => {
    const m = run(makeQuadState({ batteryVoltage: 23.22, batteryMah: 312.4 }), flying());
    expect(m.cells).toBe(6);
    expect(m.cellText).toBe('3.87V');
    expect(m.packText).toBe('23.2V');
    expect(m.mahText).toBe('312mAh');
    expect(m.lowBattery).toBe(false);
  });

  it('keeps the pack size detected on the fresh battery as the voltage sags', () => {
    const out = createHudModel();
    run(makeQuadState({ batteryVoltage: 25.2, batteryMah: 0 }), flying(), {}, NaN, out);
    expect(out.cells).toBe(6);
    run(makeQuadState({ batteryVoltage: 19.8, batteryMah: 900 }), flying(), {}, NaN, out);
    expect(out.cells).toBe(6);
    expect(out.cellText).toBe('3.30V');
  });

  it('detects a new pack when the battery is swapped for a fresh one', () => {
    const out = createHudModel();
    run(makeQuadState({ batteryVoltage: 25.2, batteryMah: 0 }), flying(), {}, NaN, out);
    run(makeQuadState({ batteryVoltage: 16.8, batteryMah: 0 }), flying(), {}, NaN, out);
    expect(out.cells).toBe(4);
    expect(out.cellText).toBe('4.20V');
  });

  it('warns below 3.5 V per cell and again, more urgently, below 3.3 V', () => {
    const out = createHudModel();
    run(makeQuadState({ batteryVoltage: 25.2, batteryMah: 0 }), flying(), {}, NaN, out);
    run(makeQuadState({ batteryVoltage: 21.3, batteryMah: 1500 }), flying(), {}, NaN, out);
    expect(out.lowBattery).toBe(false);
    run(makeQuadState({ batteryVoltage: 20.9, batteryMah: 1500 }), flying(), {}, NaN, out);
    expect(out.lowBattery).toBe(true);
    expect(out.criticalBattery).toBe(false);
    run(makeQuadState({ batteryVoltage: 19.7, batteryMah: 1500 }), flying(), {}, NaN, out);
    expect(out.criticalBattery).toBe(true);
  });

  it('does not warn about a battery that reads nothing', () => {
    expect(run(makeQuadState({ batteryVoltage: 0 }), flying()).lowBattery).toBe(false);
  });

  it('survives NaN readings', () => {
    const m = run(makeQuadState({ batteryVoltage: NaN, batteryMah: NaN, batteryCurrent: NaN }), flying());
    expect(m.cellText).toBe('0.00V');
    expect(m.mahText).toBe('0mAh');
    expect(m.currentText).toBe('0.0A');
  });
});

describe('motion readouts', () => {
  it('reports speed in km/h and the throttle stick in percent', () => {
    const snap = flying();
    snap.throttle = 0.674;
    const m = run(makeQuadState({ vel: [10, 0, 0], batteryCurrent: 45.4 }), snap);
    expect(m.speedText).toBe('36km/h');
    expect(m.throttleText).toBe('67%');
    expect(m.currentText).toBe('45A');
  });

  it('includes the vertical speed in the speed and clamps the throttle', () => {
    const snap = flying();
    snap.throttle = 3;
    const m = run(makeQuadState({ vel: [3, 4, 0] }), snap);
    expect(m.speedText).toBe('18km/h');
    expect(m.throttleText).toBe('100%');
  });

  it('reports altitude above the ground when the terrain height is known', () => {
    const m = run(makeQuadState({ pos: [0, 112.4, 0] }), flying(), {}, 100);
    expect(m.altAgl).toBe(true);
    expect(m.altText).toBe('12m');
    expect(run(makeQuadState({ pos: [0, 103.24, 0] }), flying(), {}, 100).altText).toBe('3.2m');
  });

  it('falls back to the absolute altitude without terrain data', () => {
    const m = run(makeQuadState({ pos: [0, 112.4, 0] }), flying());
    expect(m.altAgl).toBe(false);
    expect(m.altText).toBe('112m');
  });

  it('gives the flight timer in m:ss', () => {
    const snap = flying();
    snap.flightTime = 83.7;
    expect(run(makeQuadState(), snap).timerText).toBe('1:23');
  });
});

describe('attitude', () => {
  it('reports the body pitch and adds the camera tilt to it when the quad is not banked', () => {
    const s = Math.sin(0.1), c = Math.cos(0.1);
    const m = run(makeQuadState({ quat: [s, 0, 0, c] }), flying(), { cameraTiltDeg: 30, fov: 90 });
    expect(m.attitude.pitch).toBeCloseTo(0.2, 9);
    expect(m.camera.pitch).toBeCloseTo(0.2 + (30 * Math.PI) / 180, 9);
    expect(m.camera.roll).toBeCloseTo(0, 9);
    expect(m.fovY).toBeCloseTo(Math.PI / 2, 12);
  });

  it('a banked quad with a tilted camera sees the horizon at the camera elevation, not body pitch plus tilt', () => {
    const bank = (60 * Math.PI) / 180;
    const m = run(makeQuadState({ quat: [0, 0, -Math.sin(bank / 2), Math.cos(bank / 2)] }), flying(), { cameraTiltDeg: 30 });
    expect(m.attitude.pitch).toBeCloseTo(0, 9);
    expect(m.camera.pitch).toBeCloseTo(Math.asin(Math.sin((30 * Math.PI) / 180) * Math.cos(bank)), 9);
    expect(m.camera.roll).toBeGreaterThan(bank);
    expect(m.camera.roll).toBeLessThan(Math.PI / 2);
  });

  it('places the horizon where the real one is in the picture for any attitude', () => {
    const quats: [number, number, number, number][] = [[0.15, 0.35, -0.5, 0], [-0.3, 0.1, 0.2, 0], [0.05, -0.6, 0.1, 0], [0.4, 0, 0.3, 0]];
    for (const raw of quats) {
      const n = Math.hypot(raw[0], raw[1], raw[2], 1);
      const quat: [number, number, number, number] = [raw[0] / n, raw[1] / n, raw[2] / n, 1 / n];
      for (const tilt of [0, 15, 35]) {
        const m = run(makeQuadState({ quat }), flying(), { cameraTiltDeg: tilt, fov: 110 });
        const off = horizonOffsetPx(m.camera.pitch, m.fovY, 720);
        const px = 640 + Math.sin(m.camera.roll) * off, py = 360 + Math.cos(m.camera.roll) * off;
        expect(rayWorldY(quat, (tilt * Math.PI) / 180, m.fovY, 1280, 720, px, py)).toBeCloseTo(0, 6);
      }
    }
  });
});

describe('warnings', () => {
  it('flags a crash from the state or the physics event', () => {
    const snap = flying();
    expect(run(makeQuadState(), snap).crash).toBe(false);
    expect(run(makeQuadState({ crashed: true }), snap).crash).toBe(true);
    snap.state = 'crashed';
    expect(run(makeQuadState(), snap).crash).toBe(true);
  });

  it('offers a respawn only when the session does, and not with auto-respawn', () => {
    const snap = flying();
    snap.state = 'crashed';
    snap.respawnOffered = true;
    expect(run(makeQuadState(), snap).respawn).toBe(true);
    expect(run(makeQuadState(), snap, { autoRespawn: true }).respawn).toBe(false);
  });

  it('passes through throttle-high, turtle, pause and the transient message', () => {
    const snap = flying();
    snap.throttleHigh = true;
    snap.turtle = true;
    snap.message = 'AUTO DISARM';
    let m = run(makeQuadState(), snap);
    expect([m.throttleHigh, m.turtle, m.message, m.paused]).toEqual([true, true, 'AUTO DISARM', false]);
    snap.state = 'paused';
    m = run(makeQuadState(), snap);
    expect(m.paused).toBe(true);
  });
});

describe('race panel', () => {
  function raceSnap(): SessionSnapshot {
    const snap = flying();
    Object.assign(snap.race, { active: true, gateCount: 12, nextGate: 2, gatesPassed: 2, lap: 2, laps: 3 });
    return snap;
  }

  it('is inactive on a track without gates', () => {
    expect(run(makeQuadState(), flying()).race.active).toBe(false);
  });

  it('shows the next gate and the lap', () => {
    const m = run(makeQuadState(), raceSnap());
    expect(m.race.active).toBe(true);
    expect(m.race.gateText).toBe('GATE 3/12');
    expect(m.race.lapText).toBe('LAP 2/3');
  });

  it('shows dashes for times that do not exist yet and times once they do', () => {
    const snap = raceSnap();
    let m = run(makeQuadState(), snap);
    expect(m.race.lapTimeText).toBe('-:--.--');
    expect(m.race.bestText).toBe('-:--.---');
    snap.race.started = true;
    snap.race.lapTime = 12.345;
    snap.race.bestLap = 41.2;
    m = run(makeQuadState(), snap);
    expect(m.race.lapTimeText).toBe('0:12.35');
    expect(m.race.bestText).toBe('0:41.200');
  });

  it('shows the split delta for a few seconds after it was set', () => {
    const snap = raceSnap();
    snap.simTime = 100;
    snap.race.splitDelta = -0.42;
    snap.race.splitAt = 99;
    let m = run(makeQuadState(), snap);
    expect(m.race.splitVisible).toBe(true);
    expect(m.race.splitAhead).toBe(true);
    expect(m.race.splitText).toBe('-0.420');
    snap.simTime = 99 + SPLIT_SHOW_S + 0.1;
    m = run(makeQuadState(), snap);
    expect(m.race.splitVisible).toBe(false);
    snap.race.splitDelta = NaN;
    snap.simTime = 99;
    expect(run(makeQuadState(), snap).race.splitVisible).toBe(false);
  });

  it('marks a slower split as behind', () => {
    const snap = raceSnap();
    snap.race.splitDelta = 0.3;
    expect(run(makeQuadState(), snap).race.splitAhead).toBe(false);
  });

  it('announces a missed gate for a short while', () => {
    const snap = raceSnap();
    snap.simTime = 50;
    snap.race.missedGate = 4;
    snap.race.missedAt = 49;
    let m = run(makeQuadState(), snap);
    expect(m.race.missedVisible).toBe(true);
    expect(m.race.missedText).toBe('MISSED GATE 5');
    snap.simTime = 49 + MISSED_SHOW_S + 0.5;
    m = run(makeQuadState(), snap);
    expect(m.race.missedVisible).toBe(false);
    snap.race.missedGate = -1;
    snap.simTime = 49;
    expect(run(makeQuadState(), snap).race.missedVisible).toBe(false);
  });

  it('counts down on the pad: lead-in caption, then 3, 2, 1 and GO', () => {
    const snap = flying();
    snap.state = 'ready';
    const out = createHudModel();
    Object.assign(snap.countdown, { active: true, locked: true, value: -1, fraction: 0.2 });
    let m = run(makeQuadState(), snap, {}, NaN, out);
    expect(m.countdown).toMatchObject({ visible: true, text: '', caption: 'GET READY', value: -1 });
    for (const [value, text] of [[3, '3'], [2, '2'], [1, '1']] as const) {
      Object.assign(snap.countdown, { value, fraction: 0.5 });
      m = run(makeQuadState(), snap, {}, NaN, out);
      expect(m.countdown).toMatchObject({ visible: true, text, caption: 'RACE START', value, fraction: 0.5 });
    }
    Object.assign(snap.countdown, { value: 0, locked: false });
    m = run(makeQuadState(), snap, {}, NaN, out);
    expect(m.countdown).toMatchObject({ visible: true, text: 'GO', caption: 'ARM AND FLY' });
    snap.countdown.active = false;
    expect(run(makeQuadState(), snap, {}, NaN, out).countdown.visible).toBe(false);
  });

  it('shows the countdown even with the OSD off, but not behind a menu or a pause', () => {
    const snap = flying();
    snap.state = 'ready';
    Object.assign(snap.countdown, { active: true, value: 2, fraction: 0 });
    expect(run(makeQuadState(), snap, { showOsd: false }).countdown.visible).toBe(true);
    snap.state = 'paused';
    expect(run(makeQuadState(), snap).countdown.visible).toBe(false);
    snap.state = 'menu';
    expect(run(makeQuadState(), snap).countdown.visible).toBe(false);
  });

  it('passes the sticks through and hides the indicator when it is off or the OSD is', () => {
    const snap = flying();
    snap.throttle = 0.6;
    snap.stick.roll = 0.25;
    snap.stick.pitch = -0.5;
    snap.stick.yaw = 1;
    const out = createHudModel();
    let m = run(makeQuadState(), snap, {}, NaN, out);
    expect(m.sticks).toEqual({ visible: true, roll: 0.25, pitch: -0.5, yaw: 1, throttle: 0.6 });
    out.sticksEnabled = false;
    expect(run(makeQuadState(), snap, {}, NaN, out).sticks.visible).toBe(false);
    out.sticksEnabled = true;
    m = run(makeQuadState(), snap, { showOsd: false }, NaN, out);
    expect(m.sticks.visible).toBe(false);
  });
});

describe('text caching', () => {
  it('keeps the very same string while the quantised value is unchanged', () => {
    const out = createHudModel();
    const snap = flying();
    run(makeQuadState({ vel: [10, 0, 0], batteryVoltage: 23.2, batteryMah: 100 }), snap, {}, NaN, out);
    const speed = out.speedText;
    const cell = out.cellText;
    const objects = [out.race, out.countdown, out.sticks, out.attitude, out.keys];
    run(makeQuadState({ vel: [10.05, 0, 0], batteryVoltage: 23.2, batteryMah: 100.4 }), snap, {}, NaN, out);
    expect(out.speedText).toBe(speed);
    expect(out.cellText).toBe(cell);
    const after = [out.race, out.countdown, out.sticks, out.attitude, out.keys];
    objects.forEach((o, i) => expect(after[i]).toBe(o));
  });

  it('updates the text when the value moves', () => {
    const out = createHudModel();
    const snap = flying();
    run(makeQuadState({ vel: [10, 0, 0] }), snap, {}, NaN, out);
    run(makeQuadState({ vel: [20, 0, 0] }), snap, {}, NaN, out);
    expect(out.speedText).toBe('72km/h');
  });
});
