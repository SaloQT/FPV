import type { ProgressFn, TerrainData, TerrainSampler, TrackData, Vec3 } from '../../contracts';
import { createTerrainSampler } from '../terrain/sampler';
import { Rng, deriveSeed } from '../track/rng';
import { compileCurve, railSample, sampleRail, CURVE_STRIDE } from './curve';
import { add, axisAngle, basisQuat, clamp, cross, distance, mul, sub, TAU, yawPoint } from './math';
import { Parts, CONCRETE, METAL, RUBBER, carParts, carouselHorse, luminaire, markRideParts, NON_METAL_SURFACES, rideSeat } from './parts';
import { ENTERPRISE_DECK, enterpriseAssets, enterpriseBase, topSpinAssets } from './newFlatAssets';
import { ENTERPRISE_BASE_TOP, SCRAMBLER, TOPSPIN_ARM, TOPSPIN_PIVOT, TOPSPIN_PLATFORM_DROP } from './flatPhysics';
import { defaultParkRecipe, PALETTES, PARK_PRESETS, sanitizeParkRecipe } from './recipe';
import { COASTER_FAMILIES, FLAT_FAMILIES, PARK_LAYOUTS, PARK_THEMES, type CoasterFamily, type ParkData, type ParkPart, type ParkRecipe, type RideDefinition, type RideFamily } from './types';
import { preflightCoaster } from './ridePhysics';
import { coasterLayout } from './coasterLayout';
import { buildSupportBent, coasterSupportFrame, coasterSupportStations, coasterTieStations } from './coasterSupports';
import { coasterStationDetails, coasterStationObstacles, coasterWalkway, spaceShowFootprint, type WalkwayStation } from './coasterAccess';
import { STATION, SUPPORT, TIE_FITTING, TIMBER, TIMBER_STRINGER_TOP, TIMBER_TIE_TOP } from './rideDimensions';
import { attractionScenery, decoratePublicRealm, themedBuilding, sign } from './theme';
import { routeParkPaths } from './navigation';
import { buildDistrictArchitecture, districtFlatPose, paveRideAccess, plantDistrictCanopies, planParkDistricts } from './districts';
import { finalizeParkPlantings } from './planting';
import { buildRaceCourse } from './raceCourse';
import { registerBuiltRails } from './railTube';
import { annularDeck, trackTubePoints, weldedBeam, weldedTube } from './rideGeometry';
import { CAROUSEL, CAROUSEL_MOUNT, SHIP_BULWARK, SHIP_LANDING_GAP, shipSeat, CAROUSEL_STROKE, TEACUPS, teacupSeatAngle, coasterCouplerHeight, coasterCouplerLength, coasterCouplerPin, COASTER_FLOOR, COASTER_HALF_WIDTH, RAIL, SWING_CHAIN, SWING_ANCHOR, WHEEL_RIM_Z, WHEEL_CABIN_HALF_Z, WHEEL_FLOOR_HALF_Z, WHEEL_RIM_RADIUS, WHEEL_SPOKE_RADIUS, WHEEL_BEARING_HALF, WHEEL_BEARING_RADIUS, WHEEL_HOUSING_HALF, WHEEL_SUPPORT_RADIUS, WHEEL_HUB_RADIUS, WHEEL_PIN_Z, WHEEL_SUPPORT_Z, WHEEL_HINGE, WHEEL_FLOOR, WHEEL_SEAT, TOWER_APERTURE, TEACUP_BASE } from './rideDimensions';
import { declareInterface, declareMonolith, insertEnd, partAnchor, registerJoint } from './construction';
import { apexHousing, END_COVER, guardFence, legInFooting, legTop, memberBetween, STAIR_MAX_RISER, stairFlight } from './assembly';
import { PAVING_RISE, PAVING_TOP } from './surfaces';
import { buildPublicKerbs, PARK_GRADE, surfaceStrip } from './surfaces';
import { unionPublicPaving } from './pavingUnion';
import { entranceFrame, furnitureClearance, parkBench } from './furniture';

const NAMES: Record<RideFamily, string> = { steel: 'Vortex', launch: 'Velocity', inverted: 'Sky Talon', wooden: 'Timber Run', hyper: 'Horizon', mine: 'Lost Mine', space: 'Stellar Mountain', wheel: 'Sky Wheel', carousel: 'Grand Carousel', swings: 'Star Flyers', ship: 'Corsair', pendulum: 'Cyclone', drop: 'Freefall', teacups: 'Whirling Cups', scrambler: 'Orbit', observation: 'Panorama', enterprise: 'Solar Enterprise', topspin: 'Tidal Force' };

/** Only park-owned terrain is edited. The fixed grid is shared by every quality tier. */
export function gradeParkTerrain(source: TerrainData, recipe: ParkRecipe): TerrainData {
  const terrain: TerrainData = { ...source, height: source.height.slice(), maps: { soil: source.maps.soil.slice(), flow: source.maps.flow.slice(), deposit: source.maps.deposit.slice(), wetness: source.maps.wetness.slice() } };
  const r = PARK_PRESETS[recipe.size].radius + 225;
  let lo = Infinity, hi = -Infinity;
  for (let z = 0; z < terrain.resolution; z++) for (let x = 0; x < terrain.resolution; x++) {
    const wx = terrain.origin[0] + x * terrain.cellSize, wz = terrain.origin[1] + z * terrain.cellSize;
    const d = Math.hypot(wx, wz), t = Math.max(0, Math.min(1, (d - r) / 90));
    const f = t * t * (3 - 2 * t), i = z * terrain.resolution + x;
    terrain.height[i] = PARK_GRADE + (terrain.height[i] - PARK_GRADE) * f;
    if (f < 1) { terrain.maps.flow[i] *= f; terrain.maps.wetness[i] *= f; terrain.maps.soil[i] = Math.max(0.45, terrain.maps.soil[i]); }
    lo = Math.min(lo, terrain.height[i]); hi = Math.max(hi, terrain.height[i]);
  }
  terrain.minHeight = lo; terrain.maxHeight = hi; terrain.waterLevel = -Infinity;
  return terrain;
}


function node(park: ParkData, pos: Vec3, kind: ParkData['nodes'][number]['kind'] = 'path'): number { park.nodes.push({ pos, links: [], kind }); return park.nodes.length - 1; }
function connect(park: ParkData, a: number, b: number, width = 8): void { park.nodes[a].links.push(b); park.nodes[b].links.push(a); park.paths.push({ a, b, width }); }
function body(park: ParkData, ride: RideDefinition, role: ParkData['bodies'][number]['role'], index: number, local: Vec3 = [0, 0, 0], train = 0): number {
  const id = park.bodies.length; park.bodies.push({ ride: ride.id, role, index, local, train }); ride.bodies.push(id); return id;
}

