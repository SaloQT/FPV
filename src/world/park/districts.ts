import type { Vec3 } from '../../contracts';
import { Rng, deriveSeed } from '../track/rng';
import { axisAngle, inverseRotate, TAU, yawPoint } from './math';
import { Parts, METAL } from './parts';
import { PALETTES, PARK_PRESETS } from './recipe';
import { bandedColumn, sign } from './theme';
import { pitchedRoof, shopAwning, shopfront } from './architecture';
import { declareMonolith } from './construction';
import { PARK_THEMES, type ParkData, type ParkTheme } from './types';
import { PartBVH, partDistance } from './collision';
import { plantParkTree, plantingBounds } from './planting';
import { PARK_GRADE, PAVING_RISE, PAVING_TOP, surfaceBox, surfaceStrip } from './surfaces';
import { liddedBin } from './furniture';

export interface ParkDistrict {
  id: number;
  theme: ParkTheme;
  center: Vec3;
  yaw: number;
  loop: number[];
  entry: number;
  gateway: number;
}
export interface DistrictPlan { radius: number; hub: number; inner: number[]; village: number[]; outer: number[]; districts: ParkDistrict[] }
const node = (park: ParkData, pos: Vec3, kind: ParkData['nodes'][number]['kind'] = 'path') => park.nodes.push({ pos, links: [], kind }) - 1;
const link = (park: ParkData, a: number, b: number, width: number) => { if (a === b || park.nodes[a].links.includes(b)) return; park.paths.push({ a, b, width }); park.nodes[a].links.push(b); park.nodes[b].links.push(a); };
const nearest = (park: ParkData, nodes: number[], pos: Vec3) => nodes.reduce((a, b) => Math.hypot(park.nodes[a].pos[0] - pos[0], park.nodes[a].pos[2] - pos[2]) < Math.hypot(park.nodes[b].pos[0] - pos[0], park.nodes[b].pos[2] - pos[2]) ? a : b);
const LAND_GEOMETRY = {
  compact: { radius: 325, inner: 64, courtZ: 202, courtX: 89, courtDepth: 69, flatZ: 189, thirdFlatZ: 230, retailZ: 282 },
  destination: { radius: 440, inner: 130, courtZ: 192, courtX: 92, courtDepth: 65, flatZ: 176, thirdFlatZ: 225, retailZ: 272 },
  mega: { radius: 580, inner: 175, courtZ: 225, courtX: 104, courtDepth: 80, flatZ: 200, thirdFlatZ: 265, retailZ: 322 },
};

/** Where a district's street rows stand across the avenue, how far their yard slab reaches behind the centre line, and the half width of the
 * service compound that begins where that slab ends. */
const STREET_ROW_OFFSET = 29, ROW_YARD = 11, COMPOUND_HALF_WIDTH = 14;

/** Shared layout dimensions for inspection cameras and procedural land construction. */
export function parkDistrictGeometry(size: ParkData['recipe']['size']): Readonly<typeof LAND_GEOMETRY[keyof typeof LAND_GEOMETRY]> {
  return LAND_GEOMETRY[size];
}

