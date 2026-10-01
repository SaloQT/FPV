import { describe, expect, it } from 'vitest';
import { Rng } from '../../world/track/rng';
import { dot, norm, sub } from './meshBuilder';
import { growPath, limbLength, sprout, taperRadii, type Level, type SproutOptions, type Tip } from './treeBranch';
import { tangentAt, type Limb } from './treePlan';

const LEVELS: readonly Level[] = [
  { count: 4, start: 0.2, end: 0.9, angle: [0.6, 1.0], length: [0.4, 0.5], segs: 4, bend: 0.2, wobble: 0.3, radius: 0.6, tipRadius: 0.02 },
  { count: 3, start: 0.2, end: 0.9, angle: [0.5, 0.9], length: [0.4, 0.6], segs: 3, bend: 0, wobble: 0.3, radius: 0.6, tipRadius: 0.01 },
];

function parentLimb(): Limb {
  const pts = growPath(new Rng(1), [0, 0, 0], [0, 1, 0], 6, 6, 0, 0);
  return { pts, radii: taperRadii(0.2, 0.05, pts.length), order: 1 };
}

function grow(seed: number): { limbs: Limb[]; tips: Tip[]; parent: Limb } {
  const parent = parentLimb();
  const limbs: Limb[] = [parent], tips: Tip[] = [];
  const o: SproutOptions = { levels: LEVELS, order0: 1, tipRadius: { 2: 0.8, 3: 0.5 }, tipFrom: 2, limbs, tips };
  sprout(new Rng(seed), parent, o);
  return { limbs, tips, parent };
}

describe('growPath', () => {
  it('walks the requested length in the requested number of segments', () => {
    const pts = growPath(new Rng(3), [1, 2, 3], [1, 0, 0], 4, 8, 0, 0);
    expect(pts.length).toBe(9);
    expect(limbLength({ pts, radii: pts.map(() => 0.1), order: 1 })).toBeCloseTo(4, 6);
    expect(pts[8][0]).toBeCloseTo(5, 6);
  });

  it('turns toward +up with a positive bend and droops with a negative one', () => {
    const up = growPath(new Rng(3), [0, 0, 0], [1, 0, 0], 4, 8, 1.2, 0);
    const down = growPath(new Rng(3), [0, 0, 0], [1, 0, 0], 4, 8, -1.2, 0);
    expect(up[8][1]).toBeGreaterThan(0.5);
    expect(down[8][1]).toBeLessThan(-0.5);
    expect(growPath(new Rng(3), [0, 0, 0], [1, 0, 0], 4, 8, (s) => 1 - 2 * s, 0)[8][1]).toBeLessThan(up[8][1]);
  });
});

describe('sprout', () => {
  it('grows count x count children per level and flags the right tips', () => {
    const { limbs, tips } = grow(7);
    const byOrder = [0, 0, 0, 0];
    for (const l of limbs) byOrder[l.order]++;
    expect(byOrder).toEqual([0, 1, 4, 12]);
    expect(tips.length).toBe(16);
    expect(tips.filter((t) => t.order === 2).length).toBe(4);
    expect(tips.filter((t) => t.order === 3).every((t) => t.r === 0.5)).toBe(true);
  });

  it('attaches every child to its parent, thinner than it, leaving at the requested angle', () => {
    const { limbs, parent } = grow(11);
    const kids = limbs.filter((l) => l.order === 2);
    for (const k of kids) {
      let best = Infinity, at = 0;
      parent.pts.forEach((p, i) => { const d = Math.hypot(...sub(p, k.pts[0])); if (d < best) { best = d; at = i; } });
      expect(best).toBeLessThan(0.6);
      expect(k.radii[0]).toBeLessThan(parent.radii[at] + 1e-9);
      const t = tangentAt(parent.pts, at / (parent.pts.length - 1)), d = norm(sub(k.pts[1], k.pts[0]));
      expect(Math.acos(Math.min(Math.max(dot(t, d), -1), 1))).toBeLessThan(1.5);
      expect(k.radii[k.radii.length - 1]).toBeCloseTo(LEVELS[0].tipRadius, 9);
    }
  });

  it('spreads children around the parent instead of stacking them on one side', () => {
    const { limbs } = grow(5);
    const dirs = limbs.filter((l) => l.order === 2).map((l) => norm(sub(l.pts[l.pts.length - 1], l.pts[0])));
    let spread = 0;
    for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) spread = Math.max(spread, Math.hypot(...sub(dirs[i], dirs[j])));
    expect(spread).toBeGreaterThan(1);
  });

  it('is deterministic per seed and different between seeds', () => {
    expect(grow(9).limbs[3].pts).toEqual(grow(9).limbs[3].pts);
    expect(grow(9).limbs[3].pts).not.toEqual(grow(10).limbs[3].pts);
  });
});
