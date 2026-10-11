import type { Vec3 } from '../../contracts';
import { railSample, sampleRail, type RailSample } from './curve';
import { declareInterface, insertEnd } from './construction';
import { add, clamp, cross, dot, mul, sub, unit, wrap } from './math';
import { CONCRETE, METAL, Parts } from './parts';
import { RAIL, SUPPORT, TIMBER, TIMBER_STRINGER_BOTTOM, TIMBER_STRINGER_TOP, WALKWAY } from './rideDimensions';
import type { CoasterCurve, ParkData, ParkPart } from './types';

function segmentDistanceSq(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - c[0], vy = d[1] - c[1], vz = d[2] - c[2];
  const wx = a[0] - c[0], wy = a[1] - c[1], wz = a[2] - c[2], uu = ux * ux + uy * uy + uz * uz, uv = ux * vx + uy * vy + uz * vz, vv = vx * vx + vy * vy + vz * vz;
  const uw = ux * wx + uy * wy + uz * wz, vw = vx * wx + vy * wy + vz * wz, denominator = uu * vv - uv * uv;
  let s = denominator > 1e-10 ? clamp((uv * vw - vv * uw) / denominator, 0, 1) : 0;
  if (vv <= 1e-10) s = clamp(-uw / (uu || 1), 0, 1);
  let t = vv > 1e-10 ? (uv * s + vw) / vv : 0;
  if (t < 0) { t = 0; s = clamp(-uw / (uu || 1), 0, 1); }
  else if (t > 1) { t = 1; s = clamp((uv - uw) / (uu || 1), 0, 1); }
  return (wx + ux * s - vx * t) ** 2 + (wy + uy * s - vy * t) ** 2 + (wz + uz * s - vz * t) ** 2;
}

/** How far below the rail centreline a bent's crosshead axis sits. Steel: the backbone, a short neck rod, then the crosshead.
 * Timber: the crosshead carries the stringers directly, so it sits just under their underside. */
export function coasterCrossheadDrop(wooden: boolean): number {
  return wooden ? TIMBER.crossheadRadius - TIMBER_STRINGER_BOTTOM : RAIL.spineOffset + RAIL.spineRadius + SUPPORT.neckLength + SUPPORT.crossheadRadius;
}

/** Suspended trains use level overhead portals, so banking never tilts a column into the cabin. */
export function coasterSupportFrame(sample: RailSample, inverted: boolean, spread: number, wooden = false): { tops: Vec3[]; feet: Vec3[]; hanger?: [Vec3, Vec3] } {
  const right = cross(sample.tangent, sample.up), lateral = inverted ? unit([sample.tangent[2], 0, -sample.tangent[0]]) : right;
  const center = inverted ? add(sample.pos, [0, 2.2, 0]) : add(sample.pos, mul(sample.up, -coasterCrossheadDrop(wooden)));
  const tops = [-1, 1].map(side => add(center, mul(lateral, side * (inverted ? 4.2 : 1.1))));
  const feet: Vec3[] = tops.map((top, i) => [top[0] + (i * 2 - 1) * lateral[0] * spread, 12.05, top[2] + (i * 2 - 1) * lateral[2] * spread]);
  return { tops, feet, ...(inverted ? { hanger: [add(sample.pos, mul(sample.up, 0.65)), center] as [Vec3, Vec3] } : {}) };
}

/** Rail positions along the circuit, one per cross tie. The last tie is dropped when it would land less than half a
 * spacing short of the start, where it would crowd the first tie across the closing seam. */
export function coasterTieStations(length: number, supports: ReadonlyMap<number, number>, step = 1.5): number[] {
  const stations: number[] = [];
  for (let i = 0; i * step < length; i++) stations.push(i * step);
  const last = stations[stations.length - 1];
  if (length - last < step / 2 && !supports.has(last)) stations.pop();
  return stations;
}

/** How far a column carries on past the crosshead's end so the crosshead's whole end section lies inside the column wall.
 * A crosshead that meets the column at a shallow angle (a banked crosshead, a column leaning along it) needs a longer carry. */
export function columnCarry(radius: number, crossRadius: number, axis: Vec3, crossDirection: Vec3): number {
  const tilt = Math.abs(dot(crossDirection, axis)), flat = Math.sqrt(Math.max(0, 1 - tilt * tilt));
  return flat < 0.05 ? Infinity : (radius + crossRadius) * tilt / flat + crossRadius * flat + 0.05;
}

