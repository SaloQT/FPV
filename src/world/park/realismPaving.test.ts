import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { createTerrainSampler } from '../terrain/sampler';
import { testTerrainData } from '../track/testTerrain';
import { partDistance } from './collision';
import { auditPark } from './constructionAudit';
import { insertEnd } from './construction';
import { generatePark, gradeParkTerrain } from './generator';
import { axisAngle, inverseRotate } from './math';
import { Parts } from './parts';
import { defaultParkRecipe } from './recipe';
import { unionPublicPaving } from './pavingUnion';
import { buildPublicKerbs, isPublicKerb, PAVING_TOP, pathJoinPads, pavementRectangle, polygonsOverlap, surfaceStrip } from './surfaces';
import type { ParkData, ParkPart } from './types';

/** Paving where paths meet, and the kerbs along it. Small hand-built scenes show each rule on its own, with a copy that breaks the
 * rule to prove the check can see it; generated parks at several sizes and seeds show the rules hold for the real layouts. */
function scene(): ParkData {
  return { recipe: defaultParkRecipe(), layout: 'hub', bounds: { min: [-1000, 12, -1000], max: [1000, 100, 1000] }, entrance: 0,
    launch: { pos: [0, 12, 0], yaw: 0 }, rides: [], parts: [], bodies: [], lights: [], rooms: [], routes: [], nodes: [], paths: [] };
}

/** Paths from the given arm directions (radians) all meeting at the origin, with their strips laid as the generator lays them. */
function junction(arms: number[], width = 7, widths: number[] = []): ParkData {
  const park = scene(), b = new Parts(park, [0, 0, 0], 0, -1, 'path');
  park.nodes = [{ pos: [0, 12.2, 0], links: [], kind: 'path' as const }, ...arms.map((angle): ParkData['nodes'][number] => ({ pos: [30 * Math.cos(angle), 12.2, 30 * Math.sin(angle)], links: [], kind: 'path' }))];
  park.paths = arms.map((_, i) => ({ a: 0, b: i + 1, width: widths[i] ?? width }));
  for (const p of park.paths) surfaceStrip(b, park.nodes[p.a].pos, park.nodes[p.b].pos, p.width);
  return park;
}
const finish = (park: ParkData) => { buildPublicKerbs(park); unionPublicPaving(park); return park; };

const insidePart = (part: ParkPart, point: Vec3) => partDistance(part, inverseRotate(part.rot, point.map((v, k) => v - part.pos[k]) as Vec3), [0, 1, 0]) <= 1e-9;
const visiblePaving = (park: ParkData) => park.parts.filter(p => p.surface === 'paving' && p.render !== false);
const covered = (park: ParkData, x: number, z: number) => visiblePaving(park).some(p => insidePart(p, [x, 12.1, z]));
const kerbs = (park: ParkData) => park.parts.filter(isPublicKerb);
const plan = (part: ParkPart) => pavementRectangle(part);
const problems = (park: ParkData, focus: (i: number) => boolean) => auditPark(park, [], { focus }).findings.map(f => `${f.kind} ${(f.measured * 1000).toFixed(1)} mm [${f.sources.map(s => s.split(' < ')[0]).join(' x ')}]`);

/** Uncovered sample points inside the round pad that should fill the outside of a turn: within half the widest path of the node. */
function notch(park: ParkData, radius: number): number {
  let missing = 0;
  for (let x = -radius; x <= radius; x += radius / 10) for (let z = -radius; z <= radius; z += radius / 10) if (Math.hypot(x, z) < radius * 0.98 && !covered(park, x, z)) missing++;
  return missing;
}

