import { describe, expect, it } from 'vitest';
import type { ObstacleCollider, TerrainSampler, Vec3 } from '../contracts';
import { QUAD_5IN_6S } from './presets';
import { QuadPhysics } from './quad';
import { DT, flatTerrain, inp, run, slopeTerrain, upDot } from './testkit';

const cfg = QUAD_5IN_6S;
const disarmed = inp({ armed: false });

function calmQuad(terrain: TerrainSampler | null, pos: Vec3, yaw = 0): QuadPhysics {
  const q = new QuadPhysics(cfg, terrain);
  q.setWind({ meanSpeed: 0, turbulence: 0, gustsPerMinute: 0 });
  q.reset(pos, yaw);
  return q;
}

interface DropResult {
  impact: number;
  preSpeed: number;
  crashSteps: number;
  crashCount: number;
  reboundSpeed: number;
  reboundHeight: number;
  restY: number;
  restSpeed: number;
  crashedAtEnd: boolean;
  impactAtEnd: number;
}

function drop(h: number, seconds = 4): DropResult {
  const q = calmQuad(flatTerrain(0), [0, h, 0]);
  let impact = 0, preSpeed = 0, crashSteps = 0, reboundSpeed = 0, reboundHeight = 0, touched = false;
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    q.step(DT, disarmed);
    const s = q.state;
    if (!touched && s.onGround) touched = true;
    if (!touched) preSpeed = Math.max(preSpeed, -s.vel[1]);
    if (s.crashed) {
      crashSteps++;
      impact = Math.max(impact, s.impactSpeed);
    } else if (!touched) {
      impact = Math.max(impact, s.impactSpeed);
    }
    if (touched) {
      reboundSpeed = Math.max(reboundSpeed, s.vel[1]);
      reboundHeight = Math.max(reboundHeight, s.pos[1]);
    }
  }
  const s = q.state;
  return {
    impact,
    preSpeed,
    crashSteps,
    crashCount: q.crashCount,
    reboundSpeed,
    reboundHeight,
    restY: s.pos[1],
    restSpeed: Math.hypot(...s.vel),
    crashedAtEnd: s.crashed,
    impactAtEnd: s.impactSpeed,
  };
}

describe('terrain impact (flat ground at y = 0, disarmed drop)', () => {
  it('a 0.5 m drop is a soft landing: no crash, settles at the ride height', () => {
    const r = drop(0.5);
    console.log(`[drop 0.5 m] pre-impact ${r.preSpeed.toFixed(2)} m/s, rest y ${r.restY.toFixed(4)}, rebound ${r.reboundSpeed.toFixed(2)} m/s`);
    expect(r.crashSteps).toBe(0);
    expect(r.crashCount).toBe(0);
    expect(r.restY).toBeGreaterThan(0.03);
    expect(r.restY).toBeLessThan(0.07);
    expect(r.restSpeed).toBeLessThan(1e-3);
  });

  it('a 2 m drop crashes at the free-fall speed and the flag lasts about 1/60 s', () => {
    const r = drop(2);
    console.log(`[drop 2 m] pre-impact ${r.preSpeed.toFixed(2)} m/s, reported ${r.impact.toFixed(2)}, crashed for ${r.crashSteps} steps, rebound ${r.reboundSpeed.toFixed(2)} m/s to ${r.reboundHeight.toFixed(3)} m`);
    expect(r.preSpeed).toBeGreaterThan(5.5);
    expect(r.preSpeed).toBeLessThan(6.4);
    expect(r.impact).toBeGreaterThan(0.9 * r.preSpeed);
    expect(r.impact).toBeLessThan(1.1 * r.preSpeed);
    expect(r.crashCount).toBe(1);
    expect(r.crashSteps).toBeGreaterThan(60);
    expect(r.crashSteps).toBeLessThan(75);
    expect(r.crashedAtEnd).toBe(false);
    expect(r.impactAtEnd).toBe(0);
  });

  it('the bounce is heavily damped: rebound speed under 35 percent of the impact and height under 15 percent of the drop', () => {
    for (const h of [1, 2, 5]) {
      const r = drop(h);
      expect(r.reboundSpeed).toBeLessThan(0.35 * r.preSpeed);
      expect(r.reboundHeight).toBeLessThan(0.15 * h + 0.06);
      expect(r.restSpeed).toBeLessThan(1e-3);
    }
  });

  it('a drop below the crash speed (about 0.8 m) is not a crash, but 1.2 m is', () => {
    expect(drop(0.8).crashCount).toBe(0);
    expect(drop(1.2).crashCount).toBe(1);
  });

  it('crashes are counted once per impact, not once per contact step', () => {
    const q = calmQuad(flatTerrain(0), [0, 3, 0]);
    run(q, 3, disarmed);
    expect(q.crashCount).toBeGreaterThanOrEqual(1);
    expect(q.crashCount).toBeLessThanOrEqual(3);
  });
});