function coasterAssets(park: ParkData, ride: RideDefinition): void {
  const structureStart = park.parts.length;
  const curve = ride.curve!, pal = PALETTES[ride.theme], b = new Parts(park, [0, 0, 0], 0, -1, 'ride'), s = railSample();
  const wood = ride.family === 'wooden', inverted = ride.family === 'inverted', railColor = wood ? METAL : pal.primary;
  // The loading station's frame is worked out first so support bents can keep clear of its legs, stair run and roof.
  const platformArc = curve.stationEnd - 6 - ride.carLength * 2;
  sampleRail(curve, platformArc, s);
  const stationRight = cross(s.tangent, s.up), stationYaw = Math.atan2(-s.tangent[0], -s.tangent[2]);
  const platform = add(s.pos, mul(stationRight, 3.3)); platform[1] = s.pos[1] + (inverted ? -2.6 : COASTER_FLOOR);
  const rise = platform[1] - PAVING_TOP, steps = Math.max(1, Math.ceil(rise / STAIR_MAX_RISER - 1e-9)), stairRun = steps * STATION.going;
  const supportStations = coasterSupportStations(curve, inverted, wood, coasterStationObstacles(platform, stationYaw, rise, steps, inverted));
  const tubeStations: number[] = [], tubePoints = trackTubePoints(curve, inverted, tubeStations);
  registerBuiltRails(curve, tubeStations, tubePoints);
  const runningRails = [weldedTube(b, tubePoints[0], RAIL.radius, railColor, `${ride.id}/left-rail`), weldedTube(b, tubePoints[1], RAIL.radius, railColor, `${ride.id}/right-rail`)];
  const spines = wood ? null : weldedTube(b, tubePoints[2], RAIL.spineRadius, pal.secondary, `${ride.id}/spine`);
  const step = 1.5, tieAts = coasterTieStations(curve.length, supportStations, step);
  // The loading platform (13 m either side of the stopping point) and its stair run behind it keep the catwalk and lift fittings out.
  const onPlatform = (at: number) => { let q = (at - platformArc) % curve.length; if (q > curve.length / 2) q -= curve.length; else if (q < -curve.length / 2) q += curve.length; return q > -(STATION.deckHalfLength + stairRun + 2) && q < STATION.deckHalfLength + 2; };
  // Where the backbone's centre is at `at`, nudged along the track to stay clear of the joints between its straight lengths, so every member
  // that ends there has its whole end section inside a single length of tube.
  const anchorSample = railSample(), anchorMargin = 0.2;
  const spineAnchorAt = (at: number): Vec3 => {
    let k = tubeStations.length - 1; while (k > 0 && tubeStations[k] > at) k--;
    const lo = tubeStations[k], hi = k + 1 < tubeStations.length ? tubeStations[k + 1] : curve.length;
    // A length too short to keep the margin from both joints is used at its middle, as far from them as it gets.
    sampleRail(curve, hi - lo > 2 * anchorMargin ? clamp(at, lo + anchorMargin, hi - anchorMargin) : (lo + hi) / 2, anchorSample);
    return add(anchorSample.pos, mul(anchorSample.up, inverted ? RAIL.spineOffset : -RAIL.spineOffset));
  };
  interface Tie { at: number; p: Vec3; r: Vec3; up: Vec3; t: Vec3; spine: Vec3; segment: number; tie: ParkPart }
  const ties: Tie[] = [];
  let tubeSegment = 0;
  // Cross ties: a steel rod from rail centreline to rail centreline. Each end lies inside its running rail; the whole
  // end section fits because the rod is thinner than the rail tube.
  for (const nominal of tieAts) {
    while (tubeSegment + 1 < tubeStations.length && tubeStations[tubeSegment + 1] <= nominal) tubeSegment++;
    // A tie never sits on a joint between two straight lengths of the rail tube: it is slid 30 mm along the track to the inside of the length.
    const lo = tubeStations[tubeSegment], hi = tubeSegment + 1 < tubeStations.length ? tubeStations[tubeSegment + 1] : curve.length, clearance = 0.03;
    const at = hi - lo > 2 * clearance ? clamp(nominal, lo + clearance, hi - clearance) : (lo + hi) / 2;
    sampleRail(curve, at, s);
    const p: Vec3 = [...s.pos], up: Vec3 = [...s.up], t: Vec3 = [...s.tangent], r = cross(t, up);
    const railCenters = [-RAIL.halfGauge, RAIL.halfGauge].map(x => add(p, mul(r, x)));
    const tie = b.rod(railCenters[0], railCenters[1], RAIL.tieRadius, pal.secondary, { detail: 1 });
    for (let side = 0; side < 2; side++) {
      insertEnd(park, runningRails[side][0], tie, side ? 1 : -1, `${ride.id}/tie-rail`, 'The cross tie runs into the running rail; the tie is thinner than the rail tube, so its whole end section is inside the rail.');
      registerJoint(park, { name: `${ride.id}/rail-tie/${at}/${side}`, kind: 'fixed', a: partAnchor(runningRails[side][tubeSegment], railCenters[side]), b: partAnchor(tie, railCenters[side]), rationale: 'Transverse tie end enters the running tube centreline as a welded fishmouth proxy; load and up-stop tyres retain 30 mm vertical clearance.' });
    }
    ties.push({ at, p, r, up, t, spine: wood ? p : spineAnchorAt(at), segment: tubeSegment, tie });
  }
  const frameOf = (k: Tie) => basisQuat(k.r, k.up, mul(k.t, -1));
  let stringers: ParkPart[][] = [];
  if (wood) {
    // The tie rod rests on a timber tie, which rests flush on two laminated stringers that bend through the curves.
    for (const k of ties) b.box(add(k.p, mul(k.up, TIMBER_TIE_TOP - TIMBER.tieHalfHeight)), [TIMBER.tieHalfWidth, TIMBER.tieHalfHeight, TIMBER.tieHalfLength], pal.timber, { surface: 'timber', rot: frameOf(k), detail: 1 });
    stringers = [-1, 1].map(side => weldedBeam(b, ties.map(k => ({ pos: add(k.p, add(mul(k.r, side * TIMBER.stringerOffset), mul(k.up, TIMBER_STRINGER_TOP - TIMBER.stringerHalfHeight))), right: k.r, up: k.up, tangent: k.t })),
      [TIMBER.stringerHalfWidth, TIMBER.stringerHalfHeight], pal.timber, `${ride.id}/stringer/${side}`, { surface: 'timber' }));
  } else {
    // Diagonal braces end inboard of the load-wheel width; extending one to the rail would cut through the tyre. Each brace
    // enters the tie at one end and the backbone at the other; the brace is as thick as the tie, so its end section fits the tie.
    const braceX = RAIL.halfGauge - RAIL.loadHalfWidth - RAIL.tieRadius - RAIL.tieWheelClearance;
    ties.forEach((k, index) => {
      for (const side of [-1, 1]) {
        const foot = add(k.p, mul(k.r, side * braceX)), brace = b.rod(foot, k.spine, RAIL.tieRadius, pal.secondary, { detail: 1 });
        insertEnd(park, k.tie, brace, -1, `${ride.id}/brace-tie`, 'The diagonal brace is welded to the tie; brace and tie have the same radius, so its whole end section lies inside the tie.');
        insertEnd(park, spines![0], brace, 1, `${ride.id}/brace-spine`, 'The diagonal brace runs into the backbone tube; its whole end section lies inside.');
        registerJoint(park, { name: `${ride.id}/tie-brace/${k.at}/${side}`, kind: 'fixed', a: partAnchor(k.tie, foot), b: partAnchor(brace, foot), rationale: 'Inboard diagonal braces weld to the transverse tie before the moving roller envelope.' });
        if (index % 8 === 0) {
          // A reinforcing sleeve around the tie at the brace foot, sized from the brace and the tie.
          const collar = b.box(foot, [TIE_FITTING.collarHalfLength, TIE_FITTING.collarHalfSection, TIE_FITTING.collarHalfSection], METAL, { rot: frameOf(k), detail: 1 });
          declareInterface(park, { name: `${ride.id}/tie-collar`, kind: 'coaxial', a: collar, b: k.tie, rationale: 'The tie runs through the reinforcing sleeve on the same axis.' });
          insertEnd(park, collar, brace, -1, `${ride.id}/brace-collar`, 'The brace foot is also inside the reinforcing sleeve, which is wider than the brace end.');
        }
      }
    });
  }
  // Lift chain: rods laid along the track between saddle blocks on the ties, each block wrapping its tie coaxially.
  // Brake runs carry a wider pad on each tie. The blocks are as tall as the tie is thick, so they sit flush on a timber tie.
  const fittingBox = (k: Tie, halfLateral: number) => {
    const block = b.box(k.p, [halfLateral, RAIL.tieRadius, TIE_FITTING.blockHalfAlong], METAL, { rot: frameOf(k), detail: 1 });
    declareInterface(park, { name: `${ride.id}/tie-saddle`, kind: 'coaxial', a: block, b: k.tie, rationale: 'The tie runs through the saddle block on the same axis.' });
    return block;
  };
  let previousBlock: { block: ParkPart; k: Tie } | null = null;
  for (const k of ties) {
    if (k.at >= curve.stationEnd && k.at < curve.liftEnd && !onPlatform(k.at)) {
      const block = fittingBox(k, TIE_FITTING.blockHalfLateral);
      if (previousBlock) {
        const chain = b.rod(previousBlock.k.p, k.p, TIE_FITTING.chainRadius, METAL, { detail: 1 });
        for (const [end, receivers] of [[-1, [previousBlock.block, previousBlock.k.tie]], [1, [block, k.tie]]] as const) for (const receiver of receivers)
          insertEnd(park, receiver, chain, end, `${ride.id}/chain-end`, 'The chain rod ends in the saddle block on the tie, and so inside the tie it passes.');
      }
      previousBlock = { block, k };
    } else previousBlock = null;
    if (k.at > curve.brakeStart && !onPlatform(k.at)) fittingBox(k, TIE_FITTING.brakePadHalfLateral);
  }
  // Support bents.
  let previousBent: ReturnType<typeof buildSupportBent> | null = null, previousAt = 0;
  for (const k of ties) {
    if (!supportStations.has(k.at)) continue;
    sampleRail(curve, k.at, s);
    const frame = coasterSupportFrame(s, inverted, supportStations.get(k.at)!, wood);
    const bent = buildSupportBent(park, b, frame, { id: `${ride.id}/bent`, wooden: wood, color: wood ? pal.timber : pal.secondary, timberFinish: wood, floor: ride.family === 'space' ? 12 : SUPPORT.footingBottom,
      backbone: spines ? { receiver: spines[0], centre: k.spine } : undefined });
    // Sway braces only join bents that stand next to each other: a bent that was left out breaks the chain.
    const spacing = previousBent ? Math.abs(k.at - previousAt) : Infinity;
    if (wood && previousBent && Math.min(spacing, curve.length - spacing) <= 9) for (let side = 0; side < 2; side++) {
      // Sway braces tie each column to its neighbour's: low on the earlier bent, high on this one, ending inside both columns.
      const low = previousBent.legs[side], high = bent.legs[side];
      const at = (leg: { foot: Vec3; top: Vec3 }, along: number) => add(leg.foot, mul(sub(leg.top, leg.foot), along));
      const lowAlong = clamp(0.8 / distance(low.foot, low.top), 0.1, 0.3), highAlong = 1 - clamp(1 / distance(high.foot, high.top), 0.1, 0.3);
      const brace = b.rod(at(low, lowAlong), at(high, highAlong), TIMBER.braceRadius, pal.timber, { surface: 'timber' });
      insertEnd(park, previousBent.columns[side], brace, -1, `${ride.id}/sway-brace`, 'The sway brace is bolted into the earlier column; its whole end section lies inside.');
      insertEnd(park, bent.columns[side], brace, 1, `${ride.id}/sway-brace`, 'The sway brace is bolted into this column; its whole end section lies inside.');
    }
    previousBent = bent; previousAt = k.at;
  }
  // Catwalk beside the lift and brake runs, in runs of consecutive ties (never across the station platform).
  let run: WalkwayStation[] = [], sinceBracket = 0;
  const flush = () => { coasterWalkway(park, b, `${ride.id}/catwalk`, run, inverted); run = []; sinceBracket = 0; };
  // A bracket root never lands within a metre of a support bent, whose neck or hanger enters the backbone at the same place.
  const nearBent = (at: number) => [...supportStations.keys()].some(bentAt => { const gap = Math.abs(at - bentAt); return Math.min(gap, curve.length - gap) < 1; });
  // The circuit is closed, so the walk starts at the first tie after a break and runs once round: a run that crosses the seam between the last tie and the first stays one run.
  const walked = (k: Tie) => (k.at < curve.liftEnd || k.at > curve.brakeStart) && !onPlatform(k.at);
  const firstWalked = Math.max(0, ties.findIndex((k, i) => walked(k) && !walked(ties[(i + ties.length - 1) % ties.length])));
  for (let n = 0; n < ties.length; n++) {
    const k = ties[(firstWalked + n) % ties.length];
    if (walked(k)) {
      // The bracket starts a quarter of a tie spacing behind the tie, where no diagonal brace enters the backbone.
      let bracket: WalkwayStation['bracket'];
      const wrapped = (k.at - step / 4 + curve.length) % curve.length;
      if ((run.length === 0 || sinceBracket >= 2) && !nearBent(wrapped)) {
        sinceBracket = 0;
        sampleRail(curve, wrapped, s);
        const up: Vec3 = [...s.up], right = cross(s.tangent, s.up);
        bracket = wood ? { receiver: stringers[1][0], root: add(s.pos, add(mul(right, TIMBER.stringerOffset), mul(up, TIMBER_STRINGER_TOP - TIMBER.stringerHalfHeight))) }
          : { receiver: spines![0], root: spineAnchorAt(wrapped) };
      }
      sinceBracket++;
      run.push({ pos: k.p, right: k.r, up: k.up, tangent: k.t, bracket });
    } else flush();
  }
  flush();
  for (let train = 0; train < ride.trains; train++) {
    const mounts = Array.from({ length: ride.cars }, (_, i) => carParts(park, body(park, ride, 'car', i, [0, 0, 0], train), ride, pal.primary));
    const length = coasterCouplerLength(ride.carLength), pinY = coasterCouplerHeight(ride.family), pinZ = coasterCouplerPin(ride.carLength);
    for (let i = 1; i < ride.cars; i++) {
      const link = new Parts(park, [0, 0, 0], 0, body(park, ride, 'coupler', i, [0, 0, 0], train), 'ride');
      // The drawbar ends sit at the centres of the two cars' socket balls, which are wider than the bar.
      const drawbar = link.rod([0, -length / 2, 0], [0, length / 2, 0], 0.06, METAL);
      insertEnd(park, mounts[i - 1][1], drawbar, -1, `${ride.id}/drawbar-front/${train}/${i}`, 'The drawbar front end sits in the leading car\'s rear socket ball.');
      insertEnd(park, mounts[i][0], drawbar, 1, `${ride.id}/drawbar-rear/${train}/${i}`, 'The drawbar rear end sits in the following car\'s front socket ball.');
      registerJoint(park, { name: `${ride.id}/drawbar-front/${train}/${i}`, kind: 'fixed', a: partAnchor(mounts[i - 1][1], [0, pinY, pinZ]), b: partAnchor(drawbar, [0, -length / 2, 0]), rationale: 'Fixed-length drawbar front ball shares the leading car rear socket; spherical axes remain free.' });
      registerJoint(park, { name: `${ride.id}/drawbar-rear/${train}/${i}`, kind: 'fixed', a: partAnchor(mounts[i][0], [0, pinY, -pinZ]), b: partAnchor(drawbar, [0, length / 2, 0]), rationale: 'Fixed-length drawbar rear ball shares the following car front socket; trailing rail position is solved from this distance constraint.' });
    }
  }
  // The standard loading deck meets the car floor; inverted floors continue beneath the hanging seats.
  const sb = new Parts(park, platform, stationYaw, -1, 'ride');
  const stationDeck = sb.box([0, -STATION.deckHalfThick, 0], [STATION.deckHalfWidth, STATION.deckHalfThick, STATION.deckHalfLength], pal.ground, { metalness: 0, roughness: 0.85, surface: 'concrete' });
  if (inverted) {
    const underSeat = sb.box([-3.4, -0.35, 0], [1.4, 0.35, 13], pal.ground, { metalness: 0, roughness: 0.85, surface: 'concrete' });
    const seam = yawPoint(platform, stationYaw, [-2, -0.35, 0]);
    registerJoint(park, { name: `${ride.id}/station-under-seat`, kind: 'fixed', a: partAnchor(stationDeck, seam), b: partAnchor(underSeat, seam), rationale: 'Suspended loading floor continues beneath both seat rows without an unsupported lateral boarding gap.' });
  } else {
    const movingEdge = COASTER_HALF_WIDTH, clearance = 0.05, inner = movingEdge + clearance - 3.3;
    const sill = sb.box([(inner - 2) / 2, -0.09, 0], [(-2 - inner) / 2, 0.09, 12.6], METAL);
    const seam = yawPoint(platform, stationYaw, [-2, -0.09, 0]);
    registerJoint(park, { name: `${ride.id}/station-loading-sill`, kind: 'fixed', a: partAnchor(stationDeck, seam), b: partAnchor(sill, seam), rationale: 'Cantilever loading sill joins the fixed platform and stops 50 mm outside the moving car side envelope.' });
  }
  coasterStationDetails(park, ride, platform, stationYaw, rise, steps);
  ride.boarding = [yawPoint(platform, stationYaw, [0, -rise, STATION.deckHalfLength + stairRun]), yawPoint(platform, stationYaw, [0, 0, 12]), yawPoint(platform, stationYaw, [0, 0, 0])];
  if (ride.family === 'space') {
    // Concealed show machinery stays black regardless of the district's exterior theme.
    for (let i = structureStart; i < park.parts.length; i++) {
      const part = park.parts[i];
      if (part.body < 0 && part.emissive === 0) { part.color = [0.006, 0.008, 0.011]; part.roughness = 0.9; part.metalness = NON_METAL_SURFACES.has(part.surface) ? 0 : 0.02; }
    }
    const enclosureStart = park.parts.length;
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < curve.count; i++) for (let k = 0; k < 3; k++) { const v = curve.samples[i * CURVE_STRIDE + k]; min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v); }
    const footprint = spaceShowFootprint(park, ride, min, max);
    for (let k = 0; k < 3; k++) { min[k] = footprint.min[k]; max[k] = footprint.max[k]; } min[1] = 12; max[1] += 8;
    const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const half: Vec3 = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2];
    // The show building stands on a floor slab whose top face is the ground level (12). Its walls stand on the slab and carry the roof slab,
    // which is as wide as the walls' outer faces. A side wall's end runs into the front or back wall that closes it, and every wall top runs into the roof.
    const shell: Vec3 = [0.004, 0.005, 0.008], roofBottom = max[1] - 0.35, wallEnd = (receiver: ParkPart, wall: ParkPart, end: -1 | 1, axis: 0 | 1 | 2, name: string, rationale: string) =>
      declareInterface(park, { name: `${ride.id}/${name}`, kind: 'insert', a: receiver, b: wall, end, axis, rationale });
    b.box([center[0], 11.95, center[2]], [half[0] + 0.35, 0.05, half[2] + 0.35], [0.004, 0.006, 0.009], { metalness: 0, roughness: 0.96 });
    const roof = b.box([center[0], max[1], center[2]], [half[0] + 0.35, 0.35, half[2] + 0.35], shell, { roughness: 0.96 });
    const sideWalls = [-1, 1].map(side => b.box([center[0] + side * half[0], center[1], center[2]], [0.35, half[1], half[2]], shell, { roughness: 0.96 }));
    const backWall = b.box([center[0], center[1], min[2]], [half[0] + 0.35, half[1], 0.35], shell, { roughness: 0.96 });
    // Front wall is split around a genuine access opening, never an invisible closed collider.
    const opening = 12;
    const frontWalls = [-1, 1].map(side => b.box([center[0] + side * (half[0] + 0.35 + opening) / 2, center[1], max[2]], [(half[0] + 0.35 - opening) / 2, half[1], 0.35], shell, { roughness: 0.96 }));
    // The header over the opening hangs between the two front wall pieces and bears under the roof. It is as thick as the walls, so its outer
    // face is the wall plane the entrance sign's standoffs end on.
    b.box([center[0], roofBottom - 4, max[2]], [opening, 4, 0.35], pal.primary);
    sideWalls.forEach((wall, i) => {
      wallEnd(backWall, wall, -1, 2, 'side-wall-back', 'The side wall ends in the back wall; the back wall is as wide as the side walls\' outer faces, so the whole end face lies inside it.');
      wallEnd(frontWalls[i], wall, 1, 2, 'side-wall-front', 'The side wall ends in the front wall piece on its side; that piece reaches the side wall\'s outer face, so the whole end face lies inside it.');
    });
    for (const wall of [...sideWalls, backWall, ...frontWalls]) wallEnd(roof, wall, 1, 1, 'wall-roof', 'The wall top runs into the roof slab, which covers the wall\'s whole footprint.');
    const room = park.rooms.length; park.rooms.push({ min: [min[0], 11.5, min[2]], max, ride: ride.id });
    const stars = new Rng(deriveSeed(park.recipe.seed, 741, ride.id));
    // Stars are lamps fixed to the ceiling, each touching its underside. The old depth draw is kept so the orbs and planets below land where they did.
    for (let i = 0; i < 300; i++) {
      const x = stars.range(min[0] + 2, max[0] - 2); stars.range(0.7, 3); const z = stars.range(min[2] + 2, max[2] - 2), radius = stars.range(0.025, 0.1);
      b.sphere([x, roofBottom - radius, z], radius, [0.35, 0.65, 1], { emissive: stars.range(0.002, 0.025), solid: false });
    }
    // Ceiling-suspended scenery occupies only verified empty show volume: no rail sample lies near a planet, and no rail above an orb lies near its cable.
    const corridors: Vec3[] = [], railPoints: Vec3[] = [];
    for (let at = 0; at < curve.length; at += 2) { sampleRail(curve, at, s); const right = cross(s.tangent, s.up); railPoints.push([...s.pos]); corridors.push([...s.pos], add(s.pos, add(mul(s.up, 5.5), mul(right, -4)))); }
    for (let i = 0; i < 8; i++) {
      const pos: Vec3 = [stars.range(min[0] + 4, max[0] - 4), stars.range(17, max[1] - 3), stars.range(min[2] + 4, max[2] - 4)];
      const color: Vec3 = i % 2 ? [0.2, 0.38, 0.78] : [0.7, 0.26, 0.1];
      // Each orb hangs on a cable from the ceiling; where track runs above it the orb hangs just under the ceiling instead.
      if (railPoints.some(p => p[1] > pos[1] - 1 && Math.hypot(p[0] - pos[0], p[2] - pos[2]) < 8)) pos[1] = roofBottom - stars.range(1.5, 3.5);
      const orb = b.sphere(pos, 0.09, color, { solid: false }); luminaire(park, [orb], { color, candela: 18, radius: 18, room });
      const cable = b.rod(pos, [pos[0], roofBottom, pos[2]], 0.02, [0.006, 0.008, 0.011], { detail: 1, solid: false });
      insertEnd(park, orb, cable, -1, `${ride.id}/orb-cable`, 'The cable ends at the orb centre, inside the orb; the cable is thinner than the orb.');
    }
    let planets = 0;
    for (let attempt = 0; attempt < 16 && planets < 3; attempt++) {
      const radius = stars.range(1.7, 2.6), ringed = planets === 0, clearance = radius * (ringed ? 1.95 : 1) + 3.5;
      const pos: Vec3 = [stars.range(min[0] + clearance + 2, max[0] - clearance - 2), max[1] - radius - 1.1, stars.range(min[2] + clearance + 2, max[2] - clearance - 2)];
      if (corridors.some(p => distance(p, pos) < clearance)) continue;
      const planet = b.sphere(pos, radius, planets % 2 ? [0.055, 0.14, 0.27] : [0.28, 0.14, 0.055], { roughness: 0.95, emissive: 0.004 });
      b.rod([pos[0], pos[1] + radius, pos[2]], [pos[0], roofBottom, pos[2]], 0.018, [0.006, 0.008, 0.011]);
      if (ringed) {
        // Two tilted rings, each a welded polygon. Four spokes join the planet to the inner ring and four struts join the inner ring to the outer one,
        // every spoke and strut ending on the axis of a ring segment's midpoint.
        const sides = 40;
        const rings = [1.55, 1.82].map((factor, k) => {
          const points: Vec3[] = Array.from({ length: sides }, (_, j) => { const a = j * TAU / sides, rr = radius * factor; return [pos[0] + Math.cos(a) * rr, pos[1] + Math.sin(a) * rr * 0.25, pos[2] + Math.sin(a) * rr]; });
          return { points, segments: weldedTube(b, points, 0.045, [0.22, 0.15, 0.09], `${ride.id}/planet-ring/${k}`, { emissive: 0.004 }) };
        });
        const midpoint = (ring: typeof rings[number], j: number) => mul(add(ring.points[j], ring.points[(j + 1) % sides]), 0.5);
        for (let k = 0; k < 4; k++) {
          const j = k * sides / 4 + 2;
          const spoke = b.rod(pos, midpoint(rings[0], j), 0.03, [0.22, 0.15, 0.09], { detail: 1 });
          insertEnd(park, planet, spoke, -1, `${ride.id}/ring-spoke-planet`, 'The spoke starts at the planet centre, inside the planet.');
          insertEnd(park, rings[0].segments[j], spoke, 1, `${ride.id}/ring-spoke-ring`, 'The spoke ends on the axis of the ring segment; the spoke is thinner than the ring tube.');
          const strut = b.rod(midpoint(rings[0], j), midpoint(rings[1], j), 0.03, [0.22, 0.15, 0.09], { detail: 1 });
          insertEnd(park, rings[0].segments[j], strut, -1, `${ride.id}/ring-strut-inner`, 'The strut starts on the axis of the inner ring segment; the strut is thinner than the ring tube.');
          insertEnd(park, rings[1].segments[j], strut, 1, `${ride.id}/ring-strut-outer`, 'The strut ends on the axis of the outer ring segment; the strut is thinner than the ring tube.');
        }
      }
      planets++;
    }
    for (let i = enclosureStart; i < park.parts.length; i++) park.parts[i].category = 'building';
  }
}

