import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../contracts';
import { G0 } from './math3d';
import { QUAD_5IN_6S } from './presets';
import { QuadPhysics } from './quad';
import { DT, airborneQuad, inp, run } from './testkit';
import { Wind, windDefaults } from './wind';

const cfg = QUAD_5IN_6S;

function gMag(q: QuadPhysics): number {
  return Math.hypot(...q.state.gForce);
}

describe('free fall', () => {
  it('reaches a terminal speed of 18..28 m/s, with the accelerometer reading about 0 g at first and 1 g at terminal', () => {
    const q = new QuadPhysics(cfg);
    q.setWind({ meanSpeed: 0, turbulence: 0, gustsPerMinute: 0 });
    q.reset([0, 2500, 0], 0);
    run(q, 0.3, inp({ armed: false }));
    expect(gMag(q)).toBeLessThan(0.08);
    let vmax = 0, gLate = 0, n = 0;
    for (let k = 0; k < 200; k++) {
      run(q, 0.1, inp({ armed: false }));
      vmax = Math.max(vmax, -q.state.vel[1]);
      if (k > 150) {
        gLate += gMag(q);
        n++;
      }
    }
    console.log(`[free fall] terminal ${vmax.toFixed(2)} m/s, mean |g| at terminal ${(gLate / n).toFixed(3)}`);
    expect(vmax).toBeGreaterThan(18);
    expect(vmax).toBeLessThan(28);
    expect(gLate / n).toBeGreaterThan(0.85);
    expect(gLate / n).toBeLessThan(1.15);
  });

  it('drag slows the fall relative to vacuum', () => {
    const q = new QuadPhysics(cfg);
    q.reset([0, 1000, 0], 0);
    run(q, 3, inp({ armed: false }));
    expect(-q.state.vel[1]).toBeGreaterThan(15);
    expect(-q.state.vel[1]).toBeLessThan(G0 * 3 - 5);
  });
});

describe('energy sanity', () => {
  it('a powered climb turns 2 to 60 percent of the electrical energy into potential and kinetic energy', () => {
    const q = airborneQuad(cfg, 0.29);
    const y0 = q.state.pos[1];
    let elec = 0;
    const input = inp({ throttle: 0.42 });
    for (let i = 0; i < 4 * 4000; i++) {
      q.step(DT, input);
      elec += q.state.batteryVoltage * q.state.batteryCurrent * DT;
    }
    const v = q.state.vel;
    const mech = cfg.mass * G0 * (q.state.pos[1] - y0) + 0.5 * cfg.mass * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    console.log(`[energy] climbed ${(q.state.pos[1] - y0).toFixed(1)} m, ${elec.toFixed(0)} J drawn, efficiency ${(mech / elec).toFixed(3)}`);
    expect(q.state.pos[1] - y0).toBeGreaterThan(5);
    expect(mech / elec).toBeGreaterThan(0.02);
    expect(mech / elec).toBeLessThan(0.6);
  });

  it('the battery mAh counter matches the integrated current', () => {
    const q = airborneQuad(cfg, 0.32);
    const mah0 = q.state.batteryMah;
    let coulombs = 0;
    for (let i = 0; i < 2 * 4000; i++) {
      q.step(DT, inp({ throttle: 0.32 }));
      coulombs += q.state.batteryCurrent * DT;
    }
    expect(q.state.batteryMah - mah0).toBeCloseTo((coulombs * 1000) / 3600, 0);
  });
});

