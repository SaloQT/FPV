import { describe, expect, it } from 'vitest';
import type { StarCatalog } from '../../contracts';
import { magToIlluminance } from '../../world/astro/stars';
import { toHalf } from '../half';
import { galacticAxesEquatorial } from './celestial';
import { MILKY_WAY_HEIGHT, MILKY_WAY_WIDTH, bakeMilkyWay } from './milkyWay';
import { NIGHT_DOME_KERNEL, NightDome } from './nightDome';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const SUN = [0, -0.3, -0.95];
const ECLIPTIC_POLE = [0, 0.4, 0.9];

function uniformMap(nits: number): Uint16Array {
  const t = new Uint16Array(MILKY_WAY_WIDTH * MILKY_WAY_HEIGHT * 4);
  for (let i = 0; i < t.length; i += 4) { t[i] = toHalf(nits); t[i + 1] = toHalf(nits); t[i + 2] = toHalf(nits); t[i + 3] = toHalf(1); }
  return t;
}

// With the identity rotation world +Y is equatorial +Y: right ascension 90 deg on the equator (starDirectionEq: x = cos d cos a, y = cos d sin a, z = sin d).
function zenithStar(mag: number): StarCatalog {
  return { count: 1, data: Float32Array.from([Math.PI / 2, 0, mag, 0.6]) };
}

describe('night dome', () => {
  it('has a kernel between 0.5 and 1: the extinction and horizon taper cost some of the cosine-weighted dome', () => {
    expect(NIGHT_DOME_KERNEL).toBeGreaterThan(0.5);
    expect(NIGHT_DOME_KERNEL).toBeLessThan(1);
  });

  it('turns a uniform Milky Way map into the same radiance times 1 (the taper is divided out), zodiacal light on top', () => {
    const dome = new NightDome(uniformMap(2e-4), null);
    const without = Array.from(dome.compute(IDENTITY, SUN, ECLIPTIC_POLE, 0, 0));
    const withMw = Array.from(dome.compute(IDENTITY, SUN, ECLIPTIC_POLE, 1, 0));
    for (let c = 0; c < 3; c++) expect(withMw[c] - without[c]).toBeCloseTo(2e-4, 6);
    const doubled = Array.from(dome.compute(IDENTITY, SUN, ECLIPTIC_POLE, 2, 0));
    for (let c = 0; c < 3; c++) expect(doubled[c] - without[c]).toBeCloseTo(4e-4, 6);
  });

  it('adds a star by its photometric illuminance on the horizontal plane: E = pi * M * K', () => {
    const dome = new NightDome(uniformMap(0), zenithStar(2));
    const off = Array.from(dome.compute(IDENTITY, SUN, ECLIPTIC_POLE, 0, 0));
    const on = Array.from(dome.compute(IDENTITY, SUN, ECLIPTIC_POLE, 0, 1));
    const extinction = Math.exp(-0.1);
    const expected = (magToIlluminance(2) * extinction) / Math.PI / NIGHT_DOME_KERNEL;
    expect(on[1] - off[1]).toBeCloseTo(expected, 9);
    const dim = Array.from(dome.compute(IDENTITY, SUN, ECLIPTIC_POLE, 0, 0.5));
    expect(dim[1] - off[1]).toBeCloseTo(expected * 0.5, 9);
  });

  it('ignores stars below the horizon', () => {
    const dome = new NightDome(uniformMap(0), { count: 1, data: Float32Array.from([-Math.PI / 2, 0, 1, 0.6]) });
    const off = Array.from(dome.compute(IDENTITY, SUN, ECLIPTIC_POLE, 0, 0));
    const on = Array.from(dome.compute(IDENTITY, SUN, ECLIPTIC_POLE, 0, 1));
    expect(on[1]).toBeCloseTo(off[1], 12);
  });

  it('keeps zodiacal light alone near a tenth of a millinit: about 1e-4 nits on a moonless night', () => {
    const dome = new NightDome(uniformMap(0), null);
    const z = dome.compute(IDENTITY, SUN, ECLIPTIC_POLE, 0, 0);
    expect(z[1]).toBeGreaterThan(4e-5);
    expect(z[1]).toBeLessThan(4e-4);
    expect(z[0]).toBeGreaterThan(z[2]);
  });

  it('asks for a refresh only once the sky has turned by a fraction of a degree', () => {
    const dome = new NightDome(uniformMap(0), null);
    expect(dome.needsRefresh(IDENTITY)).toBe(true);
    dome.compute(IDENTITY, SUN, ECLIPTIC_POLE, 1, 1);
    expect(dome.needsRefresh(IDENTITY)).toBe(false);
    const small = IDENTITY.slice(); small[1] = 0.002; small[3] = -0.002;
    expect(dome.needsRefresh(small)).toBe(false);
    const turned = IDENTITY.slice(); turned[1] = -0.05; turned[3] = 0.05;
    expect(dome.needsRefresh(turned)).toBe(true);
  });
  it('reads the Milky Way where it is: the galactic centre overhead lights the dome more than the anticentre or the pole', () => {
    const [centre, , pole] = galacticAxesEquatorial();
    const rotationWithZenith = (u: readonly number[]): number[] => {
      const helper = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const r0 = [u[1] * helper[2] - u[2] * helper[1], u[2] * helper[0] - u[0] * helper[2], u[0] * helper[1] - u[1] * helper[0]];
      const n0 = Math.hypot(...r0);
      const row0 = r0.map((v) => v / n0);
      const row2 = [row0[1] * u[2] - row0[2] * u[1], row0[2] * u[0] - row0[0] * u[2], row0[0] * u[1] - row0[1] * u[0]];
      return [...row0, u[0], u[1], u[2], ...row2];
    };
    const dome = new NightDome(bakeMilkyWay(null), null);
    const milkyWayOnly = (zenith: readonly number[]): number => {
      const e = rotationWithZenith(zenith);
      const without = dome.compute(e, SUN, ECLIPTIC_POLE, 0, 0)[1];
      return dome.compute(e, SUN, ECLIPTIC_POLE, 1, 0)[1] - without;
    };
    const atCentre = milkyWayOnly(centre), atAnticentre = milkyWayOnly(centre.map((v) => -v)), atPole = milkyWayOnly(pole);
    expect(atCentre).toBeGreaterThan(1.5 * atAnticentre);
    expect(atCentre).toBeGreaterThan(1.5 * atPole);
    expect(atPole).toBeGreaterThan(0);
  });
});
