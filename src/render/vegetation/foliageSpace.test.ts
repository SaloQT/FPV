import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import shader from '../shaders/vegetation/tree.wgsl?raw';
import { FoliageSpace, visiblyCross, type Piece } from './foliageSpace';
import { MAX_TREE_SCALE } from './placementRules';
import { buildTreeLods } from './treeGen';
import { densify } from './treePlan';
import { VARIANT_DEFS, variantPlan } from './variants';

/** A flat square card of half size `h` at `c`, spanned by unit vectors `r` and `u`, painted opaque where `paint` says. */
function card(c: Vec3, r: Vec3, u: Vec3, h: number, paint: (u: number, v: number) => boolean, group: number): Piece {
  const corner = (x: number, y: number): Vec3 => [c[0] + h * (x * r[0] + y * u[0]), c[1] + h * (x * r[1] + y * u[1]), c[2] + h * (x * r[2] + y * u[2])];
  return { pos: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], uv: [[0, 1], [1, 1], [1, 0], [0, 0]], tris: [[0, 1, 2], [0, 2, 3]], opaque: paint, near: paint, room: 0.01, group };
}

const solid = (): boolean => true;
/** Paints only the left half of a card. */
const leftHalf = (u: number): boolean => u < 0.5;

// tree.wgsl's wind, mirrored: the leaf flutter ripples and the branch sway, both smooth fields over the tree's frame.
const constant = (name: string): number[] => {
  const m = shader.match(new RegExp(`const ${name} : (?:f32|vec3f) = (?:vec3f\\()?([-0-9., ]+)\\)?;`));
  if (!m) throw new Error(`${name} not found in tree.wgsl`);
  return m[1].split(',').map(Number);
};
const [FLAP_HZ] = constant('LEAF_FLAP_HZ'), K1 = constant('FLUTTER_K1') as Vec3, K2 = constant('FLUTTER_K2') as Vec3;
const [BRANCH_SWAY] = constant('BRANCH_SWAY'), BRANCH_WAVE = constant('BRANCH_WAVE') as Vec3;
const smoothstep = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Where a mesh point is at time `t`, in metres, for a tree at the largest scale in a strong wind (along x) at full flutter: the steepest the
 * motion gets. `radius` is the crown's horizontal radius in mesh metres (the variant's bound).
 */
function windAt(flutter: number, radius: number, t: number): (p: Vec3) => Vec3 {
  const s = MAX_TREE_SCALE, wind = 12;
  return (p) => {
    const local: Vec3 = [p[0] * s, p[1] * s, p[2] * s];
    const outer = smoothstep(0.15, 0.9, Math.hypot(local[0], local[2]) / (radius * s));
    const fp = 2 * Math.PI * FLAP_HZ * t, rise = Math.sin(fp + dot(local, K1)), side = Math.sin(1.37 * fp + dot(local, K2));
    const bs = 2 * Math.PI * 2.1 * 0.4 * t + dot(local, BRANCH_WAVE);
    const swing = (Math.sin(bs) + 0.5 * Math.sin(1.73 * bs + 0.3 * local[1])) * BRANCH_SWAY * wind * outer, f = flutter * s * outer;
    return [local[0] + swing, local[1] + rise * f + 0.45 * swing, local[2] + 0.6 * side * f];
  };
}