/** Organize land parcels before drawing anything: nested promenades and compact attraction courts. */
export function planParkDistricts(park: ParkData): DistrictPlan {
  const preset = PARK_PRESETS[park.recipe.size], rng = new Rng(deriveSeed(park.recipe.seed, 955));
  const geometry = LAND_GEOMETRY[park.recipe.size], radius = geometry.radius, innerRadius = geometry.inner;
  const offset = rng.range(-0.06, 0.06), themeOffset = rng.int(0, 7), hub = node(park, [0, 12.2, 0]);
  const ring = (r: number, count: number, width: number, irregularity: number): number[] => {
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      const a = i * TAU / count, shape = 1 + irregularity * Math.sin(a * 3 + offset * 10) + irregularity * 0.45 * Math.sin(a * 5 - 0.7);
      const sx = park.layout === 'boardwalk' ? 1.025 : 1, sz = park.layout === 'boardwalk' ? 0.94 : park.layout === 'valley' ? 0.88 : 1;
      result.push(node(park, [Math.cos(a) * r * shape * sx, 12.2, Math.sin(a) * r * shape * sz]));
    }
    for (let i = 0; i < count; i++) link(park, result[i], result[(i + 1) % count], width);
    return result;
  };
  const inner = ring(innerRadius, 36, 9, 0.04), village = park.recipe.size === 'compact' ? [] : ring(69, 24, 9, 0), outer: number[] = [];
  const spokeStep = park.layout === 'loop' || park.layout === 'valley' ? 18 : park.layout === 'boardwalk' ? 9 : 6;
  for (let i = 0; i < 36; i += spokeStep) {
    const villageNode = village[Math.round(i / 36 * village.length)];
    if (village.length) { link(park, hub, villageNode, 10); link(park, villageNode, inner[i], 10); }
    else link(park, hub, inner[i], 10);
  }
  const districts: ParkDistrict[] = [];
  for (let i = 0; i < preset.coasters; i++) {
    const a = i * TAU / preset.coasters + offset, center: Vec3 = [Math.cos(a) * radius, 12, Math.sin(a) * radius], yaw = Math.atan2(-Math.cos(a), -Math.sin(a));
    const theme = park.recipe.theme === 'mixed' ? PARK_THEMES[(i + themeOffset) % PARK_THEMES.length] : park.recipe.theme;
    const loop: number[] = [], zCenter = geometry.courtZ, xRadius = geometry.courtX * rng.range(0.93, 1.13), zRadius = geometry.courtDepth * rng.range(0.9, 1.08);
    const formal = theme === 'space' || theme === 'western' || theme === 'steampunk', phase = rng.range(0, TAU);
    for (let j = 0; j < 20; j++) {
      const t = j * TAU / 20, sx = Math.sin(t), sz = Math.cos(t);
      // Rectangular civic courts and organic garden loops share gateways but have distinct site plans.
      const x = formal ? Math.sign(sx) * Math.pow(Math.abs(sx), 0.58) : sx * (1 + 0.1 * Math.sin(t * 3 + phase));
      const z = formal ? Math.sign(sz) * Math.pow(Math.abs(sz), 0.75) : sz * (1 + 0.09 * Math.sin(t * 2 + phase));
      loop.push(node(park, yawPoint(center, yaw, [-92 + x * xRadius, 0.2, zCenter - z * zRadius])));
    }
    for (let j = 0; j < loop.length; j++) link(park, loop[j], loop[(j + 1) % loop.length], 7);
    const entry = loop[0], gateway = loop[10];
    link(park, gateway, nearest(park, inner, park.nodes[gateway].pos), 10);
    outer.push(loop[5], loop[15]);
    districts.push({ id: i, theme, center, yaw, loop, entry, gateway });
  }
  // The land courts themselves form the outer promenade. A second parallel ring previously doubled
  // walking distances and generated unoccupied strips between nearly identical circulation loops.
  for (let i = 0; i < districts.length; i++) link(park, districts[i].loop[5], districts[(i + 1) % districts.length].loop[15], park.layout === 'boardwalk' ? 12 : 10);
  // The entrance uses a gap between coaster parcels, with a real main street to the central gardens.
  const step = TAU / preset.coasters, entranceAngle = (Math.round((Math.PI / 2 - offset) / step - 0.5) + 0.5) * step + offset;
  park.entrance = node(park, [Math.cos(entranceAngle) * (radius + 70), 12.2, Math.sin(entranceAngle) * (radius + 70)], 'entrance');
  const outerEntry = nearest(park, outer, park.nodes[park.entrance].pos), innerEntry = nearest(park, inner, park.nodes[park.entrance].pos);
  link(park, park.entrance, outerEntry, 14); link(park, outerEntry, innerEntry, 14);
  park.launch = { pos: [park.nodes[park.entrance].pos[0], 12, park.nodes[park.entrance].pos[2]], yaw: Math.atan2(park.nodes[park.entrance].pos[0], park.nodes[park.entrance].pos[2]) };
  return { radius, hub, inner, village, outer, districts };
}

export function districtFlatPose(park: ParkData, plan: DistrictPlan, index: number): { district: ParkDistrict; pos: Vec3; yaw: number } {
  const district = plan.districts[index % plan.districts.length], slot = Math.floor(index / plan.districts.length), geometry = LAND_GEOMETRY[park.recipe.size];
  const locations: Vec3[] = [[-144, 0, geometry.flatZ], [-40, 0, geometry.flatZ], [-92, 0, geometry.thirdFlatZ]];
  const local = locations[slot % locations.length], pos = yawPoint(district.center, district.yaw, local);
  return { district, pos, yaw: district.yaw + (slot === 0 ? -Math.PI / 2 : slot === 1 ? Math.PI / 2 : 0) };
}

/** Every storefront unit is 12.8 m wide; its walls are 0.2 m thick and their outer faces lie 9.9 m either side of the centre line. */
const UNIT_HALF = 6.4, ROW_DEPTH = 9.9, ROW_WALL = 0.2;
/** Top of the wall shell, and top of the ceiling slab that lies on it. The roof, parapet or roof plant stands on the slab. */
const ROW_EAVE = 5.92, ROW_DECK = 6.1;
/** A fantasy row has a round tower against each end wall; this is the tower's footing radius. */
const ROW_TOWER = 1.32;

/** Half the length of a row's footprint along its street, including anything that stands against its ends. */
export function storefrontExtent(units: number, theme: ParkTheme): number {
  return units * UNIT_HALF + (theme === 'fantasy' ? 2 * ROW_TOWER : 0);
}

/** A terrace of shops under one roof deck. Wall shell, shopfronts, awnings, roofs and roof plant all derive from the same
 * unit width, wall thickness and deck height. `rear` is false when a larger building stands against the back wall. */
