import { describe, expect, it } from 'vitest';
import {
  AIRGLOW_HEIGHT_KM, AP_MAX_DISTANCE_M, ATMOSPHERE_TOP_KM, MIE_EXTINCTION, MIE_SCALE_HEIGHT_KM, MIE_SCATTER, OZONE_ABSORPTION, OZONE_CENTER_KM,
  OZONE_HALF_WIDTH_KM, PLANET_RADIUS_KM, RAYLEIGH_SCALE_HEIGHT_KM, RAYLEIGH_SCATTER, SKYVIEW_SIZE, apDistanceToSlice, apSliceToDistance,
  MS_DIPOLE, MS_DIPOLE_MU_HI, MS_DIPOLE_MU_LO, distanceToTop, hgPhase, mediumAt, miePhase, multiScatterDipole, opticalDepthToTop, rayleighPhase, skyViewParams, skyViewUv, subUvToUnit, transmittanceParams,
  transmittanceToTop, transmittanceUv, unitToSubUv, vanRhijn,
} from './physics';

/** Integral of a phase function over the sphere: 2 pi * integral over cos(theta) in [-1, 1], midpoint rule. */
function sphereIntegral(phase: (c: number) => number): number {
  const n = 40000;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += phase(-1 + (2 * (i + 0.5)) / n);
  return (sum * 2 * 2 * Math.PI) / n;
}

describe('geometry', () => {
  it('measures the path to the top of the atmosphere', () => {
    expect(distanceToTop(PLANET_RADIUS_KM, 1)).toBeCloseTo(ATMOSPHERE_TOP_KM - PLANET_RADIUS_KM, 9);
    expect(distanceToTop(ATMOSPHERE_TOP_KM, 1)).toBeCloseTo(0, 9);
    const horizon = Math.sqrt(ATMOSPHERE_TOP_KM ** 2 - PLANET_RADIUS_KM ** 2);
    expect(distanceToTop(PLANET_RADIUS_KM, 0)).toBeCloseTo(horizon, 6);
    expect(horizon).toBeCloseTo(1131.8, 0);
  });

  it('round-trips the transmittance LUT parameterisation', () => {
    for (const r of [PLANET_RADIUS_KM + 0.001, PLANET_RADIUS_KM + 1.2, PLANET_RADIUS_KM + 30, ATMOSPHERE_TOP_KM - 0.5]) {
      for (const mu of [-0.15, -0.02, 0, 0.03, 0.4, 0.9, 1]) {
        const horizonMu = -Math.sqrt(Math.max(0, 1 - (PLANET_RADIUS_KM / r) ** 2));
        if (mu < horizonMu) continue;
        const [u, v] = transmittanceUv(r, mu);
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThanOrEqual(1);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        const [r2, mu2] = transmittanceParams(u, v);
        expect(r2).toBeCloseTo(r, 3);
        expect(mu2).toBeCloseTo(mu, 3);
      }
    }
  });

  it('round-trips the sky-view LUT parameterisation and clusters rows at the horizon', () => {
    const r = PLANET_RADIUS_KM + 1.2;
    for (const cz of [1, 0.7, 0.2, 0.01, -0.05, -0.3, -1]) {
      for (const ca of [-1, -0.4, 0.3, 1]) {
        const [u, v] = skyViewUv(cz, ca, r);
        const [cz2, ca2] = skyViewParams(u, v, r);
        expect(cz2).toBeCloseTo(cz, 3);
        expect(ca2).toBeCloseTo(ca, 3);
      }
    }
    const row = (elevationDeg: number) => skyViewUv(Math.sin(elevationDeg * Math.PI / 180), 0, r)[1];
    const geometricHorizon = skyViewUv(-Math.sqrt(1 - (PLANET_RADIUS_KM / r) ** 2), 0, r)[1];
    expect(geometricHorizon).toBeCloseTo(0.5, 2);
    expect(row(90)).toBeLessThan(row(0));
    expect(row(0)).toBeLessThan(row(-90));
    expect(row(90)).toBeGreaterThan(0);
    expect(row(-90)).toBeLessThan(1);
    expect(row(0) - row(2)).toBeGreaterThan(5 * (row(60) - row(62)));
  });

  it('maps unit coordinates to texel centres and back', () => {
    expect(unitToSubUv(0, 64)).toBeCloseTo(0.5 / 64, 12);
    expect(unitToSubUv(1, 64)).toBeCloseTo(1 - 0.5 / 64, 12);
    for (const u of [0, 0.13, 0.5, 0.97, 1]) expect(subUvToUnit(unitToSubUv(u, SKYVIEW_SIZE.height), SKYVIEW_SIZE.height)).toBeCloseTo(u, 12);
  });

  it('spaces aerial-perspective slices exponentially and inverts them', () => {
    expect(apSliceToDistance(0)).toBe(0);
    expect(apSliceToDistance(1)).toBeCloseTo(AP_MAX_DISTANCE_M, 6);
    let prev = 0;
    for (let i = 1; i <= 32; i++) {
      const d = apSliceToDistance(i / 32);
      expect(d).toBeGreaterThan(prev);
      expect(apDistanceToSlice(d)).toBeCloseTo(i / 32, 9);
      prev = d;
    }
    expect(apSliceToDistance(1 / 32)).toBeLessThan(100);
  });
});

