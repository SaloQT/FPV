import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { declareInterface, declareMonolith, insertEnd } from './construction';
import { auditPark, type FindingKind } from './constructionAudit';
import { add, axisAngle, mul, qmul, rotate } from './math';
import { Parts } from './parts';
import { defaultParkRecipe } from './recipe';
import type { ParkData, ParkPart } from './types';

/** Each fixture is a small assembly the audit must pass, or the same assembly with one defect it must report against the
 * named part. Every fixture is audited at several sizes and orientations, so no result depends on axis alignment or scale. */
interface Fixture { name: string; build: (b: Parts) => ParkPart | void; defect?: FindingKind; support?: boolean }
const STEEL: Vec3 = [0.3, 0.32, 0.35], PAINT: Vec3 = [0.6, 0.1, 0.1];

function scene(): ParkData {
  return { recipe: defaultParkRecipe(), layout: 'hub', bounds: { min: [-1000, -100, -1000], max: [1000, 100, 1000] }, entrance: 0, launch: { pos: [0, 0, 0], yaw: 0 },
    rides: [], parts: [], bodies: [], lights: [], rooms: [], routes: [], nodes: [], paths: [] };
}
/** A footing slab with its top at y = 0 and its underside on the ground at y = -0.2. */
const footing = (b: Parts) => b.box([0, -0.1, 0], [0.6, 0.1, 0.6], STEEL);

const fixtures: Fixture[] = [
  { name: 'post with both ends held: foot in the footing, top in a cap block', support: true, build: b => {
    const slab = footing(b), post = b.rod([0, -0.1, 0], [0, 1, 0], 0.05, STEEL), cap = b.box([0, 1, 0], [0.1, 0.1, 0.1], STEEL);
    insertEnd(b.park, slab, post, -1, 'post/foot', 'Post foot is cast into the footing.'); insertEnd(b.park, cap, post, 1, 'post/top', 'Post top is welded into the cap block.');
  } },
  { name: 'post running 50 mm out through the top of its cap block', defect: 'contract-violation', build: b => {
    const slab = footing(b), post = b.rod([0, -0.1, 0], [0, 1.15, 0], 0.05, STEEL), cap = b.box([0, 1, 0], [0.1, 0.1, 0.1], STEEL);
    insertEnd(b.park, slab, post, -1, 'post/foot', 'Post foot is cast into the footing.'); insertEnd(b.park, cap, post, 1, 'post/top', 'Post top is welded into the cap block.');
    return post;
  } },
  { name: 'post end standing 30 mm out of the side of a block it was never declared to enter', defect: 'protruding-end', build: b => {
    const post = b.rod([0, 0, 0], [0, 1, 0], 0.05, STEEL); b.box([0.08, 1, 0], [0.1, 0.1, 0.1], STEEL); return post;
  } },
  { name: 'two braces crossing through each other with no node', defect: 'penetration', build: b => {
    b.rod([-0.5, 0, 0], [0.5, 1, 0], 0.04, STEEL); return b.rod([0.5, 0, 0], [-0.5, 1, 0], 0.04, STEEL);
  } },
  { name: 'crossing braces: one runs through, the other is split into halves ending inside it', build: b => {
    const through = b.rod([-0.5, 0, 0], [0.5, 1, 0], 0.04, STEEL);
    const lower = b.rod([0.5, 0, 0], [0, 0.5, 0], 0.03, STEEL), upper = b.rod([0, 0.5, 0], [-0.5, 1, 0], 0.03, STEEL);
    insertEnd(b.park, through, lower, 1, 'brace/lower', 'Brace half ends inside the through brace.'); insertEnd(b.park, through, upper, -1, 'brace/upper', 'Brace half ends inside the through brace.');
  } },
  { name: 'rod pushed straight through a 20 mm panel', defect: 'penetration', build: b => {
    b.box([0, 0.5, 0], [0.5, 0.5, 0.01], PAINT); return b.rod([0, 0.5, -0.3], [0, 0.5, 0.3], 0.03, STEEL);
  } },
  { name: 'rod stopping flat against a 20 mm panel', build: b => {
    b.box([0, 0.5, 0], [0.5, 0.5, 0.01], PAINT); b.rod([0, 0.5, -0.3], [0, 0.5, -0.01], 0.03, STEEL);
  } },
  { name: 'post standing on its footing', support: true, build: b => { footing(b); b.rod([0, 0, 0], [0, 1, 0], 0.05, STEEL); } },
  { name: 'post standing 5 mm clear of its footing', support: true, defect: 'floating', build: b => { footing(b); return b.rod([0, 0.005, 0], [0, 1, 0], 0.05, STEEL); } },
  { name: 'shaft centred in its sleeve', build: b => {
    const sleeve = b.part('cylinder', [0, 0.5, 0], [0.1, 0.2, 0.1], STEEL), shaft = b.rod([0, 0.1, 0], [0, 0.9, 0], 0.05, PAINT);
    declareInterface(b.park, { name: 'sleeve', kind: 'coaxial', a: sleeve, b: shaft, rationale: 'Shaft turns in the sleeve bore.' });
  } },
  { name: 'shaft 80 mm off its sleeve axis, breaking out of the bore', defect: 'contract-violation', build: b => {
    const sleeve = b.part('cylinder', [0, 0.5, 0], [0.1, 0.2, 0.1], STEEL), shaft = b.rod([0.08, 0.1, 0], [0.08, 0.9, 0], 0.05, PAINT);
    declareInterface(b.park, { name: 'sleeve', kind: 'coaxial', a: sleeve, b: shaft, rationale: 'Shaft turns in the sleeve bore.' });
    return shaft;
  } },
  { name: 'boss welded through a disc, one weldment', build: b => {
    declareMonolith(b.park, 'hub', [b.part('cylinder', [0, 0, 0], [1, 0.1, 1], STEEL), b.part('cylinder', [0, 0, 0], [0.3, 0.3, 0.3], STEEL)], 'Hub boss is welded through the disc.');
  } },
  { name: 'bent tube whose first segment end stands out below the next segment', defect: 'protruding-end', build: b => {
    const first = b.rod([0, 0, 0], [1, 0, 0], 0.1, STEEL), second = b.rod([1, 0, 0], [1, 1, 0], 0.1, STEEL);
    declareMonolith(b.park, 'bend', [first, second], 'One bent tube.', 'open'); return first;
  } },
];

