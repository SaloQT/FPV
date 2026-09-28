import { describe, expect, it } from 'vitest';
import { Battery, cellOcv } from './battery';
import { G0, Rng, TWO_PI } from './math3d';
import { Motor } from './motor';
import { BATTERY_4S_1300, BATTERY_6S_1300, QUAD_5IN_6S, getPreset } from './presets';
import { Propeller } from './propeller';
import { DT, airborneQuad, benchStatic, hoverStick, inp, run } from './testkit';

const cfg = QUAD_5IN_6S;
const weight = cfg.mass * G0;

describe('QUAD_5IN_6S static performance', () => {
  const stick = hoverStick(cfg);
  const full = benchStatic(cfg, 1, 0.8);
  const hoverDuty = cfg.fc.mixer.idle + stick * (1 - cfg.fc.mixer.idle);
  const hover = benchStatic(cfg, hoverDuty, 0.8);

  it('reports hover throttle, static thrust and current', () => {
    const rpm = (full.omega * 60) / TWO_PI;
    console.log(
      `[QUAD_5IN_6S] mass ${cfg.mass.toFixed(3)} kg, inertia ${cfg.inertia.map((x) => x.toFixed(4)).join('/')} | hover stick ${stick.toFixed(3)}, ` +
        `${hover.power.toFixed(0)} W, ${hover.current.toFixed(1)} A | full throttle: thrust ${full.thrust.toFixed(1)} N ` +
        `(${(full.thrust / 9.80665).toFixed(2)} kgf, T/W ${(full.thrust / weight).toFixed(2)}), ${full.current.toFixed(0)} A, ` +
        `${rpm.toFixed(0)} rpm, bus ${full.volts.toFixed(1)} V`,
    );
    expect(Number.isFinite(stick)).toBe(true);
  });

  it('hover throttle is in [0.26, 0.36]', () => {
    expect(stick).toBeGreaterThanOrEqual(0.26);
    expect(stick).toBeLessThanOrEqual(0.36);
  });

  it('hover power is plausible for a 650 g 5 inch quad', () => {
    expect(hover.power).toBeGreaterThan(100);
    expect(hover.power).toBeLessThan(200);
  });

  it('static thrust / weight at full throttle is in [8, 12]', () => {
    const tw = full.thrust / weight;
    expect(tw).toBeGreaterThanOrEqual(8);
    expect(tw).toBeLessThanOrEqual(12);
  });

  it('max rpm is 30-34k and full-punch battery current is 100-140 A', () => {
    const rpm = (full.omega * 60) / TWO_PI;
    expect(rpm).toBeGreaterThan(30000);
    expect(rpm).toBeLessThan(34000);
    expect(full.current).toBeGreaterThan(100);
    expect(full.current).toBeLessThan(140);
  });

  it('every motor stays below the ESC current limit and the pack below the sum of the limits', () => {
    expect(full.phase).toBeLessThanOrEqual(cfg.motor.maxCurrent + 1e-9);
    expect(full.current).toBeLessThan(4 * cfg.motor.maxCurrent);
  });

  it('the real quad at the bench hover stick has vertical load factor 1', () => {
    const q = airborneQuad(cfg, stick);
    const v0 = q.state.vel[1];
    run(q, 0.3, inp({ throttle: stick }));
    expect(q.state.gForce[1]).toBeGreaterThan(0.97);
    expect(q.state.gForce[1]).toBeLessThan(1.03);
    expect(Math.abs(q.state.vel[1] - v0)).toBeLessThan(0.15);
  });
});