function flatAssets(park: ParkData, ride: RideDefinition): void {
  const pal = PALETTES[ride.theme], b = new Parts(park, ride.pos, ride.yaw, -1, 'ride'), r = ride.radius, h = ride.height;
  const pad = b.part('cylinder', [0, PAVING_RISE / 2, 0], [r + 3, PAVING_RISE / 2, r + 3], pal.ground, { metalness: 0, roughness: 0.9, surface: 'paving' });
  // Queue fence: posts stand on the paving pad and the top rail passes into each post below its top.
  // The run stops at the posts either side of the entrance gap instead of leaving rails hanging there.
  const fenceFeet: Vec3[] = [];
  for (let k = 0; k < 48; k++) { const j = (14 + k) % 48; if (j > 10 && j < 14) continue; const a = TAU * j / 48; fenceFeet.push([Math.cos(a) * (r + 2.3), PAVING_RISE, Math.sin(a) * (r + 2.3)]); }
  guardFence(b, fenceFeet, 1.1, [1.05], 0.045, METAL, `${ride.id}/queue-fence`);
  const deckY = ride.family === 'topspin' ? TOPSPIN_PIVOT - TOPSPIN_ARM - 1.25 : ride.family === 'enterprise' ? ENTERPRISE_BASE_TOP : ride.family === 'wheel' ? 5 - WHEEL_HINGE + WHEEL_FLOOR : ride.family === 'ship' || ride.family === 'pendulum' ? h - r + 0.45 : ride.family === 'drop' || ride.family === 'observation' ? 2.35 : ride.family === 'carousel' || ride.family === 'teacups' ? 0.8 : 0.3;
  const deckZ = ride.family === 'topspin' ? 3.8 + 0.05 + 1.4 : ride.family === 'enterprise' ? 10.5 : ride.family === 'wheel' ? 3.7 : ride.family === 'ship' ? SHIP_BULWARK.z + SHIP_BULWARK.half + SHIP_LANDING_GAP + 1.4 : ride.family === 'pendulum' ? 6.95 : ride.family === 'drop' || ride.family === 'observation' ? 7.45 : ride.family === 'carousel' || ride.family === 'teacups' || ride.family === 'swings' ? r * 0.9 + 1.45 : r + 1;
  const stairEdge = deckZ + 1.4;
  const deck = b.box([0, deckY - 0.15, deckZ], [2.6, 0.15, 1.4], CONCRETE, { metalness: 0 });
  if (ride.family === 'carousel' || ride.family === 'teacups' || ride.family === 'swings') {
    const radius = r * 0.9, clearance = ride.family === 'swings' ? 0 : 0.05, edgeRadius = radius + clearance, back = deckZ - 1.4;
    // Equal-width panels conservatively follow the circular platform edge. Their width bounds the
    // maximum additional shoulder gap to 10 mm, derived from the circle slope across this landing.
    const maxSlope = 2.6 / Math.sqrt(edgeRadius * edgeRadius - 2.6 * 2.6), count = Math.ceil(5.2 * maxSlope / 0.01), width = 5.2 / count;
    for (let i = 0; i < count; i++) {
      const left = -2.6 + i * width, right = left + width, nearX = left <= 0 && right >= 0 ? 0 : Math.min(Math.abs(left), Math.abs(right));
      const front = Math.sqrt(edgeRadius * edgeRadius - nearX * nearX);
      if (back - front > 0.01) b.box([(left + right) / 2, deckY - 0.15, (front + back) / 2], [width / 2, 0.15, (back - front) / 2], CONCRETE, { metalness: 0 });
    }
  }
  // Raised landings stand on four columns set into the paving pad and into the landing slab.
  // Over the Enterprise deck ring the landing is cast with the ring instead.
  if (deckY > 0.5) for (const x of [-2.25, 2.25]) for (const z of [deckZ - 1.1, deckZ + 1.1]) if (ride.family !== 'enterprise' || Math.hypot(x, z) > ENTERPRISE_DECK.outer + 0.12) memberBetween(b, pad, [x, PAVING_RISE / 2, z], deck, [x, deckY - 0.15, z], 0.12, METAL, `${ride.id}/landing-column/${x}/${z}`);
  const stair = stairFlight(b, { halfWidth: 1.5, bottomY: PAVING_RISE, topY: deckY, topZ: stairEdge, color: CONCRETE, railColor: METAL, ride: ride.id, name: `${ride.id}/entry-stair`, guardHeight: 1.05 });
  ride.boarding = [yawPoint(ride.pos, ride.yaw, [0, PAVING_RISE, stairEdge + stair.length]), yawPoint(ride.pos, ride.yaw, [0, deckY, deckZ])];
  if (ride.family === 'enterprise') enterpriseBase(b, deck, CONCRETE, `${ride.id}`);
  if (ride.family === 'topspin') {
    // The loading floor lowers on four hydraulic rams once the restraints lock, clear of the turning gondola.
    // Each ram's barrel stands on the paving pad; its piston rises into the floor plate and stays engaged in the barrel.
    const platform = new Parts(park, [0, 0, 0], 0, body(park, ride, 'platform', 0));
    const plate = platform.box([0, deckY - 0.12, 0.8], [6.3, 0.12, 3], METAL);
    const barrelTop = PAVING_RISE + 1, engaged = 0.25;
    for (const x of [-4.5, 4.5]) for (const z of [-1.2, 2.8]) {
      const barrel = b.rod([x, PAVING_RISE, z], [x, barrelTop, z], 0.16, pal.secondary);
      declareInterface(park, { name: `${ride.id}/topspin-ram-base/${x}/${z}`, kind: 'bear', a: pad, b: barrel, rationale: 'Ram barrel stands on the paving pad.' });
      const piston = platform.rod([x, barrelTop - engaged, z], [x, deckY - 0.12, z], 0.1, METAL);
      declareInterface(park, { name: `${ride.id}/topspin-ram/${x}/${z}`, kind: 'coaxial', a: barrel, b: piston, rationale: 'Piston slides in its ram barrel.' });
      insertEnd(park, plate, piston, 1, `${ride.id}/topspin-ram-head/${x}/${z}`, 'Piston head is bolted into the floor plate.');
      registerJoint(park, { name: `${ride.id}/topspin-floor-lift/${x}/${z}`, kind: 'slider', a: partAnchor(barrel, yawPoint(ride.pos, ride.yaw, [x, barrelTop, z]), [0, 1, 0]), b: partAnchor(piston, [x, barrelTop, z], [0, 1, 0]), min: -TOPSPIN_PLATFORM_DROP, max: 0, rationale: 'The floor lowers along the ram axes by the drop that clears the gondola.' });
    }
  }
  if (ride.family === 'enterprise') enterpriseAssets(park, ride);
  else if (ride.family === 'topspin') topSpinAssets(park, ride);
  else if (ride.family === 'wheel') {
    // Two A-frames, one each side of the wheel: raked legs cast into footings meet in a fixed bearing
    // housing that stands a running clearance outside everything that turns. The fixed axle is held in
    // both housings and passes through the turning hub.
    const axleY = r + 5, housings: ParkPart[] = [];
    for (const z of [-1, 1]) {
      const apex: Vec3 = [0, axleY, z * WHEEL_SUPPORT_Z], legs = [];
      for (const x of [-1, 1]) {
        const at = legTop([x * 12, PAVING_RISE, z * 7], apex, WHEEL_SUPPORT_RADIUS, [0, 0, 1]);
        const { leg, direction } = legInFooting(b, [x * 12, PAVING_RISE, z * 7], at, WHEEL_SUPPORT_RADIUS, pal.secondary, `${ride.id}/wheel-leg/${x}/${z}`, {}, { color: CONCRETE, baseY: PAVING_RISE });
        legs.push({ part: leg, end: 1 as const, direction, radius: WHEEL_SUPPORT_RADIUS, at });
      }
      housings.push(apexHousing(b, apex, [0, 0, 1], legs, 0.48, pal.secondary, `${ride.id}/wheel-apex/${z}`, WHEEL_HOUSING_HALF - WHEEL_SUPPORT_RADIUS - END_COVER));
    }
    const axleEnd = WHEEL_SUPPORT_Z, axle = b.rod([0, axleY, -axleEnd], [0, axleY, axleEnd], 0.48, METAL);
    insertEnd(park, housings[0], axle, -1, `${ride.id}/wheel-axle/-1`, 'Fixed axle end is clamped in the A-frame bearing housing.');
    insertEnd(park, housings[1], axle, 1, `${ride.id}/wheel-axle/1`, 'Fixed axle end is clamped in the A-frame bearing housing.');
    // A fixed access bridge stops 50mm short of the moving cabin's floor edge.
    const bridgeNear = WHEEL_FLOOR_HALF_Z + 0.05, bridgeFar = deckZ - 1.4;
    b.box([0, deckY - 0.15, (bridgeNear + bridgeFar) / 2], [1.5, 0.15, (bridgeFar - bridgeNear) / 2], CONCRETE);
    const rotor = new Parts(park, [0, 0, 0], 0, body(park, ride, 'rotor', 0));
    const hubEnd = WHEEL_RIM_Z + WHEEL_BEARING_HALF, hub = rotor.rod([0, 0, -hubEnd], [0, 0, hubEnd], WHEEL_HUB_RADIUS, pal.primary);
    declareInterface(park, { name: `${ride.id}/wheel-main-bearing`, kind: 'coaxial', a: hub, b: axle, rationale: 'The fixed axle runs through the turning hub on its main bearings.' });
    registerJoint(park, { name: `${ride.id}/wheel-main-axle`, kind: 'hinge', a: partAnchor(axle, yawPoint(ride.pos, ride.yaw, [0, axleY, 0]), [Math.sin(ride.yaw), 0, Math.cos(ride.yaw)]), b: partAnchor(hub, [0, 0, 0], [0, 0, 1]), rationale: 'The rotating wheel hub surrounds the fixed axial spindle at the shared support bearing.' });
    const rims = [-WHEEL_RIM_Z, WHEEL_RIM_Z].map(z => weldedTube(rotor, Array.from({ length: 96 }, (_, j): Vec3 => { const a = TAU * j / 96; return [Math.cos(a) * r, Math.sin(a) * r, z]; }), WHEEL_RIM_RADIUS, pal.primary, `${ride.id}/wheel-rim/${z}`, {}, true, vertex => vertex % 8 !== 0));
    for (let j = 0; j < 48; j++) {
      const a = TAU * j / 48;
      if (j % 4 === 0) {
        const id = body(park, ride, 'gondola', j / 4), g = new Parts(park, [0, 0, 0], 0, id);
        g.box([0, -0.8, 0], [1.7, 0.2, WHEEL_FLOOR_HALF_Z], pal.primary);
        // The roof sits just under the hinge shaft; two roof brackets carry the shaft.
        const roofTop = WHEEL_HINGE - 0.13, roof = g.box([0, roofTop - 0.15, 0], [1.85, 0.15, WHEEL_CABIN_HALF_Z], pal.secondary);
        const pin = g.rod([0, WHEEL_HINGE, -WHEEL_PIN_Z], [0, WHEEL_HINGE, WHEEL_PIN_Z], 0.13, METAL);
        for (const side of [-1, 1]) {
          const top = WHEEL_HINGE + 0.13 + END_COVER, bracket = g.box([0, (roofTop + top) / 2, side * (WHEEL_CABIN_HALF_Z - 0.08)], [0.13 + END_COVER, (top - roofTop) / 2, 0.08], METAL);
          declareInterface(park, { name: `${ride.id}/wheel-cabin-bracket/${j / 4}/${side}`, kind: 'coaxial', a: bracket, b: pin, rationale: 'Hinge shaft passes through the roof bracket bore.' });
        }
        for (const [k, z] of [-WHEEL_RIM_Z, WHEEL_RIM_Z].entries()) {
          const spokeRoot = WHEEL_HUB_RADIUS - WHEEL_SPOKE_RADIUS, point: Vec3 = [Math.cos(a) * r, Math.sin(a) * r, z];
          // Each cabin hangs from a bearing boss on the rim; the rim tube ends and the spoke end meet inside it.
          const bearing = rotor.rod([point[0], point[1], z - WHEEL_BEARING_HALF], [point[0], point[1], z + WHEEL_BEARING_HALF], WHEEL_BEARING_RADIUS, METAL);
          const spoke = memberBetween(rotor, hub, [Math.cos(a) * spokeRoot, Math.sin(a) * spokeRoot, z], bearing, point, WHEEL_SPOKE_RADIUS, pal.secondary, `${ride.id}/wheel-spoke/${j}/${z}`);
          void spoke;
          const rim = rims[k], vertex = 2 * j;
          insertEnd(park, bearing, rim[(vertex + rim.length - 1) % rim.length], 1, `${ride.id}/wheel-rim-boss/${j}/${z}/in`, 'Rim tube ends in the cabin bearing boss.');
          insertEnd(park, bearing, rim[vertex], -1, `${ride.id}/wheel-rim-boss/${j}/${z}/out`, 'Rim tube ends in the cabin bearing boss.');
          declareInterface(park, { name: `${ride.id}/wheel-cabin-bearing/${j / 4}/${z}`, kind: 'coaxial', a: bearing, b: pin, rationale: 'Cabin hinge shaft turns inside the rim bearing boss.' });
          registerJoint(park, { name: `${ride.id}/wheel-cabin/${j / 4}/${Math.sign(z)}`, kind: 'hinge', a: partAnchor(bearing, point, [0, 0, 1]), b: partAnchor(pin, [0, WHEEL_HINGE, z], [0, 0, 1]), rationale: 'Fore and aft rim bearings share the extended cabin roof shaft; the moving wheel planes clear the complete cabin shell.' });
        }
        for (const x of [-1.6, 1.6]) for (const z of [-1, 1]) { const post = g.rod([x, -0.6, z], [x, roofTop - 0.15, z], 0.055, METAL); insertEnd(park, roof, post, 1, `${ride.id}/wheel-cabin-post/${j / 4}/${x}/${z}`, 'Cabin corner post is welded into the roof frame.'); }
        for (let seat = 0; seat < 4; seat++) rideSeat(park, id, ride, [(seat % 2 ? 1 : -1) * 0.65, WHEEL_SEAT, seat < 2 ? -0.5 : 0.5], seat < 2 ? Math.PI : 0, pal.primary, false, WHEEL_FLOOR);
      }
    }
  } else if (ride.family === 'ship' || ride.family === 'pendulum') {
    // A-frames stand in two planes outside the swinging gondola's width, so no leg is ever in the swing
    // path; raked legs cast into footings meet in a fixed bearing housing at each apex, and the fixed
    // axle spans the two housings through the turning hub.
    const swingHalfZ = ride.family === 'ship' ? 2.2 + 0.16 / 2 + 0.16 / 2 : 5.5, legRadius = 0.55, axleRadius = 0.45;
    const apexZ = swingHalfZ + 0.15 + legRadius + END_COVER, housings: ParkPart[] = [];
    for (const z of [-1, 1]) {
      const apex: Vec3 = [0, h, z * apexZ], legs = [];
      for (const x of [-1, 1]) {
        const at = legTop([x * r * 0.7, PAVING_RISE, z * apexZ], apex, legRadius, [0, 0, 1]);
        const { leg, direction } = legInFooting(b, [x * r * 0.7, PAVING_RISE, z * apexZ], at, legRadius, pal.secondary, `${ride.id}/swing-leg/${x}/${z}`, {}, { color: CONCRETE, baseY: PAVING_RISE });
        legs.push({ part: leg, end: 1 as const, direction, radius: legRadius, at });
      }
      housings.push(apexHousing(b, apex, [0, 0, 1], legs, axleRadius, pal.secondary, `${ride.id}/swing-apex/${z}`));
    }
    const axle = b.rod([0, h, -apexZ], [0, h, apexZ], axleRadius, METAL);
    insertEnd(park, housings[0], axle, -1, `${ride.id}/swing-axle/-1`, 'Fixed axle end is clamped in the A-frame bearing housing.');
    insertEnd(park, housings[1], axle, 1, `${ride.id}/swing-axle/1`, 'Fixed axle end is clamped in the A-frame bearing housing.');
    const rotor = new Parts(park, [0, 0, 0], 0, body(park, ride, 'rotor', 0));
    // The arm is welded into the hub wall and stops short of the axle that runs through the hub.
    const armRadius = 0.5, armTop = axleRadius + END_COVER, hubRadius = Math.hypot(armTop, armRadius) + END_COVER;
    const hub = rotor.rod([0, 0, -0.7], [0, 0, 0.7], hubRadius, pal.primary), arm = rotor.rod([0, -armTop, 0], [0, -r, 0], armRadius, pal.primary);
    insertEnd(park, hub, arm, -1, `${ride.id}/swing-arm-root`, 'Swing arm is welded into the hub wall.');
    declareInterface(park, { name: `${ride.id}/swing-main-bearing`, kind: 'coaxial', a: hub, b: axle, rationale: 'The fixed axle runs through the turning hub on its main bearings.' });
    registerJoint(park, { name: `${ride.id}/pendulum-main-pivot`, kind: 'hinge', a: partAnchor(axle, yawPoint(ride.pos, ride.yaw, [0, h, 0]), [Math.sin(ride.yaw), 0, Math.cos(ride.yaw)]), b: partAnchor(hub, [0, 0, 0], [0, 0, 1]), rationale: 'The swinging main arm turns on the transverse support spindle.' });
    const cabinId = body(park, ride, 'gondola', 0), cabin = new Parts(park, [0, 0, 0], 0, cabinId);
    let floor: ParkPart;
    if (ride.family === 'ship') {
      floor = cabin.box([0, 0, 0], [7, 0.45, 2.2], pal.timber, { surface: 'timber' });
      // Bulwarks stand on the deck, up to 1.8 m above the hull's centre plane.
      const hull = [floor, ...[-SHIP_BULWARK.z, SHIP_BULWARK.z].map(z => cabin.box([0, (0.45 + 1.8) / 2, z], [7, (1.8 - 0.45) / 2, SHIP_BULWARK.half], pal.primary))];
      for (const x of [-6.6, 6.6]) hull.push(cabin.part('sphere', [x, 0.25, 0], [1.3, 0.8, 2.15], pal.timber, { metalness: 0, surface: 'timber' }));
      declareMonolith(park, `${ride.id}/ship-hull`, hull, 'Boat hull: deck, bulwarks, bow and stern are one built hull.');
      insertEnd(park, floor, arm, 1, `${ride.id}/ship-arm-hull`, 'Swing arm foot is bolted into the hull deck.');
      for (let seat = 0; seat < ride.capacity; seat++) { const [x, z] = shipSeat(seat); rideSeat(park, cabinId, ride, [x, 0.7, z], Math.PI / 2, pal.primary, false, 0.45); }
    } else {
      floor = cabin.part('cylinder', [0, 0, 0], [5.5, 0.45, 5.5], pal.primary);
      declareInterface(park, { name: `${ride.id}/pendulum-disc-bearing`, kind: 'coaxial', a: floor, b: arm, rationale: 'The passenger disc turns about the arm foot on its centre bearing.' });
      for (let seat = 0; seat < ride.capacity; seat++) { const a = seat * TAU / ride.capacity; rideSeat(park, cabinId, ride, [Math.cos(a) * 4.5, 0.7, Math.sin(a) * 4.5], -a - Math.PI / 2, pal.primary, true, 0.45); }
    }
    registerJoint(park, { name: `${ride.id}/pendulum-cabin-bearing`, kind: ride.family === 'ship' ? 'fixed' : 'hinge', a: partAnchor(arm, [0, -r, 0], [0, 1, 0]), b: partAnchor(floor, [0, 0, 0], [0, 1, 0]), rationale: ride.family === 'ship' ? 'Ship hull bolts to the rigid end of its swinging arm.' : 'Passenger disk rotates about the lower arm axis at its central bearing.' });
  } else if (ride.family === 'drop' || ride.family === 'observation') {
    // Four-column lattice tower. Columns stand in footings and end inside the top cap; every face carries
    // X-braces whose ends sit inside the columns. Where two diagonals cross, one runs through and the
    // other is split into two halves that end inside it, as welded tube bracing is built.
    // Footings stand 0.3 m proud of the pad, low enough that the guide shoes clear them at the lowest stop.
    const columnOffset = 2, columnRadius = 0.3, capHalf = columnOffset + columnRadius, braceRadius = 0.09, towerFooting = 0.15;
    const cap = b.box([0, h + 4, 0], [capHalf, 1, capHalf], pal.primary);
    const columns = new Map<string, ParkPart>();
    for (const x of [-columnOffset, columnOffset]) for (const z of [-columnOffset, columnOffset]) {
      const { leg } = legInFooting(b, [x, PAVING_RISE, z], [x, h + 4, z], columnRadius, pal.secondary, `${ride.id}/tower-column/${x}/${z}`, {}, { color: CONCRETE, baseY: PAVING_RISE, halfHeight: towerFooting });
      insertEnd(park, cap, leg, 1, `${ride.id}/tower-column-cap/${x}/${z}`, 'Column top is welded into the top cap.');
      columns.set(`${x},${z}`, leg);
    }
    const face = (a: [number, number], c: [number, number], y0: number, y1: number, name: string) => {
      const ca = columns.get(`${a[0]},${a[1]}`)!, cc = columns.get(`${c[0]},${c[1]}`)!;
      const p = (k: [number, number], y: number): Vec3 => [k[0], y, k[1]];
      const through = memberBetween(b, ca, p(a, y0), cc, p(c, y1), braceRadius, pal.secondary, `${name}/through`);
      const middle: Vec3 = [(a[0] + c[0]) / 2, (y0 + y1) / 2, (a[1] + c[1]) / 2];
      for (const [col, at, y] of [[cc, c, y0], [ca, a, y1]] as const) {
        const half = b.rod(p(at, y), middle, braceRadius, pal.secondary);
        insertEnd(park, col, half, -1, `${name}/split/${y}`, 'Split diagonal end is welded into the column.');
        insertEnd(park, through, half, 1, `${name}/split/${y}/cross`, 'Split diagonal is welded to the continuous diagonal at the crossing.');
      }
    };
    const corners: [number, number][] = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
    // Bracing panels start a brace width above the footings and stop below the top cap.
    const braceBase = PAVING_RISE + 2 * towerFooting + 0.3;
    for (let y = braceBase; y + 2 <= h + 3 - 0.3; y += 3) for (let k = 0; k < 4; k++) face(corners[k], corners[(k + 1) % 4], y, y + 2, `${ride.id}/tower-brace/${y.toFixed(1)}/${k}`);
    const cabinId = body(park, ride, 'tower', 0), cabin = new Parts(park, [0, 0, 0], 0, cabinId);
    const floor = annularDeck(cabin, TOWER_APERTURE, 6, 0, 0.35, pal.primary, `${ride.id}/tower-floor`);
    declareMonolith(park, `${ride.id}/tower-floor`, floor, 'Welded annular cabin floor.', 'closed');
    const carriage = new Parts(park, [0, 0, 0], 0, body(park, ride, 'frame', 0));
    const race = annularDeck(carriage, TOWER_APERTURE - 0.05, TOWER_APERTURE + 0.35, -0.5, 0.15, METAL, `${ride.id}/tower-bearing`);
    declareMonolith(park, `${ride.id}/tower-bearing`, race, 'Welded annular bearing race.', 'closed');
    registerJoint(park, { name: `${ride.id}/tower-turntable`, kind: 'hinge', anchorModel: 'virtual-axis', a: partAnchor(race[0], [0, -0.35, 0], [0, 1, 0]), b: partAnchor(floor[0], [0, -0.35, 0], [0, 1, 0]), rationale: 'Virtual axis of the hollow annular thrust bearing; its mating races touch at the floor underside while clearing the fixed tower.' });
    // Guide carriage under the race: at each column a shoe outside the outer corner carries two rollers
    // on stub axles, one on each outward face of the column, clear of the bracing in the tower faces.
    const rollerRadius = 0.1, rollerHalf = 0.18, rollerY = -1, shoeNear = 0.23, shoeFar = 0.63, raceBottom = -0.65;
    for (const x of [-2, 2]) for (const z of [-2, 2]) {
      const sx = Math.sign(x), sz = Math.sign(z), mid = (shoeNear + shoeFar) / 2;
      const shoe = carriage.box([x + sx * mid, (rollerY - 0.3 + raceBottom) / 2, z + sz * mid], [(shoeFar - shoeNear) / 2, (raceBottom - rollerY + 0.3) / 2, (shoeFar - shoeNear) / 2], METAL);
      const reach = columnRadius + rollerRadius;
      const units: [Vec3, Vec3, Vec3][] = [
        // roller centre, axle start (10 mm inside the far roller face), axle end (inside the shoe)
        [[x + sx * reach, rollerY, z], [x + sx * reach, rollerY, z - sz * (rollerHalf - 0.01)], [x + sx * reach, rollerY, z + sz * (shoeNear + 0.2)]],
        [[x, rollerY, z + sz * reach], [x - sx * (rollerHalf - 0.01), rollerY, z + sz * reach], [x + sx * (shoeNear + 0.2), rollerY, z + sz * reach]],
      ];
      for (const [k, [centre, start, end]] of units.entries()) {
        const axis = k === 0 ? [0, 0, rollerHalf] : [rollerHalf, 0, 0];
        const wheel = carriage.rod([centre[0] - axis[0], centre[1], centre[2] - axis[2]], [centre[0] + axis[0], centre[1], centre[2] + axis[2]], rollerRadius, RUBBER);
        const axle = carriage.rod(start, end, 0.035, METAL);
        declareInterface(park, { name: `${ride.id}/tower-roller/${x}/${z}/${k}`, kind: 'coaxial', a: wheel, b: axle, rationale: 'Guide roller turns on its stub axle.' });
        insertEnd(park, shoe, axle, 1, `${ride.id}/tower-axle/${x}/${z}/${k}`, 'Stub axle is clamped in the guide shoe.');
      }
    }
    for (let seat = 0; seat < ride.capacity; seat++) { const a = seat * TAU / ride.capacity; rideSeat(park, cabinId, ride, [Math.cos(a) * 4.5, 0.7, Math.sin(a) * 4.5], -a - Math.PI / 2, pal.primary, ride.family === 'drop', 0.35); }
    if (ride.family === 'observation') {
      const roof = annularDeck(cabin, TOWER_APERTURE, 6.5, 3, 0.2, pal.secondary, `${ride.id}/tower-roof`);
      declareMonolith(park, `${ride.id}/tower-roof`, roof, 'Welded annular cabin roof.', 'closed');
      // Window posts run from inside the floor slab to inside the roof slab.
      for (let i = 0; i < 16; i++) { const a = i * TAU / 16; const post = 6 - 0.055 - END_COVER; memberBetween(cabin, floor[0], [Math.cos(a) * post, 0, Math.sin(a) * post], roof[0], [Math.cos(a) * post, 3, Math.sin(a) * post], 0.055, METAL, `${ride.id}/tower-window-post/${i}`); }
    }
  } else {
    const rotor = new Parts(park, [0, 0, 0], 0, body(park, ride, 'rotor', 0));
    const hats: ParkPart[] = [], satellites: { hub: ParkPart; sweeps: ParkPart[] }[] = [];
    const swings = ride.family === 'swings', carousel = ride.family === 'carousel', scrambler = ride.family === 'scrambler';
    // Turntables clear the paving and come up flush with the landing. The scrambler has no turntable: its top
    // hub turns on top of the mast and carries the top sweeps.
    const tableBottom = PAVING_RISE + 0.02, tableTop = 0.8, hubHalf = 0.45;
    const base = swings ? b.part('cylinder', [0, (PAVING_RISE + deckY) / 2, 0], [r * 0.9, (deckY - PAVING_RISE) / 2, r * 0.9], pal.primary)
      : scrambler ? rotor.part('cylinder', [0, SCRAMBLER.armY, 0], [1.1, hubHalf, 1.1], pal.primary)
      : rotor.part('cylinder', [0, (tableBottom + tableTop) / 2, 0], [r * 0.9, (tableTop - tableBottom) / 2, r * 0.9], pal.primary);
    // The mast is cast into the paving pad (its foundation below grade is not modelled) and runs up
    // through bores in every turning part around it.
    const mastRadius = 0.8, mastTop = swings ? h : carousel ? CAROUSEL.ceilingY + CAROUSEL.ceilingHalf + CAROUSEL.crownLift : scrambler ? SCRAMBLER.armY + 0.3 : 1.8;
    const mainMast = b.rod([0, PAVING_RISE / 2, 0], [0, mastTop, 0], mastRadius, pal.secondary);
    insertEnd(park, pad, mainMast, -1, `${ride.id}/main-mast-foot`, 'Mast foot is cast into the paving pad over its foundation.');
    const aroundMast = (part: ParkPart, name: string) => declareInterface(park, { name: `${ride.id}/mast-bore/${name}`, kind: 'coaxial', a: part, b: mainMast, rationale: 'The fixed mast passes through this part\'s central bore.' });
    aroundMast(base, 'base');
    // A carousel hangs from the flat roller thrust bearing on top of its centre pole (Tilden Park manual): the crown sits
    // on the pole top, which stands just above the ceiling the sweeps make, inside the roof.
    const mainBearing = carousel ? rotor.part('cylinder', [0, mastTop + CAROUSEL.crownHalf, 0], [0.95, CAROUSEL.crownHalf, 0.95], METAL)
      : rotor.part('cylinder', [0, swings ? h : scrambler ? SCRAMBLER.armY : 0.9, 0], [0.95, 0.25, 0.95], METAL);
    if (carousel) declareInterface(park, { name: `${ride.id}/carousel-top-bearing`, kind: 'bear', a: mainMast, b: mainBearing, rationale: 'The top thrust bearing rests on the centre pole and carries the whole turning carousel.' });
    else aroundMast(mainBearing, 'bearing');
    if (!swings && !carousel) declareMonolith(park, `${ride.id}/turntable`, [base, mainBearing], 'Turntable and its hub bearing housing are one welded assembly.');
    const jointY = swings ? 5.6 : scrambler ? SCRAMBLER.armY : carousel ? mastTop : 0.9;
    registerJoint(park, { name: `${ride.id}/main-mast-bearing`, kind: swings ? 'slider' : 'hinge', a: partAnchor(mainMast, yawPoint(ride.pos, ride.yaw, [0, jointY, 0]), [0, 1, 0]), b: partAnchor(mainBearing, [0, swings ? h : jointY, 0], [0, 1, 0]), min: 0, max: swings ? h - 5.6 : 0, rationale: swings ? 'Cylindrical mast bearing permits axial lift and spin on the same fixed shaft.' : carousel ? 'The carousel turns on the thrust bearing at the top of its fixed centre pole.' : 'Main turntable rotates around the fixed vertical mast through its hub bearing.' });
    if (scrambler) {
      const S = SCRAMBLER, armY = S.armY, reach = r * S.reach, root = mastRadius + 0.1;
      // The bottom sweeps turn round the foot of the mast on their own hub, 3.5 in above the walkway.
      const bottomHub = rotor.part('cylinder', [0, S.bottomY, 0], [mastRadius + 0.2, S.bottomRadius + 0.05, mastRadius + 0.2], pal.primary);
      aroundMast(bottomHub, 'bottom-hub');
      // A crown post on the top hub, above the mast top, carries the tie rods that hold up the top sweep tips.
      const crownTop = armY + 2.2, crown = rotor.rod([0, armY + hubHalf - 0.1, 0], [0, crownTop - 0.1, 0], 0.2, pal.secondary);
      const crownCap = rotor.part('cylinder', [0, crownTop, 0], [0.3, 0.15, 0.3], pal.secondary);
      insertEnd(park, base, crown, -1, `${ride.id}/scrambler-crown-foot`, 'The crown post is welded into the top of the hub, above the mast top.');
      insertEnd(park, crownCap, crown, 1, `${ride.id}/scrambler-crown-top`, 'The crown post ends inside its tie-rod cap.');
      for (let i = 0; i < S.units; i++) {
        const a = i * TAU / S.units, c = Math.cos(a), s = Math.sin(a), at = (radius: number, y: number): Vec3 => [c * radius, y, s * radius];
        // Top sweep from the hub wall to the head of the unit pole, held by a tie rod from the crown. Members entering
        // the pole head and foot stop short of the pole so their ends sit clear of it.
        const top = rotor.part('cylinder', at(reach, armY), [0.4, 0.4, 0.4], pal.primary), arm = rotor.rod(at(root, armY), at(reach - 0.13, armY), 0.28, pal.primary);
        insertEnd(park, base, arm, -1, `${ride.id}/scrambler-top-sweep/${i}/root`, 'The top sweep is welded into the hub wall.');
        insertEnd(park, top, arm, 1, `${ride.id}/scrambler-top-sweep/${i}/tip`, 'The top sweep ends in the unit pole head.');
        const tie = rotor.rod(at(0.15, crownTop + 0.05), at(reach - 0.1, armY + 0.3), 0.04, METAL);
        insertEnd(park, crownCap, tie, -1, `${ride.id}/scrambler-tie-rod/${i}/top`, 'The tie rod is pinned in the crown cap.');
        insertEnd(park, top, tie, 1, `${ride.id}/scrambler-tie-rod/${i}/bottom`, 'The tie rod is pinned in the unit pole head, above the pole.');
        const foot = rotor.part('cylinder', at(reach, S.bottomY), [0.25, 0.12, 0.25], pal.primary), bottom = rotor.rod(at(mastRadius + 0.05, S.bottomY), at(reach - 0.13, S.bottomY), S.bottomRadius, pal.primary);
        insertEnd(park, bottomHub, bottom, -1, `${ride.id}/scrambler-bottom-sweep/${i}/root`, 'The bottom sweep is welded into the bottom hub.');
        insertEnd(park, foot, bottom, 1, `${ride.id}/scrambler-bottom-sweep/${i}/tip`, 'The bottom sweep is pinned in the unit pole foot.');
        const unitPole = rotor.rod(at(reach, S.bottomY - 0.05), at(reach, armY), 0.12, METAL);
        insertEnd(park, foot, unitPole, -1, `${ride.id}/scrambler-unit-pole/${i}/foot`, 'The unit pole stands in its foot casting on the bottom sweep.');
        insertEnd(park, top, unitPole, 1, `${ride.id}/scrambler-unit-pole/${i}/head`, 'The unit pole top is held in the head casting on the top sweep.');
        // The unit hub turns on the unit pole and carries four seat sweeps, each ending inside a car floor. Unit parts are
        // built in the unit body's frame, which sits `bodyY` above the ride origin.
        const unit = new Parts(park, [0, 0, 0], 0, body(park, ride, 'frame', i)), y = S.sweepY - S.bodyY, end = r * S.offset - S.carHalf[1] + 0.1;
        const hub = unit.part('cylinder', [0, y, 0], [0.3, 0.12, 0.3], pal.accent);
        declareInterface(park, { name: `${ride.id}/scrambler-unit-bearing/${i}`, kind: 'coaxial', a: hub, b: unitPole, rationale: 'The unit hub turns on the unit pole.' });
        const sweeps = Array.from({ length: S.carsPerUnit }, (_, k) => {
          const p = k * TAU / S.carsPerUnit, sweep = unit.rod([Math.cos(p) * 0.2, y, Math.sin(p) * 0.2], [Math.cos(p) * end, y, Math.sin(p) * end], S.sweepRadius, pal.secondary);
          insertEnd(park, hub, sweep, -1, `${ride.id}/scrambler-seat-sweep/${i}/${k}`, 'The seat sweep is welded into the unit hub.');
          return sweep;
        });
        satellites.push({ hub, sweeps });
        registerJoint(park, { name: `${ride.id}/satellite-drive/${i}`, kind: 'hinge', a: partAnchor(unitPole, at(reach, S.sweepY), [0, 1, 0]), b: partAnchor(hub, [0, y, 0], [0, 1, 0]), rationale: 'The unit hub turns on its unit pole, against the turn of the sweeps.' });
      }
    }
    // Teacups: each small turntable turns on a bearing boss standing on the main turntable and carries a bearing pin
    // under each of its cups. Table parts are built in the table body's frame, centred on the table at ride-local y = 0.
    const cupPins: ParkPart[] = [];
    if (ride.family === 'teacups') for (let i = 0; i < TEACUPS.tables; i++) {
      const T = TEACUPS, a = i * TAU / T.tables, centre: Vec3 = [Math.cos(a) * r * T.tableReach, 0, Math.sin(a) * r * T.tableReach];
      const boss = rotor.part('cylinder', [centre[0], (tableTop + T.tableBottom) / 2, centre[2]], [0.6, (T.tableBottom - tableTop) / 2, 0.6], METAL);
      declareInterface(park, { name: `${ride.id}/teacup-table-boss/${i}`, kind: 'bear', a: base, b: boss, rationale: 'The bearing boss stands on the main turntable deck.' });
      const table = new Parts(park, [0, 0, 0], 0, body(park, ride, 'frame', i));
      const disc = table.part('cylinder', [0, (T.tableBottom + T.tableTop) / 2, 0], [T.tableRadius, (T.tableTop - T.tableBottom) / 2, T.tableRadius], pal.secondary, { metalness: 0 });
      registerJoint(park, { name: `${ride.id}/teacup-table/${i}`, kind: 'hinge', a: partAnchor(boss, [centre[0], T.tableBottom, centre[2]], [0, 1, 0]), b: partAnchor(disc, [0, T.tableBottom, 0], [0, 1, 0]), rationale: 'The small turntable turns on its bearing boss on the main turntable.' });
      for (let k = 0; k < T.cupsPerTable; k++) {
        const p = k * TAU / T.cupsPerTable, pin = table.part('cylinder', [Math.cos(p) * T.cupOffset, T.tableTop + T.pin / 2, Math.sin(p) * T.cupOffset], [0.4, T.pin / 2, 0.4], METAL);
        declareInterface(park, { name: `${ride.id}/teacup-pin/${i}/${k}`, kind: 'bear', a: disc, b: pin, rationale: 'The cup bearing pin is bolted on the small turntable.' });
        cupPins.push(pin);
      }
    }
    let ceiling: ParkPart | undefined;
    const count = scrambler ? SCRAMBLER.units * SCRAMBLER.carsPerUnit : ride.family === 'teacups' ? TEACUPS.tables * TEACUPS.cupsPerTable : 16;
    if (carousel || swings) {
      // Swing chains hang from clevis brackets under the canopy; the canopy sits above them.
      const canopyY = swings ? h + 0.1 + 0.35 : CAROUSEL.ceilingY, canopy = rotor.part('cylinder', [0, canopyY, 0], [r, swings ? 0.35 : CAROUSEL.ceilingHalf, r], pal.secondary);
      aroundMast(canopy, 'canopy'); ceiling = canopy;
      if (swings) declareMonolith(park, `${ride.id}/canopy`, [canopy, mainBearing], 'Canopy and its sliding mast bearing are one welded assembly.');
      if (carousel) {
        // Spun roof cone sits on the canopy; its finial ball is part of the same spinning.
        const cone = rotor.part('cone', [0, canopyY + 0.35 + 1.3, 0], [r, 1.3, r], pal.primary, { metalness: 0.06, roughness: 0.58 });
        const apex = canopyY + 0.35 + 2.6, finial = rotor.sphere([0, apex + 0.03, 0], 0.28, pal.accent, { metalness: 0.7 });
        // The sweeps radiate from the crown and carry the roof; the ceiling, crown, solid-modelled roof and finial are one frame.
        declareMonolith(park, `${ride.id}/roof`, [cone, finial, canopy, mainBearing], 'Roof and finial, the sweep frame and ceiling that carry them, and the top bearing crown the sweeps radiate from.');
        aroundMast(cone, 'roof');
        // A mirrored rotating drum carries the radial canopy sweeps above the horses.
        const drum = rotor.part('cylinder', [0, 2.8, 0], [1.32, 2, 1.32], pal.primary);
        aroundMast(drum, 'drum');
        // The cheese bearing low on the pole only keeps the hung platform centred.
        const cheese = rotor.part('cylinder', [0, 0.9, 0], [0.95, 0.25, 0.95], METAL);
        aroundMast(cheese, 'cheese-bearing');
        declareMonolith(park, `${ride.id}/turntable`, [base, cheese, drum], 'Platform, its cheese bearing and the drum standing on it are one welded assembly.');
        for (let j = 0; j < 8; j++) {
          const a = j * TAU / 8, rot = axisAngle([0, 1, 0], Math.PI / 2 - a);
          rotor.box([Math.cos(a) * (1.32 + 0.035), 2.75, Math.sin(a) * (1.32 + 0.035)], [0.46, 1.57, 0.035], [0.19, 0.24, 0.25], { surface: 'glass', metalness: 0, roughness: 0.11, localRot: rot });
          rotor.rod([Math.cos(a + TAU / 16) * 1.4, 0.8, Math.sin(a + TAU / 16) * 1.4], [Math.cos(a + TAU / 16) * 1.4, 4.7, Math.sin(a + TAU / 16) * 1.4], 0.06, pal.accent);
        }
        // Roof ribs lie on the cone surface, their tops gathered inside the finial.
        const slant = Math.hypot(r, 2.6), down: Vec3 = [r / slant, -2.6 / slant, 0], out: Vec3 = [2.6 / slant, r / slant, 0];
        for (let j = 0; j < 16; j++) {
          const a = j * TAU / 16, x = Math.cos(a), z = Math.sin(a), along = (t: number): Vec3 => { const p = add(add([0, apex, 0], mul(down, t)), mul(out, 0.045)); return [x * p[0], p[1], z * p[0]]; };
          const rib = rotor.rod(along(0.12), along(slant - 0.3), 0.045, pal.accent, { detail: 1 });
          insertEnd(park, cone, rib, -1, `${ride.id}/roof-rib/${j}`, 'Roof rib top is gathered inside the finial.');
          // The jumper pole passes up through a high hat on the platform, a guide bush its foot never leaves.
          const hat = rotor.part('cylinder', [x * r * SWING_ANCHOR, (tableTop + CAROUSEL.hatTop) / 2, z * r * SWING_ANCHOR], [CAROUSEL.hatRadius, (CAROUSEL.hatTop - tableTop) / 2, CAROUSEL.hatRadius], [0.57, 0.38, 0.13], { metalness: 0.7 });
          declareInterface(park, { name: `${ride.id}/high-hat/${j}`, kind: 'bear', a: base, b: hat, rationale: 'The high hat is bolted on the platform.' });
          hats.push(hat);
          // Each sweep holds the platform up on two drop rods, inboard and outboard of the figures.
          const sa = a + TAU / 32, sx = Math.cos(sa), sz = Math.sin(sa);
          for (const [k, radius] of CAROUSEL.dropRods.map((f, k) => [k, f * r] as const)) {
            const rod = rotor.rod([sx * radius, tableTop - 0.1, sz * radius], [sx * radius, canopyY - CAROUSEL.ceilingHalf + 0.1, sz * radius], CAROUSEL.dropRodRadius, METAL);
            insertEnd(park, base, rod, -1, `${ride.id}/drop-rod/${j}/${k}/foot`, 'The drop rod is bolted through the platform frame.');
            insertEnd(park, canopy, rod, 1, `${ride.id}/drop-rod/${j}/${k}/head`, 'The drop rod hangs from its sweep inside the ceiling.');
          }
          const rot = axisAngle([0, 1, 0], Math.PI / 2 - a);
          rotor.box([x * (r + 0.09), 5.34, z * (r + 0.09)], [Math.PI * r / 16 * 0.92, 0.31, 0.09], pal.primary, { localRot: rot });
          rotor.part('sphere', [x * (r + 0.18 + 0.045), 5.33, z * (r + 0.18 + 0.045)], [0.42, 0.19, 0.045], pal.accent, { localRot: rot, detail: 1 });
          // Two lamps stand on each rounding board's face, either side of its ornament.
          for (const t of [-1.3, 1.3]) rotor.sphere([x * (r + 0.18 + 0.12) - z * t, 5.34, z * (r + 0.18 + 0.12) + x * t], 0.12, pal.accent, { emissive: 0.25, solid: false });
        }
      }
      // The swing ride's rim lamps sit against the canopy fascia.
      if (swings) for (let j = 0; j < 32; j++) { const a = j * TAU / 32; rotor.sphere([Math.cos(a) * (r + 0.12), canopyY, Math.sin(a) * (r + 0.12)], 0.12, pal.accent, { emissive: 0.25, solid: false }); }
    }
    for (let j = 0; j < count; j++) {
      const id = body(park, ride, ride.family === 'teacups' || scrambler ? 'cup' : 'seat', j), seat = new Parts(park, [0, 0, 0], 0, id);
      if (carousel) {
        // The jumper pole moves with its figure: it hangs from the crank inside the ceiling and its foot slides in the high hat.
        // At mid stroke its foot is halfway up the hat, and its top halfway up the ceiling, so both stay inside over the stroke.
        const footY = (tableTop + CAROUSEL.hatTop) / 2 - CAROUSEL_MOUNT, topY = CAROUSEL.ceilingY + CAROUSEL.ceilingHalf / 2 - CAROUSEL_MOUNT;
        const pole = seat.rod([0, footY, 0], [0, topY, 0], 0.035, [0.57, 0.38, 0.13], { metalness: 0.7 });
        carouselHorse(seat, pal.primary, pal.accent, j, pole);
        const a = j * TAU / count;
        declareInterface(park, { name: `${ride.id}/high-hat-guide/${j}`, kind: 'coaxial', a: hats[j], b: pole, rationale: 'The jumper pole foot slides in its high hat.' });
        insertEnd(park, ceiling!, pole, 1, `${ride.id}/jumper-pole/${j}`, 'The jumper pole top hangs from its crank casting inside the ceiling, which hides the cranks.');
        registerJoint(park, { name: `${ride.id}/carousel-slide/${j}`, kind: 'slider', anchorModel: 'virtual-axis', a: partAnchor(hats[j], [Math.cos(a) * r * SWING_ANCHOR, CAROUSEL_MOUNT, Math.sin(a) * r * SWING_ANCHOR], [0, 1, 0]), b: partAnchor(pole, [0, 0, 0], [0, 1, 0]), min: -CAROUSEL_STROKE / 2, max: CAROUSEL_STROKE / 2, rationale: 'The figure and its jumper pole slide up and down through the high hat; the hat bore is the shared centreline.' });
      } else if (swings) {
        const chainX = 0.4, chainRadius = 0.025, pinRadius = 0.055, pinHalf = 0.07, cheekHalf = 0.015, cheekGap = chainRadius + 0.01;
        const pan = seat.box([0, 0, 0], [0.45, 0.12, 0.45], pal.primary);
        // The cushion stops short of the chains that pass beside it.
        const cushion = seat.box([0, 0.185, 0], [chainX - chainRadius - 0.01, 0.065, 0.4], RUBBER);
        declareMonolith(park, `${ride.id}/swing-seat/${j}`, [pan, cushion, seat.box([0, 0.38, 0.4], [0.45, 0.38, 0.08], pal.primary)], 'Moulded swing seat: pan and back are one moulding with the cushion bonded in.');
        for (const x of [-chainX, chainX]) {
          const chain = seat.rod([x, 0, 0], [x, SWING_CHAIN, 0], chainRadius, METAL), a = j * TAU / count;
          insertEnd(park, pan, chain, -1, `${ride.id}/swing-chain-seat/${j}/${x}`, 'Chain end is shackled into the seat pan frame.');
          const point: Vec3 = [Math.cos(a) * r * SWING_ANCHOR + x * Math.sin(a), h, Math.sin(a) * r * SWING_ANCHOR - x * Math.cos(a)], tangent: Vec3 = [Math.sin(a), 0, -Math.cos(a)];
          const clevis = rotor.rod(add(point, mul(tangent, -pinHalf)), add(point, mul(tangent, pinHalf)), pinRadius, METAL);
          // Two cheek plates hang from the canopy underside either side of the chain and carry the pin.
          for (const side of [-1, 1]) {
            const offset = side * (cheekGap + cheekHalf), top = h + 0.1, bottom = h - pinRadius - 0.03, centre = add(point, mul(tangent, offset));
            const cheek = rotor.box([centre[0], (top + bottom) / 2, centre[2]], [cheekHalf, (top - bottom) / 2, pinRadius + 0.03], METAL, { localRot: axisAngle([0, 1, 0], Math.PI / 2 - a) });
            declareInterface(park, { name: `${ride.id}/swing-clevis/${j}/${x}/${side}`, kind: 'coaxial', a: cheek, b: clevis, rationale: 'Clevis pin passes through the cheek plate.' });
          }
          insertEnd(park, clevis, chain, 1, `${ride.id}/swing-chain-top/${j}/${x}`, 'Top chain link wraps the clevis pin; its end stays on the pin axis as the seat swings.');
          registerJoint(park, { name: `${ride.id}/swing-chain/${j}/${x}`, kind: 'hinge', a: partAnchor(clevis, point, tangent), b: partAnchor(chain, [x, SWING_CHAIN, 0], [1, 0, 0]), rationale: 'Suspension chain endpoint shares the roof clevis pin while the seat cones outward.' });
        }
      } else if (ride.family === 'teacups') {
        // Moulded cup: floor, segmented wall and thrust plate are one shell, with a door gap in the wall at +z. Guests occupy its open interior.
        const T = TEACUPS, wallTop = 1.25 - 0.06, wallBottom = T.floorTop - 0.03, outer = T.wallRadius + T.wallHalf, handleSegment = 19, walls: ParkPart[] = [];
        const shell = [seat.part('cylinder', [0, T.floorTop / 2, 0], [outer - 0.09, T.floorTop / 2, outer - 0.09], pal.primary, { metalness: 0 })];
        for (let k = 0; k < 20; k++) {
          const a = (k + 0.5) * TAU / 20;
          if (k === 4 || k === 5) continue;
          walls[k] = seat.box([Math.cos(a) * T.wallRadius, (wallTop + wallBottom) / 2, Math.sin(a) * T.wallRadius], [T.wallHalf, (wallTop - wallBottom) / 2, outer * Math.tan(Math.PI / 20)], pal.secondary, { localRot: axisAngle([0, 1, 0], -a), metalness: 0, roughness: 0.24 });
          shell.push(walls[k]);
        }
        // The thrust plate is bolted under the shell; its lower face turns on the bearing pin on the small turntable.
        const movingPin = seat.part('cylinder', [0, -T.plate / 2, 0], [0.34, T.plate / 2, 0.34], METAL);
        shell.push(movingPin);
        declareMonolith(park, `${ride.id}/cup-shell/${j}`, shell, 'Moulded cup shell with its turntable plate.');
        // The rim bead sits on the wall tops: its knuckles, which are a little wider than the tube, rest on them.
        const rimRadius = 0.06, rimY = wallTop + rimRadius / Math.cos(Math.PI / 20);
        const rim = Array.from({ length: 19 }, (_, k): Vec3 => { const a = (k + 6) * TAU / 20; return [Math.cos(a) * T.wallRadius, rimY, Math.sin(a) * T.wallRadius]; });
        weldedTube(seat, rim, rimRadius, pal.accent, `${ride.id}/cup-rim/${j}`, { metalness: 0 }, false);
        // The handle is an open loop on the outside of one wall segment, square to its face, with both ends set into that segment.
        const handleCentre = outer + 0.12, handleRadius = 0.3, enter = Math.acos((T.wallRadius - handleCentre) / handleRadius), h = (handleSegment + 0.5) * TAU / 20;
        const handle = Array.from({ length: 11 }, (_, k): Vec3 => { const t = enter - k * 2 * enter / 10; const x = handleCentre + handleRadius * Math.cos(t); return [x * Math.cos(h), 0.71 + handleRadius * Math.sin(t), x * Math.sin(h)]; });
        const loop = weldedTube(seat, handle, 0.05, pal.secondary, `${ride.id}/cup-handle/${j}`, { metalness: 0 }, false);
        insertEnd(park, walls[handleSegment], loop[0], -1, `${ride.id}/cup-handle/${j}/top`, 'Handle end is moulded into the cup wall segment.');
        insertEnd(park, walls[handleSegment], loop[loop.length - 1], 1, `${ride.id}/cup-handle/${j}/bottom`, 'Handle end is moulded into the cup wall.');
        const wheel = seat.part('cylinder', [0, 1, 0], [0.3, 0.06, 0.3], METAL);
        memberBetween(seat, shell[0], [0, 0.1, 0], wheel, [0, 1, 0], 0.08, METAL, `${ride.id}/cup-wheel-column/${j}`);
        const k = j % T.cupsPerTable, p = k * TAU / T.cupsPerTable, pinTop = TEACUP_BASE - T.plate;
        registerJoint(park, { name: `${ride.id}/cup-bearing/${j}`, kind: 'hinge', a: partAnchor(cupPins[j], [Math.cos(p) * T.cupOffset, pinTop, Math.sin(p) * T.cupOffset], [0, 1, 0]), b: partAnchor(movingPin, [0, -T.plate, 0], [0, 1, 0]), rationale: 'The cup thrust plate turns on its bearing pin on the small turntable.' });
        for (let s = 0; s < 4; s++) { const a = teacupSeatAngle(s); rideSeat(park, id, ride, [Math.cos(a) * T.seatRadius, T.seatY, Math.sin(a) * T.seatRadius], Math.PI / 2 - a, pal.primary, false, T.floorTop); }
      } else {
        // Moulded two-seat car: floor, side walls and a back wall toward the unit pole; the front stays open for boarding.
        // The car frame's origin is on the floor underside, its back (+z) toward the unit pole.
        const S = SCRAMBLER, [halfX, halfZ] = S.carHalf, wall = 0.06, floorTop = 2 * S.floorHalf, wallHalfY = 0.35;
        const floor = seat.box([0, S.floorHalf, 0], [halfX, S.floorHalf, halfZ], pal.primary);
        const tub = [floor, ...[-1, 1].map(side => seat.box([side * (halfX - wall), floorTop + wallHalfY, 0], [wall, wallHalfY, halfZ], pal.primary)),
          seat.box([0, floorTop + wallHalfY, halfZ - wall], [halfX - 2 * wall, wallHalfY, wall], pal.secondary)];
        declareMonolith(park, `${ride.id}/scrambler-tub/${j}`, tub, 'Moulded car tub.');
        // The seat sweep from the unit hub ends inside the floor, bolted under the back of the car.
        const sweep = satellites[Math.floor(j / S.carsPerUnit)].sweeps[j % S.carsPerUnit], into: Vec3 = [0, S.floorHalf, halfZ - 0.1];
        insertEnd(park, floor, sweep, 1, `${ride.id}/scrambler-car/${j}/sweep`, 'The seat sweep end is bolted inside the car floor at its back.');
        const p = (j % S.carsPerUnit) * TAU / S.carsPerUnit, reachInUnit = r * S.offset - halfZ + 0.1;
        registerJoint(park, { name: `${ride.id}/scrambler-car/${j}`, kind: 'fixed', a: partAnchor(sweep, [Math.cos(p) * reachInUnit, S.sweepY - S.bodyY, Math.sin(p) * reachInUnit]), b: partAnchor(floor, into), rationale: 'The car is bolted to the end of its seat sweep.' });
        for (const side of [-1, 1]) rideSeat(park, id, ride, [side * S.seatX, S.seatY, S.seatZ], 0, pal.secondary, true, floorTop);
      }
    }
  }
}