describe('foliage space', () => {
  it('finds two painted cards crossing, and ignores crossings in their transparent parts', () => {
    const flat = card([0, 0, 0], [1, 0, 0], [0, 0, 1], 0.1, solid, 0);
    const centred = card([0, 0, 0], [0, 1, 0], [0, 0, 1], 0.1, solid, 1);
    expect(visiblyCross(flat, flat.pos, centred, centred.pos)).toBe(true);
    // This upright card crosses the flat one only along x = 0.06, on the half of it that a card painted on its left half leaves clear.
    const upright = card([0.06, 0, 0], [0, 1, 0], [0, 0, 1], 0.1, solid, 1);
    expect(visiblyCross(flat, flat.pos, upright, upright.pos)).toBe(true);
    const halfFlat = card([0, 0, 0], [1, 0, 0], [0, 0, 1], 0.1, leftHalf, 0);
    expect(visiblyCross(halfFlat, halfFlat.pos, upright, upright.pos)).toBe(false);
    // Parallel cards a few centimetres apart do not cross.
    const above = card([0, 0.03, 0], [1, 0, 0], [0, 0, 1], 0.1, solid, 1);
    expect(visiblyCross(flat, flat.pos, above, above.pos)).toBe(false);
  });

  it('tries a crossing piece in its other poses, and leaves it out if none fits', () => {
    const space = new FoliageSpace();
    expect(space.place((k) => (k === 0 ? card([0, 0, 0], [1, 0, 0], [0, 0, 1], 0.1, solid, 0) : null))).not.toBeNull();
    const poses = [card([0, 0, 0], [0, 1, 0], [0, 0, 1], 0.1, solid, 1), card([0, 0.05, 0], [1, 0, 0], [0, 0, 1], 0.1, solid, 1)];
    expect(space.place((k) => poses[k] ?? null)).toBe(poses[1]);
    expect(space.place((k) => (k === 0 ? card([0, 0, 0], [0, 1, 0], [0, 0, 1], 0.1, solid, 2) : null))).toBeNull();
    expect([space.placed, space.dropped, space.countCrossings()]).toEqual([2, 1, 0]);
  });

  it('moves every vertex of a tree, wood and leaves alike, by the same smooth wind field', () => {
    // Flutter and prop wash weigh a vertex by where it is in the crown, not by its own sway weight, except on park plants (whose wood is rigid).
    expect(shader).toMatch(/\* \(v\.shape\.w \* calm \* scale \* select\(outer, sway, anchored\)\)/);
    expect(shader).toMatch(/let reach = select\(select\(0\.03, 0\.5 \* local\.y, bush\) \+ 0\.27 \* scale \* outer, 0\.27 \* sway \* scale, anchored\);/);
    // Its slope stays well under one, so it cannot fold one part of the crown through another.
    const flutter = Math.max(...VARIANT_DEFS.map((d) => d.flutter));
    expect(flutter * MAX_TREE_SCALE * (Math.hypot(...K1) + 0.6 * Math.hypot(...K2))).toBeLessThan(0.6);
    // Each leaf's own twist on its stalk: two neighbours swinging toward each other close under the 4 mm the extreme tier's leaves keep apart
    // (treeGen.ts LEAF_LEAF_ROOM), per unit of tree scale.
    expect(2 * constant('PETIOLE_TWIST')[0]).toBeLessThan(0.004);
  });

  // One variant of each growth form: the near LOD of each has no leaf, shoot card or needle ribbon passing through another at rest, and keeps
  // most of its foliage doing so. Broadleaf crowns also stay clear of themselves at every moment of a strong wind (at most one pair in
  // five hundred pieces brushing, where the oak's metre-wide cards bend a little away from the wind field); conifers' metre-long needle
  // cards bend away from it too far for that, so they are only checked at rest.
  for (const [name, broadleaf] of [['spruce open', false], ['pine open', false], ['juniper', false], ['oak open', true], ['birch', true], ['beech open', true], ['bush', true]] as const) {
    it(`builds the ${name} with no foliage passing through itself${broadleaf ? ' at rest or in wind' : ' at rest'}`, () => {
      const v = VARIANT_DEFS.findIndex((d) => d.name === name);
      let space: FoliageSpace | null = null;
      const mesh = buildTreeLods(variantPlan(v)!, VARIANT_DEFS[v].seed, undefined, { report: (s) => { space = s; } })[0];
      const s = space as FoliageSpace | null;
      expect(s).not.toBeNull();
      expect(s!.countCrossings()).toBe(0);
      expect(s!.dropped / (s!.placed + s!.dropped)).toBeLessThan(0.2);
      if (!broadleaf) return;
      let radius = 0;
      for (let i = 0; i < mesh.vertexCount; i++) radius = Math.max(radius, Math.hypot(mesh.pos[i * 3], mesh.pos[i * 3 + 2]));
      for (let k = 0; k < 6; k++) expect(s!.countCrossings(windAt(VARIANT_DEFS[v].flutter, radius, k / (6 * FLAP_HZ)))).toBeLessThanOrEqual(s!.placed / 500);
    }, 120000);
  }

  // The extreme tier's dense crowns, counted over everything the near LOD finally draws: each leaf of the per-leaf shoots, each needle ribbon
  // of the spruce sprays, each card, whichever space placed it.
  for (const [name, broadleaf] of [['birch weeping', true], ['oak open', true], ['pine open', false], ['spruce open', false]] as const) {
    it(`builds the extreme ${name} with nothing it draws passing through anything else${broadleaf ? ' at rest or in wind' : ' at rest'}`, () => {
      const v = VARIANT_DEFS.findIndex((d) => d.name === name);
      let all: Piece[] = [];
      const mesh = buildTreeLods(densify(variantPlan(v)!), VARIANT_DEFS[v].seed, undefined, { dense: true, pieces: (p) => { all = p; } })[0];
      const drawn = FoliageSpace.of(all);
      expect(all.length).toBeGreaterThan(500);
      expect(drawn.countCrossings()).toBe(0);
      if (!broadleaf) return;
      let radius = 0;
      for (let i = 0; i < mesh.vertexCount; i++) radius = Math.max(radius, Math.hypot(mesh.pos[i * 3], mesh.pos[i * 3 + 2]));
      for (let k = 0; k < 6; k++) expect(drawn.countCrossings(windAt(VARIANT_DEFS[v].flutter, radius, k / (6 * FLAP_HZ)))).toBeLessThanOrEqual(all.length / 500);
    }, 300000);
  }
});