/** Rigid placements and sizes. Tilted placements skip the support check, whose ground is level. */
const placements = [
  { name: 'axis-aligned', rot: axisAngle([0, 1, 0], 0), at: [0, 0, 0] as Vec3, level: true },
  { name: 'turned 0.7 rad', rot: axisAngle([0, 1, 0], 0.7), at: [31, 4, -12] as Vec3, level: true },
  { name: 'tilted 1.1 rad about a skew axis', rot: axisAngle([0.86, 0.43, 0.26], 1.1), at: [-7, 9, 3] as Vec3, level: false },
];
const scales = [0.25, 1, 4];

function place(park: ParkData, rot: readonly number[], at: Vec3, scale: number): void {
  for (const p of park.parts) { p.pos = add(at, rotate(rot as never, mul(p.pos, scale))); p.half = mul(p.half, scale); p.rot = qmul(rot as never, p.rot); }
}

describe('construction audit fixtures', () => {
  for (const fixture of fixtures) for (const placement of placements) for (const scale of scales) {
    if (fixture.support && !placement.level) continue;
    it(`${fixture.defect ? 'rejects' : 'accepts'} ${fixture.name} (${placement.name}, x${scale})`, () => {
      const park = scene(), subject = fixture.build(new Parts(park));
      place(park, placement.rot, placement.at, scale);
      const ground = placement.at[1] - 0.2 * scale;
      const report = auditPark(park, [], { ground: () => ground, checks: { support: !!fixture.support } });
      const lines = report.findings.map(f => `${f.kind} ${(f.measured * 1000).toFixed(1)} mm on parts ${f.parts.join(',')}: ${f.detail}`);
      if (!fixture.defect) { expect(lines).toEqual([]); return; }
      const index = subject ? park.parts.indexOf(subject) : -1;
      expect(lines.length, 'the defect is reported').toBeGreaterThan(0);
      expect(report.findings.some(f => f.kind === fixture.defect && f.parts.includes(index)), lines.join('\n')).toBe(true);
    });
  }
});