export function storefrontBlock(park: ParkData, pos: Vec3, yaw: number, theme: ParkTheme, seed: number, units = 3, rear = true): void {
  const b = new Parts(park, pos, yaw, -1, 'building'), p = PALETTES[theme], rng = new Rng(seed), half = units * UNIT_HALF;
  const plaster: Vec3 = theme === 'space' ? [0.4, 0.46, 0.49] : theme === 'western' ? [0.38, 0.25, 0.13] : [0.56, 0.5, 0.4];
  const wall = { metalness: 0, roughness: 0.85, surface: theme === 'western' ? 'timber' as const : 'masonry' as const };
  const floor = PAVING_RISE, yardHalf = half + 0.3 + (theme === 'fantasy' ? 2 * ROW_TOWER : 0), yardBack = rear ? ROW_YARD : ROW_DEPTH;
  // The yard slab ends at the back wall when another building stands against it.
  surfaceBox(b, [0, (yardBack - ROW_YARD) / 2], [yardHalf, (yardBack + ROW_YARD) / 2], [0.34, 0.32, 0.28]);
  surfaceBox(b, [0, -(14 + ROW_YARD) / 2], [yardHalf, (14 - ROW_YARD) / 2]);
  // Back wall, then end walls between the shopfront and the back wall, then the ceiling slab across all of them.
  const wallMid = (floor + ROW_EAVE) / 2, wallHalf = (ROW_EAVE - floor) / 2;
  b.box([0, wallMid, ROW_DEPTH - ROW_WALL / 2], [half, wallHalf, ROW_WALL / 2], plaster, wall);
  for (const x of [-half + ROW_WALL, half - ROW_WALL]) b.box([x, wallMid, 0], [ROW_WALL, wallHalf, ROW_DEPTH - ROW_WALL], plaster, wall);
  b.box([0, (ROW_EAVE + ROW_DECK) / 2, 0], [half, (ROW_DECK - ROW_EAVE) / 2, ROW_DEPTH], [0.15, 0.17, 0.16], { metalness: 0.15, roughness: 0.8 });
  const labels = ['TRADING CO', 'FAMILY KITCHEN', 'ICE CREAM', 'OUTFITTERS', 'MARKET HALL', 'SWEET SHOP'];
  const pitched = theme === 'alpine' || theme === 'jungle' || theme === 'fantasy' || theme === 'seaside';
  // A parapet is a wall on the slab at the front edge; the pitched themes have a roof end there instead.
  const parapetHalf = ROW_WALL;
  const parapet = (x: number, halfWidth: number, top: number, color: Vec3): void => {
    b.box([x, (ROW_DECK + top) / 2, -ROW_DEPTH + parapetHalf], [halfWidth, (top - ROW_DECK) / 2, parapetHalf], color, { surface: theme === 'western' ? 'timber' : 'masonry', roughness: 0.8 });
  };
  for (let i = 0; i < units; i++) {
    const x = (i - (units - 1) / 2) * 2 * UNIT_HALF, color = p.primary.map(v => v * rng.range(0.7, 1.08)) as Vec3;
    shopfront(b, x, UNIT_HALF, -ROW_DEPTH + ROW_WALL / 2, ROW_EAVE, 3.8, 2, plaster, p.timber, wall);
    shopAwning(b, x, 6.32, -ROW_DEPTH, -13.05, 4.17, 0.28, color);
    // The sign board hangs 0.1 m off the wall face on two spacers.
    sign(b, labels[(i + seed) % labels.length], [x, 4.93, -ROW_DEPTH - 0.29], [0.8, 0.7, 0.5], 0.105, -ROW_DEPTH);
    const top = 7.15 + i % 2 * 0.7;
    if (pitched) {
      const roofColor: Vec3 = theme === 'alpine' ? [0.15, 0.21, 0.18] : theme === 'jungle' ? [0.29, 0.22, 0.1] : theme === 'fantasy' ? [0.3, 0.095, 0.13] : [0.18, 0.29, 0.32];
      const roof = new Parts(park, yawPoint(pos, yaw, [x, 0, 0]), yaw, -1, 'building');
      // Neighbouring roofs meet at their valley; their water runs to internal leaders, so no gutters hang from the eaves.
      pitchedRoof(roof, ROW_DECK, UNIT_HALF, ROW_DEPTH, theme === 'seaside' ? 1.65 : 2.25, roofColor, theme === 'jungle' ? 'timber' : 'paint', UNIT_HALF, ROW_DEPTH, plaster, { flushEave: true, drainage: false });
      if (rear && (theme === 'alpine' || theme === 'jungle')) {
        // The chimney stands against the back wall on the yard slab, clear of the roof's end.
        b.box([x + 3.3, (floor + 9) / 2, ROW_DEPTH + 0.55], [0.55, (9 - floor) / 2, 0.55], [0.37, 0.32, 0.27], { surface: 'masonry', roughness: 0.95 });
        b.box([x + 3.3, 9.12, ROW_DEPTH + 0.55], [0.67, 0.12, 0.67], [0.12, 0.14, 0.14], { metalness: 0.5 });
      }
    } else if (theme === 'western') {
      // A false front and two pilasters, standing in the plane of the front wall on the slab.
      const rise = 0.4 + i % 3 * 0.3, frontTop = 7.6 + rise;
      b.box([x, (ROW_DECK + frontTop) / 2, -ROW_DEPTH + parapetHalf], [4.8, (frontTop - ROW_DECK) / 2, parapetHalf], plaster, wall);
      b.box([x, frontTop + 0.1, -ROW_DEPTH + parapetHalf], [4.95, 0.1, 0.3], p.timber, { surface: 'timber' });
      for (const xx of [-5.7, 5.7]) b.box([x + xx, (ROW_DECK + 7.7) / 2, -ROW_DEPTH + parapetHalf], [0.15, (7.7 - ROW_DECK) / 2, parapetHalf], p.timber, { surface: 'timber' });
    } else if (theme === 'space') {
      parapet(x, 5.4, top, color);
      // A low drum on the slab carries the dome; the two are one moulded shell.
      const drum = b.part('cylinder', [x, ROW_DECK + 0.45, 1.4], [4.8, 0.45, 4.8], p.secondary, { metalness: 0.35, roughness: 0.42 });
      const dome = b.part('sphere', [x, ROW_DECK + 0.9, 1.4], [4.8, 0.9, 4.8], p.secondary, { metalness: 0.35, roughness: 0.42 });
      declareMonolith(park, 'rooftop drum and dome', [drum, dome], 'The dome shell and its drum are one moulded roof structure; the lower half of the dome lies inside the drum.');
      for (const xx of [-5.85, 5.85]) {
        b.box([x + xx, (ROW_DECK + 8.1) / 2, -ROW_DEPTH + parapetHalf], [0.23, (8.1 - ROW_DECK) / 2, parapetHalf], p.primary);
        b.box([x + xx, 7.1, -ROW_DEPTH - 0.0125], [0.065, 0.85, 0.0125], p.accent, { solid: false, emissive: 0.015, detail: 1 });
      }
    } else if (theme === 'steampunk') {
      parapet(x, 6.27, top, color);
      // A shallow vaulted hull on a low base, with a steam stack at each side.
      const hullColor: Vec3 = [0.25, 0.18, 0.09];
      const base = b.box([x, ROW_DECK + 0.6, 0], [4.6, 0.6, 9.5], hullColor, { surface: 'paint', metalness: 0.6, roughness: 0.6 });
      const hull = b.part('sphere', [x, ROW_DECK + 1.2, 0], [4.6, 1.2, 9.5], hullColor, { surface: 'paint', metalness: 0.6, roughness: 0.6 });
      declareMonolith(park, 'rooftop hull and base', [base, hull], 'The hull shell and its base are one riveted roof structure; the lower half of the hull lies inside the base.');
      for (const xx of [-5.4, 5.4]) for (const zz of [-5, 5]) {
        b.part('cylinder', [x + xx, ROW_DECK + 0.8, zz], [0.3, 0.8, 0.3], p.secondary, { metalness: 0.4, roughness: 0.7 });
        b.part('cylinder', [x + xx, ROW_DECK + 1.68, zz], [0.4, 0.08, 0.4], METAL);
      }
    } else {
      parapet(x, 6.27, top, color);
      b.part('cone', [x, ROW_DECK + 1.45, 0], [5.95, 1.45, 5.95], color, { surface: 'fabric', roughness: 0.9 });
      for (const xx of [-5.7, 5.7]) b.rod([x + xx, top, -ROW_DEPTH + parapetHalf], [x + xx, top + 1.8, -ROW_DEPTH + parapetHalf], 0.045, METAL);
    }
    // Rooftop plant stands at the back of the slab, clear of the roof feature in front of it.
    if (theme === 'western' || theme === 'space' || theme === 'carnival') b.box([x, ROW_DECK + 0.65, 7.9], [1.6, 0.65, 1.5], [0.24, 0.27, 0.28], { metalness: 0.4, roughness: 0.65, category: 'service' });
  }
  if (theme === 'fantasy') for (const side of [-1, 1]) {
    // Each tower stands on the yard slab, tangent to the end wall through its footing ring.
    const tx = side * (half + ROW_TOWER), tz = -7.5, radius = 1.2, height = 9.2;
    bandedColumn(b, tx, tz, floor, height, radius, p.secondary, [0.5, 6.1, 8.7].map(y => ({ y, halfHeight: 0.14, radius: ROW_TOWER, color: [0.38, 0.35, 0.29] as Vec3, options: { metalness: 0 } })), { surface: 'masonry', roughness: 0.85 });
    b.part('cone', [tx, height + 1.4, tz], [1.5, 1.4, 1.5], p.primary, { metalness: 0.15 });
  }
}