describe('resting on the ground', () => {
  const settle = (input = disarmed): QuadPhysics => {
    const q = calmQuad(flatTerrain(0), [0, 0.06, 0], 0.7);
    run(q, 1, input);
    return q;
  };

  for (const [name, input] of [['disarmed', disarmed], ['armed at idle', inp({ throttle: 0 })]] as const) {
    it(`stays put for 5 s when ${name}: no drift, no creep, no spurious crash, 1 g on the accelerometer`, () => {
      const q = settle(input);
      const p0: Vec3 = [q.state.pos[0], q.state.pos[1], q.state.pos[2]];
      const quat0 = [...q.state.quat];
      let crashes = 0, worstV = 0, worstW = 0;
      for (let i = 0; i < 5 * 4000; i++) {
        q.step(DT, input);
        if (q.state.crashed) crashes++;
        worstV = Math.max(worstV, Math.hypot(...q.state.vel));
        worstW = Math.max(worstW, Math.hypot(...q.state.angVel));
      }
      const drift = Math.hypot(q.state.pos[0] - p0[0], q.state.pos[1] - p0[1], q.state.pos[2] - p0[2]);
      const dq = Math.abs(quat0[0] * q.state.quat[0] + quat0[1] * q.state.quat[1] + quat0[2] * q.state.quat[2] + quat0[3] * q.state.quat[3]);
      console.log(`[rest ${name}] drift ${(drift * 1000).toFixed(3)} mm, max v ${worstV.toExponential(2)} m/s, max w ${worstW.toExponential(2)} rad/s, |g| ${Math.hypot(...q.state.gForce).toFixed(3)}`);
      expect(drift).toBeLessThan(1e-3);
      expect(1 - dq).toBeLessThan(1e-6);
      expect(crashes).toBe(0);
      expect(q.state.onGround).toBe(true);
      expect(worstV).toBeLessThan(0.02);
      expect(Math.hypot(...q.state.gForce)).toBeGreaterThan(0.9);
      expect(Math.hypot(...q.state.gForce)).toBeLessThan(1.1);
      expect(upDot(q)).toBeGreaterThan(0.999);
    });
  }

  it('settles and stays put at 1, 2 and 4 kHz alike, and lifts off at the same time whatever the step rate', () => {
    const airborneAt: number[] = [];
    for (const dt of [1 / 1000, 1 / 2000, 1 / 4000]) {
      const q = calmQuad(flatTerrain(0), [0, 0.06, 0], 0.7);
      run(q, 1, inp({ throttle: 0 }), dt);
      const p0 = [q.state.pos[0], q.state.pos[1], q.state.pos[2]];
      run(q, 1, inp({ throttle: 0 }), dt);
      expect(Math.hypot(q.state.pos[0] - p0[0], q.state.pos[1] - p0[1], q.state.pos[2] - p0[2])).toBeLessThan(1e-3);
      expect(q.state.onGround).toBe(true);
      let t = -1;
      for (let i = 0; i < Math.round(0.5 / dt) && t < 0; i++) {
        q.step(dt, inp({ throttle: 0.6 }));
        if (!q.state.onGround) t = (i + 1) * dt;
      }
      expect(t).toBeGreaterThan(0);
      airborneAt.push(t);
    }
    console.log(`[liftoff] airborne after ${airborneAt.map((t) => (t * 1000).toFixed(1)).join(' / ')} ms at 1 / 2 / 4 kHz`);
    expect(Math.max(...airborneAt) - Math.min(...airborneAt)).toBeLessThan(0.008);
    expect(Math.max(...airborneAt)).toBeLessThan(0.07);
  });

  it('reads about 1 g while resting, close to 0 g in free fall', () => {
    const q = settle();
    expect(q.state.gForce[1]).toBeGreaterThan(0.9);
    expect(q.state.gForce[1]).toBeLessThan(1.1);
    const f = calmQuad(null, [0, 100, 0]);
    run(f, 0.2, disarmed);
    expect(Math.hypot(...f.state.gForce)).toBeLessThan(0.08);
  });

  it('a quad set down inside the ground is pushed out gently, without a crash', () => {
    const q = calmQuad(flatTerrain(0), [0, -0.02, 0]);
    let peak = 0;
    for (let i = 0; i < 2 * 4000; i++) {
      q.step(DT, disarmed);
      peak = Math.max(peak, q.state.vel[1]);
      expect(q.state.crashed).toBe(false);
    }
    expect(peak).toBeLessThan(1);
    expect(q.state.pos[1]).toBeGreaterThan(0.03);
    expect(q.state.pos[1]).toBeLessThan(0.07);
  });
});

