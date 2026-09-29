/** Carbon frame: SDF-traced bottom and top plates, anodised standoffs and screw heads (frame coordinates). */
import { plate } from './extrude';
import { KIND } from './materials';
import type { MeshBuilder } from './meshBuilder';
import { lathe } from './primitives';
import { ARM_REACH, BODY_HALF, BOTTOM_PLATE, STANDOFF, TOP_PLATE, inFrame, smooth01 } from './quadLayout';
import { contourShapes, sdCapsule, sdCircle, sdRoundBox, sdTaperedCapsule, smoothMin, subtract } from './sdf2d';

const CORNERS: readonly (readonly [number, number])[] = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
const ARM_ROOT = 0.026;

/** Signed distance of the 5 mm bottom plate: body, four tapered arms, motor pads, arm and body cut-outs. */
function bottomField(x: number, z: number): number {
  let d = sdRoundBox(x, z, 0, 0, BODY_HALF.x, BODY_HALF.z, 0.01);
  for (const [sx, sz] of CORNERS) {
    const bx = sx * ARM_REACH;
    const bz = sz * ARM_REACH;
    d = smoothMin(d, sdTaperedCapsule(x, z, sx * ARM_ROOT, sz * ARM_ROOT, bx, bz, 0.0105, 0.0072), 0.014);
    d = smoothMin(d, sdCircle(x, z, bx, bz, 0.0165), 0.01);
  }
  for (const [sx, sz] of CORNERS) {
    const k = Math.SQRT1_2;
    d = subtract(d, sdCapsule(x, z, sx * 0.05 * k, sz * 0.05 * k, sx * 0.078 * k, sz * 0.078 * k, 0.0028));
  }
  d = subtract(d, sdRoundBox(x, z, 0, 0.044, 0.008, 0.004, 0.003));
  return subtract(d, sdRoundBox(x, z, 0, -0.044, 0.008, 0.004, 0.003));
}

/** The 2 mm top plate: rounded body, two lightening slots per side and the battery strap slots. */
function topField(x: number, z: number): number {
  let d = sdRoundBox(x, z, 0, 0, BODY_HALF.x, 0.052, 0.009);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      d = subtract(d, sdCapsule(x, z, sx * 0.0105, sz * 0.026, sx * 0.0105, sz * 0.038, 0.0035));
      d = subtract(d, sdRoundBox(x, z, sx * 0.0182, sz * 0.024, 0.0012, 0.0105, 0.0012));
    }
  }
  return d;
}

/** Centre of the bottom plate sits in the shade of the top plate and the stack. */
const enclosedAo = inFrame((x, _y, z) => 1 - 0.3 * (1 - smooth01(0.6, 1.5, Math.max(Math.abs(x) / 0.03, Math.abs(z) / 0.055))));

function addPlates(b: MeshBuilder): void {
  b.kind = KIND.CARBON;
  b.aoFn = enclosedAo;
  for (const s of contourShapes(bottomField, { x0: -0.1, z0: -0.1, x1: 0.1, z1: 0.1 }, 0.0015, 0.00025)) {
    plate(b, s.outline, s.holes, BOTTOM_PLATE.y0, BOTTOM_PLATE.y1, { chamfer: 0.0006, hardAngle: 0.7 });
  }
  b.aoFn = null;
  for (const s of contourShapes(topField, { x0: -0.04, z0: -0.07, x1: 0.04, z1: 0.07 }, 0.0006, 0.0002)) {
    plate(b, s.outline, s.holes, TOP_PLATE.y0, TOP_PLATE.y1, { chamfer: 0.0004, hardAngle: 0.7 });
  }
}

function addHardware(b: MeshBuilder): void {
  const yLo = BOTTOM_PLATE.y1;
  const yHi = TOP_PLATE.y0;
  for (const [sx, sz] of CORNERS) {
    b.push([1, 0, 0, sx * STANDOFF.x, 0, 1, 0, 0, 0, 0, 1, sz * STANDOFF.z]);
    b.kind = KIND.ALU;
    b.a2 = 1;
    b.ao = 0.85;
    lathe(b, [[0, yLo], [0.0027, yLo], [0.0028, yLo + 0.0003], [0.0028, yHi - 0.0003], [0.0027, yHi], [0, yHi]], 14, { hardAngle: 0.7 });
    b.a2 = 0;
    b.ao = 1;
    b.kind = KIND.STEEL;
    lathe(b, [[0, TOP_PLATE.y1], [0.0034, TOP_PLATE.y1], [0.0034, TOP_PLATE.y1 + 0.0008], [0.0026, TOP_PLATE.y1 + 0.0021], [0, TOP_PLATE.y1 + 0.0025]], 12, { hardAngle: 0.8 });
    lathe(b, [[0, BOTTOM_PLATE.y0 - 0.0023], [0.0018, BOTTOM_PLATE.y0 - 0.0022], [0.0030, BOTTOM_PLATE.y0 - 0.0012], [0.0032, BOTTOM_PLATE.y0]], 12, { hardAngle: 0.8 });
    b.pop();
  }
}

/** Plates, standoffs and screws; the caller positions the frame in the body. */
export function addFrame(b: MeshBuilder): void {
  addPlates(b);
  addHardware(b);
}
