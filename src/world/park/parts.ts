import type { Quat, Vec3 } from '../../contracts';
import { EMISSIVE_MAX_NITS } from '../../render/contracts';
import { axisAngle, basisQuat, cross, distance, mul, qmul, sub, unit, yawPoint } from './math';
import type { ParkData, ParkPart, PartShape, RideDefinition } from './types';
import { declareInterface, declareMonolith, insertEnd, partAnchor, registerJoint } from './construction';
import { weldedTube } from './rideGeometry';
import { coasterBogiePivot, coasterCouplerHeight, coasterCouplerPin, coasterWheelbase, COASTER_DECK, COASTER_FLOOR, coasterSeatHeight, CAROUSEL_WITHERS, RAIL, SEAT_PAN } from './rideDimensions';

/** Positions are builder-local. `localRot` composes with builder yaw; `rot` is an explicit parent-frame override. */
export type PartOptions = Partial<ParkPart> & { localRot?: Quat };

/** Generator call sites per part, recorded only for construction audits (stack capture is slow). */
const provenance = new WeakMap<ParkPart, string>();
let recordProvenance = false;
export function setPartProvenance(enabled: boolean): void { recordProvenance = enabled; }
/** The generator functions that created a part, innermost first, e.g. "rideSeat < flatAssets < generatePark". */
export function partSource(part: ParkPart): string { return provenance.get(part) ?? 'unrecorded'; }
const owners = new WeakMap<ParkPart, number>();
/** Attribute parts created since `start` to an attraction, including its static structure (audit only). */
export function markRideParts(parts: readonly ParkPart[], start: number, ride: number): void {
  if (recordProvenance) for (let i = start; i < parts.length; i++) if (!owners.has(parts[i])) owners.set(parts[i], ride);
}
export function partRide(part: ParkPart): number { return owners.get(part) ?? -1; }
const SKIPPED_FRAMES = new Set(['callSite', 'Parts.part', 'Parts.box', 'Parts.sphere', 'Parts.rod', 'Error', 'new Error']);
function callSite(): string {
  const names: string[] = [];
  for (const line of (new Error().stack ?? '').split('\n').slice(1)) {
    const match = /^\s*at (?:new )?([^\s(]+)/.exec(line); if (!match) continue;
    const name = match[1].replace(/^Object\./, '');
    if (SKIPPED_FRAMES.has(name) || name.startsWith('file:') || name === 'async') continue;
    names.push(name); if (names.length === 3) break;
  }
  return names.join(' < ') || 'anonymous';
}
/** Surfaces made of non-metals. Their reflections stay uncoloured, so their metalness is 0; only the default 'paint' tag can be bare metal. */
export const NON_METAL_SURFACES: ReadonlySet<ParkPart['surface']> = new Set(['concrete', 'timber', 'fabric', 'masonry', 'foliage', 'glass', 'paving']);

export class Parts {
  constructor(readonly park: ParkData, readonly origin: Vec3 = [0, 0, 0], readonly yaw = 0, readonly body = -1, readonly category?: ParkPart['category']) {}
  part(shape: PartShape, pos: Vec3, half: Vec3, color: Vec3, options: PartOptions = {}): ParkPart {
    const { localRot, ...properties } = options;
    if (localRot && options.rot) throw new Error('A part cannot mix localRot and parent-frame rot');
    const q = axisAngle([0, 1, 0], this.yaw);
    const p: ParkPart = { shape, pos: yawPoint(this.origin, this.yaw, pos), half, rot: localRot ? qmul(q, localRot) : q, color,
      roughness: color === CONCRETE ? 0.9 : color === RUBBER ? 0.85 : color === METAL ? 0.3 : 0.48,
      metalness: color === METAL ? 0.85 : 0, surface: color === CONCRETE ? 'concrete' : 'paint',
      emissive: 0, solid: true, detail: 0, body: this.body, category: this.category, ...properties };
    if (![...p.pos, ...p.half, ...p.rot].every(Number.isFinite) || p.half.some(v => v <= 0)) throw new Error(`Invalid ${shape} geometry`);
    if (NON_METAL_SURFACES.has(p.surface) && p.metalness !== 0) throw new Error(`A ${p.surface} part cannot have metalness ${p.metalness}`);
    if ((shape === 'cone' || shape === 'cylinder') && p.half[0] !== p.half[2]) throw new Error(`${shape} requires a circular cross-section shared by raster and collision`);
    const norm = Math.hypot(...p.rot);
    if (!norm) throw new Error('A part rotation must have nonzero norm');
    p.rot = p.rot.map(v => v / norm) as Quat;
    if (recordProvenance) provenance.set(p, callSite());
    this.park.parts.push(p); return p;
  }
  box(pos: Vec3, half: Vec3, color: Vec3, options: PartOptions = {}): ParkPart { return this.part('box', pos, half, color, options); }
  sphere(pos: Vec3, radius: number, color: Vec3, options: PartOptions = {}): ParkPart { return this.part('sphere', pos, [radius, radius, radius], color, options); }
  rod(a: Vec3, b: Vec3, radius: number, color: Vec3, options: PartOptions = {}): ParkPart {
    if (options.rot || options.localRot || options.pos || options.half) throw new Error('A rod transform is defined by its endpoints and radius');
    const aa = yawPoint(this.origin, this.yaw, a), bb = yawPoint(this.origin, this.yaw, b);
    const up = unit(sub(bb, aa)), right = unit(cross(up, Math.abs(up[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    const back = cross(right, up);
    return this.part('cylinder', [0, 0, 0], [radius, distance(aa, bb) / 2, radius], color, { pos: [(aa[0] + bb[0]) / 2, (aa[1] + bb[1]) / 2, (aa[2] + bb[2]) / 2], rot: basisQuat(right, up, back), ...options });
  }
}

export const METAL: Vec3 = [0.32, 0.36, 0.39];
export const RUBBER: Vec3 = [0.016, 0.019, 0.023];
export const CONCRETE: Vec3 = [0.36, 0.35, 0.32];

/** The lit area of a glowing part seen from its brightest side: a globe's disc, or a flat diffuser's largest face. */
export function emittingArea(part: ParkPart): number {
  if (part.shape === 'sphere') return Math.PI * part.half[0] ** 2;
  if (part.shape === 'box') { const [a, b] = [...part.half].sort((x, y) => y - x); return 4 * a * b; }
  throw new Error(`A ${part.shape} cannot be a lamp emitter`);
}

/** A light cast by the glowing parts of a fitting. The light sits at their centre and has their colour, and their glow is the
 * luminance that gives the light's candela through their lit area, so a lamp looks as bright as the light it throws. */
export function luminaire(park: ParkData, emitters: ParkPart[], light: { color: Vec3; candela: number; radius: number; room: number }): void {
  const area = emitters.reduce((sum, part) => sum + emittingArea(part), 0), emissive = light.candela / (area * EMISSIVE_MAX_NITS);
  const pos: Vec3 = [0, 0, 0];
  for (const part of emitters) { part.color = [...light.color]; part.emissive = emissive; for (let k = 0; k < 3; k++) pos[k] += part.pos[k] / emitters.length; }
  park.lights.push({ ...light, pos, emitters: emitters.map(part => park.parts.lastIndexOf(part)) });
}

/** Seat dimensions, metres in the seat frame (rider faces -z, so the backrest is at +z). Every connection below is derived from these. */
const SEAT = {
  /** Pedestal top: this far below the seat origin, inside the moulded pan, which is thickest there. */
  footTop: -0.04, footHalfX: 0.17, footHalfZ: 0.13,
  /** A floor closer than this to the pedestal top needs no pedestal: the pan simply sits on it. */
  minPedestal: 0.01,
  /** Side grab rail: a straight tube beside the pan, held off the shell by two short posts. */
  railX: 0.262, railY: 0.02, railRadius: 0.018, railFront: -0.2, railBack: 0.26, postRadius: 0.014, postRoot: 0.17, posts: [-0.12, 0.18],
  /** Restraint: a stub axle from each side of the backrest carries a hub, an arm runs down from the hub to a padded cross bar over the lap.
   * Everything stays inside the seat's half width, so seats on a 0.6 m bench pitch keep 40 mm between them. */
  hingeY: 0.72, hingeZ: 0.27, stubRoot: 0.13, stubRadius: 0.02, armX: 0.255, hubHalf: 0.025, hubRadius: 0.035, armRadius: 0.02,
  barY: 0.36, barZ: -0.2, barRadius: 0.045,
  /** Half width of the moulded pan and backrest. */
  shellHalfX: 0.24,
} as const;
/** The widest point of a seat with its grab rails and restraint, metres either side of its centre. Ride layouts derive their seat pitch from this. */
export const SEAT_HALF_WIDTH = Math.max(SEAT.railX + SEAT.railRadius, SEAT.armX + SEAT.hubHalf);

/** Manufactured bucket seat: a moulded shell with bonded foam pads, side grab rails and, when asked, a hinged over-the-lap restraint. */
export function rideSeat(park: ParkData, parent: number, ride: RideDefinition, pos: Vec3, yaw: number, color: Vec3, restraint = false, floorY?: number): ParkPart {
  const seat = new Parts(park, pos, yaw, parent, 'ride'), foam = { metalness: 0, roughness: 0.86 };
  const shell = seat.part('sphere', [0, 0.02, 0.02], [SEAT.shellHalfX, 0.14, 0.36], color, { metalness: 0.08, roughness: 0.42 });
  const cushion = seat.box([0, 0.12, -0.02], [0.245, 0.07, 0.29], RUBBER, foam);
  const backrest = seat.part('sphere', [0, 0.54, 0.27], [SEAT.shellHalfX, 0.48, 0.15], color, { metalness: 0.08 });
  const backPad = seat.box([0, 0.48, 0.14], [0.22, 0.3, 0.075], RUBBER, foam);
  const headrest = seat.part('sphere', [0, 0.91, 0.24], [0.19, 0.15, 0.1], RUBBER, foam);
  declareMonolith(park, `${ride.family}/seat-shell`, [shell, cushion, backrest, backPad, headrest], 'Moulded seat shell with its foam pads bonded in: one upholstered seat unit.');
  const top = pos[1] + SEAT.footTop;
  if (floorY !== undefined && top - floorY > SEAT.minPedestal) {
    const mount = seat.box([0, (floorY + top) / 2 - pos[1], 0.02], [SEAT.footHalfX, (top - floorY) / 2, SEAT.footHalfZ], METAL);
    declareInterface(park, { name: `${ride.family}/seat-mount-top`, kind: 'insert', a: shell, b: mount, end: 1, axis: 1, rationale: 'Pedestal top face is bolted into the underside of the moulded pan.' });
    const socket = yawPoint(pos, yaw, [0, SEAT.footTop - Math.min(0.02, (top - floorY) / 2), 0.02]);
    registerJoint(park, { name: `${ride.family}/seat-mount/${park.parts.length}`, kind: 'fixed', a: partAnchor(shell, socket), b: partAnchor(mount, socket), rationale: 'Pedestal ends in the moulded seat shell mounting socket, up to 20mm below its top.' });
  }
  for (const side of [-1, 1]) {
    const rail = seat.rod([side * SEAT.railX, SEAT.railY, SEAT.railFront], [side * SEAT.railX, SEAT.railY, SEAT.railBack], SEAT.railRadius, METAL);
    for (const z of SEAT.posts) {
      const post = seat.rod([side * SEAT.postRoot, SEAT.railY, z], [side * SEAT.railX, SEAT.railY, z], SEAT.postRadius, METAL, { detail: 1 });
      insertEnd(park, shell, post, -1, `${ride.family}/seat-rail-post-root`, 'Post foot is bolted into the moulded shell attachment boss.');
      insertEnd(park, rail, post, 1, `${ride.family}/seat-rail-post-top`, 'Post top ends on the axis of the grab rail it carries.');
      const root = yawPoint(pos, yaw, [side * SEAT.postRoot, SEAT.railY, z]), tip = yawPoint(pos, yaw, [side * SEAT.railX, SEAT.railY, z]);
      registerJoint(park, { name: `${ride.family}/seat-handrail-root/${park.parts.length}`, kind: 'fixed', a: partAnchor(shell, root), b: partAnchor(post, root), rationale: 'Grab rail post terminates inside the moulded shell attachment boss.' });
      registerJoint(park, { name: `${ride.family}/seat-handrail-end/${park.parts.length}`, kind: 'fixed', a: partAnchor(rail, tip), b: partAnchor(post, tip), rationale: 'Both grab rail posts are carried by the shell rather than floating beside the seat.' });
    }
  }
  if (!restraint) return shell;
  const pivot = yawPoint(pos, yaw, [0, SEAT.hingeY, SEAT.hingeZ]), id = park.bodies.length;
  // The restraint frame is the seat frame turned half a turn about the vertical, so the runtime's opening swing lifts the bar forward and up, away from the rider.
  park.bodies.push({ ride: ride.id, role: 'restraint', index: id, local: pivot, localRot: axisAngle([0, 1, 0], yaw + Math.PI), parent, train: park.bodies[parent].train });
  ride.bodies.push(id);
  const bar = new Parts(park, [0, 0, 0], 0, id, 'ride');
  const inFrame = (x: number, y: number, z: number): Vec3 => [-x, y - SEAT.hingeY, SEAT.hingeZ - z];
  const hubIn = SEAT.armX - SEAT.hubHalf, hubOut = SEAT.armX + SEAT.hubHalf, barHalf = SEAT.armX + SEAT.hubHalf;
  const crossbar = bar.rod(inFrame(-barHalf, SEAT.barY, SEAT.barZ), inFrame(barHalf, SEAT.barY, SEAT.barZ), SEAT.barRadius, RUBBER, { metalness: 0, roughness: 0.8 });
  for (const side of [-1, 1]) {
    const stub = seat.rod([side * SEAT.stubRoot, SEAT.hingeY, SEAT.hingeZ], [side * hubIn, SEAT.hingeY, SEAT.hingeZ], SEAT.stubRadius, METAL, { detail: 1 });
    insertEnd(park, shell, stub, -1, `${ride.family}/restraint-stub-root`, 'Stub axle is bolted into the side of the moulded backrest.');
    const hub = bar.rod(inFrame(side * hubIn, SEAT.hingeY, SEAT.hingeZ), inFrame(side * hubOut, SEAT.hingeY, SEAT.hingeZ), SEAT.hubRadius, METAL, { detail: 1 });
    declareInterface(park, { name: `${ride.family}/restraint-hub-bearing`, kind: 'bear', a: stub, b: hub, rationale: 'Hub turns on the flat end of the stub axle; the two faces meet without overlapping.' });
    const arm = bar.rod(inFrame(side * SEAT.armX, SEAT.hingeY, SEAT.hingeZ), inFrame(side * SEAT.armX, SEAT.barY, SEAT.barZ), SEAT.armRadius, METAL);
    insertEnd(park, hub, arm, -1, `${ride.family}/restraint-arm-hub`, 'Arm is welded into its hub on the hinge axis.');
    insertEnd(park, crossbar, arm, 1, `${ride.family}/restraint-arm-bar`, 'Arm ends on the axis of the padded cross bar.');
    registerJoint(park, { name: `${ride.family}/restraint/${id}/${side}`, kind: 'hinge', a: partAnchor(stub, yawPoint(pos, yaw, [side * hubIn, SEAT.hingeY, SEAT.hingeZ]), [Math.cos(yaw), 0, -Math.sin(yaw)]), b: partAnchor(hub, inFrame(side * hubIn, SEAT.hingeY, SEAT.hingeZ), [1, 0, 0]), rationale: 'Restraint hub rotates about the shared transverse stub axle in the backrest.' });
  }
  return shell;
}

/** Sculpted carousel mount, carved as one piece: barrel, neck, head, mane, saddle, bent legs, hooves and tail.
 * A brass sleeve runs up through its body for the pole; when the pole is given, it is declared as a shaft inside that sleeve. */
/** A carved horse whose pole runs through its withers at the builder's origin; the carving stands CAROUSEL_WITHERS behind
 * the pole, so the saddle and its rider sit clear of it. */
export function carouselHorse(frame: Parts, color: Vec3, tack: Vec3, variant: number, pole?: ParkPart): ParkPart {
  const b = new Parts(frame.park, yawPoint(frame.origin, frame.yaw, [0, 0, CAROUSEL_WITHERS]), frame.yaw, frame.body, frame.category);
  const hide: Vec3 = variant % 3 === 0 ? [0.73, 0.65, 0.49] : variant % 3 === 1 ? [0.37, 0.18, 0.07] : [0.86, 0.83, 0.73];
  const dark: Vec3 = [0.09, 0.055, 0.026];
  const finish = { metalness: 0, roughness: 0.36 };
  // The sleeve is listed first so a contract with it covers every piece of the carving the pole passes through.
  const sleeve = b.rod([0, 0.02, -CAROUSEL_WITHERS], [0, 0.74, -CAROUSEL_WITHERS], 0.05, METAL, { detail: 1 });
  const carved: ParkPart[] = [sleeve];
  const barrelY = 0.37, barrelHalf: Vec3 = [0.34, 0.43, 0.8];
  const barrel = b.part('sphere', [0, barrelY, 0], barrelHalf, hide, finish);
  carved.push(barrel);
  carved.push(b.part('sphere', [0, 0.9, -0.64], [0.25, 0.58, 0.3], hide, { ...finish, localRot: axisAngle([1, 0, 0], -0.42) }));
  carved.push(b.part('sphere', [0, 1.36, -0.96], [0.23, 0.28, 0.4], hide, finish));
  carved.push(b.part('sphere', [0, 1.22, -1.25], [0.2, 0.2, 0.25], hide, finish));
  carved.push(b.part('sphere', [0, 0.84, -0.4], [0.14, 0.62, 0.13], dark, finish));
  for (const x of [-0.13, 0.13]) {
    carved.push(b.part('sphere', [x, 1.68, -0.85], [0.075, 0.2, 0.06], hide, finish));
    carved.push(b.sphere([x * 1.7, 1.4, -1.08], 0.035, RUBBER, { solid: false }));
  }
  // A carved saddle seat on the horse's back, about as wide as a rider's seat; a wider flat blanket would stand out from
  // the barrel like a shelf, where the rider's thighs and knees hang.
  const saddleZ = 0.08, saddle = b.part('sphere', [0, 0.77, saddleZ], [0.18, 0.075, 0.26], tack, finish);
  carved.push(saddle);
  carved.push(b.part('sphere', [0, 0.82, 0.34], [0.34, 0.12, 0.14], color, finish));
  for (const side of [-1, 1]) for (const front of [-1, 1]) {
    const x = side * 0.22, z = front * 0.53, bend = front < 0 ? -0.3 : 0.28;
    // The upper leg is a haunch or shoulder sunk into the barrel, tilted toward the knee.
    carved.push(b.part('sphere', [x, 0.02, z + bend / 2], [0.11, 0.3, 0.11], hide, { ...finish, localRot: axisAngle([1, 0, 0], Math.atan2(-bend, 0.38)) }));
    carved.push(b.sphere([x, -0.23, z + bend], 0.11, hide, finish));
    carved.push(b.rod([x, -0.23, z + bend], [x, -0.52, z + bend - 0.3], 0.075, hide, finish));
    carved.push(b.box([x, -0.53, z + bend - 0.34], [0.105, 0.08, 0.15], dark, finish));
  }
  carved.push(b.rod([0, 0.5, 0.58], [0, -0.15, 1.08], 0.12, dark, finish));
  declareMonolith(b.park, 'carousel-horse', carved, 'A carved horse: body, head, mane, saddle, legs, hooves and tail are one carving.');
  if (pole) declareInterface(b.park, { name: 'carousel-horse-pole', kind: 'coaxial', a: sleeve, b: pole, rationale: 'The pole runs up through the horse\'s brass sleeve; the horse slides along it.' });
  // Stirrup straps run from under the saddle seat down the horse's side, lying along the barrel a few millimetres off it.
  // The bends follow the barrel's section at the saddle, pushed out by the strap radius and enough to clear the barrel between bends.
  const strapRadius = 0.02, strapOffset = 0.026, section = Math.sqrt(1 - (saddleZ / barrelHalf[2]) ** 2), sx = barrelHalf[0] * section, sy = barrelHalf[1] * section;
  for (const side of [-1, 1]) {
    // It starts on the same curve inside the saddle seat, so every bend is as gentle as the rest.
    const path: Vec3[] = [];
    for (const t of [1.35, 1.1, 0.85, 0.6, 0.35, 0.1, -0.15, -0.4, -0.65]) {
      const normal = [Math.cos(t) / sx, Math.sin(t) / sy], length = Math.hypot(normal[0], normal[1]);
      path.push([side * (sx * Math.cos(t) + strapOffset * normal[0] / length), barrelY + sy * Math.sin(t) + strapOffset * normal[1] / length, saddleZ]);
    }
    const strap = weldedTube(b, path, strapRadius, METAL, `carousel-horse-strap/${side}`, { detail: 1 }, false);
    insertEnd(b.park, saddle, strap[0], -1, 'carousel-horse-strap', 'The strap top is stitched under the saddle seat.');
  }
  return barrel;
}

/** Coaster car dimensions, metres in the car frame (y up from the rail line, nose toward -z). The body, the bogies and the couplers all read these. */
const CAR = {
  deckHalfX: 0.96, endFraction: 0.44, noseFraction: 0.455,
  panelHalfX: 0.0375, panelTop: 1.06, panelRailRadius: 0.035, slatHalfX: 0.018,
  /** The bogie crossbar runs between the wheel tops and the floor deck, or under the rails on a suspended car; a kingpin joins its middle to the car. */
  crossbarY: 0.53, suspendedCrossbarY: -0.6, crossbarRadius: 0.04, kingpinRadius: 0.035,
  plateHalfZ: 0.16, plateLow: -0.3, suspendedPlateLow: -0.65, suspendedPlateHigh: 0.35,
  guideHalfHeight: 0.07, guideArmY: 0.12, guideArmRadius: 0.035, axleRadius: 0.045, loadHub: [0.072, 0.04], upstopHub: [0.06, 0.035],
  mountRadius: 0.065, suspendedMountRadius: 0.065, suspendedMountReach: 0.36,
  /** The moulded nose stops above the drawbar's reach, which swings through the gap between neighbouring cars. */
  noseHalfY: 0.22,
  keelHalfX: 0.13, keelHalfY: 0.1, beamHalfX: 0.57, beamHalfZ: 0.07, beamBehindSeat: 0.27, hangerRadius: 0.05,
} as const;

/** One coaster car: floor deck (a keel beam when suspended), seats, two rail bogies and two drawbar sockets. Returns the front and rear socket. */
export function carParts(park: ParkData, body: number, ride: RideDefinition, color: Vec3): [ParkPart, ParkPart] {
  const b = new Parts(park, [0, 0, 0], 0, body, 'ride'), hanging = ride.family === 'inverted';
  const length = ride.carLength, pivot = coasterBogiePivot(ride.family), shell = { metalness: 0.05, roughness: 0.38 };
  const pinY = coasterCouplerHeight(ride.family), pinZ = coasterCouplerPin(length), end = length * CAR.endFraction;
  const deckMid = COASTER_FLOOR - COASTER_DECK / 2, deckBottom = COASTER_FLOOR - COASTER_DECK;
  // The spine is the one member every bogie kingpin and drawbar mount enters: the floor deck of a standing car, the keel beam of a suspended one.
  let spine: ParkPart;
  if (hanging) spine = b.box([0, pinY, 0], [CAR.keelHalfX, CAR.keelHalfY, length * 0.35], color, shell);
  else {
    spine = b.box([0, deckMid, 0], [CAR.deckHalfX, COASTER_DECK / 2, end], color, shell);
    const moulded: ParkPart[] = [spine, b.part('sphere', [0, COASTER_FLOOR, -length * CAR.noseFraction], [CAR.deckHalfX, CAR.noseHalfY, 0.1], color, shell)];
    for (const x of [-0.87, 0.87]) moulded.push(b.sphere([x, 0.75, -length * 0.466], 0.055, [0.7, 0.05, 0.01], { emissive: 0.08, solid: false }));
    declareMonolith(park, `${ride.id}/car-body`, moulded, 'Floor deck and nose cone are one moulded car body; the head lamps are set into the nose.');
    // Side panels end at the seat backs and nose. Openings beside both rows are genuine boarding paths. Each hangs from the deck's side face, above the bogie crossbar.
    const panels = [[-length * 0.42, -1.36], [-0.42, -0.25], [0.95, length * 0.42]], mid = (deckBottom + CAR.panelTop) / 2, half = (CAR.panelTop - deckBottom) / 2;
    for (const side of [-1, 1]) {
      const x = side * (CAR.deckHalfX + CAR.panelHalfX);
      for (const [front, rear] of panels) {
        const z = (front + rear) / 2, halfLength = (rear - front) / 2;
        b.box([x, mid, z], [CAR.panelHalfX, half, halfLength], color, shell);
        b.rod([x, CAR.panelTop + CAR.panelRailRadius, front], [x, CAR.panelTop + CAR.panelRailRadius, rear], CAR.panelRailRadius, METAL);
        if (ride.family === 'wooden' || ride.family === 'mine') for (const y of [0.76, 0.96]) b.box([x + side * (CAR.panelHalfX + CAR.slatHalfX), y, z], [CAR.slatHalfX, 0.065, halfLength], [0.25, 0.13, 0.055], { surface: 'timber', roughness: 0.86, detail: 1 });
      }
    }
  }
  const seats: { shell: ParkPart; x: number; y: number; z: number }[] = [];
  for (const z of [-0.65, 0.65]) for (const x of [-0.47, 0.47]) {
    // Cushion top is exactly at the authoritative pelvis anchor used by guestSeat.
    const y = coasterSeatHeight(ride.family) - SEAT_PAN;
    seats.push({ shell: rideSeat(park, body, ride, [x, y, z], 0, color, true, hanging ? undefined : COASTER_FLOOR), x, y, z });
  }
  if (hanging) {
    // Each seat row hangs from a cross beam under the keel, by one arm per seat that runs down behind the head into the backrest.
    const moulded: ParkPart[] = [spine];
    for (const z of [-0.65, 0.65]) {
      const beam = b.box([0, pinY, z + CAR.beamBehindSeat], [CAR.beamHalfX, CAR.keelHalfY, CAR.beamHalfZ], color, shell);
      moulded.push(beam);
      for (const seat of seats.filter(s => s.z === z)) {
        const arm = b.rod([seat.x, pinY, z + CAR.beamBehindSeat], [seat.x, seat.y + 0.5, z + CAR.beamBehindSeat], CAR.hangerRadius, METAL);
        insertEnd(park, beam, arm, -1, `${ride.id}/seat-arm-beam`, 'The seat arm is welded into the cross beam above it.');
        insertEnd(park, seat.shell, arm, 1, `${ride.id}/seat-arm-backrest`, 'The seat arm foot is bolted into the back of the moulded seat.');
      }
    }
    declareMonolith(park, `${ride.id}/car-body`, moulded, 'Keel and seat cross beams are one welded and moulded spine.');
  }
  const plateX = RAIL.halfGauge + RAIL.radius + 2 * RAIL.guideRadius + RAIL.guideBracketClearance + RAIL.bracketHalf;
  const plateLow = hanging ? CAR.suspendedPlateLow : CAR.plateLow, plateHigh = hanging ? CAR.suspendedPlateHigh : deckBottom, crossbarY = hanging ? CAR.suspendedCrossbarY : CAR.crossbarY;
  for (let index = 0; index < 2; index++) {
    const z = (index ? 1 : -1) * coasterWheelbase(length) / 2, id = park.bodies.length;
    park.bodies.push({ ride: ride.id, role: 'bogie', index, local: [0, 0, z], parent: body, train: park.bodies[body].train }); ride.bodies.push(id);
    const bogie = new Parts(park, [0, 0, 0], 0, id, 'ride');
    const crossbar = bogie.rod([-plateX, crossbarY, 0], [plateX, crossbarY, 0], CAR.crossbarRadius, METAL);
    const kingpin = bogie.rod([0, crossbarY, 0], [0, pivot, 0], CAR.kingpinRadius, METAL, { detail: 1 });
    insertEnd(park, crossbar, kingpin, -1, `${ride.id}/kingpin-crossbar`, 'The kingpin foot is welded into the middle of the crossbar.');
    insertEnd(park, spine, kingpin, 1, `${ride.id}/kingpin-body`, 'The kingpin head turns in a bearing inside the car spine.');
    registerJoint(park, { name: `${ride.id}/coaster-bogie/${body}/${index}`, kind: 'fixed', a: partAnchor(spine, [0, pivot, z]), b: partAnchor(kingpin, [0, pivot, 0]), rationale: 'Coincident kingpin centres transmit chassis load; bogie pitch, steering and bank axes remain free to follow the rails.' });
    for (const side of [-1, 1] as const) {
      const x = side * RAIL.halfGauge;
      // Load, up-stop and side-guide rollers are tangent to the 85 mm rail, never through it.
      const loadY = RAIL.radius + RAIL.loadRadius, upstopY = -RAIL.radius - RAIL.upstopRadius, guideX = side * (RAIL.halfGauge + RAIL.radius + RAIL.guideRadius);
      const bracketX = guideX + side * (RAIL.guideRadius + RAIL.guideBracketClearance + RAIL.bracketHalf);
      const plate = bogie.box([bracketX, (plateLow + plateHigh) / 2, 0], [RAIL.bracketHalf, (plateHigh - plateLow) / 2, CAR.plateHalfZ], METAL);
      insertEnd(park, plate, crossbar, side, `${ride.id}/crossbar-plate`, 'The crossbar end is welded into the side plate.');
      // A roller is cantilevered from the plate: roller, hub boss and axle meet face to face along the axle, and the axle ends in the plate.
      const roller = (name: string, y: number, halfWidth: number, radius: number, [hubRadius, hubLength]: readonly number[]) => {
        const wheel = bogie.rod([x - halfWidth, y, 0], [x + halfWidth, y, 0], radius, RUBBER, { wheelRadius: radius });
        const faceX = x + side * halfWidth, hubX = faceX + side * hubLength;
        const hub = bogie.rod([faceX, y, 0], [hubX, y, 0], hubRadius, METAL, { detail: 1 });
        const axle = bogie.rod([hubX, y, 0], [bracketX, y, 0], CAR.axleRadius, METAL, { detail: 1 });
        insertEnd(park, plate, axle, 1, `${ride.id}/${name}-axle-plate`, 'The axle end is bolted into the side plate.');
        declareInterface(park, { name: `${ride.id}/${name}-hub`, kind: 'bear', a: wheel, b: hub, rationale: 'The hub boss is bolted flat against the roller face.' });
        declareInterface(park, { name: `${ride.id}/${name}-axle`, kind: 'bear', a: hub, b: axle, rationale: 'The axle end bears flat on the hub boss.' });
        registerJoint(park, { name: `${ride.id}/load-wheel/${body}/${index}/${side}/${y}`, kind: 'hinge', a: partAnchor(axle, [hubX, y, 0], [1, 0, 0]), b: partAnchor(hub, [hubX, y, 0], [1, 0, 0]), rationale: 'Load or up-stop roller and its hub turn on the transverse axle end.' });
      };
      roller('load', loadY, RAIL.loadHalfWidth, RAIL.loadRadius, CAR.loadHub);
      roller('upstop', upstopY, 0.04, RAIL.upstopRadius, CAR.upstopHub);
      const guide = bogie.rod([guideX, -CAR.guideHalfHeight, 0], [guideX, CAR.guideHalfHeight, 0], RAIL.guideRadius, RUBBER, { wheelRadius: RAIL.guideRadius });
      const pin = bogie.rod([guideX, CAR.guideHalfHeight, 0], [guideX, CAR.guideArmY, 0], CAR.guideArmRadius, METAL, { detail: 1 });
      const arm = bogie.rod([guideX - side * CAR.guideArmRadius, CAR.guideArmY, 0], [bracketX, CAR.guideArmY, 0], CAR.guideArmRadius, METAL, { detail: 1 });
      insertEnd(park, plate, arm, 1, `${ride.id}/guide-arm-plate`, 'The guide arm end is welded into the side plate.');
      insertEnd(park, arm, pin, 1, `${ride.id}/guide-pin-arm`, 'The guide pin top is welded into the arm above the roller.');
      declareInterface(park, { name: `${ride.id}/guide-pin`, kind: 'bear', a: guide, b: pin, rationale: 'The pin end bears flat on the top face of the guide roller.' });
      registerJoint(park, { name: `${ride.id}/guide-wheel/${body}/${index}/${side}`, kind: 'hinge', a: partAnchor(pin, [guideX, CAR.guideHalfHeight, 0], [0, 1, 0]), b: partAnchor(guide, [guideX, CAR.guideHalfHeight, 0], [0, 1, 0]), rationale: 'Side-guide roller turns on its vertical pin; the carrier stays clear of its tread.' });
    }
  }
  const couplers: ParkPart[] = [];
  for (const sign of [-1, 1]) {
    const point: Vec3 = [0, pinY, sign * pinZ];
    // A standing car's drawbar horn drops from the deck; a suspended car's runs out of its keel.
    const root: Vec3 = hanging ? [0, pinY, sign * (pinZ - CAR.suspendedMountReach)] : [0, deckMid, sign * pinZ];
    const mount = b.rod(root, point, hanging ? CAR.suspendedMountRadius : CAR.mountRadius, METAL), socket = b.sphere(point, 0.09, METAL); couplers.push(socket);
    insertEnd(park, spine, mount, -1, `${ride.id}/coupler-mount-root`, 'The drawbar horn is rooted inside the car spine.');
    insertEnd(park, socket, mount, 1, `${ride.id}/coupler-mount-socket`, 'The horn ends at the centre of the drawbar socket ball.');
    registerJoint(park, { name: `${ride.id}/coupler-mount/${body}/${sign}`, kind: 'fixed', a: partAnchor(spine, root), b: partAnchor(mount, root), rationale: 'Drawbar bearing mount is rooted inside the rigid chassis, including suspended cars.' });
    registerJoint(park, { name: `${ride.id}/coupler-socket/${body}/${sign}`, kind: 'fixed', a: partAnchor(mount, point), b: partAnchor(socket, point), rationale: 'Spherical drawbar bearing attaches to the actual chassis cantilever.' });
  }
  return couplers as [ParkPart, ParkPart];
}