describe('slopes and friction', () => {
  const rest = (deg: number, seconds: number): QuadPhysics => {
    const angle = (deg * Math.PI) / 180;
    const q = calmQuad(slopeTerrain(angle), [0, 0.2, 0]);
    run(q, seconds, disarmed);
    return q;
  };

  it('holds on a 15 and a 20 degree slope (friction 0.6 grips up to about 31 degrees)', () => {
    for (const deg of [15, 20]) {
      const q = rest(deg, 1);
      const x0 = q.state.pos[0], z0 = q.state.pos[2];
      run(q, 4, disarmed);
      const slip = Math.hypot(q.state.pos[0] - x0, q.state.pos[2] - z0);
      console.log(`[slope ${deg} deg] slipped ${(slip * 1000).toFixed(2)} mm in 4 s`);
      expect(slip).toBeLessThan(5e-3);
      expect(q.state.onGround).toBe(true);
    }
  });

  it('uses the normal a sampler returns even when it does not write into the out argument', () => {
    const base = slopeTerrain((40 * Math.PI) / 180);
    const fresh: TerrainSampler = { ...base, normalAt: (x, z) => [...base.normalAt(x, z)] as Vec3 };
    const q = calmQuad(fresh, [0, 0.2, 0]);
    run(q, 1, disarmed);
    const x0 = q.state.pos[0];
    run(q, 2, disarmed);
    expect(x0 - q.state.pos[0]).toBeGreaterThan(3);
  });

  it('slides down a 40 degree slope (towards -X), picking up speed', () => {
    const q = rest(40, 1);
    const x0 = q.state.pos[0];
    run(q, 2, disarmed);
    console.log(`[slope 40 deg] slid ${(x0 - q.state.pos[0]).toFixed(2)} m in 2 s, v ${Math.hypot(...q.state.vel).toFixed(2)} m/s`);
    expect(x0 - q.state.pos[0]).toBeGreaterThan(3);
    expect(Math.hypot(...q.state.vel)).toBeGreaterThan(2);
    expect(Math.abs(q.state.pos[2])).toBeLessThan(0.5);
  });
});

describe('turtle mode (crash flip)', () => {
  const INVERTED_ABOUT_Z: [number, number, number, number] = [0, 0, 1, 0];

  const invertedOnGround = (): QuadPhysics => {
    const q = calmQuad(flatTerrain(0), [0, 0.08, 0]);
    q.setAttitude(INVERTED_ABOUT_Z);
    run(q, 0.5, disarmed);
    run(q, 0.1, inp({ throttle: 0 }));
    return q;
  };

  const flip = (input: Parameters<typeof inp>[0], seconds = 3): { t: number; crashSteps: number; q: QuadPhysics } => {
    const q = invertedOnGround();
    expect(upDot(q)).toBeLessThan(-0.9);
    expect(q.state.armed).toBe(true);
    let t = -1, crashSteps = 0;
    const t0 = q.state.time;
    const stick = inp({ turtle: true, ...input });
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      q.step(DT, stick);
      if (q.state.crashed) crashSteps++;
      if (upDot(q) > 0.8) {
        t = q.state.time - t0;
        break;
      }
    }
    return { t, crashSteps, q };
  };

  it('lies still upside down on the ground until the turtle stick is pushed', () => {
    const q = invertedOnGround();
    run(q, 1, inp({ turtle: true }));
    expect(upDot(q)).toBeLessThan(-0.99);
    expect(Math.hypot(...q.state.vel)).toBeLessThan(0.05);
  });

  for (const [name, input] of [
    ['pitch forward', { pitch: 1 }],
    ['pitch back', { pitch: -1 }],
    ['roll right', { roll: 1 }],
    ['roll left', { roll: -1 }],
  ] as const) {
    it(`flips upright within 3 s with ${name}, without tripping the crash flag`, () => {
      const r = flip(input);
      console.log(`[turtle ${name}] upright after ${r.t.toFixed(2)} s (crash steps ${r.crashSteps})`);
      expect(r.t).toBeGreaterThan(0);
      expect(r.crashSteps).toBe(0);
    });
  }

  it('drives only the motors on the far side, backwards (pitch forward reverses the rear pair)', () => {
    const q = invertedOnGround();
    run(q, 0.05, inp({ turtle: true, pitch: 1 }));
    const m = q.fc.motors;
    expect(m[0]).toBeCloseTo(0, 9);
    expect(m[3]).toBeCloseTo(0, 9);
    expect(m[1]).toBeCloseTo(-cfg.fc.mixer.turtlePower, 9);
    expect(m[2]).toBeCloseTo(-cfg.fc.mixer.turtlePower, 9);
    expect(q.motors[1].omega).toBeLessThan(0);
    expect(q.motors[2].omega).toBeLessThan(0);
  });

  it('does nothing while disarmed', () => {
    const q = invertedOnGround();
    run(q, 3, inp({ armed: false, turtle: true, pitch: 1 }));
    expect(upDot(q)).toBeLessThan(-0.9);
  });

  it('a stick inside the deadband leaves the motors stopped', () => {
    const q = invertedOnGround();
    run(q, 0.1, inp({ turtle: true, pitch: 0.03 }));
    for (let i = 0; i < 4; i++) expect(q.fc.motors[i]).toBe(0);
  });
});

