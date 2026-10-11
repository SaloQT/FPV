import type { Vec3 } from '../../contracts';
import { partDistance } from './collision';
import { add, dot, inverseRotate, mul, rotate, sub, unit } from './math';
import type { BodyPose, ParkData, ParkPart } from './types';

export interface JointAnchor { part: number; point: Vec3; axis?: Vec3 }
export interface ConstructionJoint {
  name: string;
  kind: 'fixed' | 'hinge' | 'slider' | 'clearance';
  /** Material anchors must lie on/in both primitives. Hollow bearings can explicitly declare a virtual axis. */
  anchorModel?: 'material' | 'virtual-axis';
  a: JointAnchor;
  b: JointAnchor;
  /** Explicit physical travel or separation. Numerical roundoff is handled separately. */
  min?: number;
  max?: number;
  rationale: string;
}
type InputAnchor = Omit<JointAnchor, 'part'> & { part: ParkPart };
export type JointInput = Omit<ConstructionJoint, 'a' | 'b'> & { a: InputAnchor; b: InputAnchor };
const indices = new WeakMap<ParkData, { count: number; index: WeakMap<ParkPart, number> }>();

/** Convert an interface in a part's parent frame to primitive-local metres. */
export function partAnchor(part: ParkPart, point: Vec3, axis?: Vec3): InputAnchor {
  return { part, point: inverseRotate(part.rot, sub(point, part.pos)), ...(axis ? { axis: inverseRotate(part.rot, unit(axis)) } : {}) };
}
export function registerJoint(park: ParkData, input: JointInput): ConstructionJoint {
  let cache = indices.get(park);
  if (!cache) { cache = { count: 0, index: new WeakMap() }; indices.set(park, cache); }
  while (cache.count < park.parts.length) { cache.index.set(park.parts[cache.count], cache.count); cache.count++; }
  const anchor = (a: InputAnchor): JointAnchor => {
    const part = cache!.index.get(a.part);
    if (part === undefined) throw new Error(`Unknown part in ${input.name}`);
    if (![...a.point, ...(a.axis ?? [])].every(Number.isFinite) || (a.axis && Math.hypot(...a.axis) === 0)) throw new Error(`Invalid anchor in ${input.name}`);
    return { part, point: [...a.point], ...(a.axis ? { axis: unit(a.axis) } : {}) };
  };
  if (!input.rationale.trim() || ![input.min ?? 0, input.max ?? 0].every(Number.isFinite) || (input.min ?? 0) > (input.max ?? 0)) throw new Error(`Invalid construction contract: ${input.name}`);
  if (input.kind !== 'fixed' && (!input.a.axis || !input.b.axis)) throw new Error(`Missing joint axes: ${input.name}`);
  const joint = { ...input, a: anchor(input.a), b: anchor(input.b) };
  (park.joints ??= []).push(joint); return joint;
}

/** Preserve semantic interfaces when an independent finalizer removes unused visual/collision parts. */
export function remapConstructionJoints(park: ParkData, oldParts: readonly ParkPart[]): void {
  const index = new Map(park.parts.map((part, i) => [part, i]));
  const map = (old: number, name: string) => { const next = index.get(oldParts[old]); if (next === undefined) throw new Error(`Finalizer removed a connected part: ${name}`); return next; };
  for (const joint of park.joints ?? []) for (const anchor of [joint.a, joint.b]) anchor.part = map(anchor.part, joint.name);
  for (const contact of park.interfaces ?? []) { contact.a = map(contact.a, contact.name); contact.b = map(contact.b, contact.name); }
  for (const piece of park.monoliths ?? []) piece.parts = piece.parts.map(part => map(part, piece.name));
  indices.delete(park);
}

/** How two generated primitives are allowed to meet. Every permitted overlap names its geometry:
 * - `insert`: one end of member `b` (a rod's cap, or a box face along `axis`) lies inside receiver `a`, as a
 *   coped-and-welded tube, socket, sleeve end or embedded foot does. Its whole end section must be inside.
 * - `coaxial`: shaft `b` runs inside the coaxial bore or hub `a` (bearings, pins, telescoping sleeves).
 * - `bear`: finite-area contact without penetration, such as a base plate on a footing or a post on a deck.
 * Anything else that overlaps is a defect, including pairs that also share a declared joint. */
export interface PartInterface {
  name: string;
  kind: 'insert' | 'coaxial' | 'bear';
  /** Receiver, bore or supporting part. */
  a: number;
  /** Inserted member, shaft or supported part. */
  b: number;
  /** insert: which end of b, -1 or +1 along its local axis. */
  end?: -1 | 1;
  /** insert: the member's local axis (1 = y for rods). */
  axis?: 0 | 1 | 2;
  rationale: string;
}
/** Several primitives that model one manufactured piece: a moulded seat, a bent tube, a carved figure.
 * Their mutual overlaps are union modelling of one solid, not an interface. `chain` pieces (bent tubes)
 * may only overlap their neighbours in sequence. */
