import type { Vec3 } from '../../contracts';
import { add, axisAngle, basisQuat, clamp, cross, distance, dot, mul, rotate, sub, unit, yawPoint } from './math';
import { CONCRETE, METAL, Parts } from './parts';
import { PALETTES } from './recipe';
import { sign } from './theme';
import { insertEnd, partAnchor, registerJoint } from './construction';
import { RAIL, STATION, WALKWAY } from './rideDimensions';
import { PAVING_RISE } from './surfaces';
import { guardFence, legInFooting, stairFlight } from './assembly';
import type { SupportObstacle } from './coasterSupports';
import type { ParkData, ParkPart, RideDefinition } from './types';

export interface WalkwayStation {
  pos: Vec3; right: Vec3; up: Vec3; tangent: Vec3;
  /** Present where a cantilever bracket starts: the part that receives it and the point on that part's axis. */
  bracket?: { receiver: ParkPart; root: Vec3 };
}

/** Service catwalk beside a run of track. The deck is a strip of boxes laid along the walking line between the
 * midpoints of neighbouring stations; at each joint both boxes are cut back by the corner distance times tan(half
 * the turn angle), which is exactly what keeps their corners from crossing, so the deck never overlaps itself at a bend.
 * A guard post stands flush on each box; the top rail, mid rail and toe rail run straight from post to post and end
 * on the post axes, inside posts thicker than the rails. Brackets run from the track structure to a cleat that is
 * flush against the deck (under it, or on top of it for a deck hung from an overhead arm). */