describe('medium', () => {
  it('has the Hillaire 2020 Rayleigh coefficients and a clear-day aerosol at the ground', () => {
    const m = mediumAt(0);
    expect(m.scatterRayleigh).toEqual([...RAYLEIGH_SCATTER]);
    expect(m.scatterMie).toBeCloseTo(MIE_SCATTER, 9);
    expect(m.extinction[1]).toBeCloseTo(RAYLEIGH_SCATTER[1] + MIE_EXTINCTION, 9);
  });

  it('decays with the scale heights and peaks the ozone at 25 km', () => {
    const a = mediumAt(RAYLEIGH_SCALE_HEIGHT_KM);
    expect(a.scatterRayleigh[2]).toBeCloseTo(RAYLEIGH_SCATTER[2] / Math.E, 9);
    expect(mediumAt(MIE_SCALE_HEIGHT_KM).scatterMie).toBeCloseTo(MIE_SCATTER / Math.E, 9);
    const o = mediumAt(OZONE_CENTER_KM);
    const dR = Math.exp(-OZONE_CENTER_KM / RAYLEIGH_SCALE_HEIGHT_KM), dM = Math.exp(-OZONE_CENTER_KM / MIE_SCALE_HEIGHT_KM);
    expect(o.extinction[1]).toBeCloseTo(RAYLEIGH_SCATTER[1] * dR + MIE_EXTINCTION * dM + OZONE_ABSORPTION[1], 12);
    const edge = mediumAt(OZONE_CENTER_KM + OZONE_HALF_WIDTH_KM);
    expect(edge.extinction[1]).toBeCloseTo(RAYLEIGH_SCATTER[1] * Math.exp(-40 / 8) + MIE_EXTINCTION * Math.exp(-40 / MIE_SCALE_HEIGHT_KM), 12);
  });
});

