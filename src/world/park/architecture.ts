import type { Vec3 } from '../../contracts';
import { axisAngle, rotate, yawPoint } from './math';
import { METAL, NON_METAL_SURFACES, Parts } from './parts';
import { PAVING_RISE } from './surfaces';
import type { ParkPart } from './types';
import { insertEnd, partAnchor, registerJoint } from './construction';

const GLASS: Vec3 = [0.024, 0.045, 0.048];
const shade = (c: Vec3, factor: number): Vec3 => c.map(v => v * factor) as Vec3;

/** A facade is a tiled wall plane: piers, spandrels, glazing and door frames share their opening edges.
 * Every window is a frame of four timber members around its panes, so no pane runs through a frame member. */
export function shopfront(b: Parts, centerX: number, halfWidth: number, frontZ: number, wallTop: number, head: number, doorHalf: number,
  plaster: Vec3, timber: Vec3, wall: Partial<ParkPart>): void {
  const floor = PAVING_RISE, depth = 0.2, pier = 0.24, frame = 0.06, sill = 1.15, sillBoard = 0.12, sillReach = 0.17;
  const box = (x0: number, y0: number, x1: number, y1: number, color: Vec3, options: Partial<ParkPart> = {}, z = frontZ, thickness = depth) =>
    b.box([centerX + (x0 + x1) / 2, (y0 + y1) / 2, z], [(x1 - x0) / 2, (y1 - y0) / 2, thickness / 2], color, options);
  box(-halfWidth, head, halfWidth, wallTop, plaster, wall);
  for (const side of [-1, 1]) {
    const outer0 = halfWidth - pier, inner1 = doorHalf + pier;
    box(side < 0 ? -halfWidth : outer0, floor, side < 0 ? -outer0 : halfWidth, head, plaster, wall);
    box(side < 0 ? -inner1 : doorHalf, floor, side < 0 ? -doorHalf : inner1, head, plaster, wall);
    const x0 = side < 0 ? -outer0 : inner1, x1 = side < 0 ? -inner1 : outer0, mid = (x0 + x1) / 2;
    // Stall riser, then a projecting sill board that carries the window frame on its top face.
    box(x0, floor, x1, sill - sillBoard, timber, { surface: 'timber' });
    box(x0, sill - sillBoard, x1, sill, timber, { surface: 'timber' }, frontZ - sillReach / 2, depth + sillReach);
    // Jambs run the full frame height; head and sill rails and the mullion fit between them.
    for (const [lo, hi] of [[x0, x0 + frame], [x1 - frame, x1]]) box(lo, sill, hi, head, timber, { surface: 'timber' }, frontZ - 0.015, 0.1);
    for (const [lo, hi] of [[sill, sill + frame], [head - frame, head]]) box(x0 + frame, lo, x1 - frame, hi, timber, { surface: 'timber' }, frontZ - 0.015, 0.1);
    box(mid - frame / 2, sill + frame, mid + frame / 2, head - frame, timber, { surface: 'timber', detail: 1 }, frontZ - 0.015, 0.1);
    // Two panes, one each side of the mullion, each bearing on the four members around it.
    for (const [lo, hi] of [[x0 + frame, mid - frame / 2], [mid + frame / 2, x1 - frame]]) box(lo, sill + frame, hi, head - frame, GLASS, { surface: 'glass', metalness: 0, roughness: 0.13 }, frontZ, 0.055);
  }
  // Door posts end under the head frame; the door panes fill the openings between posts.
  for (const x of [-doorHalf, 0, doorHalf]) box(Math.max(-doorHalf, x - frame / 2), floor, Math.min(doorHalf, x + frame / 2), head - frame, timber, { surface: 'timber' }, frontZ - 0.015, 0.12);
  box(-doorHalf, head - frame, doorHalf, head, timber, { surface: 'timber' }, frontZ - 0.015, 0.12);
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -doorHalf + frame / 2 : frame / 2, x1 = side < 0 ? -frame / 2 : doorHalf - frame / 2;
    box(x0, floor, x1, head - frame, GLASS, { surface: 'glass', metalness: 0, roughness: 0.14 }, frontZ, 0.055);
    const handleX = centerX + side * Math.min(0.22, doorHalf * 0.2), handleZ = frontZ - 0.15, glassFace = frontZ - 0.0275, pull = [1.3, 1.8], reach = 0.03;
    // The pull handle is longer than the distance between its two standoffs, so each standoff ends inside it.
    const handle = b.rod([handleX, pull[0] - reach, handleZ], [handleX, pull[1] + reach, handleZ], 0.025, METAL, { detail: 1 });
    for (const y of pull) {
      const standoff = b.rod([handleX, y, glassFace], [handleX, y, handleZ], 0.018, METAL, { detail: 1 });
      insertEnd(b.park, handle, standoff, 1, 'shopfront/door pull standoff', 'The standoff ends inside the pull handle, which runs past it at both ends; its other end sits flat on the door glass.');
    }
  }
}