describe('determinism and stepping', () => {
  const flight = (seed: number, split = 1): QuadPhysics => {
    const q = new QuadPhysics(cfg, null, seed);
    q.reset([0, 300, 0], 0.4);
    const dt = DT * split;
    for (let i = 0; i < 2000 / split; i++) q.step(dt, inp({ throttle: i * split < 200 ? 0 : 0.33, roll: 0.2, pitch: -0.1 }));
    return q;
  };
  const snapshot = (q: QuadPhysics): number[] => [...q.state.pos, ...q.state.vel, ...q.state.quat, ...q.state.angVel, ...q.state.motorOmega];

  it('the same seed reproduces a windy, turbulent flight bit for bit; another seed does not', () => {
    expect(snapshot(flight(7))).toEqual(snapshot(flight(7)));
    expect(snapshot(flight(7))).not.toEqual(snapshot(flight(8)));
  });

  it('reset restores the start so a flight repeats exactly', () => {
    const q = flight(3);
    const first = snapshot(q);
    q.reset([0, 300, 0], 0.4);
    for (let i = 0; i < 2000; i++) q.step(DT, inp({ throttle: i < 200 ? 0 : 0.33, roll: 0.2, pitch: -0.1 }));
    expect(snapshot(q)).toEqual(first);
  });

  it('a step longer than the sub-step limit is split evenly and gives the identical result', () => {
    const a = new QuadPhysics(cfg, null, 5);
    const b = new QuadPhysics(cfg, null, 5);
    a.reset([0, 300, 0], 0);
    b.reset([0, 300, 0], 0);
    for (let i = 0; i < 400; i++) {
      a.step(0.001, inp({ throttle: 0.3 }));
      b.step(0.0005, inp({ throttle: 0.3 }));
      b.step(0.0005, inp({ throttle: 0.3 }));
    }
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(a.state.time).toBeCloseTo(0.4, 12);
  });

  it('state.time advances by exactly the requested dt, including one 1/60 s call', () => {
    const q = new QuadPhysics(cfg);
    q.reset([0, 300, 0], 0);
    q.step(1 / 60, inp());
    expect(q.state.time).toBeCloseTo(1 / 60, 12);
    for (let i = 0; i < 4000; i++) q.step(DT, inp());
    expect(q.state.time).toBeCloseTo(1 + 1 / 60, 9);
  });

  it('4 kHz and 2 kHz flights agree on where the quad goes', () => {
    const fine = flight(9, 1), coarse = flight(9, 2);
    const d = Math.hypot(fine.state.pos[0] - coarse.state.pos[0], fine.state.pos[1] - coarse.state.pos[1], fine.state.pos[2] - coarse.state.pos[2]);
    expect(d).toBeLessThan(0.05);
  });
});

describe('wind field', () => {
  const calm = { meanSpeed: 0, turbulence: 0, gustsPerMinute: 0 };
  const sampleAt = (w: Wind, t = 0): Vec3 => {
    const o: Vec3 = [0, 0, 0];
    w.sample([0, 10, 0], t, o);
    return o;
  };

  it('sample returns the vector it filled, so it can be used as an expression', () => {
    const w = new Wind(1, { ...calm, meanSpeed: 4, fromDirection: 0 });
    const out: Vec3 = [9, 9, 9];
    const r = w.sample([0, 10, 0], 0, out);
    expect(r).toBe(out);
    expect(out[2]).toBeCloseTo(4, 9);
  });

  it('has no wind in calm air', () => {
    const w = new Wind(1, calm);
    for (let i = 0; i < 2000; i++) w.update(0.004, 5, i * 0.004);
    expect(Math.hypot(...sampleAt(w, 8))).toBe(0);
  });

  it('the mean flows from the requested compass bearing (0 north blows to +Z, 90 degrees east blows to -X)', () => {
    for (const [from, x, z] of [[0, 0, 1], [Math.PI / 2, -1, 0], [Math.PI, 0, -1], [1.5 * Math.PI, 1, 0], [Math.PI / 4, -Math.SQRT1_2, Math.SQRT1_2]]) {
      const w = new Wind(1, { ...calm, meanSpeed: 6, fromDirection: from });
      const s = sampleAt(w);
      expect(s[0]).toBeCloseTo(6 * x, 9);
      expect(s[1]).toBeCloseTo(0, 12);
      expect(s[2]).toBeCloseTo(6 * z, 9);
    }
  });

  it('a triggered gust reaches its peak at mid-duration and is gone after the duration', () => {
    const w = new Wind(1, calm);
    w.triggerGust(2, 5, 1, -3, 2);
    expect(Math.hypot(...sampleAt(w, 1.9))).toBe(0);
    const mid = sampleAt(w, 3);
    expect(mid[0]).toBeCloseTo(5, 9);
    expect(mid[1]).toBeCloseTo(1, 9);
    expect(mid[2]).toBeCloseTo(-3, 9);
    expect(Math.hypot(...sampleAt(w, 2.5))).toBeLessThan(Math.hypot(...mid));
    expect(Math.hypot(...sampleAt(w, 4.1))).toBe(0);
  });

  it('turbulence is zero-mean with a standard deviation near the requested intensity, and is seed-deterministic', () => {
    const run1 = (seed: number): number[] => {
      const w = new Wind(seed, { meanSpeed: 5, fromDirection: 0, turbulence: 1, gustsPerMinute: 0 });
      const out: number[] = [];
      for (let i = 0; i < 200000; i++) {
        w.update(0.002, 10, i * 0.002);
        if (i % 50 === 0) out.push(sampleAt(w, i * 0.002)[2] - 5);
      }
      return out;
    };
    const a = run1(4);
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    const sd = Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length);
    const sigma = 0.1 + 0.16 * 5;
    console.log(`[wind] mean ${mean.toFixed(3)} sd ${sd.toFixed(3)} (sigma ${sigma.toFixed(2)})`);
    expect(Math.abs(mean)).toBeLessThan(0.5 * sigma);
    expect(sd).toBeGreaterThan(0.5 * sigma);
    expect(sd).toBeLessThan(1.6 * sigma);
    expect(run1(4)).toEqual(a);
    expect(run1(5)).not.toEqual(a);
  });

  it('the defaults are a light breeze with turbulence and occasional gusts', () => {
    expect(windDefaults.meanSpeed).toBeGreaterThan(0);
    expect(windDefaults.meanSpeed).toBeLessThan(5);
    expect(windDefaults.gustsPerMinute).toBeGreaterThan(0);
  });
});