/** Restaurants and retail have real kitchens and storage behind the street facade, with roof plant on top. The block stands against a
 * `storefrontBlock`'s back wall (built with `rear` false); its roof slab lies on its walls, and the plant and rear doors on the slab
 * and the back wall. */
export function kitchenBlock(park: ParkData, center: Vec3, yaw: number, theme: ParkTheme): void {
  const back = new Parts(park, center, yaw, -1, 'building'), p = PALETTES[theme];
  const frontZ = ROW_DEPTH, backZ = 37.6, midZ = (frontZ + backZ) / 2, halfDepth = (backZ - frontZ) / 2, wallTop = 7.1, slabHalf = 0.18;
  back.box([0, wallTop / 2, midZ], [22, wallTop / 2, halfDepth], [0.4, 0.38, 0.32], { surface: 'masonry', roughness: 0.9 });
  back.box([0, wallTop + slabHalf, midZ + 0.15], [22.3, slabHalf, halfDepth + 0.15], [0.16, 0.18, 0.17], { roughness: 0.85, metalness: 0.1 });
  for (const x of [-16, 0, 16]) {
    back.box([x, wallTop + 2 * slabHalf + 0.5, 25], [2.4, 0.5, 3], [0.28, 0.3, 0.31], { category: 'service', metalness: 0.5, roughness: 0.6 });
    back.box([x, 2, backZ + 0.08], [1.6, 2, 0.08], p.timber, { surface: 'timber', roughness: 0.8 });
  }
}

