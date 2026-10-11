import type { Vec3 } from '../../contracts';
import { Rng, deriveSeed } from '../track/rng';
import { axisAngle, inverseRotate, qmul, TAU, yawPoint } from './math';
import { Parts, METAL, CONCRETE } from './parts';
import { PALETTES } from './recipe';
import type { ParkData, ParkPart, ParkTheme, RideDefinition } from './types';
import { PARK_THEMES } from './types';
import { PartBVH, partDistance } from './collision';
import { plantParkTree, plantingBounds } from './planting';
import { PARK_GRADE, PAVING_TOP, surfaceBox, surfaceStrip } from './surfaces';
import { pitchedRoof, shopAwning, shopfront, slopedRoofPost } from './architecture';
import { areaLamp, serviceDoor, terraceTable } from './furniture';
import { declareInterface, declareMonolith, insertEnd, partAnchor, registerJoint } from './construction';
export { pitchedRoof } from './architecture';

const FONT: Record<string, string> = {
 A:'01110100011000111111100011000110001',B:'11110100011000111110100011000111110',C:'01111100001000010000100001000001111',D:'11110100011000110001100011000111110',E:'11111100001000011110100001000011111',F:'11111100001000011110100001000010000',G:'01111100001000010111100011000101111',H:'10001100011000111111100011000110001',I:'11111001000010000100001000010011111',J:'00111000100001000010100101001001100',K:'10001100101010011000101001001010001',L:'10000100001000010000100001000011111',M:'10001110111010110101100011000110001',N:'10001110011010110011100011000110001',O:'01110100011000110001100011000101110',P:'11110100011000111110100001000010000',Q:'01110100011000110001101011001001101',R:'11110100011000111110101001001010001',S:'01111100001000001110000010000111110',T:'11111001000010000100001000010000100',U:'10001100011000110001100011000101110',V:'10001100011000110001100010101000100',W:'10001100011000110101101011101110001',X:'10001100010101000100010101000110001',Y:'10001100010101000100001000010000100',Z:'11111000010001000100010001000011111',
};
Object.assign(FONT, { '0':'01110100011001110101110011000101110', '1':'00100011000010000100001000010001110', '2':'01110100010000100010001000100011111', '3':'11110000010000101110000010000111110', '4':'00010001100101010010111110001000010', '5':'11111100001000011110000010000111110', '6':'01110100001000011110100011000101110', '7':'11111000010001000100010000100001000', '8':'01110100011000101110100011000101110', '9':'01110100011000101111000010000101110' });
export function sign(b: Parts, text: string, pos: Vec3, color: Vec3, scale = 0.12, mountBackZ?: number): ParkPart {
  const width = text.length * 6 * scale, front = pos[2] + 0.07 - 0.12, back = pos[2] + 0.07 + 0.12, glyphHalf = 0.035;
  const board = b.box([pos[0], pos[1], pos[2] + 0.07], [width / 2 + 0.3, scale * 4.6, 0.12], [0.025, 0.03, 0.045]);
  if (mountBackZ !== undefined && mountBackZ > back) for (const side of [-1, 1]) {
    const x = pos[0] + side * width * 0.35, spacer = b.rod([x, pos[1], back], [x, pos[1], mountBackZ], 0.045, METAL, { detail: 1 });
    const point = yawPoint(b.origin, b.yaw, [x, pos[1], back]);
    registerJoint(b.park, { name: 'sign/board standoff', kind: 'fixed', a: partAnchor(board, point), b: partAnchor(spacer, point), rationale: 'Spacer rods run from the board back to the declared supporting wall plane.' });
  }
  text.toUpperCase().split('').forEach((c, index) => { const glyph = FONT[c]; if (!glyph) return;
    // The face points toward local -Z, whose viewer-right is local -X.
    // Merge contiguous strokes. The old per-pixel boxes made text a surprisingly large instance cost.
    for (let row = 0; row < 7; row++) for (let col = 0; col < 5;) {
      if (glyph[row * 5 + col] !== '1') { col++; continue; }
      const start = col; while (col < 5 && glyph[row * 5 + col] === '1') col++;
      b.box([pos[0] + width / 2 - (index * 6 + (start + col + 1) / 2) * scale, pos[1] + (3 - row) * scale, front - glyphHalf], [(col - start - 0.14) * scale / 2, scale * 0.43, glyphHalf], color, { emissive: 0.02, detail: 1, solid: false });
    }
  });
  return board;
}
const STONE: Vec3 = [0.38, 0.35, 0.29], CREAM: Vec3 = [0.71, 0.66, 0.53], GLASS: Vec3 = [0.024, 0.045, 0.048];
function tint(color: Vec3, value: number): Vec3 { return color.map(c => c * value) as Vec3; }
const TREE_VARIANTS: Record<ParkTheme, readonly number[]> = {
  space: [0, 1, 5], fantasy: [3, 4, 5], jungle: [3, 4], western: [2, 3],
  seaside: [2, 5], steampunk: [3, 5], alpine: [0, 1, 2], carnival: [3, 4, 5],
};
function treeVariant(theme: ParkTheme, rng: Rng): number {
  const variants = TREE_VARIANTS[theme]; return variants[Math.floor(rng.range(0, variants.length))];
}
function planted(b: Parts, pos: Vec3, variant: number, height: number, rng: Rng, maxRadius = Infinity): void {
  const bounds = plantingBounds({ pos: [0, 0, 0], yaw: 0, variant, scale: 1, tint: [1, 1, 1] });
  // Fit the mature native mesh to its reserved bed, including its leaf-card silhouette.
  plantParkTree(b.park, yawPoint(b.origin, b.yaw, pos), { variant, scale: Math.min(height / bounds.height, maxRadius / bounds.radius),
    yaw: b.yaw + rng.range(0, TAU), tint: [rng.range(0.88, 1.08), rng.range(0.93, 1.08), rng.range(0.86, 1.04)] });
}
const SHOP_NAMES: Record<ParkTheme, readonly string[]> = {
  space: ['ORBIT CAFE', 'STARPORT SUPPLY', 'LUNAR OUTFITTERS'], fantasy: ['THE KINGS TABLE', 'STORYBOOK GIFTS', 'CASTLE KITCHEN'],
  jungle: ['EXPEDITION CAFE', 'EXPLORER SUPPLY', 'RIVER TRADING'], western: ['SILVER SPUR', 'GENERAL STORE', 'TRAILS END'],
  seaside: ['HARBOR GRILL', 'PIER ICE CREAM', 'SEASIDE GIFTS'], steampunk: ['FOUNDRY CAFE', 'CLOCKWORK GOODS', 'BOILER HOUSE'],
  alpine: ['SUMMIT KITCHEN', 'CHALET GIFTS', 'MOUNTAIN CAFE'], carnival: ['MIDWAY TREATS', 'FAIRGROUND GIFTS', 'CANDY KITCHEN'],
};
/** Outer face of the front, back and end walls of a themed shop, in building-local metres. */
const SHOP_FACE = 3.95;
/** Where each pitched theme's lowest roof corner lies, measured from the centre line. Themes without a gutter have none. */
const SHOP_EAVE: Partial<Record<ParkTheme, number>> = { alpine: 6.8, jungle: 6.8, western: 6.8, steampunk: 6.4, seaside: 6.6 };