describe('optical depth and transmittance', () => {
  it('matches the analytic zenith optical depth of the exponential and ozone layers', () => {
    const t = opticalDepthToTop(PLANET_RADIUS_KM, 1, 4096);
    const height = ATMOSPHERE_TOP_KM - PLANET_RADIUS_KM;
    for (let c = 0; c < 3; c++) {
      const rayleigh = RAYLEIGH_SCATTER[c] * RAYLEIGH_SCALE_HEIGHT_KM * (1 - Math.exp(-height / RAYLEIGH_SCALE_HEIGHT_KM));
      const mie = MIE_EXTINCTION * MIE_SCALE_HEIGHT_KM * (1 - Math.exp(-height / MIE_SCALE_HEIGHT_KM));
      const ozone = OZONE_ABSORPTION[c] * OZONE_HALF_WIDTH_KM;
      expect(t[c]).toBeCloseTo(rayleigh + mie + ozone, 4);
    }
    expect(t[0]).toBeCloseTo(0.2089, 3);
    expect(t[1]).toBeCloseTo(0.2732, 3);
    expect(t[2]).toBeCloseTo(0.4061, 3);
  });

  it('gives a clear zenith sky the familiar blue-shifted transmittance', () => {
    const t = transmittanceToTop(PLANET_RADIUS_KM, 1, 2048);
    expect(t[0]).toBeGreaterThan(t[1]);
    expect(t[1]).toBeGreaterThan(t[2]);
    expect(t[0]).toBeCloseTo(Math.exp(-0.2089), 3);
    expect(t[2]).toBeGreaterThan(0.6);
  });

  it('is 40 to 60 air masses along the horizon for the blue channel (the shallow aerosol layer adds air mass)', () => {
    const zenith = opticalDepthToTop(PLANET_RADIUS_KM, 1, 2048)[2];
    const horizon = opticalDepthToTop(PLANET_RADIUS_KM, 0, 2048)[2];
    expect(horizon / zenith).toBeGreaterThan(40);
    expect(horizon / zenith).toBeLessThan(60);
  });

  it('grows monotonically toward the horizon and shrinks with altitude', () => {
    let prev = 0;
    for (const mu of [1, 0.8, 0.5, 0.2, 0.05, 0]) {
      const tau = opticalDepthToTop(PLANET_RADIUS_KM, mu, 512)[1];
      expect(tau).toBeGreaterThan(prev);
      prev = tau;
    }
    expect(opticalDepthToTop(PLANET_RADIUS_KM + 5, 1, 512)[1]).toBeLessThan(opticalDepthToTop(PLANET_RADIUS_KM, 1, 512)[1]);
    expect(opticalDepthToTop(ATMOSPHERE_TOP_KM, 1, 8)).toEqual([0, 0, 0]);
  });

  it('is converged at the 64 steps the CPU reference uses by default', () => {
    for (const mu of [1, 0.3]) {
      const coarse = opticalDepthToTop(PLANET_RADIUS_KM, mu)[1], fine = opticalDepthToTop(PLANET_RADIUS_KM, mu, 4096)[1];
      expect(Math.abs(coarse - fine) / fine).toBeLessThan(0.03);
    }
  });
});

describe('aerosol', () => {
  it('is a clear-day continental aerosol: optical depth 0.1-0.2, albedo 0.9-0.95', () => {
    const aod = MIE_EXTINCTION * MIE_SCALE_HEIGHT_KM;
    expect(aod).toBeGreaterThan(0.1);
    expect(aod).toBeLessThan(0.2);
    expect(MIE_SCATTER / MIE_EXTINCTION).toBeGreaterThan(0.9);
    expect(MIE_SCATTER / MIE_EXTINCTION).toBeLessThan(0.95);
  });

  it('gives a Koschmieder visibility of 40 to 100 km at 1.2 km altitude', () => {
    const m = mediumAt(1.2);
    const sigma = m.extinction[1];
    const visibilityKm = 3.912 / sigma;
    expect(visibilityKm).toBeGreaterThan(40);
    expect(visibilityKm).toBeLessThan(100);
  });

  it('makes distant terrain hazy but visible: 5 km keeps 70-85 percent, 12 km keeps 40-60 percent of the green light', () => {
    const sigma = mediumAt(1.2).extinction[1];
    expect(Math.exp(-5 * sigma)).toBeGreaterThan(0.7);
    expect(Math.exp(-5 * sigma)).toBeLessThan(0.85);
    expect(Math.exp(-12 * sigma)).toBeGreaterThan(0.4);
    expect(Math.exp(-12 * sigma)).toBeLessThan(0.6);
  });

  it('scatters more in the back than at 90 degrees (back lobe) and far more forward', () => {
    expect(miePhase(-1)).toBeGreaterThan(miePhase(0));
    expect(miePhase(1)).toBeGreaterThan(miePhase(0) * 60);
    expect(miePhase(0)).toBeGreaterThan(0.015);
  });

  it('has a narrow glare peak: seven eighths of the peak is gone by 6 degrees and 20 degrees is down by more than 30x', () => {
    const at = (deg: number): number => miePhase(Math.cos((deg * Math.PI) / 180));
    expect(at(0)).toBeGreaterThan(10);
    expect(at(0.8) / at(0)).toBeGreaterThan(0.8);
    expect(at(5.6) / at(0)).toBeLessThan(0.12);
    expect(at(5.6) / at(0.8)).toBeLessThan(0.13);
    expect(at(20) / at(0)).toBeLessThan(1 / 30);
    expect(at(90)).toBeGreaterThan(0.02);
    expect(at(90)).toBeLessThan(0.06);
  });
});