export function coasterWalkway(park: ParkData, b: Parts, id: string, stations: readonly WalkwayStation[], overhead: boolean): void {
  const count = stations.length, W = WALKWAY, cleatHalf: Vec3 = [W.cleatHalf[0], W.cleatHalf[1], W.cleatHalf[2]];
  if (count < 2) return;
  const walk = stations.map(s => add(s.pos, add(mul(s.right, W.offset), mul(s.up, -W.drop))));
  const joints: Vec3[] = Array.from({ length: count + 1 }, (_, i) => i === 0 ? sub(walk[0], mul(sub(walk[1], walk[0]), 0.5)) : i === count ? add(walk[count - 1], mul(sub(walk[count - 1], walk[count - 2]), 0.5)) : mul(add(walk[i - 1], walk[i]), 0.5));
  const axes = Array.from({ length: count }, (_, i) => unit(sub(joints[i + 1], joints[i])));
  const reach = Math.hypot(W.halfWidth, W.halfThick);
  const cutBack = (i: number) => {
    if (i === 0 || i === count) return 0;
    const cosine = clamp(dot(axes[i - 1], axes[i]), -1, 1);
    return reach * Math.sqrt(Math.max(0, (1 - cosine) / (1 + cosine)));
  };
  const bases: Vec3[] = [], ups: Vec3[] = [], posts: ParkPart[] = [];
  const postHeight = W.topRailHeight + W.railRadius + 0.02;
  stations.forEach((s, i) => {
    const axis = axes[i], start = cutBack(i), end = cutBack(i + 1);
    const half = Math.max(0.05, (distance(joints[i], joints[i + 1]) - start - end) / 2);
    const up = unit(sub(s.up, mul(axis, dot(s.up, axis)))), right = unit(cross(axis, up));
    const centre = add(joints[i], mul(axis, start + half)), rotation = basisQuat(right, up, mul(axis, -1));
    b.box(centre, [W.halfWidth, W.halfThick, half], METAL, { roughness: 0.74, rot: rotation });
    const base = add(centre, add(mul(up, W.halfThick), mul(right, W.halfWidth - W.postInset)));
    posts.push(b.rod(base, add(base, mul(up, postHeight)), W.postRadius, METAL, { detail: 1 }));
    bases.push(base); ups.push(up);
    if (s.bracket) {
      const { receiver, root } = s.bracket;
      if (!overhead) {
        const cleat = b.box(add(centre, mul(up, -(W.halfThick + W.cleatHalf[1]))), cleatHalf, METAL, { rot: rotation, detail: 1 });
        const arm = b.rod(root, cleat.pos, W.bracketRadius, METAL, { detail: 1 });
        insertEnd(park, receiver, arm, -1, `${id}/bracket-root`, 'The cantilever bracket is welded into the track structure; its whole end section lies inside.');
        insertEnd(park, cleat, arm, 1, `${id}/bracket-cleat`, 'The bracket ends in a cleat bolted flush under the deck; its whole end section lies inside the cleat.');
      } else {
        // A suspended deck hangs from an overhead arm: arm and hanger both end in a ball node at the elbow, and the hanger lands on a cleat flush on the deck.
        const elbow = add(s.pos, add(mul(s.right, W.offset), mul(s.up, RAIL.spineOffset)));
        const node = b.sphere(elbow, W.bracketRadius * 1.7, METAL, { detail: 1 });
        const arm = b.rod(root, elbow, W.bracketRadius, METAL, { detail: 1 });
        insertEnd(park, receiver, arm, -1, `${id}/arm-root`, 'The overhead arm is welded into the backbone; its whole end section lies inside.');
        insertEnd(park, node, arm, 1, `${id}/arm-elbow`, 'The arm ends in the ball node at the elbow.');
        const cleat = b.box(add(centre, mul(up, W.halfThick + W.cleatHalf[1])), cleatHalf, METAL, { rot: rotation, detail: 1 });
        const hanger = b.rod(elbow, cleat.pos, W.bracketRadius, METAL, { detail: 1 });
        insertEnd(park, node, hanger, -1, `${id}/hanger-elbow`, 'The hanger starts in the ball node at the elbow.');
        insertEnd(park, cleat, hanger, 1, `${id}/hanger-cleat`, 'The hanger ends in a cleat bolted flush on top of the deck.');
      }
    }
  });
  const levels: [number, number, Vec3][] = [[W.topRailHeight, W.railRadius, METAL], [W.midRailHeight, W.railRadius, METAL], [W.toeHeight, W.toeRadius, [0.66, 0.45, 0.075]]];
  for (let i = 0; i + 1 < count; i++) for (const [height, radius, color] of levels) {
    const rail = b.rod(add(bases[i], mul(ups[i], height)), add(bases[i + 1], mul(ups[i + 1], height)), radius, color, { detail: 1 });
    insertEnd(park, posts[i], rail, -1, `${id}/guard-rail`, 'The guard rail runs into the post it is welded to; posts are thicker than rails so the whole end section is inside.');
    insertEnd(park, posts[i + 1], rail, 1, `${id}/guard-rail`, 'The guard rail runs into the post it is welded to; posts are thicker than rails so the whole end section is inside.');
  }
}

/** Walls of the space show building are this thick, and the front opening is this wide either side of the building's centre line. */
export const SHOW_WALL_HALF_THICKNESS = 0.35, SHOW_OPENING_HALF = 12;
/** The queue gate scenery stands in this rectangle round the approach point, in the ride's frame (lamps at +-12, gate posts at z = 20, its sign just in front). */
const APPROACH_SCENERY = { x: 13, zBehind: 13, zAhead: 21 } as const;

/** Plan outline of the space show building: the track's bounding box plus a margin, grown to hold the whole entry area of the ride
 * (queue lanes, the stair foot, the exit, the station walk and the queue scenery). Returns the box corners; y is left to the caller. */
export function spaceShowFootprint(park: ParkData, ride: RideDefinition, trackMin: Vec3, trackMax: Vec3, margin = 8): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [trackMin[0] - margin, trackMin[1], trackMin[2] - margin], max: Vec3 = [trackMax[0] + margin, trackMax[1], trackMax[2] + margin];
  const hold = (p: Vec3, room: number) => { min[0] = Math.min(min[0], p[0] - room); max[0] = Math.max(max[0], p[0] + room); min[2] = Math.min(min[2], p[2] - room); max[2] = Math.max(max[2], p[2] + room); };
  const approach = yawPoint(ride.queue[0], ride.yaw, [5, 0, 0]), room = 3;
  for (const p of [...ride.queue, ...ride.boarding, ...ride.exit, park.nodes[ride.station].pos]) hold(p, room);
  for (const x of [-APPROACH_SCENERY.x, APPROACH_SCENERY.x]) for (const z of [-APPROACH_SCENERY.zBehind, APPROACH_SCENERY.zAhead]) hold(yawPoint(approach, ride.yaw, [x, 0, z]), room);
  return { min, max };
}