/** A fenced backstage pad with two maintenance sheds and three bins. `side` (-1 or 1) picks the pad edge that carries the long fence;
 * the sheds' doors face the middle of the pad. */
export function serviceCompound(park: ParkData, pos: Vec3, yaw: number, side: number, theme: ParkTheme): void {
  const back = new Parts(park, pos, yaw, -1, 'service'), timber = PALETTES[theme].timber;
  // The fences stand on the pad: the end fences along its short edges, the side fence between them along the long edge.
  const pad = 0.12, padHalfX = COMPOUND_HALF_WIDTH, padHalfZ = 21, fence = 0.14, fenceHeight = 2.5, fenceMid = pad + (fenceHeight - pad) / 2, fenceHalf = (fenceHeight - pad) / 2;
  back.box([0, pad / 2, 0], [padHalfX, pad / 2, padHalfZ], [0.19, 0.18, 0.16], { surface: 'concrete', roughness: 0.95 });
  for (const zz of [-1, 1]) back.box([0, fenceMid, zz * (padHalfZ - fence)], [padHalfX, fenceHalf, fence], timber, { surface: 'timber', roughness: 0.9 });
  back.box([side * (padHalfX - fence), fenceMid, 0], [fence, fenceHalf, padHalfZ - 2 * fence], timber, { surface: 'timber', roughness: 0.9 });
  // Real occupied backstage space: maintenance sheds, screened bins and HVAC, not a blank pad.
  // Each shed stands on the pad, carries its roof slab on its top, and has its door panel and louvres on its inner face.
  const shedTop = 5.12, shedHalf = (shedTop - pad) / 2, doorTop = 3.5;
  for (const zz of [-11, 8]) {
    back.box([side * 4, pad + shedHalf, zz], [8, shedHalf, 6], [0.29, 0.31, 0.28], { surface: 'paint', roughness: 0.8, category: 'building' });
    back.box([side * 4, shedTop + 0.14, zz], [8.3, 0.14, 6.3], [0.15, 0.17, 0.16], { metalness: 0.35, roughness: 0.7, category: 'building' });
    back.box([side * (-4 - 0.08), (pad + doorTop) / 2, zz], [0.08, (doorTop - pad) / 2, 3], [0.12, 0.14, 0.14], { metalness: 0.35, roughness: 0.65 });
    for (let y = 0.45; y < doorTop; y += 0.32) back.box([side * -4.2, y, zz], [0.04, 0.025, 2.9], METAL, { detail: 1 });
  }
  for (const zz of [-3, 0, 3]) liddedBin(back, side * -9, zz, 0.12);
}