export function generatePark(recipeInput: ParkRecipe, sampler: TerrainSampler, onProgress?: ProgressFn): ParkData {
  const recipe = sanitizeParkRecipe(recipeInput), preset = PARK_PRESETS[recipe.size], rng = new Rng(deriveSeed(recipe.seed, 901));
  const layout = recipe.layout === 'random' ? rng.pick(PARK_LAYOUTS) : recipe.layout;
  const park: ParkData = { recipe, layout, bounds: { min: [-1000, 12, -1000], max: [1000, 100, 1000] }, entrance: 0, launch: { pos: [0, 12, 100], yaw: Math.PI }, rides: [], nodes: [], paths: [], parts: [], bodies: [], lights: [], rooms: [], routes: [] };
  const districtPlan = planParkDistricts(park), hub = districtPlan.hub;
  for (let i = 0; i < preset.rides; i++) {
    const isCoaster = i < preset.coasters;
    const family: RideFamily = isCoaster ? COASTER_FAMILIES[i % COASTER_FAMILIES.length] : FLAT_FAMILIES[(i - preset.coasters) % FLAT_FAMILIES.length];
    const rrng = new Rng(deriveSeed(recipe.seed, 902, i));
    const flatPose = isCoaster ? null : districtFlatPose(park, districtPlan, i - preset.coasters);
    const district = isCoaster ? districtPlan.districts[i] : flatPose!.district;
    const pos: Vec3 = [...(isCoaster ? district.center : flatPose!.pos)];
    const yaw = isCoaster ? district.yaw : flatPose!.yaw, theme = district.theme;
    const duplicate = park.rides.filter(r => r.family === family).length;
    const ride: RideDefinition = { id: i, family, name: `${NAMES[family]}${duplicate ? ` ${duplicate + 1}` : ''}`, pos, yaw, theme,
      radius: family === 'wheel' ? 24 : family === 'ship' || family === 'pendulum' ? 19 : 12,
      height: family === 'enterprise' ? 18.4 : family === 'topspin' ? 16.5 : family === 'drop' ? 62 : family === 'observation' ? 48 : family === 'swings' ? 21 : family === 'ship' || family === 'pendulum' ? 27 : 8,
      capacity: isCoaster ? 20 : family === 'enterprise' || family === 'topspin' ? 40 : family === 'wheel' ? 48 : family === 'teacups' || family === 'scrambler' ? 24 : 16,
      station: 0, queue: [], exit: [], boarding: [], cars: isCoaster ? 5 : 0, trains: isCoaster && (family === 'steel' || family === 'launch' || family === 'hyper') ? 2 : 1,
      carLength: 3.4, emptyCarMass: family === 'wooden' ? 750 : 900, dragArea: 1.5, rolling: 0.004,
      liftSpeed: family === 'launch' ? 11 : 3.5, motorForce: 80000, motorPower: family === 'launch' ? 1500000 : family === 'enterprise' ? 90000 : family === 'topspin' ? 220000 : 350000, motorTorque: family === 'enterprise' ? 30000 : family === 'topspin' ? 350000 : 40000, brakeForce: 90000,
      targetOmega: family === 'enterprise' ? 1.32 : family === 'topspin' ? 0.75 : family === 'wheel' ? 0.065 : family === 'swings' ? 0.8 : 0.42, inertia: family === 'topspin' ? 100000 : 90000, duration: family === 'enterprise' ? 95 : rrng.range(45, 85), bodies: [], maxG: isCoaster ? 5.5 : family === 'enterprise' ? 2.6 : 4, maxJerk: 180 };
    if (isCoaster) {
      const template = coasterLayout(family as CoasterFamily, rrng);
      ride.curve = compileCurve(template.points.map(p => yawPoint(pos, yaw, p)), template.station, template.lift, template.brake, 24);
      ride.preflight = preflightCoaster(ride);
      if (ride.preflight.maxG > ride.maxG || ride.preflight.maxJerk > ride.maxJerk) throw new Error(`${ride.name}: design exceeds its force envelope`);
    }
    const approach = yawPoint(pos, yaw, isCoaster ? [-92, 0.2, 105] : [0, 0.2, ride.radius + 14]);
    ride.station = node(park, yawPoint(approach, yaw, [-1.4, 0, -2.5]), 'station');
    let nearest = district.loop[0]; for (const n of district.loop) if (distance(park.nodes[n].pos, approach) < distance(park.nodes[nearest].pos, approach)) nearest = n;
    connect(park, nearest, ride.station, 6);
    for (let q = 0; q < 72; q++) {
      const lane = Math.floor(q / 18), k = q % 18;
      ride.queue.push(yawPoint(approach, yaw, [-5 + lane * 1.2, 0, (lane % 2 ? 17 - k : k) * 0.85]));
    }
    ride.exit = [yawPoint(approach, yaw, [8, 0, -3]), park.nodes[ride.station].pos];
    park.rides.push(ride);
    const firstPart = park.parts.length;
    if (isCoaster) coasterAssets(park, ride); else flatAssets(park, ride);
    attractionScenery(park, ride, true);
    markRideParts(park.parts, firstPart, ride.id);
    onProgress?.(`Building ${ride.name}`, 0.15 + 0.65 * (i + 1) / preset.rides);
  }
  const b = new Parts(park, [0, 0, 0], 0, -1, 'path');
  for (let i = 0; i < (recipe.size === 'compact' ? 8 : 0); i++) {
    const a = i * TAU / 8 + 0.25, p: Vec3 = [Math.cos(a) * 65, 12, Math.sin(a) * 65];
    const theme = recipe.theme === 'mixed' ? PARK_THEMES[i] : recipe.theme;
    themedBuilding(park, p, Math.PI / 2 - a, theme, deriveSeed(recipe.seed, 947, i));
    const kiosk = node(park, [p[0] * 0.9, 12.2, p[2] * 0.9], 'facility'); connect(park, hub, kiosk, 4);
  }
  buildDistrictArchitecture(park, districtPlan);
  // Public paths, kerbs, lamps, benches and kiosks are generated from the navigation graph.
  routeParkPaths(park);
  paveRideAccess(park);
  const crossesPath = (x: number, z: number, margin: number, own: typeof park.paths[number]): boolean => park.paths.some(other => {
    if (other === own) return false;
    const a = park.nodes[other.a].pos, c = park.nodes[other.b].pos, dx = c[0] - a[0], dz = c[2] - a[2];
    const f = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - a[0] - f * dx, z - a[2] - f * dz) < other.width / 2 + margin;
  });
  // Lamps and benches go only where nothing is already built (ride scenery, walls, fences, trees).
  const room = furnitureClearance(park);
  for (const path of park.paths) {
    const a = park.nodes[path.a].pos, c = park.nodes[path.b].pos, d = distance(a, c), yaw = Math.atan2(c[0] - a[0], c[2] - a[2]);
    surfaceStrip(b, a, c, path.width);
    for (let j = 0; j < d; j += 35) {
      const f = j / d, px = a[0] + (c[0] - a[0]) * f + Math.cos(yaw) * (path.width / 2 + 1), pz = a[2] + (c[2] - a[2]) * f - Math.sin(yaw) * (path.width / 2 + 1);
      if (crossesPath(px, pz, 0.4, path) || park.lights.some(l => l.room < 0 && Math.hypot(l.pos[0] - px, l.pos[2] - pz) < 12) || !room.pole(px, pz)) continue;
      const pole = b.rod([px, 12, pz], [px, 17, pz], 0.09, METAL), globe = b.sphere([px, 17, pz], 0.24, [1, 1, 1], { solid: false });
      insertEnd(park, globe, pole, 1, 'path-lamp/globe', 'The pole top is set into the lamp globe fitting.');
      luminaire(park, [globe], { color: [1, 0.68, 0.32], candela: 1200, radius: 35, room: -1 });
      const bx = px + Math.cos(yaw) * 1.6 + Math.sin(yaw) * 2, bz = pz - Math.sin(yaw) * 1.6 + Math.cos(yaw) * 2;
      if (!crossesPath(bx, bz, 1.2, path) && room.bench(bx, bz, yaw - Math.PI / 2)) {
        parkBench(new Parts(park, [bx, PARK_GRADE, bz], yaw - Math.PI / 2, -1, 'furniture'));
      }
    }
  }
  plantDistrictCanopies(park, districtPlan);
  decoratePublicRealm(park);
  buildPublicKerbs(park);
  unionPublicPaving(park);
  const entry = new Parts(park, park.nodes[park.entrance].pos, 0, -1, 'building');
  entranceFrame(entry); sign(entry, 'WONDER PARK', [0, 11, -0.7], [0.95, 0.65, 0.15], 0.3);
  park.routes = buildParkRoutes(park);
  finalizeParkPlantings(park);
  onProgress?.('Park ready', 1);
  return park;
}