/** A path link that runs through the show building's walls: which wall (0 = -x, 1 = +x, 2 = -z, 3 = +z) at each end it meets, or -1 where that end lies inside. */
export interface WallCrossing { a: number; b: number; enter: number; leave: number; at: [Vec3, Vec3] }

/** Every path link that meets the building's walls, where it meets them. Walls occupy the outline plus or minus their half thickness. */
export function showWallCrossings(park: ParkData, min: Vec3, max: Vec3): WallCrossing[] {
  const T = SHOW_WALL_HALF_THICKNESS, lo = [min[0] - T, min[2] - T], hi = [max[0] + T, max[2] + T], out: WallCrossing[] = [];
  for (let a = 0; a < park.nodes.length; a++) for (const b of park.nodes[a].links) {
    if (b < a) continue;
    const p = park.nodes[a].pos, q = park.nodes[b].pos, d = [q[0] - p[0], q[2] - p[2]], from = [p[0], p[2]];
    let t0 = 0, t1 = 1, enter = -1, leave = -1;
    for (let k = 0; k < 2 && t0 <= t1; k++) {
      if (Math.abs(d[k]) < 1e-12) { if (from[k] < lo[k] || from[k] > hi[k]) t1 = -1; continue; }
      let ta = (lo[k] - from[k]) / d[k], tb = (hi[k] - from[k]) / d[k], wa = 2 * k, wb = 2 * k + 1;
      if (ta > tb) { [ta, tb] = [tb, ta]; [wa, wb] = [wb, wa]; }
      if (ta > t0) { t0 = ta; enter = wa; }
      if (tb < t1) { t1 = tb; leave = wb; }
    }
    if (t0 > t1) continue;
    const at = (t: number): Vec3 => [p[0] + d[0] * t, p[1], p[2] + d[1] * t];
    out.push({ a, b, enter: t0 > 0 ? enter : -1, leave: t1 < 1 ? leave : -1, at: [at(t0), at(t1)] });
  }
  return out;
}

/** The legs that carry the loading deck. The suspended family has a wider deck: one row under its right half, two under the under-seat floor. */
function deckLegXs(inverted: boolean): number[] { return inverted ? [STATION.deckLegX, -2.35, -4.45] : [-STATION.deckLegX, STATION.deckLegX]; }

/** Everything that stands on the ground at the loading station, as vertical capsules (plus the roof and stair run), so support
 * bents can keep their footings and members clear of it. Each capsule is as wide as its footing's corner plus working room. */
export function coasterStationObstacles(platform: Vec3, yaw: number, rise: number, steps: number, inverted: boolean): SupportObstacle[] {
  const S = STATION, at = (x: number, y: number, z: number) => yawPoint(platform, yaw, [x, y, z]), room = 0.7;
  const out: SupportObstacle[] = [];
  const deckBottom = -2 * S.deckHalfThick, roofBottom = S.roofCentreY - S.roofHalfThick;
  for (const x of deckLegXs(inverted)) for (const z of [-S.deckLegZ, S.deckLegZ]) out.push({ a: at(x, -rise, z), b: at(x, deckBottom, z), radius: S.deckFootingHalf * Math.SQRT2 + room });
  for (const z of S.columnZ) out.push({ a: at(S.columnX, -rise, z), b: at(S.columnX, roofBottom, z), radius: S.columnFootingHalf * Math.SQRT2 + room });
  // The stair is solid from the paving up to its treads: one upright capsule per quarter of the run, as tall as that quarter's highest step.
  const quarter = steps * S.going / 4;
  for (let k = 0; k < 4; k++) out.push({ a: at(0, -rise, S.deckHalfLength + (k + 0.5) * quarter), b: at(0, Math.min(0, -rise * k / 4 + rise / steps), S.deckHalfLength + (k + 0.5) * quarter), radius: Math.hypot(S.stairHalfWidth, quarter / 2) + room });
  out.push({ a: at(S.roofCentreX, S.roofCentreY, -S.roofHalfLength), b: at(S.roofCentreX, S.roofCentreY, S.roofHalfLength), radius: S.roofHalfWidth + 0.1 });
  return out;
}