interface Band { y: number; halfHeight: number; radius: number; color: Vec3; options?: Partial<ParkPart> }
/** A round column with wider bands (a barrel hoop, tower ring, pipe flange). The column is built in sections that stop at each
 * band's faces, so a band is a full-width disc in the column and nothing passes through it. Returns the sections, lowest first. */
export function bandedColumn(b: Parts, x: number, z: number, y0: number, y1: number, radius: number, color: Vec3, bands: Band[], options: Partial<ParkPart> = {}): ParkPart[] {
  const sections: ParkPart[] = [], section = (from: number, to: number) => { if (to - from > 1e-9) sections.push(b.part('cylinder', [x, (from + to) / 2, z], [radius, (to - from) / 2, radius], color, options)); };
  let from = y0;
  for (const band of [...bands].sort((a, c) => a.y - c.y)) {
    section(from, band.y - band.halfHeight);
    b.part('cylinder', [x, band.y, z], [band.radius, band.halfHeight, band.radius], band.color, band.options);
    from = band.y + band.halfHeight;
  }
  section(from, y1);
  return sections;
}

export function themedBuilding(park: ParkData, pos: Vec3, yaw: number, theme: ParkTheme, seed: number): void {
  const b = new Parts(park, pos, yaw, -1, 'building'), p = PALETTES[theme], rng = new Rng(seed), FACE = SHOP_FACE;
  const plaster = theme === 'carnival' ? CREAM : theme === 'western' || theme === 'jungle' ? tint(p.secondary, 0.9) : theme === 'space' ? p.secondary : tint(CREAM, rng.range(0.74, 0.93));
  const wall: Partial<ParkPart> = { metalness: theme === 'space' ? 0.25 : 0, roughness: theme === 'space' ? 0.4 : 0.9, surface: theme === 'space' ? 'paint' : theme === 'western' ? 'timber' : 'masonry' };
  // A real shell leaves recessed shopfronts and a shaded interior behind the glazing. The floor slab reaches only as far as
  // the walls, or to the downpipes when the roof has gutters; everything beside it stands on bare grade.
  const eave = SHOP_EAVE[theme], slabHalf = eave === undefined ? 6 : eave + 0.1;
  surfaceBox(b, [0, -0.1], [slabHalf, 4.05], STONE);
  surfaceBox(b, [0, -(7.5 + 4.15) / 2], [6.4, (7.5 - 4.15) / 2]);
  surfaceBox(b, [2.8, FACE + 0.5], [1.1, 0.5]);
  // The front shopfront wall spans -FACE to -FACE + 0.2; end walls and the back wall close the shell around the same footprint.
  for (const x of [-5.85, 5.85]) b.box([x, 2.9, 0], [0.15, 2.7, FACE], plaster, wall);
  b.box([0, 2.9, FACE - 0.15], [5.7, 2.7, 0.15], plaster, wall);
  b.box([0, 5.45, -0.05], [5.7, 0.15, 3.7], plaster, wall);
  // Service elevations remain convincing when the drone flies around the building.
  serviceDoor(b, 2.8, FACE, tint(p.timber, 0.68));
  b.box([-3.6, 3.1, FACE + 0.09], [0.73, 0.55, 0.09], [0.065, 0.07, 0.065], { metalness: 0.3, roughness: 0.8 });
  for (let y = 2.65; y < 3.6; y += 0.18) b.box([-3.6, y, FACE + 0.18 + 0.065], [0.66, 0.022, 0.065], METAL, { detail: 1 });
  shopfront(b, 0, 5.7, -3.85, 5.6, 3.7, 1.4, plaster, p.timber, wall);
  // One moulding course on the front face, above the sign, spanning the corners.
  b.box([0, 5.54, -FACE - 0.1], [6, 0.06, 0.1], theme === 'space' ? p.primary : STONE, { metalness: 0, roughness: 0.8 });
  const awning = shopAwning(b, 0, 6.4, -FACE, -6.25, 4.1, 0.3, p.primary, p.timber);
  const names = SHOP_NAMES[theme], name = names[Math.floor(rng.range(0, names.length))], scale = Math.min(0.12, 10.8 / (name.length * 6));
  sign(b, name, [0, 4.35 + scale * 4.6, -4.26], theme === 'space' ? p.accent : CREAM, scale, -FACE);
  const roof = (width: number, rise: number, color: Vec3, surface: ParkPart['surface'], options: Parameters<typeof pitchedRoof>[10] = {}): void => {
    pitchedRoof(b, 5.6, width, FACE, rise, color, surface, 6, FACE, plaster, options);
  };
  if (theme === 'fantasy') {
    // The towers stand tangent to each end wall, touching it through their rings.
    const ringRadius = 1.86, x0 = 6 + ringRadius;
    for (const x of [-x0, x0]) {
      b.part('cylinder', [x, 0.1, 0.6], [ringRadius, 0.1, ringRadius], STONE, { surface: 'concrete' });
      bandedColumn(b, x, 0.6, 0.2, 9.2, 1.75, plaster, [0.5, 6.1, 8.9].map(y => ({ y, halfHeight: 0.14, radius: ringRadius, color: STONE, options: { metalness: 0 } })), { metalness: 0, roughness: 0.95, surface: 'masonry' });
      for (let j = 0; j < 6; j++) { const a = j * TAU / 6; b.box([x + Math.sin(a) * 1.79, 7.3, 0.6 + Math.cos(a) * 1.79], [0.3, 0.65, 0.04], GLASS, { rot: axisAngle([0, 1, 0], yaw + a), roughness: 0.25, metalness: 0 }); }
      const spire = b.part('cone', [x, 11.7, 0.6], [2.15, 2.5, 2.15], p.primary, { metalness: 0.1, roughness: 0.72 });
      insertEnd(park, spire, b.rod([x, 13.8, 0.6], [x, 16.4, 0.6], 0.045, METAL), -1 as const, 'tower flagpole', 'The flagpole foot is sunk into the spire above the point where the cone is wider than the pole.');
      b.box([x + 0.045 + 0.6, 15.9, 0.6], [0.6, 0.28, 0.025], p.primary, { solid: false, metalness: 0 });
    }
    roof(6, 2.65, tint(p.primary, 0.75), 'paint', { flushEave: true, drainage: false });
  } else if (theme === 'space') {
    // A squat drum on the roof slab carries the dome; the two are one moulded shell.
    const drum = b.box([0, 5.6 + 0.7, 0], [5.7, 0.7, 3.7], p.primary, { metalness: 0.45, roughness: 0.32 });
    const dome = b.part('sphere', [0, 7, 0], [5.7, 1.4, 3.7], p.primary, { metalness: 0.45, roughness: 0.32 });
    declareMonolith(park, 'observatory drum and dome', [drum, dome], 'The dome shell and its drum are one moulded roof structure; the lower half of the dome lies inside the drum.');
    for (const x of [-5.8, 5.8]) b.box([x, 2.075, -FACE - 0.125], [0.13, 1.875, 0.125], p.accent, { emissive: 0.02, solid: false });
    for (const x of [-7, 7]) {
      b.part('cylinder', [x, 0.35, 1], [0.9, 0.35, 0.9], METAL);
      bandedColumn(b, x, 1, 0.7, 11.2, 0.32, p.secondary, [{ y: 10.8, halfHeight: 0.15, radius: 0.6, color: p.accent, options: { emissive: 0.03 } }]);
      b.part('cone', [x, 12, 1], [0.55, 0.8, 0.55], p.primary);
    }
    b.box([0, 8.4 + 0.35, 0], [1.35, 0.35, 1.2], METAL);
    for (let j = 0; j < 6; j++) b.box([-1 + j * 0.4, 8.4 + 0.7 + 0.04, 0], [0.035, 0.04, 1], [0.05, 0.06, 0.07], { detail: 1 });
  } else if (theme === 'western' || theme === 'alpine') {
    roof(6.8, theme === 'alpine' ? 3.1 : 1.7, theme === 'alpine' ? tint(p.primary, 0.6) : tint(p.timber, 0.65), theme === 'alpine' ? 'paint' : 'timber');
    // Clapboard strips lie on the end walls, between the downpipe stays.
    for (const x of [-6.035, 6.035]) for (let y = 0.6; y < 5.55; y += 0.42) b.box([x, y, 0], [0.035, 0.025, 3.8], p.timber, { detail: 1, metalness: 0, roughness: 0.9 });
    for (const x of [-5.58, -1.52, 1.52, 5.58]) b.box([x, 4.9, -FACE - 0.06], [0.085, 0.55, 0.06], p.timber, { metalness: 0 });
    if (theme === 'western') {
      // The false front stands on the moulding course, in front of the roof's end.
      b.box([0, 6.225, -FACE - 0.1], [5, 0.625, 0.1], plaster, wall);
      b.box([0, 6.95, -FACE - 0.15], [5.2, 0.1, 0.15], p.timber, { metalness: 0 });
    } else {
      // The chimney stands on its own hearth pad against the back wall, clear of the roof's end.
      surfaceBox(b, [4.6, FACE + 0.6], [0.6, 0.6]);
      b.box([4.6, 4.6, FACE + 0.6], [0.55, 4.4, 0.6], STONE, { metalness: 0, roughness: 0.95 });
      b.box([4.6, 9.12, FACE + 0.6], [0.67, 0.12, 0.72], METAL);
    }
    for (const x of [-8, 8]) bandedColumn(b, x, -1, 0, 1.5, 0.65, p.timber, [0.3, 1.2].map(y => ({ y, halfHeight: 0.06, radius: 0.68, color: METAL })), { metalness: 0 });
  } else if (theme === 'steampunk') {
    roof(6.4, 1.8, [0.095, 0.105, 0.095], 'paint');
    for (const x of [-1.4, 4.8]) {
      const height = rng.range(11, 15), r = 0.65;
      b.part('cylinder', [x, 0.1, FACE + r], [r, 0.1, r], CONCRETE);
      bandedColumn(b, x, FACE + r, 0.2, height, r, p.secondary, [height - 2, height - 0.5].map(y => ({ y, halfHeight: 0.08, radius: 0.71, color: METAL })), { metalness: 0, roughness: 0.96 });
      b.part('cylinder', [x, height + 0.16, FACE + r], [0.8, 0.16, 0.8], p.timber, { metalness: 0 });
    }
    for (const x of [-6.7, 6.7]) {
      const sections = bandedColumn(b, x, 0, 0, 5.1, 0.18, p.accent, [1, 3.9].map(y => ({ y, halfHeight: 0.065, radius: 0.25, color: METAL, options: { detail: 1 } }))), run = b.rod([x, 5.1, -0.18], [x, 5.1, 3], 0.18, p.accent);
      insertEnd(park, run, sections[sections.length - 1], 1, 'steam pipe elbow', 'The riser top is sunk into the horizontal run; the run starts a pipe radius behind the riser axis, so the whole round end is inside it.');
      sections.slice(1).forEach((section, i) => {
        const y = [1, 3.9][i] + 0.3, stay = b.rod([Math.sign(x) * 6, y, 0], [x, y, 0], 0.045, METAL, { detail: 1 });
        insertEnd(park, section, stay, 1, 'steam pipe stay', 'The stay ends inside the pipe; its other end sits flat on the wall face.');
      });
    }
  } else if (theme === 'seaside') {
    roof(6.6, 2.1, tint(p.primary, 0.75), 'paint');
    for (let x = -6; x < 6; x += 1.2) b.box([x + 0.6, awning.hang.y, awning.hang.front - 0.015], [0.28, 0.15, 0.015], CREAM, { detail: 1, metalness: 0 });
    b.part('cylinder', [8.5, 0.1, 1], [1.5, 0.1, 1.5], STONE, { surface: 'concrete' });
    bandedColumn(b, 8.5, 1, 0.2, 12.6, 1.35, CREAM, [3.2, 7.7].map(y => ({ y, halfHeight: 0.72, radius: 1.37, color: p.primary, options: { metalness: 0 } })), { metalness: 0, roughness: 0.9 });
    b.part('cylinder', [8.5, 12.78, 1], [1.9, 0.18, 1.9], p.primary);
    b.part('cylinder', [8.5, 13.46, 1], [0.8, 0.5, 0.8], GLASS, { roughness: 0.2, emissive: 0.025 });
    b.part('cone', [8.5, 14.46, 1], [1.25, 0.5, 1.25], p.primary);
    for (let j = 0; j < 8; j++) { const a = j * TAU / 8; b.rod([8.5 + Math.cos(a) * 1.7, 12.96, 1 + Math.sin(a) * 1.7], [8.5 + Math.cos(a) * 1.7, 13.76, 1 + Math.sin(a) * 1.7], 0.025, CREAM, { detail: 1 }); }
  } else if (theme === 'jungle') {
    roof(6.8, 3, [0.31, 0.25, 0.12], 'timber');
    // Vines climb in front of the end piers up to the awning; each leaf touches its vine stem and the wall face.
    for (const x of [-5.6, 5.6]) {
      b.rod([x, 0.2, -FACE - 0.05], [x, 4, -FACE - 0.05], 0.03, p.timber, { solid: false, detail: 1, surface: 'timber' });
      for (let y = 0.5; y < 3.7; y += 0.5) b.part('sphere', [x + Math.sign(x) * 0.19, y, -FACE - 0.05], [0.16, 0.22, 0.05], [0.045, 0.12, 0.025], { solid: false, detail: 1, metalness: 0, roughness: 0.95 });
    }
  } else {
    // The tent roof is a cone on the wall tops; its ribs lie on the cone and its hem boards hang under the rim.
    const base = 5.6, rise = 5, radius = 8, apex = base + rise, slantLength = Math.hypot(radius, rise);
    b.part('cone', [0, base + rise / 2, 0], [radius, rise / 2, radius], p.primary, { metalness: 0, roughness: 0.9, surface: 'fabric' });
    const ribRadius = 0.065, lift = [rise / slantLength * ribRadius, radius / slantLength * ribRadius], stopAt = 0.5;
    for (let j = 0; j < 16; j++) {
      const a = j * TAU / 16, ca = Math.cos(a), sa = Math.sin(a), outward = (radialDistance: number, height: number): Vec3 => [ca * radialDistance, height, sa * radialDistance];
      const along = (t: number): Vec3 => outward(radius * (1 - t) + lift[0], base + rise * t + lift[1]);
      b.rod(along(0), along(1 - stopAt / radius), ribRadius, CREAM, { detail: 1, solid: false });
    }
    const hem = 0.05, board = (radius - 2 * hem) * Math.tan(Math.PI / 16);
    for (let j = 0; j < 16; j++) { const a = (j + 0.5) * TAU / 16; b.box([Math.cos(a) * (radius - hem), base - 0.13, Math.sin(a) * (radius - hem)], [board, 0.13, hem], CREAM, { rot: axisAngle([0, 1, 0], yaw + Math.PI / 2 - a), metalness: 0 }); }
    b.rod([0, apex, 0], [0, 12.5, 0], 0.045, METAL); b.box([0.045 + 0.6, 12, 0], [0.6, 0.3, 0.025], p.accent, { metalness: 0, solid: false });
  }
}