describe('obstacle boxes', () => {
  const wall = (z: number, yaw = 0, thickness = 0.05): ObstacleCollider => ({ kind: 'box', center: [0, 100, z], half: [6, 6, thickness], yaw });

  const shoot = (speed: number, dt: number, collider: ObstacleCollider, heading: Vec3 = [0, 0, -1]): { q: QuadPhysics; crashed: boolean; impact: number; deepest: number } => {
    const q = calmQuad(null, [0, 100, 0]);
    q.setColliders([collider]);
    q.state.vel[0] = heading[0] * speed;
    q.state.vel[1] = heading[1] * speed;
    q.state.vel[2] = heading[2] * speed;
    const c = Math.cos(collider.yaw), s = Math.sin(collider.yaw);
    let crashed = false, impact = 0, deepest = Infinity;
    for (let i = 0; i < Math.round(0.6 / dt); i++) {
      q.step(dt, { ...disarmed });
      crashed = crashed || q.state.crashed;
      impact = Math.max(impact, q.state.impactSpeed);
      const dx = q.state.pos[0] - collider.center[0], dz = q.state.pos[2] - collider.center[2];
      deepest = Math.min(deepest, s * dx + c * dz);
    }
    return { q, crashed, impact, deepest };
  };

  it('a fast quad hits a thin wall and is stopped by it, with a crash flagged (no tunnelling at 4 kHz)', () => {
    const r = shoot(40, DT, wall(-20));
    console.log(`[wall 40 m/s, 4 kHz] crashed ${r.crashed}, impact ${r.impact.toFixed(1)} m/s, final z ${r.q.state.pos[2].toFixed(3)}, deepest local z ${r.deepest.toFixed(3)}`);
    expect(r.crashed).toBe(true);
    expect(r.impact).toBeGreaterThan(25);
    expect(r.deepest).toBeGreaterThan(-0.05);
    expect(r.q.state.pos[2]).toBeGreaterThan(-20);
    expect(r.q.state.vel[2]).toBeGreaterThan(-2);
  });

  it('does not tunnel at 2 kHz either', () => {
    const r = shoot(40, 1 / 2000, wall(-20));
    expect(r.crashed).toBe(true);
    expect(r.deepest).toBeGreaterThan(-0.05);
    expect(r.q.state.pos[2]).toBeGreaterThan(-20);
  });

  it('holds a wall that is turned 45 degrees, and the crash is at the normal closing speed', () => {
    const r = shoot(30, DT, wall(-12, Math.PI / 4));
    console.log(`[yawed wall] crashed ${r.crashed}, impact ${r.impact.toFixed(1)} m/s, deepest local z ${r.deepest.toFixed(3)}`);
    expect(r.crashed).toBe(true);
    expect(r.deepest).toBeGreaterThan(-0.05);
    expect(r.impact).toBeGreaterThan(0.5 * 30 * Math.SQRT1_2);
    expect(r.impact).toBeLessThan(1.1 * 30 * Math.SQRT1_2);
  });

  it('a gentle touch on a wall (2 m/s) is not a crash', () => {
    const r = shoot(2, DT, wall(-0.5));
    expect(r.crashed).toBe(false);
    expect(r.q.state.pos[2]).toBeGreaterThan(-0.5);
  });

  it('lands on top of a box and rests there without crashing', () => {
    const q = calmQuad(flatTerrain(0), [0, 1.6, 0]);
    q.setColliders([{ kind: 'box', center: [0, 0.5, 0], half: [1, 0.5, 1], yaw: 0.3 }]);
    run(q, 3, disarmed);
    expect(q.state.crashed).toBe(false);
    expect(q.state.onGround).toBe(true);
    expect(q.state.pos[1]).toBeGreaterThan(1.03);
    expect(q.state.pos[1]).toBeLessThan(1.07);
    expect(Math.hypot(...q.state.vel)).toBeLessThan(1e-3);
  });

  it('with no colliders left, the quad flies straight through where the wall was', () => {
    const q = calmQuad(null, [0, 100, 0]);
    q.setColliders([wall(-5)]);
    q.setColliders([]);
    q.state.vel[2] = -20;
    run(q, 0.5, disarmed);
    expect(q.state.pos[2]).toBeLessThan(-9);
    expect(q.crashCount).toBe(0);
  });
});
