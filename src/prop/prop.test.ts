import { describe, expect, it } from 'vitest';
import { QUAD_5IN_6S } from '../sim/presets';
import { bemt } from './bemt';
import { benchProp } from './bench';
import { DEFAULT_PROP, designFromVector, PROP_VARS, vectorFromDesign } from './design';
import { propMassInertia, propParamsFromDesign, quadWithProp } from './fit';

const rpm = (r: number) => (r * 2 * Math.PI) / 60;

describe('blade element solver', () => {
  it('thrust and power grow with the square and cube of rpm at standstill', () => {
    const a = bemt(DEFAULT_PROP, rpm(15000), 0);
    const b = bemt(DEFAULT_PROP, rpm(30000), 0);
    expect(b.thrust / a.thrust).toBeGreaterThan(3.6);
    expect(b.thrust / a.thrust).toBeLessThan(4.4);
    expect(b.power / a.power).toBeGreaterThan(7);
    expect(b.power / a.power).toBeLessThan(9);
  });

  it('gives a plausible 5 inch tri-blade static point', () => {
    const p = bemt(DEFAULT_PROP, rpm(25000), 0);
    expect(p.thrust / 9.80665 * 1000).toBeGreaterThan(800);
    expect(p.thrust / 9.80665 * 1000).toBeLessThan(1600);
    expect(p.thrustPerWatt * 101.97).toBeGreaterThan(1.5);
    expect(p.thrustPerWatt * 101.97).toBeLessThan(4.5);
  });

  it('loses thrust as the air speed along the axis rises', () => {
    const w = rpm(25000);
    const t0 = bemt(DEFAULT_PROP, w, 0).thrust;
    const t1 = bemt(DEFAULT_PROP, w, 15).thrust;
    const t2 = bemt(DEFAULT_PROP, w, 30).thrust;
    expect(t1).toBeLessThan(t0);
    expect(t2).toBeLessThan(t1);
  });

  it('more pitch means more thrust and more power', () => {
    const v = vectorFromDesign(DEFAULT_PROP);
    v[1] *= 1.25;
    const hi = bemt(designFromVector(v), rpm(25000), 0);
    const base = bemt(DEFAULT_PROP, rpm(25000), 0);
    expect(hi.thrust).toBeGreaterThan(base.thrust);
    expect(hi.power).toBeGreaterThan(base.power);
  });
});

describe('plugging a prop into the quad', () => {
  it('the default design is exactly the stock quad', () => {
    const q = quadWithProp(QUAD_5IN_6S, DEFAULT_PROP);
    expect(q.prop).toEqual(QUAD_5IN_6S.prop);
    expect(q.mass).toBeCloseTo(QUAD_5IN_6S.mass, 12);
    expect(q.inertia[0]).toBeCloseTo(QUAD_5IN_6S.inertia[0], 12);
    expect(q.inertia[1]).toBeCloseTo(QUAD_5IN_6S.inertia[1], 12);
    expect(q.inertia[2]).toBeCloseTo(QUAD_5IN_6S.inertia[2], 12);
    expect(q.motor.inertia).toBeCloseTo(QUAD_5IN_6S.motor.inertia, 12);
    expect(q.name).toBe(QUAD_5IN_6S.name);
  });

  it('the default prop weighs 5 g', () => {
    expect(propMassInertia(DEFAULT_PROP).mass).toBeCloseTo(0.005, 9);
  });

  it('a stiffer-pitch prop changes the coefficients and the mass moves with the design', () => {
    const v = vectorFromDesign(DEFAULT_PROP);
    v[1] *= 1.2;
    v[3] = 4;
    const d = designFromVector(v);
    expect(propParamsFromDesign(d).ct0).not.toBe(QUAD_5IN_6S.prop.ct0);
    const q = quadWithProp(QUAD_5IN_6S, d);
    expect(q.mass).not.toBe(QUAD_5IN_6S.mass);
  });

  it('clamps and rounds optimiser vectors', () => {
    const d = designFromVector(PROP_VARS.map((v) => v.max * 10));
    expect(d.blades).toBe(5);
    expect(d.diameter).toBeCloseTo(5.2 * 0.0254, 9);
  });
});

describe('bench', () => {
  it('reports sensible numbers for the stock prop', () => {
    const r = benchProp(DEFAULT_PROP, QUAD_5IN_6S, false);
    expect(r.thrustToWeight).toBeGreaterThan(5);
    expect(r.thrustToWeight).toBeLessThan(15);
    expect(r.hoverDuty).toBeGreaterThan(0.15);
    expect(r.hoverDuty).toBeLessThan(0.5);
    expect(r.hoverMinutes).toBeGreaterThan(3);
    expect(r.tipMach).toBeLessThan(0.9);
  });
});

describe('against a published thrust stand', () => {
  // Source: miniquadtestbench.com, HQ v1s 5x4.3x3PC (not the Emax Avan Flow; no table for that prop was found).
  // rpm, thrust g at the shaft. Its power column is electrical, so only thrust is compared here.
  const rows: [number, number][] = [[11004, 170], [18326, 494], [24588, 893]];
  it('solver thrust is within 25% and the calibrated sim prop within 6%', () => {
    for (const [r, g] of rows) {
      const raw = (bemt(DEFAULT_PROP, rpm(r), 0).thrust / 9.80665) * 1000;
      expect(Math.abs(raw / g - 1)).toBeLessThan(0.25);
      const p = QUAD_5IN_6S.prop;
      const n = r / 60;
      const sim = ((p.ct0 * 1.225 * n * n * p.diameter ** 4) / 9.80665) * 1000;
      expect(Math.abs(sim / g - 1)).toBeLessThan(0.06);
    }
  });
});