describe('paving where paths meet', () => {
  const layouts: [string, number[], number, boolean][] = [
    ['gentle bend', [Math.PI, 0.3], 7, true], ['right-angle bend', [Math.PI, Math.PI / 2], 7, true], ['sharp bend', [Math.PI, -2.6], 4, true], ['narrow bend', [Math.PI, 1.2], 2.4, true],
    ['T junction', [Math.PI, 0, Math.PI / 2], 7, false], ['cross', [0, Math.PI / 2, Math.PI, -Math.PI / 2], 5, false], ['spur', [Math.PI, 0.9, 1.4], 3.2, true],
  ];
  for (const [name, arms, width, open] of layouts) it(`${name} leaves no notch at the node`, () => {
    const strips = junction(arms, width), park = finish(junction(arms, width)), radius = width / 2;
    // A bare strip ends in a flat face, so the outside of a turn is open; the join piece closes it. A cross or a T has no open side.
    if (open) expect(notch(strips, radius), `${name}: bare strips`).toBeGreaterThan(0);
    expect(notch(park, radius), `${name}: with the join piece`).toBe(0);
  });
  it('lays no join piece where equal-width paths simply continue', () => {
    expect(pathJoinPads(junction([Math.PI, 0])).length).toBe(0);
    expect(pathJoinPads(junction([Math.PI, 5e-5])).length).toBe(0);
    expect(pathJoinPads(junction([Math.PI, 0.6])).length).toBeGreaterThan(0);
  });
  it('keeps one join piece per gap wider than a straight line, sized by the widest path', () => {
    const park = junction([0, Math.PI / 2, Math.PI], 4, [4, 9, 4]);
    for (const pad of pathJoinPads(park)) for (const v of pad.rim) expect(Math.hypot(v[0], v[1])).toBeCloseTo(4.5, 9);
  });
  it('closes the notch for any width and turn', () => {
    for (const width of [1.5, 3, 6, 12]) for (const turn of [0.2, 0.7, 1.4, 2.2, 2.9]) {
      const park = finish(junction([Math.PI, turn], width));
      expect(notch(park, width / 2), `width ${width} turn ${turn}`).toBe(0);
    }
  });
});

describe('kerbs', () => {
  const crossing = (park: ParkData) => {
    const list = kerbs(park).map(plan), found: [number, number][] = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (polygonsOverlap(list[i], list[j])) found.push([i, j]);
    return found;
  };
  for (const [name, arms, width] of [['bend', [Math.PI, 0.6], 7], ['sharp bend', [Math.PI, -2.7], 5], ['T junction', [Math.PI, 0, Math.PI / 2], 7], ['cross', [0, 1.4, Math.PI, -1.6], 4]] as [string, number[], number][]) {
    it(`butt against each other without crossing at a ${name}`, () => {
      const park = finish(junction(arms, width));
      expect(kerbs(park).length).toBeGreaterThan(0);
      expect(crossing(park)).toEqual([]);
      expect(problems(park, () => true)).toEqual([]);
    });
  }
  it('stop at the paving of another path and never run over it', () => {
    const park = finish(junction([Math.PI, 0, Math.PI / 2], 7));
    for (const kerb of kerbs(park)) for (const paving of visiblePaving(park)) if (paving.shape === 'box') expect(polygonsOverlap(plan(kerb), plan(paving)), 'kerb over paving').toBe(false);
  });
  it('are reported when two cross', () => {
    const park = finish(junction([Math.PI, 0.6], 7)), original = kerbs(park)[0], b = new Parts(park, [0, 0, 0], 0, -1, 'path');
    b.box([...original.pos], [...original.half], original.color, { surface: 'concrete', rot: axisAngle([0, 1, 0], 1.2) });
    expect(problems(park, i => i >= park.parts.length - 1).length).toBeGreaterThan(0);
  });
  it('stop at a footing that stands in their way', () => {
    const park = junction([Math.PI, 0], 7), b = new Parts(park, [0, 0, 0], 0, -1, 'path');
    // A lamp base on the line of the kerb, standing from the ground through the paving.
    const base = b.part('cylinder', [10, 12.1, 3.5 + 0.2], [0.23, 0.1, 0.23], [0.4, 0.4, 0.4], { surface: 'concrete' });
    finish(park);
    expect(kerbs(park).some(k => partDistance(k, inverseRotate(k.rot, base.pos.map((v, i) => v - k.pos[i]) as Vec3), [0, 1, 0]) < 0)).toBe(false);
    expect(problems(park, i => i >= park.parts.length - 40 || park.parts[i] === base).filter(p => p.startsWith('penetration'))).toEqual([]);
  });
});