/** The widest a column may lean from vertical (assumed): beyond it the base shoe and footing grow to an unreasonable size. */
export const MAX_COLUMN_LEAN = 40 * Math.PI / 180;

/** Sizes of one column's base, from the column radius and how far it leans. The base shoe is a short square pedestal block: a leaning column
 * crosses its top face as an ellipse, so the shoe holds the column's tilted foot disc and the ellipse where the column leaves the top face.
 * The anchor bolts stand just outside the shoe, the plate reaches past the bolts, and the footing reaches past the plate. */
export function columnBase(radius: number, top: Vec3, foot: Vec3): { plateThickness: number; boltRadius: number; boltOffset: number; plateHalf: number; footingHalf: number;
  shoeHeight: number; shoeRadius: number; centreY: number; lean: number } {
  const plateThickness = clamp(radius * 0.2, 0.04, 0.09), boltRadius = clamp(radius * 0.1, 0.025, 0.045);
  let centreY = SUPPORT.footingTop + plateThickness + radius, shoeHeight = 0, shoeRadius = 0, lean = 0;
  for (let pass = 0; pass < 4; pass++) {
    const axis = unit(sub(top, [foot[0], centreY, foot[2]])), cosine = Math.abs(axis[1]), sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
    const rise = radius * sine + radius * 0.1;
    shoeHeight = 2 * rise; shoeRadius = radius / cosine + rise * sine / cosine + SUPPORT.edgeMargin; lean = Math.acos(clamp(cosine, 0, 1));
    centreY = SUPPORT.footingTop + plateThickness + shoeHeight / 2;
  }
  const boltOffset = shoeRadius + boltRadius + 0.04, plateHalf = boltOffset + boltRadius + 0.04;
  return { plateThickness, boltRadius, boltOffset, plateHalf, footingHalf: plateHalf + 0.1, shoeHeight, shoeRadius, centreY, lean };
}

export interface SupportBent { columns: ParkPart[]; crosshead: ParkPart; legs: { foot: Vec3; top: Vec3 }[] }
export interface SupportBentOptions {
  id: string; wooden: boolean; color: Vec3; timberFinish: boolean;
  /** Top of the ground the footings stand on (the concrete floor of a show building, otherwise a little below grade). */
  floor: number;
  /** The backbone: the bent's neck rod (steel) or hanger (suspended) ends at its centre inside this part. */
  backbone?: { receiver: ParkPart; centre: Vec3 };
}

/** One bent: a concrete footing, a base plate on it with anchor bolts running through the plate into the footing,
 * a base shoe on the plate that receives the foot of the column, columns that carry on past the crosshead so the
 * crosshead's ends plug into their sides, and a neck rod (or hanger) from the crosshead into the backbone.
 * Every size is worked out from the column radius and how far the column leans. */
