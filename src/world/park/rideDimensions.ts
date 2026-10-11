/** Mechanical contact dimensions, metres; geometry and operating transforms share these values. */
export const RAIL = { halfGauge: 0.71, radius: 0.085, spineRadius: 0.22, spineOffset: 0.65, loadRadius: 0.19, upstopRadius: 0.12, guideRadius: 0.12, loadHalfWidth: 0.13, tieRadius: 0.055, tieWheelClearance: 0.03, guideBracketClearance: 0.01, bracketHalf: 0.045, chordError: 0.005 } as const;
/** Parts that sit on the cross tie. Their half height equals the tie rod radius, so a timber tie top meets their underside flush. */
export const TIE_FITTING = { blockHalfLateral: 0.08, blockHalfAlong: 0.08, brakePadHalfLateral: 0.32, chainRadius: 0.05, collarHalfSection: 0.08, collarHalfLength: 0.07 } as const;
/** Timber track, measured from the rail centreline along the track's up axis: a steel tie rod rests on a timber tie, which rests on two laminated stringers. */
export const TIMBER = { tieHalfWidth: 0.62, tieHalfHeight: 0.1, tieHalfLength: 0.13, stringerOffset: 0.47, stringerHalfWidth: 0.11, stringerHalfHeight: 0.37, postRadius: 0.17, crossheadRadius: 0.14, braceRadius: 0.11 } as const;
export const TIMBER_TIE_TOP = -RAIL.tieRadius;
export const TIMBER_STRINGER_TOP = TIMBER_TIE_TOP - 2 * TIMBER.tieHalfHeight;
export const TIMBER_STRINGER_BOTTOM = TIMBER_STRINGER_TOP - 2 * TIMBER.stringerHalfHeight;
/** Steel bents: columns carry a crosshead; a neck rod joins it to the backbone (or a hanger from an overhead portal). */
export const SUPPORT = { crossheadRadius: 0.19, neckRadius: 0.13, neckLength: 0.3, columnMin: 0.22, columnMax: 0.46, footingTop: 12.4, footingBottom: 11.9, edgeMargin: 0.04 } as const;
/** Service catwalk beside the lift and brake runs. Heights are above the deck's top face. */
export const WALKWAY = { offset: 2.3, drop: 0.28, halfWidth: 0.5, halfThick: 0.055, postRadius: 0.05, railRadius: 0.03, toeRadius: 0.04, topRailHeight: 1.065, midRailHeight: 0.545, toeHeight: 0.09, postInset: 0.1, bracketRadius: 0.07, cleatHalf: [0.12, 0.1, 0.1] } as const;
/** Loading station in its own frame: x across (away from the track), y up from the deck's top face, z along the track.
 * The roof stands on columns beside the deck; each column's top plugs into a cross beam that bears on the roof slab from below. */
export const STATION = { deckHalfWidth: 2, deckHalfLength: 13, deckHalfThick: 0.35, roofCentreX: -1.2, roofCentreY: 5.1, roofHalfWidth: 4.2, roofHalfThick: 0.25, roofHalfLength: 15,
  columnX: 2.4, columnZ: [-12, 0, 12], columnRadius: 0.17, columnFootingHalf: 0.4, columnFootingThick: 0.5,
  deckLegX: 1.62, deckLegZ: 11, deckLegRadius: 0.15, deckFootingHalf: 0.45, deckFootingThick: 0.36,
  beamHalfThick: 0.12, beamHalfDepth: 0.2, edgeBeamX: [-4.85, 1.8], edgeBeamHalfWidth: 0.095, kneeBraceRadius: 0.085, kneeBraceRise: 0.95, lampX: [-1.6, -0.2, 0.9], lampRadius: 0.055, lampHeight: 0.2,
  stairHalfWidth: 1.4, going: 0.35,
  guardX: 1.92, guardPostRadius: 0.04, guardRailRadius: 0.035, guardPostSpacing: 4, guardHeights: [0.58, 1.1] } as const;