/** Supported station construction, within the original platform and stair reservation.
 * Deck legs and roof columns are cast into footings on the paving. Each roof column plugs into a cross beam that bears on the roof slab
 * from below, with a knee brace running from the column out to the beam's far end; two edge beams bear under the cross beams.
 * The stair is solid steps standing on the paving, handrails stand on the steps. */
export function coasterStationDetails(park: ParkData, ride: RideDefinition, platform: Vec3, yaw: number, rise: number, steps: number): void {
  const S = STATION, b = new Parts(park, platform, yaw, -1, 'ride'), palette = PALETTES[ride.theme], inverted = ride.family === 'inverted';
  const deckBottom = -2 * S.deckHalfThick, roofBottom = S.roofCentreY - S.roofHalfThick, beamY = roofBottom - S.beamHalfThick, grade = -rise - PAVING_RISE;
  for (const x of deckLegXs(inverted)) for (const z of [-S.deckLegZ, S.deckLegZ])
    legInFooting(b, [x, grade, z], [x, deckBottom, z], S.deckLegRadius, METAL, `${ride.id}/deck-leg/${x}/${z}`, {}, { color: CONCRETE, baseY: grade, halfHeight: S.deckFootingThick / 2, halfWidth: S.deckFootingHalf });
  const roof = b.box([S.roofCentreX, S.roofCentreY, 0], [S.roofHalfWidth, S.roofHalfThick, S.roofHalfLength], palette.secondary);
  const edgeMin = S.edgeBeamX[0] - S.edgeBeamHalfWidth, beamMax = S.columnX + S.columnRadius + 0.08;
  for (const z of S.columnZ) {
    const beam = b.box([(edgeMin + beamMax) / 2, beamY, z], [(beamMax - edgeMin) / 2, S.beamHalfThick, S.beamHalfDepth], METAL);
    const { leg: column } = legInFooting(b, [S.columnX, grade, z], [S.columnX, beamY, z], S.columnRadius, palette.secondary, `${ride.id}/roof-column/${z}`, {},
      { color: CONCRETE, baseY: grade, halfHeight: S.columnFootingThick / 2, halfWidth: S.columnFootingHalf });
    insertEnd(park, beam, column, 1, `${ride.id}/roof-column-beam`, 'The column top plugs into the roof cross beam, which is wider than the column, so its whole end section lies inside.');
    const knee = b.rod([S.columnX, beamY - S.kneeBraceRise, z], [edgeMin + 0.15, beamY, z], S.kneeBraceRadius, palette.secondary);
    insertEnd(park, column, knee, -1, `${ride.id}/knee-brace-column`, 'The knee brace is welded into the column wall; its whole end section lies inside the column.');
    insertEnd(park, beam, knee, 1, `${ride.id}/knee-brace-beam`, 'The knee brace runs into the cross beam at its far end; its whole end section lies inside the beam.');
    for (const x of S.lampX) b.rod([x, beamY - S.beamHalfThick - S.lampHeight, z], [x, beamY - S.beamHalfThick, z], S.lampRadius, METAL, { detail: 1 });
  }
  for (const x of S.edgeBeamX) b.box([x, beamY - 2 * S.beamHalfThick, 0], [S.edgeBeamHalfWidth, S.beamHalfThick, S.roofHalfLength - 0.35], palette.secondary);
  // The loading edge stays open to every car; its contrasting tactile strip marks the drop.
  b.box([-1.87, 0.015, 0], [0.1, 0.015, 12.6], [0.78, 0.55, 0.1], { solid: false, roughness: 0.9 });
  const guardFeet: Vec3[] = [];
  for (let z = -S.deckHalfLength + 1; z <= S.deckHalfLength - 1; z += S.guardPostSpacing) guardFeet.push([S.guardX, 0, z]);
  guardFence(b, guardFeet, S.guardHeights[S.guardHeights.length - 1] + S.guardRailRadius + 0.005, [...S.guardHeights], S.guardPostRadius, METAL, `${ride.id}/deck-guard`, { railRadius: S.guardRailRadius });
  // The stair is the shared cast-concrete flight: solid steps from the paving up to the deck edge, a handrail on balusters and a guard rail above it.
  const flight = stairFlight(b, { halfWidth: S.stairHalfWidth, bottomY: -rise, topY: 0, topZ: S.deckHalfLength, going: S.going, color: CONCRETE, railColor: METAL, ride: ride.id,
    name: `${ride.id}/stair`, guardHeight: S.guardHeights[S.guardHeights.length - 1] });
  if (flight.steps !== steps) throw new Error(`${ride.id}: the station stair has ${flight.steps} steps, not the ${steps} the support layout kept clear`);
  const console = new Parts(park, platform, yaw, -1, 'furniture');
  const cabinetHalf: Vec3 = [0.3, 0.6, 0.65], panelHalf: Vec3 = [0.35, 0.07, 0.6], tilt = 0.12;
  console.box([1.3, cabinetHalf[1], -10.5], cabinetHalf, palette.secondary);
  // The panel's lowest edge rests on the cabinet top: the centre sits above it by the panel's half thickness and half length, both tilted.
  const panelPosition: Vec3 = [1.3, 2 * cabinetHalf[1] + panelHalf[1] * Math.cos(tilt) + panelHalf[2] * Math.sin(tilt), -10.5], panelRotation = axisAngle([1, 0, 0], -tilt);
  const panel = console.box(panelPosition, panelHalf, METAL, { localRot: panelRotation });
  for (const z of [0.3, -0.05, -0.4]) {
    const center = add(panelPosition, rotate(panelRotation, [0, 0.07 + 0.045, z]));
    const button = console.sphere(center, 0.045, z === 0.3 ? [0.45, 0.035, 0.015] : [0.07, 0.3, 0.06], { solid: false, detail: 1 });
    const contact = yawPoint(platform, yaw, add(panelPosition, rotate(panelRotation, [0, 0.07, z])));
    registerJoint(park, { name: `${ride.id}/console-button/${z}`, kind: 'fixed', a: partAnchor(panel, contact), b: partAnchor(button, contact), rationale: 'Button bases touch the inclined control-panel plane along its actual normal.' });
  }
  const signBuilder = new Parts(park, yawPoint(platform, yaw, [-1.3, 4.62, 15.2]), yaw + Math.PI, -1, 'ride');
  const board = sign(signBuilder, ride.name, [0, 0, 0], palette.accent, 0.11);
  for (const side of [-1, 1]) {
    const x = side * board.half[0] * 0.6;
    const bracket = signBuilder.rod([x, 0.25, 0.07], [x, 0.48, 0.4], 0.045, METAL);
    insertEnd(park, board, bracket, -1, `${ride.id}/sign-bracket-board`, 'The bracket starts inside the sign board; its whole end section lies inside.');
    insertEnd(park, roof, bracket, 1, `${ride.id}/sign-bracket-roof`, 'The bracket ends inside the roof slab; its whole end section lies inside.');
    const contact = yawPoint(signBuilder.origin, signBuilder.yaw, [x, 0.25, 0.07]);
    registerJoint(park, { name: `${ride.id}/station-sign/${side}`, kind: 'fixed', a: partAnchor(board, contact), b: partAnchor(bracket, contact), rationale: 'Suspension brackets connect the sign board into the roof underside.' });
  }
}
