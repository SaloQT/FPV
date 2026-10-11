import type { Vec3 } from '../../contracts';
import { declareMonolith, partAnchor, registerJoint } from './construction';
import { CURVE_STRIDE, railSample, sampleRail } from './curve';
import { add, axisAngle, basisQuat, clamp, cross, distance, dot, mul, sub, unit, yawPoint } from './math';
import { Parts, type PartOptions } from './parts';
import { RAIL } from './rideDimensions';
import type { CoasterCurve, ParkPart } from './types';

/** Bound normalized-vector interpolation curvature over one stored rail-table interval.
 * For n=v/|v|, |n''| <= |v''|/m + 3|v'|²/m². Linear interpolation error is <= max|n''|/8.
 * right=normalize(tangent×up); corrected up=right×normalize(tangent), matching sampleRail exactly. */
function frameChordBounds(curve: CoasterCurve, index: number): [number, number] {
  const data = curve.samples, o = index * CURVE_STRIDE, e = o + CURVE_STRIDE;
  const t0: Vec3 = [data[o + 3], data[o + 4], data[o + 5]], t1: Vec3 = [data[e + 3], data[e + 4], data[e + 5]];
  const u0: Vec3 = [data[o + 6], data[o + 7], data[o + 8]], u1: Vec3 = [data[e + 6], data[e + 7], data[e + 8]];
  const dt = sub(t1, t0), du = sub(u1, u0), v0 = cross(t0, u0), v1 = cross(t1, u1), w = cross(dt, du);
  const dv = add(cross(dt, u0), cross(t0, du));
  const minChordNorm = (a: Vec3, b: Vec3) => Math.min(Math.hypot(...a), Math.hypot(...b)) * Math.sqrt(Math.max(0, (1 + dot(unit(a), unit(b))) / 2));
  const minV = minChordNorm(v0, v1) - Math.hypot(...w) / 4, minT = minChordNorm(t0, t1);
  if (minV <= 0 || minT <= 0) throw new Error('Rail frame reverses within one interpolation interval');
  const r1 = Math.max(Math.hypot(...dv), Math.hypot(...add(dv, mul(w, 2)))) / minV;
  const r2 = 2 * Math.hypot(...w) / minV + 3 * r1 * r1;
  const tRate = Math.hypot(...dt) / minT, t2 = 3 * tRate * tRate;
  return [RAIL.halfGauge * r2 / 8, RAIL.spineOffset * (r2 + 2 * r1 * tRate + t2) / 8];
}

/** Closed tubes bound the entire sampled-curve deviation, including every arc-table knot and normalized-frame curvature. */
export function trackTubePoints(curve: CoasterCurve, inverted: boolean, stations?: number[]): [Vec3[], Vec3[], Vec3[]] {
  const result: [Vec3[], Vec3[], Vec3[]] = [[], [], []], sample = railSample();
  const frameBounds = Array.from({ length: curve.count - 1 }, (_, i) => frameChordBounds(curve, i));
  const arc = (index: number) => curve.samples[index * CURVE_STRIDE + 13];
  const at = (s: number): Vec3[] => {
    sampleRail(curve, s, sample); const right = cross(sample.tangent, sample.up);
    return [add(sample.pos, mul(right, -RAIL.halfGauge)), add(sample.pos, mul(right, RAIL.halfGauge)), add(sample.pos, mul(sample.up, inverted ? RAIL.spineOffset : -RAIL.spineOffset))];
  };
  const split = (a: number, b: number, first: Vec3[], last: Vec3[], depth: number): void => {
    let lo = 0, hi = curve.count - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >>> 1; if (arc(mid) <= a) lo = mid; else hi = mid; }
    const chordDistance = (points: Vec3[]) => points.map((point, k) => {
      const delta = sub(last[k], first[k]), t = clamp(dot(sub(point, first[k]), delta) / Math.max(dot(delta, delta), 1e-15), 0, 1);
      return distance(point, add(first[k], mul(delta, t)));
    });
    let start = a, previous = [0, 0, 0], error = 0;
    for (let i = lo; i < curve.count - 1 && start < b; i++) {
      const end = Math.min(b, arc(i + 1)), current = end === b ? [0, 0, 0] : chordDistance(at(end));
      const fraction = (end - start) / (arc(i + 1) - arc(i));
      for (let k = 0; k < 3; k++) error = Math.max(error, Math.max(previous[k], current[k]) + frameBounds[i][k === 2 ? 1 : 0] * fraction * fraction);
      start = end; previous = current;
    }
    if (error > RAIL.chordError) {
      if (depth >= 16) throw new Error('Unable to bound the rail tube chord error');
      const mid = (a + b) / 2, middle = at(mid); split(a, mid, first, middle, depth + 1); split(mid, b, middle, last, depth + 1);
    } else { stations?.push(a); for (let k = 0; k < 3; k++) result[k].push(first[k]); }
  };
  const count = Math.ceil(curve.length / 3);
  for (let i = 0; i < count; i++) { const a = curve.length * i / count, b = curve.length * (i + 1) / count; split(a, b, at(a), at(b), 0); }
  return result;
}