describe('phase functions', () => {
  it('integrate to one over the sphere', () => {
    expect(sphereIntegral(rayleighPhase)).toBeCloseTo(1, 4);
    expect(sphereIntegral((c) => miePhase(c))).toBeCloseTo(1, 3);
    expect(sphereIntegral((c) => hgPhase(c, 0.8))).toBeCloseTo(1, 3);
    expect(sphereIntegral((c) => hgPhase(c, -0.3))).toBeCloseTo(1, 4);
  });

  it('peaks forward for positive anisotropy and matches the isotropic value at g = 0', () => {
    expect(hgPhase(0.3, 0)).toBeCloseTo(1 / (4 * Math.PI), 12);
    expect(hgPhase(1, 0.8)).toBeGreaterThan(hgPhase(-1, 0.8) * 100);
    expect(miePhase(1)).toBeGreaterThan(miePhase(0) * 50);
    expect(rayleighPhase(0)).toBeCloseTo(3 / (16 * Math.PI), 12);
    expect(rayleighPhase(1)).toBeCloseTo(rayleighPhase(-1), 12);
  });
});

describe('airglow geometry', () => {
  it('has a unit Van Rhijn factor at the zenith and about 6 at the horizon', () => {
    expect(vanRhijn(1)).toBeCloseTo(1, 12);
    const shell = PLANET_RADIUS_KM / (PLANET_RADIUS_KM + AIRGLOW_HEIGHT_KM);
    expect(vanRhijn(0)).toBeCloseTo(1 / Math.sqrt(1 - shell * shell), 9);
    expect(vanRhijn(0)).toBeGreaterThan(5.5);
    expect(vanRhijn(0)).toBeLessThan(6.5);
    expect(vanRhijn(0.5)).toBeGreaterThan(vanRhijn(0.9));
  });
});

describe('ozone absorption', () => {
  it('is a Chappuis band: red and green absorbed ~20x more than blue, red a little weaker than green (a stronger red tilts twilight yellow-green, a weaker one magenta)', () => {
    const [r, g, b] = OZONE_ABSORPTION;
    expect(r).toBeLessThan(g);
    expect(r / g).toBeGreaterThan(0.8);
    expect(g / b).toBeGreaterThan(15);
  });
});

describe('twilight multiple-scattering dipole', () => {
  it('is exactly 1 for a light above the horizon and at the zenith view, whatever the azimuth', () => {
    for (const c of [-1, -0.3, 0, 0.7, 1]) expect(multiScatterDipole(MS_DIPOLE_MU_HI + 0.2, c)).toBe(1);
    for (const mu of [-0.3, -0.05, 0.4]) expect(multiScatterDipole(mu, 0)).toBe(1);
  });

  it('after sunset puts 1 + MS_DIPOLE on the glow side and 1 - MS_DIPOLE on the shadow side, with a unit mean over azimuth', () => {
    const mu = MS_DIPOLE_MU_LO - 0.05;
    expect(multiScatterDipole(mu, 1)).toBeCloseTo(1 + MS_DIPOLE, 12);
    expect(multiScatterDipole(mu, -1)).toBeCloseTo(1 - MS_DIPOLE, 12);
    let mean = 0;
    const n = 360;
    for (let i = 0; i < n; i++) mean += multiScatterDipole(mu, Math.cos(((i + 0.5) / n) * 2 * Math.PI)) / n;
    expect(mean).toBeCloseTo(1, 9);
  });

  it('never goes negative and fades monotonically between its two light elevations', () => {
    expect(1 - MS_DIPOLE).toBeGreaterThan(0);
    let prev = multiScatterDipole(MS_DIPOLE_MU_LO, -1);
    for (let mu = MS_DIPOLE_MU_LO; mu <= MS_DIPOLE_MU_HI; mu += 0.005) {
      const g = multiScatterDipole(mu, -1);
      expect(g).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = g;
    }
  });
});