/** Closed pitched roof. Two thin leaves meet under a ridge board, the gable triangles under their lower faces share the leaves'
 * plane, and gutters and downpipes hang from the lowest edge.
 *
 * - `width` is the horizontal run from the ridge to the lowest corner of each leaf's underside; with `flushEave` it is the run to the
 *   leaf's outer top corner instead, so two roofs side by side meet exactly at their valley.
 * - The leaves lie just above the sloped top of the gable triangle, and each leaf ends in a square end face at the ridge. Those two
 *   faces leave a narrow V that the ridge board covers, so the leaves never cross each other. */
export function pitchedRoof(b: Parts, wallTop: number, width: number, depth: number, rise: number, color: Vec3,
  surface: ParkPart['surface'] = 'paint', wallWidth = width - 0.4, wallDepth = depth - 0.4, wallColor = color,
  options: { infill?: boolean; drainage?: boolean; halfThickness?: number; flushEave?: boolean } = {}): ParkPart[] {
  const angle = Math.atan2(rise, width), cosine = Math.cos(angle), sine = Math.sin(angle), slope = rise / width, thickness = options.halfThickness ?? 0.14;
  const ridge = wallTop + slope * wallWidth, reach = options.flushEave ? width - 2 * thickness * sine : width, length = reach / cosine, halfLength = length / 2;
  const gableRise = ridge - wallTop;
  const gables = options.infill === false ? [] : [-wallDepth + 0.1, wallDepth - 0.1].map(z => b.part('gable', [0, wallTop + gableRise / 2, z], [wallWidth, gableRise / 2, 0.1], wallColor, { metalness: 0, roughness: 0.9, surface: surface === 'timber' ? 'timber' : 'masonry' }));
  const panels: ParkPart[] = [];
  const leafFinish = { metalness: NON_METAL_SURFACES.has(surface) ? 0 : 0.08, roughness: 0.82, surface };
  for (const side of [-1, 1]) {
    // The leaf's lower inner corner sits on the ridge point; its lower face runs down the gable slope.
    const panel = b.box([side * (halfLength * cosine + thickness * sine), ridge - halfLength * sine + thickness * cosine, 0], [halfLength, thickness, depth], color,
      { localRot: axisAngle([0, 0, 1], -side * angle), ...leafFinish });
    panels.push(panel);
    for (const gable of gables) {
      const point = yawPoint(gable.pos, b.yaw, [side * wallWidth / 2, 0, 0]);
      registerJoint(b.park, { name: 'gable-to-roof underside', kind: 'fixed', a: { part: gable, point: [side * wallWidth / 2, 0, 0] }, b: partAnchor(panel, point), rationale: 'Triangular infill top and panel underside share the same roof-plane equation.' });
    }
    if (options.drainage !== false) {
      // The gutter hangs directly under the leaf's lowest corner, touching it along the whole eave.
      const edgeX = side * reach, edgeY = ridge - slope * reach, gutterRadius = 0.09, gutterY = edgeY - gutterRadius;
      const gutter = b.rod([edgeX, gutterY, -depth], [edgeX, gutterY, depth], gutterRadius, METAL, { detail: 1 });
      const seam = yawPoint(b.origin, b.yaw, [edgeX, edgeY, 0]);
      registerJoint(b.park, { name: 'roof/gutter eave seam', kind: 'fixed', a: partAnchor(panel, seam), b: partAnchor(gutter, seam), rationale: 'The gutter top meets the finite lower eave edge along its full length; this is an edge seam on a closed gutter proxy.' });
      // Each downpipe's top end is inside the gutter's outlet; a stay ties it to the wall when the wall is there.
      const pipeRadius = 0.055, stayRadius = 0.02, overhang = reach - wallWidth;
      for (const z of [-1, 1].map(end => end * Math.max(pipeRadius, Math.min(depth - 0.155, wallDepth - 0.5)))) {
        const pipe = b.rod([edgeX, PAVING_RISE, z], [edgeX, gutterY, z], pipeRadius, METAL, { detail: 1 });
        insertEnd(b.park, gutter, pipe, 1, 'roof/downpipe outlet', 'The downpipe top ends inside the gutter body at its outlet, with its whole round end inside the gutter tube.');
        if (options.infill !== false && overhang > 0.06) {
          const stay = b.rod([side * wallWidth, 1.2, z], [edgeX, 1.2, z], stayRadius, METAL, { detail: 1 });
          insertEnd(b.park, pipe, stay, 1, 'roof/downpipe stay', 'The stay ends inside the downpipe; its other end sits flat on the wall face.');
        }
      }
    }
    // Standing seams lie on the leaf: each rod is tangent to the leaf top and stops short of the ridge board and the eave.
    const seamRadius = 0.035, startAt = (0.28 - (2 * thickness + seamRadius) * sine) / cosine, stopAt = length - 0.1;
    const inner: Vec3 = [0, ridge, 0];
    for (let z = -depth + 0.7; z < depth - 0.3; z += 1.2) {
      const point = (along: number): Vec3 => [inner[0] + side * (along * cosine + (2 * thickness + seamRadius) * sine), inner[1] - along * sine + (2 * thickness + seamRadius) * cosine, z];
      b.rod(point(startAt), point(stopAt), seamRadius, shade(color, 0.65), { detail: 1, solid: false });
    }
  }
  // The ridge board covers the V between the two leaf end faces, resting on their top corners.
  const cornerY = ridge + 2 * thickness * cosine, boardHalf = 0.16, boardHalfHeight = 0.07;
  b.box([0, cornerY + boardHalfHeight, 0], [boardHalf, boardHalfHeight, depth], color, leafFinish);
  return panels;
}