/** Wherever a bend is sharp enough that the slit between its two cut ends is wider than this, its knuckle is ray traced too; a gentler bend's
 * slit is narrower than half a pixel from 10 m away (1080 lines, 60 degree field), so only the drawn knuckle closes it. */
const KNUCKLE_RAY_TRACED_SLIT = 0.005;
/** A bent steel tube built from straight lengths. Each length stops short of a bend by radius*tan(half the turn) = d: that is exactly where the
 * inner walls of the two lengths cross, so the lengths touch at that one edge point and never overlap each other. A round knuckle of radius
 * sqrt(radius^2 + d^2) is welded at the bend: both cut rims lie exactly on its surface and the middle of both cut ends is inside it (closed runs
 * get one where the last length meets the first; open runs keep square-cut free ends). A bend whose neighbouring vertex is too close for two
 * knuckles, or that the caller buries in a part of its own (`knuckle` returns false), has none: the two lengths are welded along the touching
 * edge instead. The knuckle of a gentle bend is a raster-only part, so a long rail does not double the ray-traced part count; a sharp bend's is
 * also ray traced. Returns the straight lengths in vertex order; the knuckles are in the same chain monolith, in order: length, knuckle, length, ... */
export function weldedTube(builder: Parts, points: readonly Vec3[], radius: number, color: Vec3, name: string, options: PartOptions = {}, closed = true, knuckle: (vertex: number) => boolean = () => true): ParkPart[] {
  if (points.length < (closed ? 3 : 2)) throw new Error('A welded tube needs enough vertices for its topology');
  const count = points.length, segmentCount = closed ? count : count - 1;
  const directions = Array.from({ length: segmentCount }, (_, i) => unit(sub(points[(i + 1) % count], points[i])));
  const before = (i: number) => directions[(i + segmentCount - 1) % segmentCount];
  const setback = points.map((_, i) => {
    if (!closed && (i === 0 || i === count - 1)) return 0;
    const cosine = clamp(dot(before(i), directions[i % segmentCount]), -1, 1);
    if (cosine <= -0.999) throw new Error('A welded tube cannot reverse at a zero-radius bend');
    return radius * Math.sqrt(Math.max(0, (1 - cosine) / (1 + cosine)));
  });
  const parts = directions.map((direction, i) => {
    const next = (i + 1) % count;
    if (distance(points[i], points[next]) <= setback[i] + setback[next]) throw new Error('A welded tube length is too short to meet its bends');
    return builder.rod(add(points[i], mul(direction, setback[i])), add(points[next], mul(direction, -setback[next])), radius, color, options);
  });
  // A knuckle needs both neighbouring vertices a little more than both knuckle radii away, or it would overlap its neighbour's knuckle.
  const knuckleRadius = (i: number) => Math.hypot(radius, setback[i]);
  const roomy = (i: number) => [1, count - 1].every(step => distance(points[i], points[(i + step) % count]) >= 1.05 * (knuckleRadius(i) + knuckleRadius((i + step) % count)));
  const chain: ParkPart[] = [];
  for (let i = 0; i < segmentCount; i++) {
    chain.push(parts[i]);
    const next = (i + 1) % count;
    if (!closed && next === count - 1) continue;
    const incomingDirection = directions[i], outgoingDirection = directions[(i + 1) % segmentCount];
    const incomingEnd = yawPoint(builder.origin, builder.yaw, add(points[next], mul(incomingDirection, -setback[next])));
    const outgoingStart = yawPoint(builder.origin, builder.yaw, add(points[next], mul(outgoingDirection, setback[next])));
    if (knuckle(next) && roomy(next)) {
      const bead = builder.sphere(points[next], knuckleRadius(next), color, { ...options, detail: 2 * setback[next] > KNUCKLE_RAY_TRACED_SLIT ? options.detail : Math.max(options.detail ?? 0, 1) });
      chain.push(bead);
      // Each length's cut end is centred on its own axis, inside the knuckle; the weld joins the two at that centre.
      registerJoint(builder.park, { name: `${name}/${next}/in`, kind: 'fixed', a: partAnchor(parts[i], incomingEnd), b: partAnchor(bead, incomingEnd),
        rationale: 'The incoming length is welded to the knuckle at the centre of its cut end, which lies inside the knuckle.' });
      registerJoint(builder.park, { name: `${name}/${next}/out`, kind: 'fixed', a: partAnchor(parts[(i + 1) % segmentCount], outgoingStart), b: partAnchor(bead, outgoingStart),
        rationale: 'The outgoing length is welded to the knuckle at the centre of its cut end, which lies inside the knuckle.' });
    } else {
      // The inner edge of the incoming cut end: a radius to the inside of the turn from the cut end's centre.
      const across = sub(outgoingDirection, mul(incomingDirection, dot(outgoingDirection, incomingDirection)));
      const weld = Math.hypot(...across) < 1e-9 ? incomingEnd : add(incomingEnd, mul(yawPoint([0, 0, 0], builder.yaw, unit(across)), radius));
      registerJoint(builder.park, { name: `${name}/${next}`, kind: 'fixed', a: partAnchor(parts[i], weld), b: partAnchor(parts[(i + 1) % segmentCount], weld),
        rationale: 'Short lengths meet without a knuckle: they are welded along the one edge point where the inner walls of the bend cross.' });
    }
  }
  declareMonolith(builder.park, name, chain, 'One bent steel tube: straight lengths stopping just short of each bend, welded into a round knuckle where there is room for one; only a knuckle and its two lengths overlap.', closed ? 'closed' : 'open');
  return parts;
}