export function buildSupportBent(park: ParkData, b: Parts, frame: ReturnType<typeof coasterSupportFrame>, o: SupportBentOptions): SupportBent {
  const crossRadius = o.wooden ? TIMBER.crossheadRadius : SUPPORT.crossheadRadius;
  const columns: ParkPart[] = [], legs: SupportBent['legs'] = [];
  for (let i = 0; i < 2; i++) {
    const top = frame.tops[i], foot = frame.feet[i];
    const radius = o.wooden ? TIMBER.postRadius : clamp((top[1] - 12) * 0.007, SUPPORT.columnMin, SUPPORT.columnMax);
    const { plateThickness, boltRadius, boltOffset, plateHalf, footingHalf, shoeHeight, shoeRadius, centreY } = columnBase(radius, top, foot);
    const footPoint: Vec3 = [foot[0], centreY, foot[2]], axis = unit(sub(top, footPoint));
    const footingThickness = SUPPORT.footingTop - o.floor;
    const footing = b.box([foot[0], o.floor + footingThickness / 2, foot[2]], [footingHalf, footingThickness / 2, footingHalf], CONCRETE, { roughness: 0.9, metalness: 0 });
    const plate = b.box([foot[0], SUPPORT.footingTop + plateThickness / 2, foot[2]], [plateHalf, plateThickness / 2, plateHalf], METAL, { detail: 1 });
    const plateTop = SUPPORT.footingTop + plateThickness;
    const shoe = b.box([foot[0], plateTop + shoeHeight / 2, foot[2]], [shoeRadius, shoeHeight / 2, shoeRadius], o.wooden ? METAL : o.color);
    for (const dx of [-boltOffset, boltOffset]) for (const dz of [-boltOffset, boltOffset]) {
      const embed = Math.min(0.25, footingThickness * 0.6), stub = Math.min(0.12, shoeHeight * 0.5);
      const bolt = b.rod([foot[0] + dx, SUPPORT.footingTop - embed, foot[2] + dz], [foot[0] + dx, plateTop + stub, foot[2] + dz], boltRadius, METAL, { detail: 2 });
      insertEnd(park, footing, bolt, -1, `${o.id}/anchor-bolt-footing`, 'The anchor bolt is cast into the concrete footing; its whole end section lies inside.');
      declareInterface(park, { name: `${o.id}/anchor-bolt-plate`, kind: 'coaxial', a: plate, b: bolt, rationale: 'The anchor bolt passes through a hole in the base plate and is nutted on top.' });
    }
    // The column carries on past the crosshead's end so the crosshead's whole end section lies inside the column wall.
    // A crosshead banked with the track leaves the column wall higher than its end; the column rises above the crosshead's upper surface at the wall.
    const topEnd = add(top, mul(axis, columnCarry(radius, crossRadius, axis, unit(sub(frame.tops[1], frame.tops[0])))));
    const column = b.rod(footPoint, topEnd, radius, o.color, { surface: o.timberFinish ? 'timber' : 'paint' });
    insertEnd(park, shoe, column, -1, `${o.id}/column-shoe`, 'The foot of the column is welded into the base shoe; the shoe is sized to hold its whole tilted foot section.');
    columns.push(column); legs.push({ foot: footPoint, top });
  }
  const crosshead = b.rod(frame.tops[0], frame.tops[1], crossRadius, o.color, { surface: o.timberFinish ? 'timber' : 'paint' });
  insertEnd(park, columns[0], crosshead, -1, `${o.id}/crosshead-column`, 'The crosshead frames into the side of the column; its whole end section lies inside the column.');
  insertEnd(park, columns[1], crosshead, 1, `${o.id}/crosshead-column`, 'The crosshead frames into the side of the column; its whole end section lies inside the column.');
  if (o.backbone) {
    const centre = frame.hanger ? frame.hanger[1] : mul(add(frame.tops[0], frame.tops[1]), 0.5);
    const neck = b.rod(frame.hanger ? o.backbone.centre : centre, frame.hanger ? centre : o.backbone.centre, SUPPORT.neckRadius, o.color);
    const [lower, upper] = frame.hanger ? [o.backbone.receiver, crosshead] : [crosshead, o.backbone.receiver];
    insertEnd(park, lower, neck, -1, `${o.id}/neck-lower`, 'The neck rod ends inside the member below it; its whole end section lies inside.');
    insertEnd(park, upper, neck, 1, `${o.id}/neck-upper`, 'The neck rod ends inside the member above it; its whole end section lies inside.');
  }
  return { columns, crosshead, legs };
}

/** A straight member of other structure, as a capsule, that a bent's members must stay clear of. */
export interface SupportObstacle { a: Vec3; b: Vec3; radius: number }

/** Shift complete bents along the rail where crossings need an unobstructed vehicle/flight corridor.
 * A bent is only built where its footings and members keep clear of the other bents and of the loading station's legs, stair and roof;
 * where no such placement exists the bent is left out, and the track there is carried by the bents either side. */
