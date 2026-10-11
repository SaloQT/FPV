import type { Vec3 } from '../../contracts';
import { add, axisAngle, mul, TAU, yawPoint } from './math';
import { ENTERPRISE_BASE_TOP, ENTERPRISE_DECK, enterpriseDeckGap,ENTERPRISE_BOOM, ENTERPRISE_HINGE, ENTERPRISE_PIT_FLOOR, ENTERPRISE_PIVOT, ENTERPRISE_RADIUS, ENTERPRISE_RAM_FOOT, ENTERPRISE_RAM_FOOT_PIN, ENTERPRISE_RAM_HEAD, ENTERPRISE_RAM_RADIUS, TOPSPIN_ARM, TOPSPIN_PIVOT } from './flatPhysics';
import { CONCRETE, METAL, Parts, rideSeat, SEAT_HALF_WIDTH } from './parts';
import { PALETTES } from './recipe';
import type { ParkBody, ParkData, ParkPart, RideDefinition } from './types';
import { declareInterface, declareMonolith, insertEnd, partAnchor, registerJoint } from './construction';
import { apexHousing, END_COVER, legInFooting, legTop, memberBetween } from './assembly';
import { PAVING_RISE } from './surfaces';
import { weldedTube } from './rideGeometry';
import { GUEST_SEATED_HALF_WIDTH } from './guestPose';

function attachment(park: ParkData, ride: RideDefinition, role: ParkBody['role'], index = 0): number {
  const id = park.bodies.length;
  park.bodies.push({ ride: ride.id, role, index, local: [0, 0, 0] }); ride.bodies.push(id);
  return id;
}

export { ENTERPRISE_DECK };
const ENTERPRISE_BEAM = { x: 1.5, radius: 0.26 }, ENTERPRISE_FRAME_PIN = 0.42;
/** Cabin: hinge pins on the tangent axis at +-pin.at, inside rim bearings; the body stays a running clearance inboard of them. */
const ENTERPRISE_CABIN = { pinRadius: 0.065, bearingRadius: 0.18, bearingHalf: 0.065, at: 1, halfZ: 0.85, wallX: 0.57, rimY: 0.95 } as const;

/** Slab and deck under the Enterprise. The landing slab is cast with the deck ring it meets. */
export function enterpriseBase(b: Parts, landing: ParkPart, color: Vec3, name: string): void {
  const { inner, outer, segments, notch, corridor } = ENTERPRISE_DECK, floor = ENTERPRISE_PIT_FLOOR, top = ENTERPRISE_BASE_TOP;
  const finish = { metalness: 0, roughness: 0.9, surface: 'concrete' as const };
  const slab = b.part('cylinder', [0, (PAVING_RISE + floor) / 2, 0], [outer, (floor - PAVING_RISE) / 2, outer], color, finish);
  // Each ring segment is a radial box whose outer edge is the chord of its arc; neighbours overlap toward the pit.
  const step = TAU / segments, half = outer * Math.tan(step / 2), radial = (outer - inner) / 2, mid = inner + radial, ring: ParkPart[] = [landing];
  for (let k = 0; k < segments; k++) {
    const a = k * step;
    if (enterpriseDeckGap(k)) continue;
    ring.push(b.part('box', [Math.cos(a) * mid, (floor + top) / 2, Math.sin(a) * mid], [radial, (top - floor) / 2, half], color, { ...finish, localRot: axisAngle([0, 1, 0], -a) }));
  }
  // The segment faces beside the notch are closest to the centre line at their inner corners.
  const edge = (Math.floor(notch / 2) + 1) * step, nearest = Math.cos(edge - Math.PI / 2) * inner + Math.sin(edge - Math.PI / 2) * half;
  if (nearest < corridor) throw new Error(`Enterprise deck notch leaves ${nearest.toFixed(2)} m, the boom needs ${corridor} m`);
  declareMonolith(b.park, `${name}/deck`, ring, 'Deck ring and landing are one cast slab.');
  for (const part of ring.slice(1)) declareInterface(b.park, { name: `${name}/deck-on-slab`, kind: 'bear', a: slab, b: part, rationale: 'Deck ring is cast on the pit floor slab.' });
}