export interface BeamStation { pos: Vec3; right: Vec3; up: Vec3; tangent: Vec3 }
/** A laminated timber beam bent through a curve, built as one straight box per station (builder at the origin, no yaw).
 * Each box reaches halfway to its neighbours plus the mitre allowance reach*tan(half turn angle), where reach is the
 * distance from the beam axis to a corner of its section, so no gap opens on the outside of a bend and only neighbours overlap. */
export function weldedBeam(builder: Parts, stations: readonly BeamStation[], half: readonly [number, number], color: Vec3, name: string, options: PartOptions = {}, closed = true): ParkPart[] {
  const count = stations.length, reach = Math.hypot(half[0], half[1]);
  if (count < (closed ? 3 : 2)) throw new Error('A bent beam needs enough stations for its topology');
  const span = (i: number, j: number) => {
    const cosine = clamp(dot(stations[i].tangent, stations[j].tangent), -1, 1);
    return distance(stations[i].pos, stations[j].pos) / 2 + reach * Math.sqrt(Math.max(0, (1 - cosine) / (1 + cosine)));
  };
  const parts = stations.map((s, i) => {
    const previous = closed ? (i + count - 1) % count : i - 1, next = closed ? (i + 1) % count : i + 1;
    const hasPrevious = previous >= 0, hasNext = next < count;
    const behind = hasPrevious ? span(previous, i) : span(next, i), ahead = hasNext ? span(i, next) : span(previous, i);
    const centre = add(s.pos, mul(s.tangent, (ahead - behind) / 2));
    return builder.box(centre, [half[0], half[1], (ahead + behind) / 2], color, { rot: basisQuat(s.right, s.up, mul(s.tangent, -1)), ...options });
  });
  declareMonolith(builder.park, name, parts, 'One laminated timber beam bent through the curve; neighbouring boxes overlap at the mitre where the beam changes direction.', closed ? 'closed' : 'open');
  return parts;
}

/** Polygonal annulus with a real central opening; radial panel overlap follows the outer polygon angle. */
export function annularDeck(builder: Parts, inner: number, outer: number, y: number, halfHeight: number, color: Vec3, name: string): ParkPart[] {
  const count = 48, middle = (inner + outer) / 2, parts: ParkPart[] = [];
  for (let i = 0; i < count; i++) {
    const a = i * Math.PI * 2 / count;
    parts.push(builder.box([Math.cos(a) * middle, y, Math.sin(a) * middle], [(outer - inner) / 2, halfHeight, outer * Math.tan(Math.PI / count)], color,
      { localRot: axisAngle([0, 1, 0], -a) }));
  }
  for (let i = 0; i < count; i++) {
    const angle = (i + 0.5) * Math.PI * 2 / count, point = yawPoint(builder.origin, builder.yaw, [Math.cos(angle) * middle, y, Math.sin(angle) * middle]);
    registerJoint(builder.park, { name: `${name}/${i}`, kind: 'fixed', a: partAnchor(parts[i], point), b: partAnchor(parts[(i + 1) % count], point), rationale: 'Adjacent welded annular floor panels share their radial seam; the central tower opening remains empty.' });
  }
  return parts;
}