export function attractionScenery(park: ParkData, ride: RideDefinition, urban = false): void {
  if (ride.family === 'space') spaceShowBuilding(park, ride);
  const p = PALETTES[ride.theme], origin = yawPoint(ride.queue[0], ride.yaw, [5, 0, 0]), b = new Parts(park, origin, ride.yaw, -1, 'furniture');
  surfaceBox(b, [-3.2, 7.2], [3.3, 8.4]);
  // Queue rails: each rail runs from post axis to post axis, ending inside the posts at both ends. The posts stand slightly
  // higher than the rails, so the whole round rail end is inside the post.
  const top = PAVING_TOP - b.origin[1], railY = top + 1;
  for (let lane = 0; lane < 5; lane++) {
    const x = -5.6 + lane * 1.2;
    let previous: ParkPart | undefined;
    for (let z = 1; z <= 13; z += 2) {
      const post = b.rod([x, top, z], [x, top + 1.05, z], 0.035, METAL);
      if (previous) {
        const rail = b.rod([x, railY, z - 2], [x, railY, z], 0.035, METAL);
        insertEnd(park, previous, rail, -1, 'queue rail end', 'The rail ends on the axis of the post it leaves, below the post top, so its whole round end is inside the post.');
        insertEnd(park, post, rail, 1, 'queue rail end', 'The rail ends on the axis of the post it reaches, below the post top, so its whole round end is inside the post.');
      }
      previous = post;
    }
  }
  // Shade the middle of the queue. Posts carry a tie beam and end in shoes under the roof; the beam passes below the roof's lowest edge.
  const canopy = new Parts(park, yawPoint(origin, ride.yaw, [-3.2, 0, 7]), ride.yaw, -1, 'furniture');
  const underside = (x: number) => 3.3 + 0.5 * (3.2 - Math.abs(x)) / 3.2, ground = PAVING_TOP - canopy.origin[1], postRadius = 0.075, beamRadius = 0.05, beamY = ground + 3.15;
  const roof = pitchedRoof(canopy, 3.3, 3.2, 4.3, 0.5, ride.theme === 'space' ? p.primary : tint(CREAM, 0.9), ride.theme === 'space' ? 'paint' : 'fabric', 3.2, 4.3, undefined, { infill: false, drainage: false, halfThickness: 0.045 });
  for (const z of [-3.8, 3.8]) {
    const posts = [-3, 3].map(x => {
      canopy.part('cylinder', [x, ground + 0.08, z], [0.18, 0.08, 0.18], CONCRETE, { metalness: 0 });
      return slopedRoofPost(canopy, roof[x < 0 ? 0 : 1], x, z, ground + 0.16, ground + underside(x), [-Math.sign(x) * 0.5 / 3.2, 0], postRadius);
    });
    const beam = canopy.rod([-3, beamY, z], [3, beamY, z], beamRadius, METAL);
    insertEnd(park, posts[0], beam, -1, 'canopy tie beam', 'The beam ends on the post axis, between the post bottom and top, and is thinner than the post.');
    insertEnd(park, posts[1], beam, 1, 'canopy tie beam', 'The beam ends on the post axis, between the post bottom and top, and is thinner than the post.');
    [-3, 3].forEach((x, i) => {
      const brace = canopy.rod([x, beamY - 0.6, z], [x - Math.sign(x) * 0.6, beamY, z], 0.035, METAL);
      insertEnd(park, posts[i], brace, -1, 'canopy brace foot', 'The brace foot ends on the post axis, inside the post.');
      insertEnd(park, beam, brace, 1, 'canopy brace head', 'The brace head ends on the beam axis, inside the beam.');
    });
  }
  // The entrance gate: a header board whose ends are sunk into two round posts, with the ride sign mounted on its front face.
  const gateHalf = 9, gateZ = 20, boardHalfDepth = 0.2, signScale = Math.min(0.18, 16.4 / (ride.name.length * 6));
  const gatePosts = [-gateHalf, gateHalf].map(x => b.rod([x, PARK_GRADE - b.origin[1], gateZ], [x, 7.5, gateZ], 0.23, p.secondary));
  const header = b.box([0, 6.5, gateZ], [gateHalf, 0.85, boardHalfDepth], p.primary);
  declareInterface(park, { name: 'gate header end', kind: 'insert', a: gatePosts[0], b: header, end: -1, axis: 0, rationale: 'The header end face lies on the post axis inside the round post; the post is taller than the header.' });
  declareInterface(park, { name: 'gate header end', kind: 'insert', a: gatePosts[1], b: header, end: 1, axis: 0, rationale: 'The header end face lies on the post axis inside the round post; the post is taller than the header.' });
  sign(b, ride.name, [0, 6.5, gateZ - boardHalfDepth - 0.19], p.accent, signScale);
  if (!urban) themedBuilding(park, yawPoint(origin, ride.yaw, [22, -0.2, 10]), ride.yaw, ride.theme, deriveSeed(park.recipe.seed, 945, ride.id));
  for (const x of [-12, 12]) for (const z of [-12, 12]) areaLamp(b, x, z);
  if (urban) return; // District parcels supply their shared shopfronts and mature planting buffers.
  // Deliberately composed, seeded planting beds, with native bark, branches and leaf cards.
  const rng = new Rng(deriveSeed(park.recipe.seed, 946, ride.id)), plantingStart = park.parts.length;
  for (let i = 0; i < 12; i++) {
    const x = -22 - rng.range(0, 12), z = -15 + i * 4.8 + rng.range(-0.6, 0.6), height = rng.range(6.2, 10.3);
    b.part('cylinder', [x, 0.1, z], [1.3, 0.1, 1.3], [0.09, 0.065, 0.035], { metalness: 0, roughness: 1, solid: false });
    planted(b, [x, 0.2, z], treeVariant(ride.theme, rng), height, rng, 3.4);
    // One detailed, branching shrub fills the small companion bed without a rigid leaf collider.
    planted(b, [x + 0.8, 0.2, z + 0.5], i % 2 ? 6 : 7, 0.65, rng, 0.75);
  }
  for (let i = plantingStart; i < park.parts.length; i++) park.parts[i].category = 'landscape';
}