export function enterpriseAssets(park: ParkData, ride: RideDefinition): void {
  const pal = PALETTES[ride.theme], r = ENTERPRISE_RADIUS, [, pivotY, pivotZ] = ENTERPRISE_PIVOT, [, hubH, boom] = ENTERPRISE_BOOM;
  const fixed = new Parts(park, ride.pos, ride.yaw), worldX: Vec3 = [Math.cos(ride.yaw), 0, -Math.sin(ride.yaw)];
  const floor = ENTERPRISE_PIT_FLOOR;
  // Boom pivots: at each rail a pin turns in two cheek blocks cast on the slot floor; the rail ends in the pin.
  const frame = new Parts(park, [0, 0, 0], 0, attachment(park, ride, 'frame'));
  const cheekHalf = 0.15, cheekGap = ENTERPRISE_BEAM.radius + END_COVER, cheekTop = pivotY + ENTERPRISE_FRAME_PIN + END_COVER;
  // Pin ends stop 10 mm inside the outer cheek faces, so no two faces coincide.
  const pinHalf = cheekGap + 2 * cheekHalf - 0.01, beams: ParkPart[] = [];
  for (const x of [-ENTERPRISE_BEAM.x, ENTERPRISE_BEAM.x]) {
    const pin = frame.rod([x - pinHalf, 0, 0], [x + pinHalf, 0, 0], ENTERPRISE_FRAME_PIN, METAL);
    for (const side of [-1, 1]) {
      const cheek = fixed.box([x + side * (cheekGap + cheekHalf), (floor + cheekTop) / 2, pivotZ], [cheekHalf, (cheekTop - floor) / 2, ENTERPRISE_FRAME_PIN + END_COVER], pal.secondary);
      declareInterface(park, { name: `${ride.id}/enterprise-pivot/${x}/${side}`, kind: 'coaxial', a: cheek, b: pin, rationale: 'Boom pivot pin turns in the cheek block bore.' });
      const inCheek = x + side * (cheekGap + cheekHalf);
      if (side < 0) registerJoint(park, { name: `${ride.id}/enterprise-tilt/${x}`, kind: 'hinge', a: partAnchor(cheek, yawPoint(ride.pos, ride.yaw, [inCheek, pivotY, pivotZ]), worldX), b: partAnchor(pin, [inCheek, 0, 0], [1, 0, 0]), rationale: 'The boom turns about the pivot pin axis held in the cheek blocks.' });
    }
    const beam = frame.rod([x, 0, 0], [x, 0, boom], ENTERPRISE_BEAM.radius, pal.secondary);
    insertEnd(park, pin, beam, -1, `${ride.id}/enterprise-beam-pivot/${x}`, 'Boom rail ends in a boss bored for the pivot pin.');
    beams.push(beam);
  }
  // Boom head: a box joining the rails under the wheel, carrying the hub column and the fixed hub spindle.
  const head = frame.box([0, 0, boom], [ENTERPRISE_BEAM.x + ENTERPRISE_BEAM.radius + END_COVER, ENTERPRISE_BEAM.radius + END_COVER, 0.55], pal.secondary);
  for (const beam of beams) insertEnd(park, head, beam, 1, `${ride.id}/enterprise-beam-head`, 'Boom rail is welded into the head box.');
  // Cross bars stay clear of the band where the lift ram passes through the boom plane during the lift.
  for (const z of [1, 7.2]) memberBetween(frame, beams[0], [-ENTERPRISE_BEAM.x, 0, z], beams[1], [ENTERPRISE_BEAM.x, 0, z], 0.15, pal.secondary, `${ride.id}/enterprise-cross/${z}`);
  const spindle = frame.rod([0, hubH - 0.6, boom], [0, hubH + 0.3, boom], 0.8, METAL);
  // The column stops inside the spindle, short of the turning hub's lower face.
  const hubHalf = 0.45, column = frame.rod([0, 0, boom], [0, hubH - hubHalf - END_COVER, boom], 0.5, pal.secondary);
  insertEnd(park, head, column, -1, `${ride.id}/enterprise-column-foot`, 'Hub column is welded into the boom head.');
  insertEnd(park, spindle, column, 1, `${ride.id}/enterprise-column-top`, 'Hub column ends inside the fixed hub spindle.');
  // Lift ram head pin: carried between two lug plates standing on the rails.
  const [, ramHeadY, ramHeadZ] = ENTERPRISE_RAM_HEAD, headPinRadius = 0.22, lugTop = ramHeadY + headPinRadius + END_COVER;
  const headPin = frame.rod([-ENTERPRISE_BEAM.x, ramHeadY, ramHeadZ], [ENTERPRISE_BEAM.x, ramHeadY, ramHeadZ], headPinRadius, METAL);
  beams.forEach((beam, i) => {
    const x = (i ? 1 : -1) * ENTERPRISE_BEAM.x;
    const lug = frame.box([x, lugTop / 2, ramHeadZ], [0.12, lugTop / 2, headPinRadius + END_COVER + 0.03], pal.secondary);
    declareInterface(park, { name: `${ride.id}/enterprise-ram-lug/${x}`, kind: 'insert', a: beam, b: lug, end: -1, axis: 1, rationale: 'Lug plate is welded onto the boom rail.' });
    insertEnd(park, lug, headPin, i ? 1 : -1, `${ride.id}/enterprise-ram-head-pin/${x}`, 'Ram head pin is held in the lug plate bore.');
  });
  // Lift ram foot: a pin in two cheek blocks on the pit floor.
  const foot = ENTERPRISE_RAM_FOOT, footCheek = 0.1, footGap = ENTERPRISE_RAM_RADIUS + END_COVER, footTop = foot[1] + ENTERPRISE_RAM_FOOT_PIN + END_COVER;
  const footPin = fixed.rod([-(footGap + 2 * footCheek - 0.01), foot[1], foot[2]], [footGap + 2 * footCheek - 0.01, foot[1], foot[2]],ENTERPRISE_RAM_FOOT_PIN, METAL);
  for (const side of [-1, 1]) {
    const cheek = fixed.box([side * (footGap + footCheek), (floor + footTop) / 2, foot[2]], [footCheek, (footTop - floor) / 2, ENTERPRISE_RAM_FOOT_PIN + END_COVER], pal.secondary);
    declareInterface(park, { name: `${ride.id}/enterprise-ram-foot/${side}`, kind: 'coaxial', a: cheek, b: footPin, rationale: 'Ram foot pin sits in the cheek block bores.' });
  }
  // Three telescoping stages. Each body spans [-1.6, 1.6] along its axis; the inner stages are shortened at the
  // foot and the outer stages at the head so no stage reaches a pin it does not hang on at the shortest stroke.
  // Stage 1 reaches 170 mm past stage 0, so at the shortest stroke its gland stands clear above stage 0's.
  const sleeves: ParkPart[] = [], clear = ENTERPRISE_RAM_FOOT_PIN + END_COVER + 0.07;
  for (let i = 0; i < 3; i++) {
    const sleeve = new Parts(park, [0, 0, 0], 0, attachment(park, ride, 'actuator', i)), radius = ENTERPRISE_RAM_RADIUS - i * 0.06;
    const lo = i ? -1.6 + clear : -1.6, hi = [1.6 - clear, 1.6 - clear + 0.17, 1.6][i];
    const body = sleeve.part('cylinder', [0, (lo + hi) / 2, 0], [radius, (hi - lo) / 2, radius], i === 0 ? pal.secondary : METAL, { roughness: i ? 0.18 : 0.42 });
    if (i < 2) declareMonolith(park, `${ride.id}/enterprise-ram-stage/${i}`, [body, sleeve.part('cylinder', [0, hi - 0.07, 0], [radius + 0.035, 0.08, radius + 0.035], [0.045, 0.052, 0.055], { roughness: 0.82 })], 'Gland ring is welded round the mouth of its stage and stands 10 mm proud of it.');
    for (const outer of sleeves) declareInterface(park, { name: `${ride.id}/enterprise-ram-stage/${i}`, kind: 'coaxial', a: outer, b: body, rationale: 'Inner stage slides in the bore of every stage outside it.' });
    sleeves.push(body);
  }
  insertEnd(park, footPin, sleeves[0], -1, `${ride.id}/enterprise-ram-foot-eye`, 'Outer stage ends in an eye on the foot pin.');
  insertEnd(park, headPin, sleeves[2], 1, `${ride.id}/enterprise-ram-head-eye`, 'Inner stage ends in an eye on the head pin.');
  registerJoint(park, { name: `${ride.id}/enterprise-cylinder-foot`, kind: 'hinge', a: partAnchor(footPin, yawPoint(ride.pos, ride.yaw, [...foot]), worldX), b: partAnchor(sleeves[0], [0, -1.6, 0], [1, 0, 0]), rationale: 'Hydraulic outer stage articulates on the fixed foot pin.' });
  registerJoint(park, { name: `${ride.id}/enterprise-cylinder-head`, kind: 'hinge', a: partAnchor(headPin, [...ENTERPRISE_RAM_HEAD], [1, 0, 0]), b: partAnchor(sleeves[2], [0, 1.6, 0], [1, 0, 0]), rationale: 'The innermost stage ends on the boom head pin for the entire lift stroke.' });
  for (let i = 1; i < 3; i++) registerJoint(park, { name: `${ride.id}/enterprise-sleeve/${i}`, kind: 'slider', a: partAnchor(sleeves[i - 1], [0, 0, 0], [0, 1, 0]), b: partAnchor(sleeves[i], [0, 0, 0], [0, 1, 0]), min: 0, max: 3, rationale: 'Coaxial telescoping stages; at full lift each stage still overlaps the one outside it.' });
  // Wheel: hub on the fixed spindle, rim raised above the cabin hinge line, cabins hung from it on hangers.
  const rotor = new Parts(park, [0, 0, 0], 0, attachment(park, ride, 'rotor'));
  const rotorHub = rotor.part('cylinder', [0, 0, 0], [1.2, hubHalf, 1.2], pal.primary);
  declareInterface(park, { name: `${ride.id}/enterprise-hub-bearing`, kind: 'coaxial', a: rotorHub, b: spindle, rationale: 'Wheel hub turns on the fixed spindle.' });
  declareMonolith(park, `${ride.id}/enterprise-hub`, [rotorHub, rotor.part('cylinder', [0, 0.525, 0], [0.75, 0.075, 0.75], pal.accent)], 'Hub cap is welded to the hub.');
  registerJoint(park, { name: `${ride.id}/enterprise-rotor-bearing`, kind: 'hinge', a: partAnchor(spindle, [0, hubH, boom], [0, 1, 0]), b: partAnchor(rotorHub, [0, 0, 0], [0, 1, 0]), rationale: 'Wheel hub rotates about the boom spindle; tilt is inherited by both bearing halves.' });
  for (let i = 0; i < 12; i++) { const a = i * TAU / 12; rotor.part('cylinder', [Math.cos(a) * 0.94, 0.5, Math.sin(a) * 0.94], [0.07, 0.05, 0.07], METAL, { detail: 1 }); }
  const step = TAU / 20, rimY = ENTERPRISE_CABIN.rimY, vertex = r / Math.cos(step / 2);
  const rim = weldedTube(rotor, Array.from({ length: 20 }, (_, k): Vec3 => { const a = (k + 0.5) * step; return [Math.cos(a) * vertex, rimY, Math.sin(a) * vertex]; }), 0.14, pal.secondary, `${ride.id}/enterprise-rim`);
  const { pinRadius, bearingRadius, bearingHalf, at, halfZ, wallX } = ENTERPRISE_CABIN;
  for (let i = 0; i < 20; i++) {
    const a = i * step, dir: Vec3 = [Math.cos(a), 0, Math.sin(a)], tip = mul(dir, r), tangent: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
    // Upper spokes meet the rim above each cabin; lower spokes meet the same rim tube halfway to the hanger,
    // so every spoke end lies inside one straight length of rim.
    const upper = rotor.rod(add(mul(dir, 1), [0, 0.3, 0]), add(tip, [0, rimY, 0]), 0.1, pal.primary);
    const lowerEnd = add(tip, mul(tangent, at / 2)), lowerDir = mul(lowerEnd, 1 / Math.hypot(lowerEnd[0], lowerEnd[2]));
    const lower = rotor.rod(add(mul(lowerDir, 1.05), [0, -0.3, 0]), add(lowerEnd, [0, rimY, 0]), 0.085, pal.secondary);
    for (const spoke of [upper, lower]) {
      insertEnd(park, rotorHub, spoke, -1, `${ride.id}/enterprise-spoke-hub`, 'Spoke is welded into the hub.');
      insertEnd(park, rim[0], spoke, 1, `${ride.id}/enterprise-spoke-rim`, 'Spoke ends inside the rim tube.');
    }
    const id = attachment(park, ride, 'gondola', i), cabin = new Parts(park, [0, 0, 0], 0, id);
    const tub = [
      cabin.part('sphere', [0, 0.08, 0], [0.6, 0.22, halfZ], pal.primary, { metalness: 0.08 }),
      cabin.box([0, ENTERPRISE_CABIN_FLOOR - 0.06, 0], [wallX - 0.055, 0.06, halfZ - 0.05], METAL),
      ...[-1, 1].map(side => cabin.box([side * wallX, 0.52, 0], [0.055, 0.35, halfZ], pal.primary)),
    ];
    declareMonolith(park, `${ride.id}/enterprise-tub`, tub, 'Moulded tub: hull, floor and side walls are one shell.');
    for (const side of [-1, 1]) {
      // Canopy hoop over the riders, its feet set into the side wall.
      const hoop = weldedTube(cabin, [[side * wallX, 0.25, -halfZ + 0.05], [side * wallX, 1.42, -0.6], [side * wallX, 1.42, 0.6], [side * wallX, 0.25, halfZ - 0.05]], 0.035, METAL, `${ride.id}/enterprise-hoop`, {}, false);
      insertEnd(park, tub[2 + (side > 0 ? 1 : 0)], hoop[0], -1, `${ride.id}/enterprise-hoop-foot`, 'Hoop foot is set into the side wall.');
      insertEnd(park, tub[2 + (side > 0 ? 1 : 0)], hoop[2], 1, `${ride.id}/enterprise-hoop-foot`, 'Hoop foot is set into the side wall.');
    }
    for (const side of [-1, 1]) {
      const centre = add(tip, mul(tangent, side * at)), pinPoint: Vec3 = [0, ENTERPRISE_HINGE, side * at];
      const bearing = rotor.rod(add(tip, mul(tangent, side * (at - bearingHalf))), add(tip, mul(tangent, side * (at + bearingHalf))), bearingRadius, METAL);
      const hanger = rotor.rod(add(centre, [0, pinRadius + END_COVER, 0]), add(centre, [0, rimY, 0]), 0.06, METAL);
      insertEnd(park, bearing, hanger, -1, `${ride.id}/enterprise-hanger-bearing`, 'Hanger is welded into the bearing housing above the pin bore.');
      insertEnd(park, rim[0], hanger, 1, `${ride.id}/enterprise-hanger-rim`, 'Hanger ends inside the rim tube.');
      // The pin runs on inboard past the struts, so its end stands free of them.
      const pin = cabin.rod([0, ENTERPRISE_HINGE, side * (halfZ - 0.15)],[0, ENTERPRISE_HINGE, side * (at + bearingHalf)], pinRadius, METAL);
      declareInterface(park, { name: `${ride.id}/enterprise-cabin-pin/${i}/${side}`, kind: 'coaxial', a: bearing, b: pin, rationale: 'Cabin pin turns in the rim bearing.' });
      for (const wall of [tub[2], tub[3]]) {
        const x = wall === tub[2] ? -wallX : wallX;
        memberBetween(cabin, wall, [x, 0.8, side * (halfZ - 0.05)], pin, [0, ENTERPRISE_HINGE, side * halfZ], 0.045, METAL, `${ride.id}/enterprise-strut`);
      }
      registerJoint(park, { name: `${ride.id}/enterprise-gondola/${i}/${side}`, kind: 'hinge', a: partAnchor(bearing, centre, tangent), b: partAnchor(pin, pinPoint, [0, 0, 1]), rationale: 'Separate stub pins at each end share the tangent-axis hinge; no axle passes through the riders.' });
    }
    // Two seats back to back, each rider facing an end of the cabin.
    for (const s of ENTERPRISE_CABIN_SEATS) rideSeat(park, id, ride, [0, ENTERPRISE_SEAT_Y, s.z], s.yaw, pal.secondary, true, ENTERPRISE_CABIN_FLOOR);
  }
  // Operator's booth on the deck, outside the widest swing of the cabins.
  const boothX = 9.6;
  fixed.box([boothX, ENTERPRISE_BASE_TOP + 0.85, 0], [0.55, 0.85, 0.8], pal.primary);
  for (let i = 0; i < 8; i++) fixed.box([boothX + 0.55 + 0.02, ENTERPRISE_BASE_TOP + 0.6 + i * 0.09, 0], [0.02, 0.018, 0.6], METAL, { detail: 1 });
}