describe('paving beside things that stand in it', () => {
  const strip = () => junction([Math.PI, 0], 7);
  const stand = (park: ParkData, shape: 'cylinder' | 'box', bottom: number, top: number, x = 6, z = 0.8) => {
    const b = new Parts(park, [0, 0, 0], 0, -1, 'ride');
    return b.part(shape, [x, (bottom + top) / 2, z], shape === 'box' ? [0.6, (top - bottom) / 2, 0.6] : [0.4, (top - bottom) / 2, 0.4], [0.5, 0.5, 0.55], { surface: 'paint' });
  };
  it('leaves a hole for a post that stands from the ground, and the audit finds nothing', () => {
    for (const shape of ['cylinder', 'box'] as const) {
      const park = strip(), post = stand(park, shape, 12, 15); finish(park);
      expect(covered(park, 6, 0.8)).toBe(false);
      expect(covered(park, 6, 2.5)).toBe(true);
      expect(problems(park, i => park.parts[i] === post || (park.parts[i].surface === 'paving'))).toEqual([]);
    }
  });
  it('reports a post set 100 mm into the layer instead of hiding it', () => {
    const park = strip(), post = stand(park, 'cylinder', 12.1, 15); finish(park);
    expect(covered(park, 6, 0.8)).toBe(true);
    expect(problems(park, i => park.parts[i] === post).some(p => p.startsWith('penetration'))).toBe(true);
  });
  it('reports a post 50 mm too low where a correct one rests on the paving', () => {
    const rests = strip(), low = strip();
    stand(rests, 'cylinder', PAVING_TOP, 15); stand(low, 'cylinder', PAVING_TOP - 0.05, 15);
    finish(rests); finish(low);
    expect(covered(rests, 6, 0.8)).toBe(true); expect(problems(rests, i => rests.parts[i].surface !== 'paving' && !isPublicKerb(rests.parts[i]))).toEqual([]);
    expect(problems(low, i => low.parts[i].surface !== 'paving' && !isPublicKerb(low.parts[i])).some(p => p.startsWith('penetration'))).toBe(true);
  });
  it('keeps a mast foot cast into a ride pad accepted, and reports the same mast when nothing declares the foot', () => {
    for (const declare of [true, false]) {
      const park = scene(), b = new Parts(park, [0, 0, 0], 0, -1, 'ride');
      const pad = b.part('cylinder', [0, 12.1, 0], [9, 0.1, 9], [0.3, 0.3, 0.3], { surface: 'paving' });
      const mast = b.part('cylinder', [0, 12.1 + 5, 0], [0.8, 5, 0.8], [0.5, 0.5, 0.55], { surface: 'paint' });
      if (declare) insertEnd(park, pad, mast, -1, 'ride/main-mast-foot', 'Mast foot is cast into the paving pad.');
      unionPublicPaving(park);
      const found = problems(park, i => park.parts[i] === mast);
      if (declare) expect(found).toEqual([]); else expect(found.some(p => p.startsWith('penetration'))).toBe(true);
    }
  });
  it('does not cut paving over a thin plate that lies under it', () => {
    const park = strip(); stand(park, 'box', 11.96, 12.06); finish(park);
    expect(covered(park, 6, 0.8)).toBe(true);
  });
});

describe('generated parks', () => {
  /** Paving pieces and kerbs, which must never interfere with one another. */
  const pavingOrKerb = (park: ParkData, i: number) => park.parts[i].surface === 'paving' || isPublicKerb(park.parts[i]);
  const generate = (seed: number, size: 'compact' | 'destination') => {
    const recipe = { ...defaultParkRecipe(seed, size), guests: 0 };
    return generatePark(recipe, createTerrainSampler(gradeParkTerrain(testTerrainData({ resolution: 64, cellSize: 32 }), recipe)));
  };
  const ownProblems = (park: ParkData) => auditPark(park, [], { focus: i => park.parts[i].render !== false && pavingOrKerb(park, i), checks: { ends: false, support: false } }).findings
    .filter(f => f.parts.every(i => pavingOrKerb(park, i))).map(f => `${f.kind} ${(f.measured * 1000).toFixed(1)} mm [${f.sources.map(s => s.split(' < ')[0]).join(' x ')}]`);
  for (const [seed, size] of [[1337, 'compact'], [4242, 'compact'], [1337, 'destination']] as const) {
    it(`has no paving or kerb interfering with other paving or kerbs (seed ${seed}, ${size})`, () => {
      const park = generate(seed, size);
      expect(kerbs(park).length).toBeGreaterThan(100);
      expect(ownProblems(park)).toEqual([]);
    }, 240000);
  }
  it('reports a kerb unit laid across another (seed 1337, compact)', () => {
    const park = generate(1337, 'compact'), original = kerbs(park)[5], b = new Parts(park, [0, 0, 0], 0, -1, 'path');
    b.box([...original.pos], [...original.half], original.color, { surface: 'concrete', rot: axisAngle([0, 1, 0], 1.2) });
    const crossed = auditPark(park, [], { focus: i => i === park.parts.length - 1, checks: { ends: false, support: false } }).findings;
    expect(crossed.some(f => f.kind === 'penetration')).toBe(true);
  }, 240000);
});