/** The car floor deck: its top face is the boarding floor and its mid-plane is where each bogie's kingpin ends. */
export const COASTER_FLOOR = 0.67;
export const COASTER_DECK = 0.045;
export const COASTER_BOGIE_PIVOT = COASTER_FLOOR - COASTER_DECK / 2;
/** Suspended trains carry their coupler spine below the rails, clear of the overhead backbone; the kingpin ends at that spine's mid-height. */
export const SUSPENDED_BOGIE_PIVOT = 0.38;
export function coasterBogiePivot(family: string): number { return family === 'inverted' ? -SUSPENDED_BOGIE_PIVOT : COASTER_BOGIE_PIVOT; }
export function coasterCouplerPin(carLength: number): number { return carLength * 0.4; }
export function coasterCouplerLength(carLength: number): number { return carLength * 0.2; }
export function coasterCouplerHeight(family: string): number { return family === 'inverted' ? -0.38 : 0.35; }
export function coasterWheelbase(carLength: number): number { return carLength * 0.64; }
export const COASTER_HALF_WIDTH = RAIL.halfGauge + RAIL.radius + 2 * RAIL.guideRadius + RAIL.guideBracketClearance + 2 * RAIL.bracketHalf;
export const COASTER_SEAT = 1.12;
export function coasterSeatHeight(family: string): number { return family === 'inverted' ? -1.5 : COASTER_SEAT; }
export const SEAT_PAN = 0.19;
export const SWING_CHAIN = 5;
export const SWING_ANCHOR = 0.72;
export const CAROUSEL_MOUNT = 1.75;
/** Jumping horses, from the Tilden Park carousel maintenance manual (Herschell-Spillman, c. 1911) quoted in
 * docs/park-construction-sources.md: the crank's 5 in throws raise the figures 10 in, and the crank gears turn 4 1/3 times
 * per platform turn. Each horse rides CAROUSEL_STROKE / 2 either side of CAROUSEL_MOUNT. */
export const CAROUSEL_STROKE = 10 * 0.0254, CAROUSEL_BOBS = 13 / 3;
/** Height of carousel horse `index` (of 16) above its mount for platform angle `theta`; neighbouring throws are set 3/16 turn apart. */
export function carouselLift(theta: number, index: number): number { return CAROUSEL_STROKE / 2 * Math.sin(CAROUSEL_BOBS * theta + 3 * index * Math.PI * 2 / 16); }
/** Carousel structure from the same manual and the Dentzel glossary (docs/park-construction-sources.md): a flat roller
 * thrust bearing on top of the fixed centre pole carries the whole turning machine; the sweeps radiate from it; the
 * platform hangs from the sweeps on two drop rods each; a cheese bearing lower down keeps it centred; each jumper pole
 * hangs from its crank and passes through a high hat on the platform. Sizes are assumed. Heights are ride-local metres:
 * the ceiling (sweeps and their boards) is centred at `ceilingY`; the pole top and crown stand `crownLift` above it, inside the
 * roof; drop rods stand at these fractions of the ride radius. */
export const CAROUSEL = { ceilingY: 5.5, ceilingHalf: 0.35, crownHalf: 0.2, crownLift: 0.05, hatTop: 1.15, hatRadius: 0.07, dropRods: [0.4, 0.875], dropRodRadius: 0.04 } as const;
/** The jumper pole passes through the horse's withers, this far ahead of the saddle centre, so it rises in front of the rider
 * instead of through them (clearance measured against the seated guest by guestHorse.test.ts). */
export const CAROUSEL_WITHERS = 0.22;
/** Swinging ship benches: 8 rows of 2, all facing +x, either side of the centre line. The row pitch keeps the front row's
 * leg room clear of the solid bow, which starts about 5.5 m from the centre at foot height (guestRide.test.ts measures it). */
export const SHIP_ROW_PITCH = 1.3;
/** Ship bulwarks: centre plane either side of the hull and half thickness. They are the outermost swinging parts across the
 * hull, so the fixed landing stands a running clearance outside them. */