export interface Monolith { name: string; parts: number[]; chain?: 'open' | 'closed'; rationale: string }

function partIndex(park: ParkData, part: ParkPart, name: string): number {
  let cache = indices.get(park);
  if (!cache) { cache = { count: 0, index: new WeakMap() }; indices.set(park, cache); }
  while (cache.count < park.parts.length) { cache.index.set(park.parts[cache.count], cache.count); cache.count++; }
  const index = cache.index.get(part); if (index === undefined) throw new Error(`Unknown part in ${name}`);
  return index;
}
export function declareInterface(park: ParkData, input: Omit<PartInterface, 'a' | 'b'> & { a: ParkPart; b: ParkPart }): PartInterface {
  if (!input.rationale.trim()) throw new Error(`Interface needs a rationale: ${input.name}`);
  if (input.kind === 'insert' && (input.end !== -1 && input.end !== 1)) throw new Error(`Insertion needs a member end: ${input.name}`);
  if (input.a === input.b) throw new Error(`Interface joins a part to itself: ${input.name}`);
  const contact: PartInterface = { ...input, a: partIndex(park, input.a, input.name), b: partIndex(park, input.b, input.name), ...(input.kind === 'insert' ? { axis: input.axis ?? 1 } : {}) };
  (park.interfaces ??= []).push(contact); return contact;
}
export function declareMonolith(park: ParkData, name: string, parts: readonly ParkPart[], rationale: string, chain?: Monolith['chain']): Monolith {
  if (parts.length < 2 || !rationale.trim()) throw new Error(`Invalid monolith: ${name}`);
  const piece: Monolith = { name, parts: parts.map(p => partIndex(park, p, name)), rationale, ...(chain ? { chain } : {}) };
  (park.monoliths ??= []).push(piece); return piece;
}
/** Convenience: member end `end` of a rod inserted into `receiver` (end -1 = the rod's first point). */
export function insertEnd(park: ParkData, receiver: ParkPart, member: ParkPart, end: -1 | 1, name: string, rationale: string): PartInterface {
  return declareInterface(park, { name, kind: 'insert', a: receiver, b: member, end, axis: 1, rationale });
}

export interface JointMeasurement {
  name: string; kind: ConstructionJoint['kind']; separation: number; lateralError: number; axisError: number;
  anchorError: number;
  numericTolerance: number; pass: boolean; a: Vec3; b: Vec3; rationale: string;
}
/** No geometry is inflated to pass this check. The tolerance only bounds accumulated binary64 operations. */
export function measureJoints(park: ParkData, poses: readonly BodyPose[] = []): JointMeasurement[] {
  const point = (anchor: JointAnchor) => {
    const p = park.parts[anchor.part];
    let at = add(p.pos, rotate(p.rot, anchor.point)), axis = anchor.axis ? rotate(p.rot, anchor.axis) : undefined;
    if (p.body >= 0) {
      const body = poses[p.body]; if (!body) throw new Error(`Missing body pose ${p.body}`);
      at = add(body.pos, rotate(body.rot, at)); if (axis) axis = rotate(body.rot, axis);
    }
    return { at, axis };
  };
  return (park.joints ?? []).map(joint => {
    const a = point(joint.a), b = point(joint.b), delta = sub(b.at, a.at);
    const axis = joint.kind === 'fixed' ? undefined : a.axis, separation = axis ? dot(delta, axis) : Math.hypot(...delta);
    const lateralError = axis ? Math.hypot(...sub(delta, mul(axis, separation))) : Math.hypot(...delta);
    const axisError = axis && b.axis ? Math.hypot(...sub(axis, mul(b.axis, dot(axis, b.axis) < 0 ? -1 : 1))) : 0;
    // 128 rounded operations conservatively cover nested rigid transforms, subtraction and projection.
    const numericTolerance = 128 * Number.EPSILON * Math.max(1, ...a.at.map(Math.abs), ...b.at.map(Math.abs), ...joint.a.point.map(Math.abs), ...joint.b.point.map(Math.abs));
    const anchorError = joint.anchorModel === 'virtual-axis' ? 0 : Math.max(0,
      partDistance(park.parts[joint.a.part], joint.a.point, [0, 0, 0]), partDistance(park.parts[joint.b.part], joint.b.point, [0, 0, 0]));
    const min = joint.min ?? 0, max = joint.max ?? 0;
    const pass = anchorError <= numericTolerance && (joint.kind === 'fixed' ? Math.hypot(...delta) <= numericTolerance
      : lateralError <= numericTolerance && axisError <= 128 * Number.EPSILON && separation >= min - numericTolerance && separation <= max + numericTolerance);
    return { name: joint.name, kind: joint.kind, separation, lateralError, axisError, anchorError, numericTolerance, pass, a: a.at, b: b.at, rationale: joint.rationale };
  });
}