describe('wind drift of a drifting quad (disarmed, 8 m/s, 6 s)', () => {
  const drift = (from: number): Vec3 => {
    const q = new QuadPhysics(cfg, null, 1);
    q.setWind({ meanSpeed: 8, fromDirection: from, turbulence: 0, gustsPerMinute: 0 });
    q.reset([0, 300, 0], 0);
    run(q, 6, inp({ armed: false }));
    return [q.state.pos[0], q.state.pos[1], q.state.pos[2]];
  };

  it('a north wind pushes the quad to +Z, east to -X, south to -Z, west to +X, with little cross drift', () => {
    const north = drift(0), east = drift(Math.PI / 2), south = drift(Math.PI), west = drift(1.5 * Math.PI);
    console.log(`[wind drift] north z ${north[2].toFixed(1)}, east x ${east[0].toFixed(1)}, south z ${south[2].toFixed(1)}, west x ${west[0].toFixed(1)}`);
    expect(north[2]).toBeGreaterThan(2);
    expect(east[0]).toBeLessThan(-2);
    expect(south[2]).toBeLessThan(-2);
    expect(west[0]).toBeGreaterThan(2);
    for (const [d, along, cross] of [[north, 2, 0], [east, 0, 2], [south, 2, 0], [west, 0, 2]] as const) {
      expect(Math.abs(d[cross])).toBeLessThan(0.5);
      expect(Math.abs(d[along])).toBeLessThan(40);
    }
  });

  it('calm air gives no horizontal drift', () => {
    const q = new QuadPhysics(cfg, null, 1);
    q.setWind({ meanSpeed: 0, turbulence: 0, gustsPerMinute: 0 });
    q.reset([0, 300, 0], 0);
    run(q, 3, inp({ armed: false }));
    expect(Math.abs(q.state.pos[0])).toBeLessThan(1e-6);
    expect(Math.abs(q.state.pos[2])).toBeLessThan(1e-6);
  });
});

describe('forward flight', () => {
  it('full pitch and throttle in angle mode settles at a racing top speed of 35..55 m/s, heading straight ahead (-Z)', () => {
    const q = airborneQuad(cfg, 0.29);
    run(q, 10, inp({ mode: 'angle', throttle: 1, pitch: 1 }));
    const v = q.state.vel;
    const speed = Math.hypot(v[0], v[2]);
    console.log(`[top speed] ${speed.toFixed(1)} m/s (${(speed * 3.6).toFixed(0)} km/h), climbing ${v[1].toFixed(1)} m/s, ${q.state.batteryCurrent.toFixed(0)} A`);
    expect(speed).toBeGreaterThan(35);
    expect(speed).toBeLessThan(55);
    expect(v[2]).toBeLessThan(-0.95 * speed);
    expect(Math.abs(v[0])).toBeLessThan(0.05 * speed);
  });

  it('more tilt gives more speed: half pitch flies slower than full pitch', () => {
    const at = (pitch: number): number => {
      const q = airborneQuad(cfg, 0.29);
      run(q, 8, inp({ mode: 'angle', throttle: 0.7, pitch }));
      return Math.hypot(q.state.vel[0], q.state.vel[2]);
    };
    expect(at(0.5)).toBeLessThan(at(1) - 5);
  });
});