/** Urban blocks are composed around the circulation plan, before obstacle-aware path routing. */
export function buildDistrictArchitecture(park: ParkData, plan: DistrictPlan): void {
  if (plan.village.length) for (let i = 0; i < 6; i++) {
    const a = (i + 0.5) * TAU / 6, center: Vec3 = [Math.cos(a) * 88, 12, Math.sin(a) * 88], yaw = Math.PI / 2 - a;
    const theme = park.recipe.theme === 'mixed' ? PARK_THEMES[i % PARK_THEMES.length] : park.recipe.theme;
    storefrontBlock(park, center, yaw, theme, deriveSeed(park.recipe.seed, 958, i), 4, false);
    const facility = node(park, [Math.cos(a) * 73.5, 12.2, Math.sin(a) * 73.5], 'facility'); link(park, plan.village[i * 4 + 2], facility, 4);
    kitchenBlock(park, center, yaw, theme);
  }
  for (const d of plan.districts) {
    // Two continuous street edges at each inward-facing gateway. Facades face the approach avenue.
    const z = LAND_GEOMETRY[park.recipe.size].retailZ;
    for (const side of [-1, 1]) {
      const pos = yawPoint(d.center, d.yaw, [-92 + side * STREET_ROW_OFFSET, 0, z]);
      storefrontBlock(park, pos, d.yaw + side * Math.PI / 2, d.theme, deriveSeed(park.recipe.seed, 956, d.id * 2 + side + 1), park.recipe.size === 'compact' ? 2 : 3);
      const apron = yawPoint(d.center, d.yaw, [-92 + side * 14, 0.2, z]);
      const facility = node(park, apron, 'facility'); link(park, facility, d.gateway, 4);
    }
    // A screened compound belongs to the land, with no public shortcuts through service doors.
    for (const side of [-1, 1]) serviceCompound(park, yawPoint(d.center, d.yaw, [-92 + side * (STREET_ROW_OFFSET + ROW_YARD + COMPOUND_HALF_WIDTH), 0, z]), d.yaw, side, d.theme);
  }
  // Main Street is an occupied arrival corridor. Place real rows only in plots clear of every ride and road.
  const entryPath = park.paths.find(p => p.a === park.entrance || p.b === park.entrance);
  if (entryPath) {
    const end = entryPath.a === park.entrance ? entryPath.b : entryPath.a, a = park.nodes[park.entrance].pos, c = park.nodes[end].pos, dx = c[0] - a[0], dz = c[2] - a[2], length = Math.hypot(dx, dz), heading = Math.atan2(dx, dz);
    const toLocal = (pos: Vec3, center: Vec3, yaw: number): Vec3 => { const x = pos[0] - center[0], z = pos[2] - center[2]; return [Math.cos(yaw) * x - Math.sin(yaw) * z, pos[1] - center[1], Math.sin(yaw) * x + Math.cos(yaw) * z]; };
    const plotClear = (center: Vec3, yaw: number, half: number): boolean => {
      for (const ride of park.rides) if (!ride.curve) { const p = toLocal(ride.pos, center, yaw); if (Math.hypot(Math.max(0, Math.abs(p[0]) - half), Math.max(0, Math.abs(p[2]) - 14)) < ride.radius + 5) return false; }
      for (const path of park.paths) {
        if (path === entryPath) continue;
        const p = park.nodes[path.a].pos, q = park.nodes[path.b].pos, count = Math.ceil(Math.hypot(q[0] - p[0], q[2] - p[2]) / 4);
        for (let k = 0; k <= count; k++) { const t = k / Math.max(1, count), v = toLocal([p[0] + (q[0] - p[0]) * t, 12, p[2] + (q[2] - p[2]) * t], center, yaw); if (Math.abs(v[0]) < half + path.width / 2 + 2 && Math.abs(v[2]) < 14 + path.width / 2 + 2) return false; }
      }
      const rotation = axisAngle([0, 1, 0], yaw);
      for (const p of park.parts) {
        if (!p.solid || p.body >= 0 || Math.hypot(p.pos[0] - center[0], p.pos[2] - center[2]) > Math.hypot(half, 14) + Math.hypot(...p.half) + 2) continue;
        // Conservative projection of the oriented primitive bounds reserves roofs, rail corridors and walls.
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let k = 0; k < 8; k++) {
          const v: Vec3 = [(k & 1 ? 1 : -1) * p.half[0], (k & 2 ? 1 : -1) * p.half[1], (k & 4 ? 1 : -1) * p.half[2]];
          const q = [-p.rot[0], -p.rot[1], -p.rot[2], p.rot[3]] as [number, number, number, number]; inverseRotate(q, v, v);
          v[0] += p.pos[0] - center[0]; v[1] += p.pos[1] - center[1]; v[2] += p.pos[2] - center[2]; inverseRotate(rotation, v, v);
          for (let j = 0; j < 3; j++) { min[j] = Math.min(min[j], v[j]); max[j] = Math.max(max[j], v[j]); }
        }
        if (max[1] > 0.65 && min[1] < 9 && min[0] < half + 1 && max[0] > -half - 1 && min[2] < 14 && max[2] > -14) return false;
      }
      return true;
    };
    const junctions: { id: number; at: number }[] = [];
    for (let at = 36; at < length - 28; at += 57) {
      let junction = -1;
      for (const side of [-1, 1]) {
        const units = side > 0 && junctions.length % 2 ? 3 : 4, yaw = heading + side * Math.PI / 2, t = at / length, offset = entryPath.width / 2 + 14;
        const pos: Vec3 = [a[0] + dx * t + Math.cos(heading) * side * offset, 12, a[2] + dz * t - Math.sin(heading) * side * offset];
        if (!plotClear(pos, yaw, storefrontExtent(units, park.recipe.theme === 'mixed' ? 'seaside' : park.recipe.theme) + 0.5)) continue;
        const theme = park.recipe.theme === 'mixed' ? 'seaside' : park.recipe.theme;
        storefrontBlock(park, pos, yaw, theme, deriveSeed(park.recipe.seed, 959, Math.round(at) + side), units);
        if (junction < 0) { junction = node(park, [a[0] + dx * t, 12.2, a[2] + dz * t]); junctions.push({ id: junction, at }); }
        const facility = node(park, yawPoint(pos, yaw, [0, 0.2, -14]), 'facility'); link(park, junction, facility, 3.5);
      }
    }
    if (junctions.length) {
      park.paths.splice(park.paths.indexOf(entryPath), 1);
      park.nodes[park.entrance].links = park.nodes[park.entrance].links.filter(id => id !== end); park.nodes[end].links = park.nodes[end].links.filter(id => id !== park.entrance);
      let previous = park.entrance; for (const j of junctions) { link(park, previous, j.id, entryPath.width); previous = j.id; } link(park, previous, end, entryPath.width);
    }
  }
}