/** The door frames beside the show building's front opening: each is 2 x FRAME_HALF wide and its outer edge is FRAME_OUTER from the centre line. */
const FRAME_HALF = 0.4, FRAME_OUTER = 13.2;

function spaceShowBuilding(park: ParkData, ride: RideDefinition): void {
  const room = park.rooms.find(r => r.ride === ride.id); if (!room) return;
  const { min, max } = room, cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2, top = max[1];
  const hx = (max[0] - min[0]) / 2, hz = (max[2] - min[2]) / 2, wallY = (12 + top) / 2, wallH = (top - 12) / 2;
  const b = new Parts(park, [0, 0, 0], 0, -1, 'building'), shell: Vec3 = [0.43, 0.49, 0.52], rib: Vec3 = [0.64, 0.7, 0.72], trim: Vec3 = [0.13, 0.19, 0.23];
  // The interior remains the light-tight show box. Narrow, opaque exterior cladding and ribs give it
  // an engineered shell without consuming any of the interior vehicle or flight clearance.
  const xPanels = Math.ceil(hx * 2 / 14), zPanels = Math.ceil(hz * 2 / 14);
  const hosts = park.parts.filter(part => part.shape === 'box' && part.body < 0 && Math.abs(part.pos[1] - wallY) < 1e-6 && Math.abs(part.half[1] - wallH) < 1e-6);
  const cladding = (axis: 0 | 2, side: number, coordinate: number, across: number, halfAcross: number, ribAt: number): void => {
    const other = axis === 0 ? 2 : 0;
    const host = hosts.find(part => Math.abs(part.pos[axis] - coordinate) < 1e-6 && Math.abs(across - part.pos[other]) + halfAcross <= part.half[other] + 1e-6);
    if (!host) throw new Error('Stellar Mountain cladding requires a matching physical wall panel');
    const face = host.pos[axis] + side * host.half[axis], halfThickness = 0.045, ribDepth = 0.26;
    const center: Vec3 = [0, wallY, 0], half: Vec3 = [0, wallH - 0.2, 0];
    center[axis] = face + side * halfThickness; center[other] = across;
    half[axis] = halfThickness; half[other] = halfAcross;
    const plate = b.box(center, half, shell, { metalness: 0.35, roughness: 0.48, surface: 'paint' });
    const point: Vec3 = [...center]; point[axis] = face;
    registerJoint(park, { name: 'show-building/cladding wall face', kind: 'fixed', a: partAnchor(host, point), b: partAnchor(plate, point), rationale: 'The complete plate back lies on the actual supporting wall face; panel joints remain exposed gaps between adjacent plates.' });
    const ribCenter: Vec3 = [...center], ribHalf: Vec3 = [...half];
    ribCenter[axis] = face + side * ribDepth / 2; ribCenter[other] = ribAt;
    ribHalf[axis] = ribDepth / 2; ribHalf[other] = 0.16; ribHalf[1] = wallH;
    const stiffener = b.box(ribCenter, ribHalf, rib, { metalness: 0.4, roughness: 0.42 });
    const ribPoint: Vec3 = [...point]; ribPoint[other] = ribAt;
    registerJoint(park, { name: 'show-building/rib wall face', kind: 'fixed', a: partAnchor(host, ribPoint), b: partAnchor(stiffener, ribPoint), rationale: 'The exterior rib begins at the same physical wall face as its neighbouring cladding.' });
  };
  for (const side of [-1, 1]) {
    for (let j = 0; j < zPanels; j++) {
      const z = min[2] + (j + 0.5) * hz * 2 / zPanels;
      cladding(0, side, cx + side * hx, z, hz / zPanels - 0.18, z - hz / zPanels);
    }
    for (let j = 0; j < xPanels; j++) {
      const x = min[0] + (j + 0.5) * hx * 2 / xPanels, half = hx / xPanels - 0.18;
      // The front wall's opening and the door frames beside it stay clear: skip any plate or rib that reaches into their span.
      if (side > 0 && Math.min(x - half, x - hx / xPanels - 0.16) - cx < FRAME_OUTER && Math.max(x + half, x - hx / xPanels + 0.16) - cx > -FRAME_OUTER) continue;
      cladding(2, side, cz + side * hz, x, half, x - hx / xPanels);
    }
  }
  // A compact landmark peak, surrounded by independently supported roof petals and service modules.
  const skin = park.parts.find(p => p.shape === 'box' && p.body < 0 && Math.abs(p.pos[0] - cx) < 1e-6 && Math.abs(p.pos[1] - top) < 1e-6 && Math.abs(p.pos[2] - cz) < 1e-6);
  if (!skin) throw new Error('Stellar Mountain exterior requires its physical roof slab');
  const roofTop = skin.pos[1] + skin.half[1], base = roofTop + 0.7;
  const radius = Math.min(36, Math.min(hx, hz) * 0.42), height = Math.min(32, radius * 0.92);
  b.part('cylinder', [cx, roofTop + 0.35, cz], [radius + 1.1, 0.35, radius + 1.1], trim, { metalness: 0.4, roughness: 0.48 });
  const cone = b.part('cone', [cx, base + height / 2, cz], [radius, height / 2, radius], rib, { metalness: 0.4, roughness: 0.42, surface: 'paint' });
  // Each rib lies along the cone, one rib radius outside its surface, so it touches the cone along a line. It stops where the cone
  // is 1.2 m across, so neighbouring ribs stay apart, and starts on the trim ring's top.
  const slant = Math.hypot(radius, height), ribRadius = 0.17, outward = [height / slant, radius / slant], ribStop = 1.2;
  for (let j = 0; j < 16; j++) {
    const a = j * TAU / 16, ca = Math.cos(a), sa = Math.sin(a);
    const onRib = (coneRadius: number): Vec3 => {
      const reach = coneRadius + ribRadius * outward[0], y = base + height * (1 - coneRadius / radius) + ribRadius * outward[1];
      return [cx + ca * reach, y, cz + sa * reach];
    };
    b.rod(onRib(radius), onRib(ribStop), ribRadius, shell, { metalness: 0.35 });
    if (j % 2) continue;
    // Each petal starts 1.6 m beyond the trim ring, so neither it nor its posts touch the cone or the ring.
    const length = 14, r = radius + 1.6 + length / 2, panel = new Parts(park, [cx + ca * r, roofTop + 2.2, cz + sa * r], Math.PI / 2 - a, -1, 'building');
    const petal = panel.box([0, 0, 0], [5.2, 0.14, length / 2], shell, { localRot: axisAngle([1, 0, 0], 0.15), metalness: 0.4, roughness: 0.45 });
    for (const x of [-4.6, 4.6]) for (const z of [-length / 2 + 0.4, length / 2 - 0.4]) slopedRoofPost(panel, petal, x, z, roofTop - panel.origin[1], -Math.tan(0.15) * z - 0.14 / Math.cos(0.15), [0, -Math.tan(0.15)], 0.12);
  }
  // The mast foot is sunk 1 m into the cone, where the cone is wider than the mast.
  insertEnd(park, cone, b.rod([cx, base + height - 1, cz], [cx, base + height + 4, cz], 0.1, METAL), -1, 'spire mast foot', 'The mast foot is sunk into the cone where the cone is much wider than the mast, so its whole round end is inside the cone.');
  for (const side of [-1, 1]) {
    const service = new Parts(park, [cx + side * hx * 0.73, roofTop, cz], 0, -1, 'service');
    service.box([0, 1.35, 0], [3.5, 1.35, 6], trim, { metalness: 0.25, roughness: 0.65 });
    // Each fan housing stands on the unit's top face, and its blades lie on the housing's top face.
    for (const z of [-3, 3]) {
      service.part('cylinder', [0, 2.7 + 0.16, z], [2.3, 0.16, 2.3], METAL);
      for (let j = 0; j < 6; j++) { const a = j * TAU / 6; service.rod([Math.cos(a) * 0.3, 3.02 + 0.05, z + Math.sin(a) * 0.3], [Math.cos(a) * 2.15, 3.02 + 0.05, z + Math.sin(a) * 2.15], 0.05, [0.06, 0.07, 0.08], { detail: 1 }); }
    }
    // Front frame remains outside the original 24 m clear opening.
    b.box([cx + side * (FRAME_OUTER - FRAME_HALF), wallY, max[2] + 0.35 + 0.25], [FRAME_HALF, wallH, 0.25], trim, { metalness: 0.4 });
  }
  const entrance = new Parts(park, [cx, top - 4, max[2] + 0.85], Math.PI, -1, 'building');
  sign(entrance, 'STELLAR MOUNTAIN', [0, 0, 0], [0.66, 0.85, 0.95], 0.22, 0.5);
}