describe('battery', () => {
  it('sags 1-3 V on 6S under a full-throttle punch and recovers at rest', () => {
    const q = airborneQuad(cfg, 0.29);
    const ocv = 6 * cellOcv(1);
    const hoverV = q.state.batteryVoltage;
    run(q, 0.5, inp({ throttle: 1 }));
    const sag = ocv - q.state.batteryVoltage;
    expect(sag).toBeGreaterThan(1);
    expect(sag).toBeLessThan(3);
    expect(hoverV).toBeGreaterThan(q.state.batteryVoltage);
    expect(ocv - hoverV).toBeLessThan(sag);
    expect(q.state.batteryCurrent).toBeGreaterThan(80);
  });

  it('OCV curve is monotonic from 3.0 to 4.2 V with a 3.7 V plateau', () => {
    expect(cellOcv(0)).toBeCloseTo(3.0, 6);
    expect(cellOcv(1)).toBeCloseTo(4.2, 6);
    let prev = 0;
    for (let s = 0; s <= 1.0001; s += 0.01) {
      const v = cellOcv(s);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(cellOcv(0.4)).toBeGreaterThan(3.65);
    expect(cellOcv(0.4)).toBeLessThan(3.8);
  });

  it('integrates mAh, and resistance rises when cold or nearly empty', () => {
    const b = new Battery(cfg.battery);
    for (let i = 0; i < 4000; i++) b.step(DT, 36);
    expect(b.mah).toBeCloseTo(10, 6);
    const warm = new Battery(cfg.battery);
    const cold = new Battery(cfg.battery);
    cold.tempC = 0;
    const flat = new Battery(cfg.battery);
    flat.mah = 1250;
    expect(cold.seriesResistance()).toBeGreaterThan(warm.seriesResistance());
    expect(flat.seriesResistance()).toBeGreaterThan(warm.seriesResistance());
  });

  it('4S and 6S presets give 16.8 V and 25.2 V fresh', () => {
    expect(new Battery(BATTERY_4S_1300).emf()).toBeCloseTo(16.8, 6);
    expect(new Battery(BATTERY_6S_1300).emf()).toBeCloseTo(25.2, 6);
    expect(getPreset('quad_5in_6s').battery.cells).toBe(6);
  });
});

describe('motor and ESC', () => {
  const settle = (m: Motor, duty: number, volts: number, load: (w: number) => number, seconds: number): void => {
    for (let i = 0; i < seconds / DT; i++) {
      m.updateDuty(DT, duty);
      m.advance(DT, volts, load(m.omega), 0);
    }
  };

  it('no-load speed is close to kv * volts', () => {
    const m = new Motor(cfg.motor);
    settle(m, 1, 24, () => 0, 0.4);
    const ideal = (cfg.motor.kv * 24 * TWO_PI) / 60;
    expect(m.omega).toBeGreaterThan(0.98 * ideal);
    expect(m.omega).toBeLessThan(ideal);
  });

  it('the current limiter clamps stall current to the ESC limit', () => {
    const m = new Motor(cfg.motor);
    for (let i = 0; i < 4000; i++) m.updateDuty(DT, 1);
    m.advance(DT, 24, 0, 0);
    expect(m.current).toBeCloseTo(cfg.motor.maxCurrent, 6);
  });

  it('active braking stops the rotor faster than coasting', () => {
    const brake = new Motor({ ...cfg.motor, activeBraking: true });
    const coast = new Motor({ ...cfg.motor, activeBraking: false });
    brake.omega = coast.omega = 3000;
    settle(brake, 0, 24, () => 0, 0.05);
    settle(coast, 0, 24, () => 0, 0.05);
    expect(brake.omega).toBeLessThan(coast.omega);
    expect(brake.current).toBeLessThan(0);
  });

  it('negative duty spins the rotor in reverse', () => {
    const m = new Motor(cfg.motor);
    settle(m, -0.5, 24, () => 0, 0.3);
    expect(m.omega).toBeLessThan(-1000);
  });

  it('duty follows the command with the ESC lag time constant', () => {
    const m = new Motor(cfg.motor);
    m.updateDuty(DT, 1);
    const steps = Math.round(cfg.motor.escLag / DT);
    for (let i = 0; i < steps; i++) m.updateDuty(DT, 1);
    expect(m.duty).toBeGreaterThan(0.55);
    expect(m.duty).toBeLessThan(0.7);
  });
});

describe('propeller', () => {
  const n = cfg.prop.reynoldsRef;
  const omega = n * TWO_PI;
  const p = cfg.prop;
  const thrustAt = (rho: number, vAxial: number, w = omega): number => {
    const prop = new Propeller(p, new Rng(3));
    prop.evaluate(w, rho, vAxial, 1, DT);
    return prop.thrust;
  };

  it('static thrust matches CT rho n^2 D^4 and scales with air density', () => {
    const ref = p.ct0 * 1.225 * n * n * p.diameter ** 4;
    expect(thrustAt(1.225, 0)).toBeCloseTo(ref, 6);
    expect(thrustAt(0.6125, 0) / thrustAt(1.225, 0)).toBeCloseTo(0.5, 6);
  });

  it('thrust falls with climb speed (advance ratio) and rises again with ground effect', () => {
    expect(thrustAt(1.225, 10)).toBeLessThan(thrustAt(1.225, 0));
    const prop = new Propeller(p, new Rng(3));
    prop.evaluate(omega, 1.225, 0, 1.3, DT);
    expect(prop.thrust).toBeCloseTo(1.3 * thrustAt(1.225, 0), 6);
  });

  it('reverse spin gives about half the thrust, pointing down the body axis', () => {
    const fwd = thrustAt(1.225, 0);
    const rev = thrustAt(1.225, 0, -omega);
    expect(rev).toBeLessThan(0);
    expect(-rev / fwd).toBeCloseTo(p.reverseThrust, 6);
  });

  it('descending at about one induced velocity loses thrust (vortex ring) and adds wake noise', () => {
    const area = Math.PI * p.diameter * p.diameter * 0.25;
    const vh = Math.sqrt((p.ct0 * 1.225 * n * n * p.diameter ** 4) / (2 * 1.225 * area));
    const prop = new Propeller(p, new Rng(3));
    let sum = 0, sum2 = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      prop.evaluate(omega, 1.225, -vh, 1, DT);
      sum += prop.thrust;
      sum2 += prop.thrust * prop.thrust;
    }
    const mean = sum / N;
    const sd = Math.sqrt(sum2 / N - mean * mean);
    const clean = thrustAt(1.225, 0) * (1 + vh / (n * p.diameter * p.j0));
    expect(mean).toBeLessThan(0.75 * clean);
    expect(sd / mean).toBeGreaterThan(0.005);
    expect(sd / mean).toBeLessThan(0.15);
    const calm = new Propeller(p, new Rng(3));
    for (let i = 0; i < 100; i++) calm.evaluate(omega, 1.225, 3, 1, DT);
    const t0 = calm.thrust;
    calm.evaluate(omega, 1.225, 3, 1, DT);
    expect(calm.thrust).toBe(t0);
  });

  it('torque is positive with rotation and produces H-force and flapping gains', () => {
    const prop = new Propeller(p, new Rng(3));
    prop.evaluate(omega, 1.225, 0, 1, DT);
    expect(prop.torque).toBeGreaterThan(0);
    expect(prop.hDrag).toBeGreaterThan(0);
    expect(prop.flapGain).toBeGreaterThan(0);
  });
});