/** Top Spin dimensions shared by the moving arms and the fixed towers that must clear them. */
export const TOPSPIN_ARM_X = 6.8;
/** Each arm runs on past the hub to a round counterweight disc, as the HUSS looping-swing patent (US5188566) and the Gardaland
 * and Serengeti-Park photos show (docs/park-construction-sources.md). Disc radius, half thickness along the axis and centre
 * distance from the axis are assumed; the disc is thicker than the arm box so the arm ends inside it. */
const TOPSPIN_COUNTERWEIGHT = { radius: 1.1, half: 0.4, centre: 2.6 }, TOPSPIN_ARM_BOX = [0.36, 0.55] as const;
const TOPSPIN_LEG_RADIUS = 0.55, TOPSPIN_SPINDLE = 0.4, TOPSPIN_CLEARANCE = 0.1, TOPSPIN_SHAFT = 0.18;
/** The arm box and counterweight stub stop a wall's cover short of the fixed spindle, so the hub holds their end sections. */
const TOPSPIN_HUB = { half: 0.42, radius: Math.hypot(TOPSPIN_SPINDLE + END_COVER, TOPSPIN_ARM_BOX[1]) + END_COVER };
/** The arm stops short of the gondola shaft turning in the arm-end bearing, which holds the arm's end section. */
const TOPSPIN_ARM_END = { half: 0.5, radius: Math.hypot(TOPSPIN_SHAFT + END_COVER, TOPSPIN_ARM_BOX[1]) + END_COVER };
/** Gondola end frames stand a running clearance inboard of the arm-end bearings. */
const TOPSPIN_END_WALL = { half: 0.13, x: TOPSPIN_ARM_X - TOPSPIN_ARM_END.half - 0.07 - 0.13 };
/** Outer face of everything that turns with the arms (hub, arm-end bearing, counterweight), from the ride's centre line. */
/** The cabin floor top and the two seats of an Enterprise cabin, back to back, in the cabin frame; seat index % 2 picks a seat. The cabin model and the
 * runtime's rider positions and leg room all read this. */
