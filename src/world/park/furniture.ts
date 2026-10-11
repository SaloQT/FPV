import type { Vec3 } from '../../contracts';
import { PartBVH, partDistance } from './collision';
import { insertEnd, partAnchor, registerJoint } from './construction';
import { inverseRotate, yawPoint } from './math';
import { CONCRETE, luminaire, METAL, Parts } from './parts';
import { PARK_GRADE, PAVING_RISE, PAVING_TOP } from './surfaces';
import type { ParkData, ParkPart } from './types';

function contact(b: Parts, name: string, a: ParkPart, c: ParkPart, point: Vec3, rationale: string): void {
  const world = yawPoint(b.origin, b.yaw, point);
  registerJoint(b.park, { name, kind: 'fixed', a: partAnchor(a, world), b: partAnchor(c, world), rationale });
}

/** Height above the builder's origin of the low slab (paving, pad, step) under a foot, or 0 for bare ground. The foot is a square of
 * half width `reach` around the builder-local point; if any part of it lies on a slab it stands on that slab's top instead of
 * sinking its corner into the slab edge. Furniture feet stand on whatever surface is really under them. */
function standingHeight(b: Parts, x: number, z: number, reach = 0): number {
  const local: Vec3 = [0, 0, 0], corners: [number, number][] = [[0, 0], [reach, reach], [reach, -reach], [-reach, reach], [-reach, -reach]];
  let top = 0;
  for (const p of b.park.parts) {
    if (p.body >= 0 || p.shape !== 'box' || !p.solid || Math.abs(p.rot[0]) > 1e-6 || Math.abs(p.rot[2]) > 1e-6) continue;
    const t = p.pos[1] + p.half[1] - b.origin[1], bottom = p.pos[1] - p.half[1] - b.origin[1];
    if (t <= 0.001 || t > 0.45 || bottom > 0.05 || t <= top) continue;
    for (const [dx, dz] of corners) {
      const world = yawPoint(b.origin, b.yaw, [x + dx, 0, z + dz]);
      local[0] = world[0] - p.pos[0]; local[1] = 0; local[2] = world[2] - p.pos[2]; inverseRotate(p.rot, local, local);
      if (Math.abs(local[0]) <= p.half[0] && Math.abs(local[2]) <= p.half[2]) { top = t; break; }
    }
  }
  return top;
}

/** Answers "is there room here?" for path furniture against every solid part built so far (ride scenery, walls, fences, trees). Build
 * it once, after the buildings and scenery exist and before placing benches and lamps. Ground slabs are ignored, because furniture
 * stands on them. */