export const SHIP_BULWARK = { z: 2.1, half: 0.16 } as const, SHIP_LANDING_GAP = 0.05;
export function shipSeat(seat: number): [number, number] { return [(Math.floor(seat / 2) - 3.5) * SHIP_ROW_PITCH, seat % 2 ? 0.9 : -0.9]; }
export const WHEEL_CABIN_HALF_Z = 1.25;
export const WHEEL_FLOOR_HALF_Z = 1.1;
export const WHEEL_RIM_RADIUS = 0.18;
export const WHEEL_SPOKE_RADIUS = 0.12;
export const WHEEL_RUNNING_CLEARANCE = 0.12;
/** Cabin bearing boss on the rim: long and wide enough to hold the rim tube ends and the spoke end that meet in it. */
export const WHEEL_BEARING_HALF = WHEEL_RIM_RADIUS + 0.02;
export const WHEEL_BEARING_RADIUS = WHEEL_RIM_RADIUS + 0.07;
export const WHEEL_SUPPORT_RADIUS = 0.65;
export const WHEEL_HUB_RADIUS = 1.05;
export const WHEEL_RIM_Z = WHEEL_CABIN_HALF_Z + Math.max(WHEEL_RIM_RADIUS, WHEEL_BEARING_HALF) + WHEEL_RUNNING_CLEARANCE;
export const WHEEL_PIN_Z = WHEEL_RIM_Z + WHEEL_BEARING_HALF + 0.06;
/** Fixed bearing housing at each A-frame apex: holds the leg ends (radius + 50 mm wall). */
export const WHEEL_HOUSING_HALF = WHEEL_SUPPORT_RADIUS + 0.05;
/** Apex plane: the housing stands a running clearance outside every turning pin, bearing and rim. */
export const WHEEL_SUPPORT_Z = Math.max(WHEEL_PIN_Z, WHEEL_RIM_Z + WHEEL_BEARING_RADIUS) + WHEEL_HOUSING_HALF + WHEEL_RUNNING_CLEARANCE;
export const WHEEL_HINGE = 1.5;
export const WHEEL_FLOOR = -0.6;
export const WHEEL_SEAT = -0.3;
/** Teacups, built as the Disney patent, Technical Park and the Zamperla listing describe (docs/park-construction-sources.md):
 * the large turntable carries smaller turntables, each with its cups, and every cup turns on its own bearing. Sizes and turning
 * directions are not in the sources and are chosen here. Heights are ride-local metres; the main turntable top is 0.8.
 * On the 12 m ride a cup's handle sweeps 1.83 m round its centre, so the two cups on a table clear each other by 0.34 m,
 * the tables' sweeps clear each other by 2.7 m, and the outermost cup stays 1 m inside the main turntable edge. */
export const TEACUPS = {
  /** Small turntables: count, centre as a fraction of the ride radius, disc radius, and disc underside and top. */
  tables: 3, tableReach: 0.5, tableRadius: 3.5, tableBottom: 0.86, tableTop: 0.96,
  /** Cups per small turntable, their centres' distance from the table centre, and the table's turn against the main turntable. */
  cupsPerTable: 2, cupOffset: 2, tableRate: -1.8,
  /** In the cup frame: wall centre radius and half thickness, floor top, and the four seats' radius and height. */
  wallRadius: 1.28, wallHalf: 0.08, floorTop: 0.2, seatRadius: 0.75, seatY: 0.34,
  /** The bearing pin under each cup stands this far above the table, and the cup's thrust plate is this thick. */
  pin: 0.02, plate: 0.07,
} as const;
export const TEACUP_BASE = TEACUPS.tableTop + TEACUPS.pin + TEACUPS.plate;
/** Seat `seat % 4` of a cup sits at this angle round the cup, clear of the door at +z (90 degrees). */
export function teacupSeatAngle(seat: number): number { return (seat % 4 + 0.5) * Math.PI / 2; }
export const TOWER_APERTURE = 3.4;