/** Flat post cap and a finite bearing shoe for a roof plane y = y0 + gx*x + gz*z. */
export function slopedRoofPost(b: Parts, roof: ParkPart, x: number, z: number, bottom: number, atPost: number, gradient: [number, number], radius: number): ParkPart {
  const slope = Math.hypot(...gradient), ux = gradient[0] / slope, uz = gradient[1] / slope;
  if (!(slope > 0)) throw new Error('Sloping roof bearing requires a nonzero gradient');
  const half = radius * 3, setback = radius * 1.5, low = atPost - slope * setback, rise = slope * half;
  const post = b.rod([x, bottom, z], [x, low, z], radius, METAL);
  const shoe = b.part('gable', [x + ux * (half - setback), low + rise / 2, z + uz * (half - setback)], [half, rise / 2, radius * 1.6], METAL,
    { localRot: axisAngle([0, 1, 0], Math.atan2(-uz, ux)) });
  const bottomPoint = yawPoint(b.origin, b.yaw, [x, low, z]);
  registerJoint(b.park, { name: 'roof-post/flat shoe bearing', kind: 'fixed', a: { part: post, point: [0, post.half[1], 0] }, b: partAnchor(shoe, bottomPoint), rationale: 'The complete horizontal post cap is contained in the shoe flat base.' });
  const surfacePoint = yawPoint(b.origin, b.yaw, [x + ux * (half / 2 - setback), low + rise / 2, z + uz * (half / 2 - setback)]);
  registerJoint(b.park, { name: 'roof-post/sloping shoe bearing', kind: 'fixed', a: { part: shoe, point: [-half / 2, 0, 0] }, b: partAnchor(roof, surfacePoint), rationale: 'The rising shoe facet lies on the underside plane over a finite bearing area.' });
  return post;
}

