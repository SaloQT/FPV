import { describe, expect, it } from 'vitest';
import type { AstroState } from '../contracts';
import { CPU_EXPOSURE_KEY, ExposureController, MAX_PRE, estimateSceneLuminance, preExposureFor, skyIlluminanceLux } from './exposure';

const deg = (d: number) => (d * Math.PI) / 180;

function astro(sunElev: number, moonElev: number, phase = 0): AstroState {
  return {
    julianDate: 2461000, sunDir: [0, Math.sin(deg(sunElev)), -Math.cos(deg(sunElev))], moonDir: [0, Math.sin(deg(moonElev)), -Math.cos(deg(moonElev))],
    sunElevation: deg(sunElev), moonElevation: deg(moonElev), moonIlluminatedFraction: 0.5, moonPhaseAngle: phase,
    equatorialToWorld: [1, 0, 0, 0, 1, 0, 0, 0, 1], planets: [],
  };
}

describe('estimateSceneLuminance', () => {
  it('orders noon >> dusk >> full moon >> new moon', () => {
    const noon = estimateSceneLuminance(astro(60, -30), 100);
    const dusk = estimateSceneLuminance(astro(-3, -30), 100);
    const fullMoon = estimateSceneLuminance(astro(-30, 60, 0), 100);
    const newMoon = estimateSceneLuminance(astro(-30, 60, Math.PI), 100);
    expect(noon).toBeGreaterThan(dusk * 50);
    expect(dusk).toBeGreaterThan(fullMoon * 50);
    expect(fullMoon).toBeGreaterThan(newMoon * 20);
    expect(newMoon).toBeGreaterThanOrEqual(3e-5);
  });

  it('noon is in the thousands of nits and full moon a few 1e-3', () => {
    expect(estimateSceneLuminance(astro(60, -30), 0)).toBeGreaterThan(3000);
    expect(estimateSceneLuminance(astro(60, -30), 0)).toBeLessThan(20000);
    const moon = estimateSceneLuminance(astro(-30, 60, 0), 0);
    expect(moon).toBeGreaterThan(3e-3);
    expect(moon).toBeLessThan(3e-2);
  });

  it('is monotonic in solar elevation across the whole sky', () => {
    let prev = 0;
    for (let e = -25; e <= 90; e += 1) {
      const l = estimateSceneLuminance(astro(e, -40), 50);
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });

  it('floors at starlight with nothing above the horizon', () => {
    expect(estimateSceneLuminance(astro(-60, -60, Math.PI), 0)).toBeGreaterThanOrEqual(3e-5);
  });

  it('skylight table interpolates continuously', () => {
    expect(skyIlluminanceLux(deg(0))).toBeCloseTo(Math.pow(10, 2.6), 0);
    expect(skyIlluminanceLux(deg(-9))).toBeGreaterThan(skyIlluminanceLux(deg(-12)));
    expect(skyIlluminanceLux(deg(-9))).toBeLessThan(skyIlluminanceLux(deg(-6)));
  });
});

describe('preExposureFor', () => {
  it('maps a mid-grey surface to 0.25 and clamps to [1e-6, MAX_PRE]', () => {
    expect(preExposureFor(1000) * 1000).toBeCloseTo(CPU_EXPOSURE_KEY, 6);
    expect(preExposureFor(1e-9)).toBe(MAX_PRE);
    expect(MAX_PRE).toBe(1e3);
    expect(preExposureFor(1e12)).toBe(1e-6);
  });
});

describe('ExposureController', () => {
  it('snaps on the first update and limits later change to 2% per frame', () => {
    const c = new ExposureController();
    c.update(1 / 60, astro(60, -30), 100);
    const day = c.preExposure;
    expect(day).toBeCloseTo(preExposureFor(estimateSceneLuminance(astro(60, -30), 100)), 9);
    let prev = day;
    for (let i = 0; i < 400; i++) {
      c.update(1 / 60, astro(-30, -30), 100);
      const cur = c.preExposure;
      expect(cur / prev).toBeLessThanOrEqual(1.0201);
      expect(cur).toBeGreaterThanOrEqual(prev);
      expect(c.prevPreExposure).toBeCloseTo(prev, 12);
      prev = cur;
    }
  });

  it('converges toward the target with a ~0.4 s time constant', () => {
    const c = new ExposureController();
    c.update(1 / 60, astro(10, -30), 0);
    const target = preExposureFor(estimateSceneLuminance(astro(20, -30), 0));
    for (let i = 0; i < 240; i++) c.update(1 / 60, astro(20, -30), 0);
    expect(Math.abs(Math.log(c.preExposure / target))).toBeLessThan(0.01);
  });

  it('reset makes the next update snap again', () => {
    const c = new ExposureController();
    c.update(1 / 60, astro(60, -30), 0);
    c.reset();
    c.update(1 / 60, astro(-30, -30), 0);
    expect(c.preExposure).toBeCloseTo(preExposureFor(estimateSceneLuminance(astro(-30, -30), 0)), 9);
  });
});