export function furnitureClearance(park: ParkData): { bench: (x: number, z: number, yaw: number) => boolean; pole: (x: number, z: number) => boolean } {
  const solids = park.parts.filter(p => p.solid && p.body < 0 && p.category !== 'path'), bounds = new Float64Array(solids.length * 6);
  solids.forEach((p, i) => {
    const [x, y, z, w] = p.rot, h = p.half, m = [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
    for (let k = 0; k < 3; k++) { const extent = Math.abs(m[k * 3]) * h[0] + Math.abs(m[k * 3 + 1]) * h[1] + Math.abs(m[k * 3 + 2]) * h[2]; bounds[i * 6 + k] = p.pos[k] - extent; bounds[i * 6 + k + 3] = p.pos[k] + extent; }
  });
  const tree = new PartBVH(solids, bounds), local: Vec3 = [0, 0, 0], normal: Vec3 = [0, 1, 0];
  /** True if no solid part comes within `margin` of the point. */
  const free = (x: number, y: number, z: number, margin: number): boolean => {
    let ok = true;
    tree.query(x, y, z, margin, i => {
      if (!ok) return;
      const p = solids[i]; local[0] = x - p.pos[0]; local[1] = y - p.pos[1]; local[2] = z - p.pos[2]; inverseRotate(p.rot, local, local);
      if (partDistance(p, local, normal) < margin) ok = false;
    });
    return ok;
  };
  const above = PARK_GRADE + 0.5;
  return {
    // A bench is 2.2 m wide and 1 m deep; sample its footprint at seat, backrest and rail heights, from just above the slabs it stands on.
    bench(x, z, yaw) {
      for (let u = -1.2; u <= 1.2 + 1e-9; u += 0.2) for (let v = -0.5; v <= 0.5 + 1e-9; v += 0.2) {
        const at = yawPoint([x, 0, z], yaw, [u, 0, v]);
        for (const y of [above, above + 0.35, above + 0.7]) if (!free(at[0], y, at[2], 0.12)) return false;
      }
      return true;
    },
    // A lamp pole is thin, but its housing is 0.7 m across; check the shaft up its length with the housing's reach.
    pole(x, z) {
      for (let y = above; y <= PARK_GRADE + 5; y += 0.5) if (!free(x, y, z, 0.4)) return false;
      return true;
    },
  };
}

/** Slats bear on two continuous rails; rear uprights support every backrest plank. Each foot stands on the slab under it, if any. */
export function parkBench(b: Parts): void {
  const wood: Vec3 = [0.27, 0.15, 0.06], seatY = 0.6, seatHalf = 0.07, railHalf = 0.05;
  const seatBottom = seatY - seatHalf, railBottom = seatBottom - 2 * railHalf;
  const seats = [-0.28, 0, 0.28].map(z => b.box([0, seatY, z], [1.1, seatHalf, 0.12], wood, { surface: 'timber' }));
  const backs = [0.85, 1.1].map(y => b.box([0, y, -0.33], [1.1, 0.1, 0.07], wood, { surface: 'timber' }));
  for (const x of [-0.85, 0.85]) {
    const rail = b.box([x, seatBottom - railHalf, 0], [0.045, railHalf, 0.4], METAL);
    const frontFoot = standingHeight(b, x, 0.28, 0.045), rearFoot = standingHeight(b, x, -0.445, 0.045);
    const front = b.box([x, (railBottom + frontFoot) / 2, 0.28], [0.045, (railBottom - frontFoot) / 2, 0.045], METAL);
    const rear = b.box([x, (1.2 + rearFoot) / 2, -0.445], [0.045, (1.2 - rearFoot) / 2, 0.045], METAL);
    contact(b, 'bench/front-leg rail bearing', front, rail, [x, railBottom, 0.28], 'Leg cap and rail underside have a finite rectangular bearing.');
    contact(b, 'bench/rear-upright rail weld', rear, rail, [x, seatBottom - railHalf, -0.4], 'The rail end meets the upright front face.');
    for (let i = 0; i < seats.length; i++) contact(b, 'bench/seat slat bearing', rail, seats[i], [x, seatBottom, (i - 1) * 0.28], 'Every seat slat spans both supporting rails.');
    for (let i = 0; i < backs.length; i++) contact(b, 'bench/backrest upright bearing', rear, backs[i], [x, [0.85, 1.1][i], -0.4], 'Each backrest plank bears against both upright faces.');
  }
}

/** Rear leaf, frame and pull handle derive from a single wall face and opening. */
export function serviceDoor(b: Parts, x: number, wallZ: number, color: Vec3): void {
  const floor = PAVING_RISE, halfWidth = 0.68, height = 2.2, leafHalf = 0.035, frame = 0.09, top = floor + height;
  const leaf = b.box([x, floor + height / 2, wallZ + leafHalf], [halfWidth, height / 2, leafHalf], color, { metalness: 0.12, roughness: 0.76 });
  for (const side of [-1, 1]) {
    const jamb = b.box([x + side * (halfWidth + frame / 2), floor + height / 2, wallZ + 0.05], [frame / 2, height / 2, 0.05], METAL, { detail: 1 });
    contact(b, 'service-door/leaf jamb', leaf, jamb, [x + side * halfWidth, floor + height / 2, wallZ + leafHalf], 'Leaf and jamb edges tile the same opening.');
  }
  const lintel = b.box([x, top + frame / 2, wallZ + 0.05], [halfWidth + frame, frame / 2, 0.05], METAL, { detail: 1 });
  contact(b, 'service-door/leaf head', leaf, lintel, [x, top, wallZ + leafHalf], 'The head frame starts at the leaf top.');
  const handleX = x - halfWidth + 0.15, face = wallZ + 2 * leafHalf, handleZ = face + 0.06;
  // The pull is longer than the gap between its two standoffs, so each standoff ends inside it.
  const handle = b.rod([handleX, 1.13 - 0.03, handleZ], [handleX, 1.45 + 0.03, handleZ], 0.026, METAL, { detail: 1 });
  for (const y of [1.13, 1.45]) {
    const mount = b.rod([handleX, y, face], [handleX, y, handleZ], 0.018, METAL, { detail: 1 });
    contact(b, 'service-door/pull standoff', leaf, mount, [handleX, y, face], 'A real standoff meets the outer leaf face.');
    // The weld line is where the standoff's surface meets the handle's surface.
    contact(b, 'service-door/pull elbow', mount, handle, [handleX + 0.018, y, handleZ - Math.sqrt(0.026 ** 2 - 0.018 ** 2)], 'Standoff and handle surfaces meet along the weld where the standoff enters the pull.');
    insertEnd(b.park, handle, mount, 1, 'service-door/pull standoff end', 'The standoff ends inside the pull handle, which runs past it at both ends.');
  }
}

/** Fixture footing spans bare grade to the common paved level, even for a queue-origin builder. On paving, the post stands on a base plate. */
export function areaLamp(b: Parts, x: number, z: number): void {
  const bottom = PARK_GRADE - b.origin[1], base = PAVING_TOP - b.origin[1], headY = 6.1, headHalf = 0.08, underside = headY - headHalf;
  const slab = standingHeight(b, x, z, 0.14);
  let foot: ParkPart, postBottom = base;
  if (slab > 0) {
    postBottom = slab + 0.04;
    foot = b.part('cylinder', [x, slab + 0.02, z], [0.14, 0.02, 0.14], METAL);
  } else foot = b.part('cylinder', [x, (bottom + base) / 2, z], [0.23, (base - bottom) / 2, 0.23], CONCRETE);
  const post = b.rod([x, postBottom, z], [x, underside, z], 0.065, METAL);
  const head = b.box([x, headY, z], [0.34, headHalf, 0.28], [0.045, 0.05, 0.055]);
  contact(b, 'lamp/footing post', foot, post, [x, postBottom, z], 'The post starts on its ground-bearing foundation.');
  contact(b, 'lamp/post housing', post, head, [x, underside, z], 'The complete post cap meets the flat housing underside.');
  // The post reaches the housing in the middle, so the light panel is two strips either side of it.
  const diffusers = [-1, 1].map(side => {
    const diffuser = b.box([x, underside - 0.025, z + side * 0.16], [0.29, 0.025, 0.07], [1, 1, 1], { solid: false, roughness: 0.3 });
    contact(b, 'lamp/diffuser housing', diffuser, head, [x + 0.2, underside, z + side * 0.16], 'Diffuser top and housing underside share their contact plane.');
    return diffuser;
  });
  luminaire(b.park, diffusers, { color: [1, 0.76, 0.48], candela: 1100, radius: 32, room: -1 });
}

/** Local z of the entrance sign's board centre; the gate beam sits directly behind the board that is mounted here. */
export const ENTRANCE_SIGN_Z = -0.7;

export function entranceFrame(b: Parts): void {
  const beamY = 11, beamHalf = 1.1, columnTop = beamY - beamHalf, bottom = PARK_GRADE - b.origin[1], base = PAVING_TOP - b.origin[1];
  // The sign board's back face is 0.19 m behind its centre line; the beam's front face lies against it.
  const beamHalfDepth = 0.6, beamFront = ENTRANCE_SIGN_Z + 0.19;
  const beam = b.box([0, beamY, beamFront + beamHalfDepth], [13, beamHalf, beamHalfDepth], [0.08, 0.18, 0.24]);
  for (const x of [-12, 12]) {
    const footing = b.box([x, (bottom + base) / 2, 0], [1.2, (base - bottom) / 2, 1.2], CONCRETE);
    const column = b.box([x, (base + columnTop) / 2, 0], [1.2, (columnTop - base) / 2, 1.2], [0.2, 0.25, 0.3]);
    contact(b, 'entrance/column footing', footing, column, [x, base, 0], 'The foundation bears on grade and supports the whole column base.');
    contact(b, 'entrance/lintel bearing', column, beam, [x, columnTop, 0], 'The lintel underside bears on the column top over their overlapping rectangle.');
  }
}

/** A solid bin proxy with a separate lid whose bottom is derived from the body top. */
export function liddedBin(b: Parts, x: number, z: number, base: number): void {
  const height = 1.2, top = base + height;
  const body = b.box([x, base + height / 2, z], [0.8, height / 2, 1.05], [0.08, 0.13, 0.11], { roughness: 0.75 });
  const lid = b.box([x, top + 0.08, z], [0.9, 0.08, 1.12], [0.055, 0.07, 0.06]);
  contact(b, 'bin/lid rim', body, lid, [x, top, z], 'The closed lid rests on the body top. The body is a closed exterior proxy.');
}

/** The umbrella mast rises through a socket in the table: one length under the top, one length above it, and the top end is sunk
 * into the umbrella. Stools have exact flat-cap seat bearings. */
export function terraceTable(b: Parts, z: number, timber: Vec3, canopyColor: Vec3): void {
  const base = PAVING_TOP - b.origin[1], tableBottom = 0.8 - 0.065, tableTop = 0.8 + 0.065, mastRadius = 0.045;
  const table = b.part('cylinder', [0, 0.8, z], [0.77, 0.065, 0.77], timber, { roughness: 0.8, surface: 'timber' });
  const lowerMast = b.rod([0, base, z], [0, tableBottom, z], mastRadius, METAL);
  const upperMast = b.rod([0, tableTop, z], [0, 3.1, z], mastRadius, METAL);
  contact(b, 'table/mast socket', table, lowerMast, [mastRadius, tableBottom, z], 'The lower mast ends on the underside of the table, inside its socket.');
  contact(b, 'table/mast socket', table, upperMast, [mastRadius, tableTop, z], 'The upper mast starts on the table top, inside its socket.');
  const canopy = b.part('cone', [0, 3.05, z], [1.7, 0.38, 1.7], canopyColor, { roughness: 0.95, surface: 'fabric' });
  insertEnd(b.park, canopy, upperMast, 1, 'table/umbrella mast top', 'The mast top is sunk into the umbrella canopy, where the cone is much wider than the mast.');
  for (let j = 0; j < 4; j++) {
    const angle = Math.PI / 4 + j * Math.PI / 2, x = Math.cos(angle) * 1.13, zz = z + Math.sin(angle) * 1.13, seatBottom = 0.5 - 0.065;
    const seat = b.part('cylinder', [x, 0.5, zz], [0.27, 0.065, 0.27], timber, { roughness: 0.85, surface: 'timber' });
    const leg = b.rod([x, base, zz], [x, seatBottom, zz], 0.06, METAL);
    contact(b, 'stool/seat pedestal', leg, seat, [x, seatBottom, zz], 'The full pedestal cap bears on the flat seat underside.');
  }
}