export function buildParkRoutes(park: ParkData): TrackData[] {
  const parkMap = { guests: park.recipe.guests, layout: park.layout, radius: PARK_PRESETS[park.recipe.size].radius + 210,
    rides: park.rides.map(r => ({ name: r.name, pos: r.pos, coaster: !!r.curve })), paths: park.paths.map(p => [park.nodes[p.a].pos, park.nodes[p.b].pos]),
    rails: park.rides.filter(r => r.curve).map(r => { const path: Vec3[] = [], rail = railSample(); for (let s = 0; s < r.curve!.length; s += 12) { sampleRail(r.curve!, s, rail); path.push([...rail.pos]); } return path; }) };
  const make = (id: string, path: Vec3[], closed: boolean, gates: boolean): TrackData => {
    // A closed path repeats its first point at the end; that point is gate 0 again, not a gate of its own.
    const ring = closed && path.length > 1 && distance(path[0], path[path.length - 1]) < 1e-6 ? path.slice(0, -1) : path;
    const gs = gates ? ring.filter((_, i) => i % Math.max(1, Math.floor(ring.length / 24)) === 0).map((pos, index, a) => {
      const next = a[(index + 1) % a.length]; return { index, kind: 'hoop' as const, pos, yaw: Math.atan2(-(next[0] - pos[0]), -(next[2] - pos[2])), pitch: Math.atan2(next[1] - pos[1], Math.hypot(next[0] - pos[0], next[2] - pos[2])), roll: 0, width: 7, height: 7 };
    }) : [];
    let length = 0; for (let i = 1; i < path.length; i++) length += distance(path[i - 1], path[i]);
    return { seed: park.recipe.seed, style: 'freestyle', gates: gs, obstacles: [], path, closed, length, start: park.launch, laps: 1, parkCourse: id, parkMap };
  };
  const routes = [make('free', [], false, false)];
  const tour: Vec3[] = [];
  for (let i = 0; i <= 144; i++) { const a = TAU * i / 144, r = park.recipe.size === 'compact' ? 110 : park.recipe.size === 'mega' ? 350 : 245; tour.push([Math.cos(a) * r, 38 + 4 * Math.sin(3 * a), Math.sin(a) * r]); }
  routes.push(make('tour', tour, true, true));
  for (const ride of park.rides) if (ride.curve) {
    const path: Vec3[] = [], s = railSample();
    for (let at = 0; at < ride.curve.length; at += 5) { sampleRail(ride.curve, at, s); const right = cross(s.tangent, s.up); path.push(add(s.pos, add(mul(s.up, 5.5), mul(right, ride.family === 'inverted' ? 4 : -4)))); }
    path.push([...path[0]]);
    routes.push(make(`coaster-${ride.id}`, path, true, false));
  }
  // The race course is built only for parks that ask for it: its corridor clears the trees along the line.
  if (park.recipe.route === 'race') { const race = buildRaceCourse(park, parkMap); if (race) routes.push(race); }
  return routes;
}

export function selectedParkTrack(park: ParkData): TrackData {
  const key = park.recipe.route === 'coaster' ? `coaster-${park.recipe.coaster}` : park.recipe.route;
  return park.routes.find(t => t.parkCourse === key) ?? park.routes[0];
}