/** Awning plane and support contacts are evaluated at each attachment, including a sloping canopy.
 * `wallZ` is the z of the wall face the canopy leans on. The canopy's lower face meets that face at `backHeight`
 * and falls by `drop` over the way out to `frontZ`. */
export function shopAwning(b: Parts, centerX: number, width: number, wallZ: number, frontZ: number, backHeight: number, drop: number, color: Vec3, posts: Vec3 = METAL):
  { canopy: ParkPart; valance: ParkPart; hang: { y: number; front: number } } {
  const depth = wallZ - frontZ, angle = -Math.atan2(drop, depth), cosine = Math.cos(angle), sine = Math.sin(angle), thick = 0.065;
  const run = Math.hypot(depth, drop);
  // The canopy's lower back corner touches the wall face; the lower face then runs down to the lower front corner.
  const midZ = (wallZ + frontZ) / 2 + thick * sine, midY = backHeight - drop / 2 + thick * cosine;
  const tilt = axisAngle([1, 0, 0], angle);
  const canopy = b.box([centerX, midY, midZ], [width, thick, run / 2], color,
    { localRot: tilt, metalness: 0, roughness: 0.92, surface: 'fabric' });
  const underAt = (z: number) => backHeight - (wallZ - z) / depth * drop;
  const postZ = frontZ + 0.15, postX = width - 0.25, shoeHalf = 0.16, shoeStart = postZ - 0.08;
  const postY = underAt(shoeStart), shoeRise = drop / depth * shoeHalf;
  for (const side of [-1, 1]) {
    const x = centerX + side * postX;
    const post = b.rod([x, PAVING_RISE, postZ], [x, postY, postZ], 0.065, posts);
    // A horizontal post cap cannot lie flush against a sloped roof. The bearing shoe has a flat base
    // and a rising face on the exact roof plane; its other face falls away into the sheltered space.
    const shoe = b.part('gable', [x, postY + shoeRise / 2, shoeStart + shoeHalf], [shoeHalf, shoeRise / 2, 0.12], posts, { localRot: axisAngle([0, 1, 0], -Math.PI / 2) });
    const postPoint = yawPoint(b.origin, b.yaw, [x, postY, postZ]);
    registerJoint(b.park, { name: 'awning post-to-shoe bearing', kind: 'fixed', a: { part: post, point: [0, post.half[1], 0] }, b: partAnchor(shoe, postPoint), rationale: 'The entire horizontal post cap bears against the flat shoe base.' });
    const roofPoint = yawPoint(b.origin, b.yaw, [x, underAt(shoeStart + shoeHalf / 2), shoeStart + shoeHalf / 2]);
    registerJoint(b.park, { name: 'awning shoe-to-canopy bearing', kind: 'fixed', a: { part: shoe, point: [-shoeHalf / 2, 0, 0] }, b: partAnchor(canopy, roofPoint), rationale: 'The shoe rising facet and roof underside share a contact plane over a finite bearing area.' });
  }
  // The valance hangs from the canopy's actual lower front corner, found by tilting the panel's own corner.
  const valanceHeight = 0.3, corner = rotate(tilt, [0, -thick, -run / 2]), cornerY = midY + corner[1], valanceZ = midZ + corner[2];
  const valance = b.box([centerX, cornerY - valanceHeight / 2, valanceZ], [width, valanceHeight / 2, 0.045], color, { metalness: 0, roughness: 0.95, surface: 'fabric' });
  const seam = yawPoint(b.origin, b.yaw, [centerX, cornerY, valanceZ]);
  registerJoint(b.park, { name: 'awning canopy-to-valance edge seam', kind: 'fixed', a: partAnchor(canopy, seam), b: partAnchor(valance, seam), rationale: 'The hanging valance meets the complete finite lower front panel edge; this is a fabric edge seam, not a horizontal load-bearing shoe.' });
  // Builder-local height of the valance middle and z of its front face, for trim that hangs on the valance.
  return { canopy, valance, hang: { y: cornerY - valanceHeight / 2, front: valanceZ - 0.045 } };
}