export const ENTERPRISE_CABIN_FLOOR = 0.3, ENTERPRISE_SEAT_Y = 0.43, ENTERPRISE_CABIN_SEATS = [{ z: -0.44, yaw: 0 }, { z: 0.44, yaw: Math.PI }] as const;
/** Twenty seats a row, spaced so the widest seated rider in an end seat (GUEST_SEATED_HALF_WIDTH, wider than the seat) keeps 30 mm from the end frames.
 * The gondola model and the runtime's rider positions both read this. */
export const TOPSPIN_SEAT_PITCH = (TOPSPIN_END_WALL.x - TOPSPIN_END_WALL.half - Math.max(SEAT_HALF_WIDTH, GUEST_SEATED_HALF_WIDTH) - 0.03) / 9.5;
export function topSpinSeatX(seat: number): number { return (seat % 20 - 9.5) * TOPSPIN_SEAT_PITCH; }
export const TOPSPIN_ENVELOPE_X = TOPSPIN_ARM_X + Math.max(TOPSPIN_HUB.half, TOPSPIN_ARM_END.half, TOPSPIN_COUNTERWEIGHT.half);
/** Tower plane: the legs and the apex housing (half-length = leg radius + cover) stand clear outside the arms. */
export const TOPSPIN_TOWER_X = TOPSPIN_ENVELOPE_X + TOPSPIN_CLEARANCE + TOPSPIN_LEG_RADIUS + END_COVER;