export function coasterSupportStations(curve: CoasterCurve, inverted: boolean, wooden: boolean, obstacles: readonly SupportObstacle[] = []): Map<number, number> {
  const guide: Vec3[] = [], rail: { at: number; pos: Vec3; hanging: Vec3; spine: Vec3; stringers: Vec3[]; walk: [Vec3, Vec3] | null }[] = [], sample = railSample();
  for (let at = 0; at < curve.length; at += 5) {
    sampleRail(curve, at, sample); const right = cross(sample.tangent, sample.up);
    guide.push(add(sample.pos, add(mul(sample.up, 5.5), mul(right, inverted ? 4 : -4))));
  }
  guide.push(guide[0]);
  for (let at = 0; at < curve.length; at += 2) {
    sampleRail(curve, at, sample); const right = cross(sample.tangent, sample.up);
    rail.push({ at, pos: add(sample.pos, mul(sample.up, inverted ? -1.7 : 1.1)), hanging: add(sample.pos, mul(sample.up, -1.2)), spine: add(sample.pos, mul(sample.up, inverted ? RAIL.spineOffset : -RAIL.spineOffset)),
      stringers: [-1, 1].map(side => add(sample.pos, add(mul(right, side * TIMBER.stringerOffset), mul(sample.up, TIMBER_STRINGER_TOP - TIMBER.stringerHalfHeight)))),
      // The service catwalk beside the lift and brake runs: its deck and the top of its guard rail.
      walk: at < curve.liftEnd || at > curve.brakeStart ? [add(sample.pos, add(mul(right, WALKWAY.offset), mul(sample.up, -WALKWAY.drop))), add(sample.pos, add(mul(right, WALKWAY.offset), mul(sample.up, WALKWAY.topRailHeight + WALKWAY.railRadius)))] : null });
  }
  // Different bents must not share ground or cross each other's members, so a bent whose footings or members would meet another's
  // is moved first. If it cannot be moved clear but the track itself could be cleared, it is left out.
  const stations = new Map<number, number>(), interval = wooden ? 6 : 12, placed: { x: number; z: number; half: number }[] = [], members: { a: Vec3; b: Vec3; radius: number }[] = [], footingGap = 0.5;
  for (let base = 0; base < curve.length; base += interval) {
    sampleRail(curve, base, sample); if (sample.up[1] <= 0.3) continue;
    let found = false, leftOut = false, tangled = false;
    for (const [separate, avoid] of [[true, true], [true, false], [false, false]] as const) if (!found) candidate: for (const spread of [1.4, 0, 3, 6, 10]) for (const offset of [0, -1.5, 1.5, -3, 3, -4.5, 4.5]) {
      const at = base + offset; if (at < 0 || at >= curve.length || stations.has(at)) continue;
      sampleRail(curve, at, sample); if (sample.up[1] <= 0.3) continue;
      const { tops, feet, hanger } = coasterSupportFrame(sample, inverted, spread, wooden);
      const legs: [Vec3, Vec3][] = tops.map((top, i) => [feet[i], top]);
      legs.push([tops[0], tops[1]]);
      if (hanger) legs.push(hanger);
      const near = Math.round(at / 2), crossRadius = wooden ? TIMBER.crossheadRadius : SUPPORT.crossheadRadius, crossDirection = unit(sub(tops[1], tops[0]));
      // Each column starts on its pedestal, a little above the footing top, and carries on past the crosshead (see columnCarry).
      const columns = tops.map((top, i) => {
        const radius = wooden ? TIMBER.postRadius : clamp((top[1] - 12) * 0.007, SUPPORT.columnMin, SUPPORT.columnMax);
        const base = columnBase(radius, top, feet[i]), axis = unit(sub(top, [feet[i][0], base.centreY, feet[i][2]])), carry = columnCarry(radius, crossRadius, axis, crossDirection);
        return { radius, carry, base, end: add(top, mul(axis, Number.isFinite(carry) ? carry : 0)) };
      });
      const footprints = columns.map((c, i) => ({ x: feet[i][0], z: feet[i][2], half: c.base.footingHalf }));
      const overlaps = (p: { x: number; z: number; half: number }, q: { x: number; z: number; half: number }) => Math.abs(p.x - q.x) < p.half + q.half + footingGap && Math.abs(p.z - q.z) < p.half + q.half + footingGap;
      // Columns, crosshead and neck of this bent as capsules (widest plausible radius for each).
      const mine = [...columns.map((c, i) => ({ a: feet[i], b: c.end, radius: wooden ? TIMBER.postRadius : SUPPORT.columnMax })), { a: tops[0], b: tops[1], radius: crossRadius },
        ...(wooden ? [] : [hanger ? { a: hanger[0], b: hanger[1], radius: SUPPORT.neckRadius } : { a: mul(add(tops[0], tops[1]), 0.5), b: add(sample.pos, mul(sample.up, -RAIL.spineOffset)), radius: SUPPORT.neckRadius }])];
      // A bent cannot be built where its crosshead meets a column at a very shallow angle, where its two footings would run into each other
      // (a steeply banked stretch puts both feet almost together), or where a column would run through its neck, the backbone or the timber stringers.
      const stringerReach = Math.hypot(TIMBER.stringerHalfWidth, TIMBER.stringerHalfHeight);
      if (overlaps(footprints[0], footprints[1]) || !columns.every((c, i) => {
        if (!(c.carry <= 2) || c.base.lean > MAX_COLUMN_LEAN) return false;
        if (!wooden && segmentDistanceSq(feet[i], c.end, mine[3].a, mine[3].b) < (c.radius + SUPPORT.neckRadius + 0.05) ** 2) return false;
        for (let j = near - 3; j < near + 3; j++) {
          const here = rail[(j + rail.length) % rail.length], next = rail[(j + 1 + rail.length) % rail.length];
          if (!wooden && segmentDistanceSq(feet[i], c.end, here.spine, next.spine) < (c.radius + RAIL.spineRadius + 0.05) ** 2) return false;
          if (wooden && here.stringers.some((p, side) => segmentDistanceSq(feet[i], c.end, p, next.stringers[side]) < (c.radius + stringerReach + 0.02) ** 2)) return false;
        }
        return true;
      })) { tangled = true; continue; }
      // Members that would pass through the catwalk deck or its guard rail leave the bent out.
      if (mine.some(m => { for (let j = near - 4; j < near + 4; j++) {
        const here = rail[(j + rail.length) % rail.length].walk, next = rail[(j + 1 + rail.length) % rail.length].walk;
        if (here && next && [segmentDistanceSq(m.a, m.b, here[0], next[0]), segmentDistanceSq(m.a, m.b, here[1], next[1]), segmentDistanceSq(m.a, m.b, here[0], here[1])].some(d => d < (m.radius + WALKWAY.halfWidth + 0.1) ** 2)) return true;
      } return false; })) { tangled = true; continue; }
      if (separate && (placed.some(other => footprints.some(p => overlaps(p, other)))
        || mine.some(m => members.some(o => segmentDistanceSq(m.a, m.b, o.a, o.b) < (m.radius + o.radius + 0.1) ** 2)))) continue;
      if (avoid && mine.some(m => obstacles.some(o => segmentDistanceSq(m.a, m.b, o.a, o.b) < (m.radius + o.radius + 0.1) ** 2))) continue;
      const clear = legs.every(([a, b], leg) => {
        for (let i = 1; i < guide.length; i++) {
          const c = guide[i - 1], d = guide[i];
          if (a.some((v, k) => Math.max(v, b[k]) + 0.9 < Math.min(c[k], d[k]) || Math.min(v, b[k]) - 0.9 > Math.max(c[k], d[k]))) continue;
          if (segmentDistanceSq(a, b, c, d) < 0.9 ** 2) return false;
        }
        // Car body and passengers have clearance from supports of other, vertically stacked spans.
        // Sampling margin covers the gaps between these two-metre centerline samples.
        for (const vehicle of rail) {
          const separation = Math.abs(vehicle.at - at), nearby = Math.min(separation, curve.length - separation) < 18;
          if (nearby && (!inverted || leg === 3)) continue;
          // A banked hanging train swings toward a vertical portal leg. Its own span
          // needs clearance too: 1.4m body/rider radius, 1m sample gap and 0.46m post.
          const center = nearby ? vehicle.hanging : vehicle.pos, radius = nearby ? Math.hypot(1.4, 1) + 0.46 : 3;
          if (a.some((v, k) => Math.max(v, b[k]) + radius < center[k] || Math.min(v, b[k]) - radius > center[k])) continue;
          if (segmentDistanceSq(a, b, center, center) < radius ** 2) return false;
        }
        return true;
      });
      if (clear && !(separate && avoid)) { leftOut = true; found = true; break candidate; }
      if (clear) { stations.set(at, spread); placed.push(...footprints); members.push(...mine); found = true; break candidate; }
    }
    if (!found && !leftOut && tangled) continue;
    if (!found && !leftOut) throw new Error(`Coaster support at ${wrap(base, curve.length).toFixed(1)} cannot clear its vehicle and flight corridors`);
  }
  return stations;
}
