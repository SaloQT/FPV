/** Power side of the quad: 6S 1300 mAh pack, foam pad, two straps, XT60 and the short pack leads. */
import type { Vec3 } from '../../contracts';
import { KIND } from './materials';
import type { MeshBuilder } from './meshBuilder';
import { bevelBox } from './primitives';
import { catmullRom } from './quadCurves';
import { BATTERY, STRAP_Z, TOP_PLATE, inFrame, smooth01 } from './quadLayout';
import { circleSection, rectSection, sweep } from './sweep';

const PAD_Y = TOP_PLATE.y1 + 0.0005;
const XT60_CENTRE: Vec3 = [0, TOP_PLATE.y1 + 0.004, 0.0505];
const STRAP_X = 0.0182;
const STRAP_LOW = 0.0299;
const STRAP_HIGH = BATTERY.centre[1] + BATTERY.half[1] + 0.0006;
const STRAP_ROUND = 0.0035;

const packAo = inFrame((_x, y) => 0.55 + 0.45 * smooth01(0.034, 0.041, y));

/** Closed rounded rectangle in the xy plane at depth z, wound so the strap hugs the pack. */
function strapLoop(z: number): Vec3[] {
  const corners: [number, number, number][] = [
    [STRAP_X - STRAP_ROUND, STRAP_HIGH - STRAP_ROUND, 0],
    [-(STRAP_X - STRAP_ROUND), STRAP_HIGH - STRAP_ROUND, 1],
    [-(STRAP_X - STRAP_ROUND), STRAP_LOW + STRAP_ROUND, 2],
    [STRAP_X - STRAP_ROUND, STRAP_LOW + STRAP_ROUND, 3],
  ];
  const pts: Vec3[] = [];
  for (const [cx, cy, c] of corners) {
    for (let k = 0; k <= 4; k++) {
      const a = ((c + k / 4) * Math.PI) / 2;
      pts.push([cx + STRAP_ROUND * Math.cos(a), cy + STRAP_ROUND * Math.sin(a), z]);
    }
  }
  pts.push(pts[0]);
  return pts;
}

function addBattery(b: MeshBuilder): void {
  b.kind = KIND.BATTERY;
  b.aoFn = packAo;
  bevelBox(b, BATTERY.centre, BATTERY.half, 0.0018);
  b.aoFn = null;
  b.kind = KIND.RUBBER;
  b.ao = 0.5;
  bevelBox(b, [0, PAD_Y, 0], [0.0155, 0.0005, 0.034], 0.0002);
  b.ao = 1;
  b.a2 = 1;
  for (const sz of [-1, 1]) sweep(b, strapLoop(sz * STRAP_Z), rectSection(0.018, 0.0012, 0.0002), { up: [0, 0, 1] });
  b.a2 = 0;
}

function addConnector(b: MeshBuilder): void {
  b.kind = KIND.PLASTIC;
  b.a2 = 1;
  bevelBox(b, XT60_CENTRE, [0.0079, 0.004, 0.008], 0.0007);
  b.a2 = 0;
  b.kind = KIND.WIRE;
  const zBattery = BATTERY.centre[2] + BATTERY.half[2];
  for (const [sx, colour] of [[-1, 0], [1, 1]] as const) {
    b.a2 = colour;
    const x = sx * 0.004;
    const path = catmullRom([[x, 0.046, zBattery - 0.001], [x, 0.043, zBattery + 0.004], [x, XT60_CENTRE[1], XT60_CENTRE[2] - 0.008]], 4);
    sweep(b, path, circleSection(0.0013, 7), { up: [0, 1, 0] });
    sweep(b, [[x, XT60_CENTRE[1], XT60_CENTRE[2] + 0.008], [x, XT60_CENTRE[1] - 0.001, XT60_CENTRE[2] + 0.0125]], circleSection(0.0013, 7), { up: [0, 1, 0], capEnd: true });
  }
  b.a2 = 0;
}

export function addPower(b: MeshBuilder): void {
  addBattery(b);
  addConnector(b);
}