/** Place coherent gardens and occupied rest terraces beside the finished pedestrian streets. */
export function decoratePublicRealm(park: ParkData): void {
  const rng = new Rng(deriveSeed(park.recipe.seed, 953)), paths = [...park.paths], sites: { pos: Vec3; radius: number }[] = [];
  const flatRides = park.rides.filter(r => !r.curve), protectedPoints = park.rides.flatMap(r => [...r.queue, ...r.boarding, ...r.exit]);
  const themeAt = (pos: Vec3): ParkTheme => {
    if (park.recipe.theme !== 'mixed') return park.recipe.theme;
    if (Math.hypot(pos[0], pos[2]) < 125) return PARK_THEMES[(Math.round((Math.atan2(pos[2], pos[0]) - 0.25) * 8 / TAU) + 8) % 8];
    let nearest = Infinity, theme: ParkTheme = 'alpine';
    for (const ride of park.rides) { const distance = Math.hypot(pos[0] - ride.pos[0], pos[2] - ride.pos[2]); if (distance < nearest) { nearest = distance; theme = ride.theme; } }
    return theme;
  };
  const obstacles = park.parts.filter(p => p.solid && p.body < 0), bounds = new Float64Array(obstacles.length * 6);
  for (let i = 0; i < obstacles.length; i++) {
    const p = obstacles[i], [x, y, z, w] = p.rot, h = p.half;
    const m = [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
    for (let k = 0; k < 3; k++) { const extent = Math.abs(m[k * 3]) * h[0] + Math.abs(m[k * 3 + 1]) * h[1] + Math.abs(m[k * 3 + 2]) * h[2]; bounds[i * 6 + k] = p.pos[k] - extent; bounds[i * 6 + k + 3] = p.pos[k] + extent; }
  }
  const tree = new PartBVH(obstacles, bounds), local: Vec3 = [0, 0, 0], normal: Vec3 = [0, 1, 0];
  const clear = (pos: Vec3, radius: number): boolean => {
    if (sites.some(s => Math.hypot(s.pos[0] - pos[0], s.pos[2] - pos[2]) < s.radius + radius + 4)) return false;
    for (const path of park.paths) {
      const a = park.nodes[path.a].pos, b = park.nodes[path.b].pos, dx = b[0] - a[0], dz = b[2] - a[2], t = Math.max(0, Math.min(1, ((pos[0] - a[0]) * dx + (pos[2] - a[2]) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(pos[0] - a[0] - t * dx, pos[2] - a[2] - t * dz) < path.width / 2 + radius + 0.7) return false;
    }
    if (flatRides.some(ride => Math.hypot(pos[0] - ride.pos[0], pos[2] - ride.pos[2]) < ride.radius + radius + 8)) return false;
    if (protectedPoints.some(p => Math.hypot(pos[0] - p[0], pos[2] - p[2]) < radius + 3.5)) return false;
    let ok = true;
    tree.query(pos[0], 13.4, pos[2], radius + 2.5, i => {
      if (!ok || bounds[i * 6 + 4] < 12.65 || bounds[i * 6 + 1] > 15.8) return;
      const p = obstacles[i]; local[0] = pos[0] - p.pos[0]; local[1] = 13.4 - p.pos[1]; local[2] = pos[2] - p.pos[2]; inverseRotate(p.rot, local, local);
      if (partDistance(p, local, normal) < radius) ok = false;
    });
    return ok;
  };
  const approachClear = (a: Vec3, c: Vec3): boolean => {
    const length = Math.hypot(c[0] - a[0], c[2] - a[2]), steps = Math.ceil(length / 0.5); let ok = true;
    // The extra half-sample margin proves the swept 1.2 m walking radius clear between checks.
    for (let step = 0; step <= steps && ok; step++) {
      const x = a[0] + (c[0] - a[0]) * step / steps, z = a[2] + (c[2] - a[2]) * step / steps;
      tree.query(x, 13.4, z, 1.45, i => {
        if (!ok || bounds[i * 6 + 4] < 12.65 || bounds[i * 6 + 1] > 14.3) return;
        const p = obstacles[i]; local[0] = x - p.pos[0]; local[1] = 13.4 - p.pos[1]; local[2] = z - p.pos[2]; inverseRotate(p.rot, local, local);
        if (partDistance(p, local, normal) < 1.45) ok = false;
      });
    }
    return ok;
  };
  const addLink = (a: number, b: number, width: number) => { park.paths.push({ a, b, width }); park.nodes[a].links.push(b); park.nodes[b].links.push(a); };
  const b = new Parts(park, [0, 0, 0], 0, -1, 'path');
  for (let pi = 0; pi < paths.length; pi++) {
    const path = paths[pi], a = park.nodes[path.a].pos, c = park.nodes[path.b].pos, length = Math.hypot(c[0] - a[0], c[2] - a[2]);
    if (length < 32 || path.width < 4) continue;
    const yaw = Math.atan2(c[0] - a[0], c[2] - a[2]);
    const radius = 6.5, terrace = length > 65 && pi % 3 === 0, interval = terrace ? length : 44;
    for (let at = terrace ? length / 2 : 18; at < length - 14; at += interval) {
      const side = (pi + Math.floor(at / 44)) % 2 ? 1 : -1, f = at / length, roadside: Vec3 = [a[0] + (c[0] - a[0]) * f, 12, a[2] + (c[2] - a[2]) * f];
      const pos = yawPoint(roadside, yaw, [side * (path.width / 2 + radius + 1.2), 0, 0]);
      if (!clear(pos, radius) || terrace && !approachClear(roadside, pos)) continue;
      const facing = yaw + (side < 0 ? Math.PI : 0), site = new Parts(park, pos, facing, -1, 'landscape'), theme = themeAt(pos);
      sites.push({ pos, radius });
      if (terrace) {
        restTerrace(site, theme, rng);
        // Connect each terrace to the actual street graph so guests can use its open central aisle.
        const junction = park.nodes.push({ pos: [roadside[0], 12.2, roadside[2]], links: [], kind: 'path' }) - 1;
        const destination = park.nodes.push({ pos: [pos[0], 12.2, pos[2]], links: [], kind: 'facility' }) - 1;
        const oldB = path.b, ai = park.nodes[path.a].links.indexOf(oldB), bi = park.nodes[oldB].links.indexOf(path.a);
        if (ai >= 0) park.nodes[path.a].links[ai] = junction;
        if (bi >= 0) park.nodes[oldB].links[bi] = junction;
        park.nodes[junction].links.push(path.a, oldB); path.b = junction; park.paths.push({ a: junction, b: oldB, width: path.width }); addLink(junction, destination, 2.4);
        surfaceStrip(b, roadside, pos, 2.4);
      } else garden(site, theme, rng);
    }
  }
  // Larger planted masses break up the unused centre of each district. Clearance reservations make
  // these landscape islands adapt to every topology, rather than overwriting roads with random trees.
  for (const radius of [105, 148, 285]) {
    const count = Math.round(TAU * radius / 58);
    for (let i = 0; i < count; i++) {
      const a = i * TAU / count + radius * 0.007 + rng.range(-0.045, 0.045), pos: Vec3 = [Math.cos(a) * radius, 12, Math.sin(a) * radius];
      if (!clear(pos, 12.5)) continue;
      sites.push({ pos, radius: 12.5 }); grove(new Parts(park, pos, -a, -1, 'landscape'), themeAt(pos), rng);
    }
  }
}

export function restTerrace(b: Parts, theme: ParkTheme, rng: Rng): void {
  b = new Parts(b.park, b.origin, b.yaw, b.body, 'furniture');
  const p = PALETTES[theme], top = PAVING_TOP - b.origin[1];
  surfaceBox(b, [0, 0], [4.6, 4.6], undefined, { category: 'path' });
  for (const z of [-4.45, 4.45]) b.box([0, top + 0.07, z], [4.5, 0.07, 0.13], CREAM, { metalness: 0 });
  for (const z of [-2.6, 2.6]) {
    terraceTable(b, z, tint(p.timber, 0.85), rng.range(0, 1) < 0.5 ? CREAM : p.primary);
  }
  // A human-scale concession stand faces the clear approach aisle between the tables. Its body runs up to the roof,
  // the counter hangs on the front of the body, and the roof posts stand clear of both counter and sign.
  const kiosk = new Parts(b.park, yawPoint(b.origin, b.yaw, [3.2, 0, 0]), b.yaw + Math.PI / 2, -1, 'building'), bodyHalf = 1.075;
  kiosk.box([0, top + bodyHalf, 0], [1.3, bodyHalf, 0.8], p.secondary, { metalness: 0, roughness: 0.84 });
  kiosk.box([0, top + 0.98, -0.95], [1.4, 0.07, 0.15], CREAM, { metalness: 0 });
  kiosk.box([0, top + 2 * bodyHalf + 0.1, 0], [1.55, 0.1, 1.12], p.primary, { metalness: 0, roughness: 0.9 });
  for (const x of [-1.5, 1.5]) kiosk.rod([x, top, -0.95], [x, top + 2 * bodyHalf, -0.95], 0.045, METAL);
  sign(kiosk, 'REFRESHMENTS', [0, top + 1.5, -0.99], CREAM, 0.03);
  for (const z of [-3.9, 3.9]) {
    b.box([3.7, top + 0.25, z], [0.55, 0.25, 0.4], STONE, { metalness: 0, roughness: 0.9 });
    planted(b, [3.7, top + 0.5, z], 6, 0.75, rng, 0.55);
  }
}

export function garden(b: Parts, theme: ParkTheme, rng: Rng): void {
  // Bed soil sits between four kerbs; the long kerbs run the full length and the short kerbs fit between them.
  b.box([0, 0.04, 0], [3.6, 0.04, 4.4], [0.09, 0.065, 0.035], { solid: false, metalness: 0, roughness: 1 });
  for (const x of [-3.7, 3.7]) b.box([x, 0.16, 0], [0.1, 0.16, 4.6], STONE, { metalness: 0, roughness: 0.9 });
  for (const z of [-4.5, 4.5]) b.box([0, 0.16, z], [3.6, 0.16, 0.1], STONE, { metalness: 0, roughness: 0.9 });
  for (const z of [-2.3, 2.3]) {
    const h = rng.range(4.8, 6.3), x = rng.range(-0.7, 0.7);
    planted(b, [x, 0.08, z], treeVariant(theme, rng), h, rng, 2.2);
  }
  for (const x of [-2.5, 2.5]) for (const z of [-3.5, 0, 3.5]) planted(b, [x, 0.08, z], 6, 1.1, rng, 0.85);
}

function grove(b: Parts, theme: ParkTheme, rng: Rng): void {
  b.part('sphere', [0, 0.015, 0], [10, 0.09, 11.7], [0.085, 0.065, 0.035], { solid: false, metalness: 0, roughness: 1 });
  const soilAt = (x: number, z: number) => 0.015 + 0.09 * Math.sqrt(Math.max(0, 1 - (x / 10) ** 2 - (z / 11.7) ** 2));
  for (const x of [-4, 4]) for (const z of [-5.3, 5.3]) {
    planted(b, [x, soilAt(x, z), z], treeVariant(theme, rng), rng.range(6.5, 9), rng, 3.6);
  }
  for (let i = 0; i < 18; i++) {
    const a = i * TAU / 18, x = Math.cos(a) * 9, z = Math.sin(a) * 10.5;
    planted(b, [x, soilAt(x, z), z], i % 3 ? 6 : 7, 1.3 + i % 3 * 0.1, rng, 1.35);
  }
}