export function topSpinAssets(park: ParkData, ride: RideDefinition): void {
  const pal = PALETTES[ride.theme], h = TOPSPIN_PIVOT, arm = TOPSPIN_ARM;
  const fixed = new Parts(park, ride.pos, ride.yaw);
  const spindles: ParkPart[] = [];
  for (const side of [-1, 1]) {
    // Each tower is an A-frame in a plane outside the arms: two raked legs cast into footings meet in a
    // bearing housing; the fixed spindle runs from the housing inward into the turning arm hub.
    const x = side * TOPSPIN_TOWER_X, apex: Vec3 = [x, h, 0], legs = [];
    for (const z of [-3.5, 3.5]) {
      const at = legTop([x, PAVING_RISE, z], apex, TOPSPIN_LEG_RADIUS, [1, 0, 0]);
      const { leg, direction } = legInFooting(fixed, [x, PAVING_RISE, z], at, TOPSPIN_LEG_RADIUS, pal.secondary, `${ride.id}/topspin-leg/${side}/${z}`, {}, { color: CONCRETE, baseY: PAVING_RISE });
      legs.push({ part: leg, end: 1 as const, direction, radius: TOPSPIN_LEG_RADIUS, at });
    }
    const housing = apexHousing(fixed, apex, [1, 0, 0], legs, TOPSPIN_SPINDLE, pal.primary, `${ride.id}/topspin-tower/${side}`);
    const housingHalf = housing.half[1];
    const spindle = fixed.rod([side * (TOPSPIN_ARM_X - TOPSPIN_HUB.half + END_COVER), h, 0], apex, TOPSPIN_SPINDLE, METAL);
    insertEnd(park, housing, spindle, 1, `${ride.id}/topspin-spindle/${side}`, 'Fixed spindle is clamped in the tower bearing housing.');
    spindles.push(spindle);
    // Drive motor and gearbox bolt flat against the housing's outer face, on the spindle axis.
    fixed.box([x + side * (housingHalf + 0.4), h, 0], [0.4, 0.45, 0.45], METAL);
    // Control cabinet at the tower foot, between the legs and outside the arm envelope.
    const cabinetHalfX = TOPSPIN_TOWER_X - TOPSPIN_ENVELOPE_X - TOPSPIN_CLEARANCE;
    fixed.box([x, PAVING_RISE + 2.6, 0], [cabinetHalfX, 2.6, 0.7], pal.primary);
  }
  const rotor = new Parts(park, [0, 0, 0], 0, attachment(park, ride, 'rotor'));
  const armBearings = [];
  for (const x of [-TOPSPIN_ARM_X, TOPSPIN_ARM_X]) {
    const side = Math.sign(x);
    const hub = rotor.rod([x - TOPSPIN_HUB.half, 0, 0], [x + TOPSPIN_HUB.half, 0, 0], TOPSPIN_HUB.radius, pal.secondary);
    declareInterface(park, { name: `${ride.id}/topspin-main-bearing/${side}`, kind: 'coaxial', a: hub, b: spindles[side < 0 ? 0 : 1], rationale: 'The fixed spindle runs inside the turning arm hub on the main bearing.' });
    registerJoint(park, { name: `${ride.id}/topspin-main-pivot/${x}`, kind: 'hinge', a: partAnchor(spindles[side < 0 ? 0 : 1], yawPoint(ride.pos, ride.yaw, [x, h, 0]), [Math.cos(ride.yaw), 0, -Math.sin(ride.yaw)]), b: partAnchor(hub, [x, 0, 0], [1, 0, 0]), rationale: 'Driven arm hub surrounds the fixed tower spindle at its coaxial main bearing.' });
    // The arm box runs from just outside the spindle to just short of the gondola shaft; past the hub the arm runs on
    // to the counterweight disc and ends at its centre.
    const armTop = -(TOPSPIN_SPINDLE + END_COVER), armBottom = -arm + TOPSPIN_SHAFT + END_COVER;
    const armBox = rotor.box([x, (armTop + armBottom) / 2, 0], [TOPSPIN_ARM_BOX[0], (armTop - armBottom) / 2, TOPSPIN_ARM_BOX[1]], pal.primary);
    const W = TOPSPIN_COUNTERWEIGHT, stubBottom = TOPSPIN_SPINDLE + END_COVER, stubTop = W.centre;
    const weight = rotor.rod([x - W.half, W.centre, 0], [x + W.half, W.centre, 0], W.radius, pal.secondary);
    const stub = rotor.box([x, (stubBottom + stubTop) / 2, 0], [TOPSPIN_ARM_BOX[0], (stubTop - stubBottom) / 2, TOPSPIN_ARM_BOX[1]], pal.primary);
    const bearing = rotor.rod([x - TOPSPIN_ARM_END.half, -arm, 0], [x + TOPSPIN_ARM_END.half, -arm, 0], TOPSPIN_ARM_END.radius, METAL);
    armBearings.push(bearing);
    declareInterface(park, { name: `${ride.id}/topspin-arm-root/${side}`, kind: 'insert', a: hub, b: armBox, end: 1, axis: 1, rationale: 'Arm box is welded into the hub.' });
    declareInterface(park, { name: `${ride.id}/topspin-arm-tip/${side}`, kind: 'insert', a: bearing, b: armBox, end: -1, axis: 1, rationale: 'Arm box ends in the arm-end bearing housing.' });
    declareInterface(park, { name: `${ride.id}/topspin-stub-root/${side}`, kind: 'insert', a: hub, b: stub, end: -1, axis: 1, rationale: 'The arm extension is welded into the hub.' });
    declareInterface(park, { name: `${ride.id}/topspin-stub-weight/${side}`, kind: 'insert', a: weight, b: stub, end: 1, axis: 1, rationale: 'The arm extension ends at the centre of the counterweight disc.' });
  }
  const id = attachment(park, ride, 'gondola'), cabin = new Parts(park, [0, 0, 0], 0, id);
  // Floor plate and its welded grillage are one fabricated frame.
  const wallInner = TOPSPIN_END_WALL.x - TOPSPIN_END_WALL.half;
  const floor = cabin.box([0, -1.08, 0], [TOPSPIN_END_WALL.x, 0.1, 1.25], METAL), grillage = [floor];
  for (const z of [-0.9, 0, 0.9]) grillage.push(cabin.box([0, -1.2, z], [wallInner, 0.025, 0.065], pal.secondary));
  for (let x = -5.4; x <= 5.5; x += 1.2) grillage.push(cabin.box([x, -1.2, 0], [0.045, 0.025, 1.17], pal.secondary));
  declareMonolith(park, `${ride.id}/topspin-floor`, grillage, 'Gondola floor plate welded to its under-floor beam grid.');
  for (const side of [-1, 1]) {
    // End frames carry the floor and the outboard shafts that turn in the arm-end bearings.
    const top = 0.3, bottom = -1.25, wall = cabin.box([side * TOPSPIN_END_WALL.x, (top + bottom) / 2, 0], [TOPSPIN_END_WALL.half, (top - bottom) / 2, 1.3], pal.primary);
    declareInterface(park, { name: `${ride.id}/topspin-floor-end/${side}`, kind: 'insert', a: wall, b: floor, end: side as -1 | 1, axis: 0, rationale: 'Floor plate ends inside the gondola end frame.' });
    const pin = cabin.rod([side * TOPSPIN_END_WALL.x, 0, 0], [side * (TOPSPIN_ARM_X + 0.2), 0, 0], TOPSPIN_SHAFT, METAL);
    insertEnd(park, wall, pin, -1, `${ride.id}/topspin-shaft/${side}`, 'Gondola shaft is welded into the end frame.');
    declareInterface(park, { name: `${ride.id}/topspin-gondola-bearing/${side}`, kind: 'coaxial', a: armBearings[side < 0 ? 0 : 1], b: pin, rationale: 'Gondola shaft turns inside the arm-end bearing.' });
    registerJoint(park, { name: `${ride.id}/topspin-gondola/${side}`, kind: 'hinge', a: partAnchor(armBearings[side < 0 ? 0 : 1], [side * TOPSPIN_ARM_X, -arm, 0], [1, 0, 0]), b: partAnchor(pin, [side * TOPSPIN_ARM_X, 0, 0], [1, 0, 0]), rationale: 'Gondola end shafts and arm-end bearings remain coaxial through independent arm and cabin rotation.' });
  }
  for (let seat = 0; seat < 40; seat++) rideSeat(park, id, ride, [topSpinSeatX(seat), -0.85, seat < 20 ? -0.6 : 0.6], seat < 20 ? 0 : Math.PI, pal.primary, true, -0.98);
  // Edge lamps sit against the floor plate's side face.
  for (let x = -5.7; x <= 5.8; x += 0.6) cabin.sphere([x, -1.08, 1.25 + 0.045], 0.045, pal.accent, { solid: false, emissive: 0.025, detail: 1 });
  // Operator's booth standing on the paving, with a flat control desk on top.
  fixed.box([10, PAVING_RISE + 0.6, -2], [0.65, 0.6, 0.85], pal.secondary);
  fixed.box([10, PAVING_RISE + 1.2 + 0.08, -2], [0.5, 0.08, 0.55], METAL);
}

