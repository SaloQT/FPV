import { describe, expect, it } from 'vitest';
import type { CameraState, Quat, QuadState, Vec3 } from '../contracts';
import {
  CAMERA_FAR, CAMERA_MIN_AGL, CAMERA_NEAR, CameraRig, CHASE_DISTANCE, CHASE_HEIGHT, FPV_MOUNT, MAX_ORBIT_M, MIN_ORBIT_M,
  type CameraSettings,
} from './cameraRig';
import { quatAxisX, quatMul, quatRotate, quatYaw } from './quat';
import { makeQuadState } from './testKit';
import { DEG } from './units';

const CALM: CameraSettings = { fov: 100, cameraTiltDeg: 0, camVibration: 0 };
const CHASE_R = Math.hypot(CHASE_DISTANCE, CHASE_HEIGHT);

function yawed(yaw: number, over: Partial<QuadState> = {}): QuadState {
  return makeQuadState({ quat: quatYaw(yaw, [0, 0, 0, 1]), ...over });
}

function forward(cam: CameraState): Vec3 {
  return quatRotate(cam.quat, [0, 0, -1], [0, 0, 0]);
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function rigIn(mode: 'fpv' | 'chase' | 'free', ground?: (x: number, z: number) => number): CameraRig {
  const rig = new CameraRig(ground);
  rig.mode = mode;
  return rig;
}

function settle(rig: CameraRig, quad: QuadState, seconds: number, settings = CALM): CameraState {
  let cam = rig.camera;
  for (let t = 0; t < seconds; t += 1 / 60) cam = rig.update(1 / 60, quad, settings, 16 / 9);
  return cam;
}

function expectLooksAt(cam: CameraState, quad: QuadState): void {
  const f = forward(cam);
  const dx = quad.pos[0] - cam.pos[0];
  const dy = quad.pos[1] + 0.05 - cam.pos[1];
  const dz = quad.pos[2] - cam.pos[2];
  const l = Math.hypot(dx, dy, dz);
  expect(f[0]).toBeCloseTo(dx / l, 6);
  expect(f[1]).toBeCloseTo(dy / l, 6);
  expect(f[2]).toBeCloseTo(dz / l, 6);
}

describe('FPV camera', () => {
  it('rides in the quad: position from the body-frame mount, attitude from the quad', () => {
    const rig = rigIn('fpv');
    const q = quatMul(quatYaw(0.7, [0, 0, 0, 1]), quatAxisX(0.3, [0, 0, 0, 1]), [0, 0, 0, 1]);
    const quad = makeQuadState({ pos: [10, 20, -30], quat: q });
    const cam = rig.update(1 / 60, quad, CALM, 1.5);
    const m = quatRotate(q, [FPV_MOUNT[0], FPV_MOUNT[1], FPV_MOUNT[2]], [0, 0, 0]);
    expect(cam.pos[0]).toBeCloseTo(10 + m[0], 9);
    expect(cam.pos[1]).toBeCloseTo(20 + m[1], 9);
    expect(cam.pos[2]).toBeCloseTo(-30 + m[2], 9);
    for (let i = 0; i < 4; i++) expect(cam.quat[i]).toBeCloseTo(q[i], 9);
  });

  it('the mount is ahead of and above the centre and turns with the quad', () => {
    const rig = rigIn('fpv');
    const cam = rig.update(1 / 60, yawed(Math.PI / 2), CALM, 1.5);
    expect(cam.pos[0]).toBeCloseTo(FPV_MOUNT[2], 9);
    expect(cam.pos[1]).toBeCloseTo(FPV_MOUNT[1], 9);
    expect(cam.pos[2]).toBeCloseTo(0, 9);
  });

  it('a nose-up tilt raises the view; zero tilt looks along the body', () => {
    const rig = rigIn('fpv');
    const quad = makeQuadState();
    expect(forward(rig.update(0.01, quad, CALM, 1.5))[1]).toBeCloseTo(0, 9);
    const f = forward(rig.update(0.01, quad, { ...CALM, cameraTiltDeg: 30 }, 1.5));
    expect(f[1]).toBeCloseTo(Math.sin(30 * DEG), 9);
    expect(f[2]).toBeCloseTo(-Math.cos(30 * DEG), 9);
  });

  it('a negative tilt looks down', () => {
    const f = forward(rigIn('fpv').update(0.01, makeQuadState(), { ...CALM, cameraTiltDeg: -10 }, 1.5));
    expect(f[1]).toBeLessThan(0);
  });

  it('tilts relative to the quad body, whichever way it faces', () => {
    const rig = rigIn('fpv');
    const quad = yawed(Math.PI / 2);
    const f = forward(rig.update(0.01, quad, { ...CALM, cameraTiltDeg: 20 }, 1.5));
    expect(f[0]).toBeCloseTo(-Math.cos(20 * DEG), 9);
    expect(f[1]).toBeCloseTo(Math.sin(20 * DEG), 9);
  });

  it('converts the field of view to radians, clamped to a sane range, and passes the aspect through', () => {
    const rig = rigIn('fpv');
    const quad = makeQuadState();
    expect(rig.update(0.01, quad, { ...CALM, fov: 90 }, 2).fovY).toBeCloseTo(Math.PI / 2, 12);
    expect(rig.camera.aspect).toBe(2);
    expect(rig.update(0.01, quad, { ...CALM, fov: 5 }, 2).fovY).toBeCloseTo(20 * DEG, 12);
    expect(rig.update(0.01, quad, { ...CALM, fov: 400 }, 2).fovY).toBeCloseTo(160 * DEG, 12);
    expect(rig.camera.near).toBe(CAMERA_NEAR);
    expect(rig.camera.far).toBe(CAMERA_FAR);
  });

  it('keeps the last aspect when handed a non-positive one', () => {
    const rig = rigIn('fpv');
    rig.update(0.01, makeQuadState(), CALM, 2);
    expect(rig.update(0.01, makeQuadState(), CALM, 0).aspect).toBe(2);
  });

  it('returns one reused camera object', () => {
    const rig = rigIn('fpv');
    const a = rig.update(0.01, makeQuadState(), CALM, 1.5);
    const b = rig.update(0.01, makeQuadState(), CALM, 1.5);
    expect(a).toBe(b);
    expect(a).toBe(rig.camera);
  });
});

describe('FPV vibration', () => {
  const spinning = (omega: number): QuadState => makeQuadState({ pos: [1, 2, 3], motorOmega: [omega, omega, omega, omega] });

  function worst(omega: number, vib: number, frames = 300): { pos: number; angle: number } {
    const rig = rigIn('fpv');
    const still = rigIn('fpv');
    const quad = spinning(omega);
    let pos = 0;
    let angle = 0;
    for (let i = 0; i < frames; i++) {
      const a = rig.update(0.0013, quad, { ...CALM, camVibration: vib }, 1.5);
      const b = still.update(0.0013, quad, CALM, 1.5);
      pos = Math.max(pos, distance(a.pos, b.pos));
      const dot = a.quat[0] * b.quat[0] + a.quat[1] * b.quat[1] + a.quat[2] * b.quat[2] + a.quat[3] * b.quat[3];
      angle = Math.max(angle, 2 * Math.acos(Math.min(1, Math.abs(dot))));
    }
    return { pos, angle };
  }

  it('is off when disabled, or when the motors are not turning', () => {
    expect(worst(2500, 0).pos).toBe(0);
    expect(worst(0, 1).pos).toBe(0);
    expect(worst(0, 1).angle).toBe(0);
  });

  it('shakes the picture a little when the motors spin', () => {
    const w = worst(2500, 1);
    expect(w.pos).toBeGreaterThan(1e-4);
    expect(w.pos).toBeLessThan(0.01);
    expect(w.angle).toBeGreaterThan(1e-3);
    expect(w.angle).toBeLessThan(0.02);
  });

  it('scales with the setting', () => {
    expect(worst(2500, 0.5).pos * 2).toBeCloseTo(worst(2500, 1).pos, 9);
  });

  it('is stronger at high motor speed than at idle', () => {
    expect(worst(3000, 1).pos).toBeGreaterThan(worst(600, 1).pos * 2);
  });

  it('is capped for absurd motor speeds', () => {
    expect(worst(1e6, 1).pos).toBeLessThan(0.01);
  });

  it('is deterministic: the same inputs give the same picture', () => {
    const a = rigIn('fpv');
    const b = rigIn('fpv');
    for (let i = 0; i < 20; i++) {
      const ca = a.update(0.004, spinning(2000), { ...CALM, camVibration: 0.8 }, 1.5);
      const cb = b.update(0.004, spinning(2000), { ...CALM, camVibration: 0.8 }, 1.5);
      expect(ca.pos).toEqual(cb.pos);
      expect(ca.quat).toEqual(cb.quat);
    }
  });

  it('keeps the attitude a unit quaternion', () => {
    const rig = rigIn('fpv');
    for (let i = 0; i < 100; i++) {
      const q = rig.update(0.0033, spinning(3000), { ...CALM, camVibration: 1 }, 1.5).quat;
      expect(Math.hypot(...q)).toBeCloseTo(1, 9);
    }
  });
});

describe('modes', () => {
  it('cycles fpv, chase, free, fpv', () => {
    const rig = new CameraRig();
    expect(rig.mode).toBe('fpv');
    expect([rig.cycle(), rig.cycle(), rig.cycle(), rig.cycle()]).toEqual(['chase', 'free', 'fpv', 'chase']);
  });

  it('only the FPV view hides the quad model', () => {
    const rig = new CameraRig();
    expect(rig.quadVisible).toBe(false);
    rig.cycle();
    expect(rig.quadVisible).toBe(true);
    rig.cycle();
    expect(rig.quadVisible).toBe(true);
    rig.cycle();
    expect(rig.quadVisible).toBe(false);
  });
});

describe('chase camera', () => {
  it('sits behind and above a steady quad and looks at it', () => {
    const quad = makeQuadState({ pos: [4, 5, -6] });
    const cam = rigIn('chase').update(1 / 60, quad, CALM, 1.5);
    expect(cam.pos[0]).toBeCloseTo(4, 9);
    expect(cam.pos[1]).toBeCloseTo(5 + CHASE_HEIGHT, 9);
    expect(cam.pos[2]).toBeCloseTo(-6 + CHASE_DISTANCE, 9);
    expectLooksAt(cam, quad);
  });

  it('follows the body heading', () => {
    const quad = yawed(Math.PI / 2, { pos: [0, 5, 0] });
    const cam = rigIn('chase').update(1 / 60, quad, CALM, 1.5);
    expect(cam.pos[0]).toBeCloseTo(CHASE_DISTANCE, 9);
    expect(cam.pos[2]).toBeCloseTo(0, 9);
  });

  it('keeps a constant distance from the quad', () => {
    const rig = rigIn('chase');
    const quad = makeQuadState({ pos: [0, 5, 0] });
    for (let i = 0; i < 120; i++) {
      quad.quat = quatYaw(i * 0.05, [0, 0, 0, 1]);
      const cam = rig.update(1 / 60, quad, CALM, 1.5);
      expect(distance(cam.pos, quad.pos)).toBeCloseTo(CHASE_R, 6);
    }
  });

  it('turns behind the direction of travel when flying fast sideways', () => {
    const rig = rigIn('chase');
    const quad = makeQuadState({ pos: [0, 5, 0] });
    settle(rig, quad, 0.5);
    quad.vel = [12, 0, 0];
    const cam = settle(rig, quad, 3);
    expect(cam.pos[0]).toBeCloseTo(-CHASE_DISTANCE, 3);
    expect(cam.pos[2]).toBeCloseTo(0, 3);
  });

  it('ignores the velocity direction while creeping', () => {
    const rig = rigIn('chase');
    const quad = makeQuadState({ pos: [0, 5, 0], vel: [0.4, 0, 0] });
    const cam = settle(rig, quad, 1);
    expect(cam.pos[0]).toBeCloseTo(0, 6);
  });

  it('glides round after a turn instead of jumping', () => {
    const rig = rigIn('chase');
    const quad = makeQuadState({ pos: [0, 5, 0] });
    settle(rig, quad, 0.2);
    quad.quat = quatYaw(Math.PI / 2, [0, 0, 0, 1]);
    const first = rig.update(1 / 60, quad, CALM, 1.5);
    expect(first.pos[0]).toBeLessThan(0.5);
    const done = settle(rig, quad, 3);
    expect(done.pos[0]).toBeCloseTo(CHASE_DISTANCE, 3);
  });

  it('swings a 180 degree turn without ever leaping and never crosses the quad', () => {
    const rig = rigIn('chase');
    const quad = makeQuadState({ pos: [0, 5, 0] });
    settle(rig, quad, 0.2);
    quad.quat = quatYaw(Math.PI, [0, 0, 0, 1]);
    let prev: Vec3 = [rig.camera.pos[0], rig.camera.pos[1], rig.camera.pos[2]];
    for (let i = 0; i < 240; i++) {
      const cam = rig.update(1 / 60, quad, CALM, 1.5);
      expect(distance(cam.pos, prev)).toBeLessThan(0.5);
      expect(Math.hypot(cam.pos[0], cam.pos[2])).toBeGreaterThan(CHASE_DISTANCE - 1e-6);
      prev = [cam.pos[0], cam.pos[1], cam.pos[2]];
    }
    expect(prev[2]).toBeCloseTo(-CHASE_DISTANCE, 3);
  });

  it('is unaffected by the quad pointing straight up', () => {
    const rig = rigIn('chase');
    const q: Quat = [Math.sin(-Math.PI / 4), 0, 0, Math.cos(-Math.PI / 4)];
    const quad = makeQuadState({ pos: [0, 5, 0], quat: q });
    const cam = settle(rig, quad, 1);
    expect(Number.isFinite(cam.pos[0] + cam.pos[1] + cam.pos[2])).toBe(true);
    expect(distance(cam.pos, quad.pos)).toBeCloseTo(CHASE_R, 6);
  });

  it('stays above the terrain', () => {
    const ground = (_x: number, z: number): number => (z > 0.5 ? 8 : 0);
    const rig = rigIn('chase', ground);
    const quad = makeQuadState({ pos: [0, 2, 0] });
    const cam = rig.update(1 / 60, quad, CALM, 1.5);
    expect(cam.pos[1]).toBeCloseTo(8 + CAMERA_MIN_AGL, 9);
    expectLooksAt(cam, quad);
  });

  it('does not touch the height without a terrain', () => {
    const rig = rigIn('chase');
    const cam = rig.update(1 / 60, makeQuadState({ pos: [0, -3, 0] }), CALM, 1.5);
    expect(cam.pos[1]).toBeCloseTo(-3 + CHASE_HEIGHT, 9);
  });

  it('snaps on the first update and after a teleport', () => {
    const rig = rigIn('chase');
    const quad = makeQuadState({ pos: [0, 5, 0] });
    settle(rig, quad, 0.2);
    quad.pos = [200, 5, 200];
    quad.quat = quatYaw(Math.PI, [0, 0, 0, 1]);
    const cam = rig.update(1 / 60, quad, CALM, 1.5);
    expect(cam.pos[0]).toBeCloseTo(200, 9);
    expect(cam.pos[2]).toBeCloseTo(200 - CHASE_DISTANCE, 9);
  });

  it('snap() drops the smoothing on request', () => {
    const rig = rigIn('chase');
    const quad = makeQuadState({ pos: [0, 5, 0] });
    settle(rig, quad, 0.2);
    quad.quat = quatYaw(Math.PI / 2, [0, 0, 0, 1]);
    rig.snap();
    expect(rig.update(1 / 60, quad, CALM, 1.5).pos[0]).toBeCloseTo(CHASE_DISTANCE, 9);
  });

  it('snaps when the mode changes', () => {
    const rig = rigIn('fpv');
    const quad = yawed(Math.PI / 2, { pos: [0, 5, 0] });
    rig.update(1 / 60, quad, CALM, 1.5);
    rig.cycle();
    expect(rig.update(1 / 60, quad, CALM, 1.5).pos[0]).toBeCloseTo(CHASE_DISTANCE, 9);
  });

  it('a zero or negative frame time does not move the smoothed heading', () => {
    const rig = rigIn('chase');
    const quad = makeQuadState({ pos: [0, 5, 0] });
    settle(rig, quad, 0.2);
    quad.quat = quatYaw(1, [0, 0, 0, 1]);
    const before = rig.update(0, quad, CALM, 1.5).pos[0];
    expect(rig.update(-1, quad, CALM, 1.5).pos[0]).toBe(before);
  });
});

describe('free camera', () => {
  it('orbits the quad at the default distance, looking at it', () => {
    const quad = makeQuadState({ pos: [3, 4, 5] });
    const cam = rigIn('free').update(1 / 60, quad, CALM, 1.5);
    expect(distance(cam.pos, quad.pos)).toBeCloseTo(3, 9);
    expectLooksAt(cam, quad);
  });

  it('starts behind the quad when entered', () => {
    const quad = yawed(Math.PI / 2, { pos: [0, 5, 0] });
    const cam = rigIn('free').update(1 / 60, quad, CALM, 1.5);
    expect(cam.pos[0]).toBeGreaterThan(1);
    expect(cam.pos[2]).toBeCloseTo(0, 9);
  });

  it('dragging right swings the camera round to the left of the quad', () => {
    const rig = rigIn('free');
    const quad = makeQuadState({ pos: [0, 5, 0] });
    rig.update(1 / 60, quad, CALM, 1.5);
    rig.applyOrbit({ dx: 100, dy: 0, wheel: 0 });
    const cam = rig.update(1 / 60, quad, CALM, 1.5);
    expect(cam.pos[0]).toBeLessThan(-1);
    expect(distance(cam.pos, quad.pos)).toBeCloseTo(3, 9);
  });

  it('dragging down raises the camera and clamps before the poles', () => {
    const rig = rigIn('free');
    const quad = makeQuadState({ pos: [0, 5, 0] });
    const low = rig.update(1 / 60, quad, CALM, 1.5).pos[1];
    rig.applyOrbit({ dx: 0, dy: 40, wheel: 0 });
    expect(rig.update(1 / 60, quad, CALM, 1.5).pos[1]).toBeGreaterThan(low);
    rig.applyOrbit({ dx: 0, dy: 1e6, wheel: 0 });
    const top = rig.update(1 / 60, quad, CALM, 1.5);
    expect(top.pos[1]).toBeLessThan(5 + 3);
    expect(top.pos[1]).toBeGreaterThan(5 + 2.9);
    rig.applyOrbit({ dx: 0, dy: -1e6, wheel: 0 });
    expect(rig.update(1 / 60, quad, CALM, 1.5).pos[1]).toBeLessThan(5);
  });

  it('the wheel zooms exponentially and clamps to the allowed range', () => {
    const rig = rigIn('free');
    const quad = makeQuadState({ pos: [0, 5, 0] });
    rig.update(1 / 60, quad, CALM, 1.5);
    rig.applyOrbit({ dx: 0, dy: 0, wheel: 100 });
    expect(distance(rig.update(1 / 60, quad, CALM, 1.5).pos, quad.pos)).toBeCloseTo(3 * Math.exp(0.15), 9);
    rig.applyOrbit({ dx: 0, dy: 0, wheel: 1e6 });
    expect(distance(rig.update(1 / 60, quad, CALM, 1.5).pos, quad.pos)).toBeCloseTo(MAX_ORBIT_M, 9);
    rig.applyOrbit({ dx: 0, dy: 0, wheel: -1e7 });
    expect(distance(rig.update(1 / 60, quad, CALM, 1.5).pos, quad.pos)).toBeCloseTo(MIN_ORBIT_M, 9);
  });

  it('follows the quad and holds its view direction as the quad moves', () => {
    const rig = rigIn('free');
    const quad = makeQuadState({ pos: [0, 5, 0] });
    const a = rig.update(1 / 60, quad, CALM, 1.5);
    const offset: Vec3 = [a.pos[0] - quad.pos[0], a.pos[1] - quad.pos[1], a.pos[2] - quad.pos[2]];
    quad.pos = [7, 6, -3];
    quad.quat = quatYaw(2, [0, 0, 0, 1]);
    const b = rig.update(1 / 60, quad, CALM, 1.5);
    expect(b.pos[0] - 7).toBeCloseTo(offset[0], 9);
    expect(b.pos[1] - 6).toBeCloseTo(offset[1] + 0, 9);
    expect(b.pos[2] + 3).toBeCloseTo(offset[2], 9);
  });

  it('stays above the terrain', () => {
    const rig = rigIn('free', () => 20);
    const quad = makeQuadState({ pos: [0, 21, 0] });
    rig.update(1 / 60, quad, CALM, 1.5);
    rig.applyOrbit({ dx: 0, dy: -1e6, wheel: 0 });
    expect(rig.update(1 / 60, quad, CALM, 1.5).pos[1]).toBeGreaterThanOrEqual(20 + CAMERA_MIN_AGL);
  });

  it('keeps the orbit while the mode is unchanged and re-derives it behind the quad on re-entry', () => {
    const rig = rigIn('free');
    const quad = makeQuadState({ pos: [0, 5, 0] });
    rig.update(1 / 60, quad, CALM, 1.5);
    rig.applyOrbit({ dx: 200, dy: 0, wheel: 0 });
    rig.update(1 / 60, quad, CALM, 1.5);
    rig.cycle();
    rig.update(1 / 60, quad, CALM, 1.5);
    rig.cycle();
    rig.update(1 / 60, quad, CALM, 1.5);
    rig.cycle();
    const cam = rig.update(1 / 60, quad, CALM, 1.5);
    expect(cam.pos[0]).toBeCloseTo(0, 9);
    expect(cam.pos[2]).toBeGreaterThan(1);
  });
});