/** Mature avenues first, then planted buffers; small decorative shrubs cannot exhaust their budget. */
export function plantDistrictCanopies(park: ParkData, plan: DistrictPlan): void {
  const rng = new Rng(deriveSeed(park.recipe.seed, 957)), solids = park.parts.filter(p => p.solid && p.body < 0 && p.category !== 'landscape');
  const bounds = new Float64Array(solids.length * 6);
  solids.forEach((p, i) => {
    const [x, y, z, w] = p.rot, h = p.half, m = [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
    for (let k = 0; k < 3; k++) { const extent = Math.abs(m[k * 3]) * h[0] + Math.abs(m[k * 3 + 1]) * h[1] + Math.abs(m[k * 3 + 2]) * h[2]; bounds[i * 6 + k] = p.pos[k] - extent; bounds[i * 6 + k + 3] = p.pos[k] + extent; }
  });
  const tree = new PartBVH(solids, bounds), local: Vec3 = [0, 0, 0], normal: Vec3 = [0, 1, 0], cells = new Map<string, { pos: Vec3; radius: number }[]>();
  const occupancy = (pos: Vec3, radius: number, insert: boolean) => {
    const gx = Math.floor(pos[0] / 18), gz = Math.floor(pos[2] / 18);
    if (insert) { const key = `${gx},${gz}`, list = cells.get(key) ?? []; list.push({ pos, radius }); cells.set(key, list); return true; }
    for (let z = gz - 1; z <= gz + 1; z++) for (let x = gx - 1; x <= gx + 1; x++) for (const p of cells.get(`${x},${z}`) ?? []) if (Math.hypot(p.pos[0] - pos[0], p.pos[2] - pos[2]) < (p.radius + radius) * 0.7) return false;
    return true;
  };
  for (const plant of park.plantings ?? []) occupancy(plant.pos, plantingBounds(plant).radius, true);
  const distanceTo = (pos: Vec3, a: Vec3, b: Vec3) => { const dx = b[0] - a[0], dz = b[2] - a[2], t = Math.max(0, Math.min(1, ((pos[0] - a[0]) * dx + (pos[2] - a[2]) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(pos[0] - a[0] - t * dx, pos[2] - a[2] - t * dz); };
  let added = 0; const limit = park.recipe.size === 'compact' ? 1150 : 2100;
  const addTree = (pos: Vec3, avenue: boolean): void => {
    if (added >= limit) return;
    const variant = rng.range(0, 1) < 0.8 ? rng.pick([3, 4]) : rng.pick([2, 5]);
    const yaw = rng.range(0, TAU), base = plantingBounds({ pos, yaw, variant, scale: 1, tint: [1, 1, 1] });
    const radius = rng.range(avenue ? 4.8 : 5.2, avenue ? 6.6 : 7), scale = radius / base.radius;
    if (!occupancy(pos, radius, false)) return;
    // A hollow show building is still an indoor parcel, never an unoccupied planting plot.
    for (const room of park.rooms) if (pos[0] > room.min[0] - radius && pos[0] < room.max[0] + radius && pos[2] > room.min[2] - radius && pos[2] < room.max[2] + radius) return;
    for (const path of park.paths) if (distanceTo(pos, park.nodes[path.a].pos, park.nodes[path.b].pos) < path.width / 2 + 1.8) return;
    for (const ride of park.rides) {
      if (!ride.curve && Math.hypot(pos[0] - ride.pos[0], pos[2] - ride.pos[2]) < ride.radius + radius + 4) return;
      const reserved = [park.nodes[ride.station].pos, ...ride.queue, ...ride.boarding, ...ride.exit];
      for (let i = 1; i < reserved.length; i++) if (distanceTo(pos, reserved[i - 1], reserved[i]) < 2) return;
    }
    let clear = true;
    tree.query(pos[0], 13.4, pos[2], 1.6, i => {
      if (!clear || bounds[i * 6 + 4] < 12.65 || bounds[i * 6 + 1] > 14.3) return;
      const p = solids[i]; local[0] = pos[0] - p.pos[0]; local[1] = 13.4 - p.pos[1]; local[2] = pos[2] - p.pos[2]; inverseRotate(p.rot, local, local); if (partDistance(p, local, normal) < 1.6) clear = false;
    });
    if (!clear) return;
    const cy = 12 + base.height * scale * 0.62;
    tree.query(pos[0], cy, pos[2], radius, i => {
      if (!clear || solids[i].category === 'path' || solids[i].category === 'furniture') return;
      const p = solids[i]; local[0] = pos[0] - p.pos[0]; local[1] = cy - p.pos[1]; local[2] = pos[2] - p.pos[2]; inverseRotate(p.rot, local, local); if (partDistance(p, local, normal) < radius) clear = false;
    });
    if (!clear) return;
    if (plantParkTree(park, pos, { variant, scale, yaw, tint: [rng.range(0.86, 1.08), rng.range(0.9, 1.07), rng.range(0.8, 1.03)] })) { added++; occupancy(pos, radius, true); }
  };
  for (const path of park.paths) {
    const a = park.nodes[path.a].pos, b = park.nodes[path.b].pos, length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (length < 9 || path.width < 4) continue;
    for (let at = 6; at < length - 3; at += 12) for (const side of [-1, 1]) {
      const t = at / length, offset = side * (path.width / 2 + 3.2);
      addTree([a[0] + (b[0] - a[0]) * t + (b[2] - a[2]) / length * offset, 12, a[2] + (b[2] - a[2]) * t - (b[0] - a[0]) / length * offset], true);
    }
  }
  // Irregular native woodland stands occupy coaster infields and screen the service edge. Each land
  // gets discrete clumps with visible clearings; rows remain an avenue treatment beside public paths.
  for (const district of plan.districts) for (const center of [[-68, -24], [28, -18], [63, 39]]) {
    for (let i = 0; i < 46; i++) {
      const a = rng.range(0, TAU), r = Math.sqrt(rng.range(0, 1)), x = center[0] + Math.cos(a) * r * 49, z = center[1] + Math.sin(a) * r * 31;
      addTree(yawPoint(district.center, district.yaw, [x, 0, z]), false);
    }
  }
  // Deliberately irregular woodland and coaster infield planting; no regular lawn-sized voids.
  const samples: Vec3[] = [], extent = plan.radius + 70;
  for (let z = -extent; z <= extent; z += 17) for (let x = -extent; x <= extent; x += 17) if (Math.hypot(x, z) < extent) samples.push([x + rng.range(-5, 5), 12, z + rng.range(-5, 5)]);
  // Fill spaces nearest the circulation first, so woodland is seen from the park rather than spent beyond its edges.
  samples.sort((a, b) => Math.abs(Math.hypot(a[0], a[2]) - (plan.radius - 160)) - Math.abs(Math.hypot(b[0], b[2]) - (plan.radius - 160)));
  for (const pos of samples) { addTree(pos, false); if (added >= limit) break; }
}

export function paveRideAccess(park: ParkData): void {
  const b = new Parts(park, [0, 0, 0], 0, -1, 'path');
  const pave = (a: Vec3, c: Vec3): void => {
    if (a[1] > PAVING_TOP + 0.3 || c[1] > PAVING_TOP + 0.3) return; // Modeled stairs/decks supply elevated surfaces.
    surfaceStrip(b, a, c, 2.8);
  };
  for (const ride of park.rides) {
    if (!ride.curve && ride.boarding.length) {
      // A single forecourt joins the queue, exit and stair foot, instead of leaving a triangular grass
      // pocket between three narrow strips. It meets the ride apron at the same finished paving level.
      const points = [ride.queue[0], park.nodes[ride.station].pos, ride.exit[0], ride.boarding[0]], q = axisAngle([0, 1, 0], ride.yaw);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of points) { const v: Vec3 = [p[0] - ride.pos[0], 0, p[2] - ride.pos[2]]; inverseRotate(q, v, v); minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]); minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]); }
      const center = yawPoint(ride.pos, ride.yaw, [(minX + maxX) / 2, PARK_GRADE, (minZ + maxZ) / 2]);
      surfaceBox(b, [center[0], center[2]], [(maxX - minX) / 2 + 1.4, (maxZ - minZ) / 2 + 1.4], undefined, { rot: q });
    }
    pave(park.nodes[ride.station].pos, ride.queue[ride.queue.length - 1]);
    if (ride.boarding.length) { pave(ride.queue[0], ride.boarding[0]); pave(ride.boarding[0], ride.exit[0]); }
    for (let i = 1; i < ride.exit.length; i++) pave(ride.exit[i - 1], ride.exit[i]);
  }
}

