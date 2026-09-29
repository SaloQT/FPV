/**
 * 5.1 inch tri-blade propeller. The mesh is centred on the hub with the axis along +Y and blade 0 along +X. The counter-clockwise
 * mesh (`mirrored = false`) is built for a rotor that turns counter-clockwise seen from above: blades lead with the edge toward -Z
 * and are pitched so the thrust is +Y. The clockwise mesh is its mirror image across the xy plane.
 */
import { KIND } from './materials';
import { MeshBuilder, affineFromBasis, affineRotY, type MeshData } from './meshBuilder';
import { lathe, surface } from './primitives';
import { plate } from './extrude';
import type { Pt } from './polygon';

/** Matches FIVE_INCH_PROP.diameter (0.1295 m) in the physics presets. */
export const PROP_RADIUS = 0.06475;
export const PROP_BLADES = 3;
export const PROP_HUB_RADIUS = 0.0088;
const ROOT_RADIUS = 0.005;
const CHORD_MAX = 0.0135;
/** Geometric pitch, metres of advance per revolution. */
const PITCH = 0.104;
const SECTION_SEGMENTS = 16;
const RADIAL_SEGMENTS = 14;

/** Rounds the last tenth of the blade to a point; it scales both chord and thickness so the tip closes. */
function tipRound(rho: number): number {
  return rho > 0.9 ? Math.sqrt(Math.max(0, 1 - ((rho - 0.9) / 0.1) ** 2)) : 1;
}

function chordAt(rho: number): number {
  const body = 0.72 + 0.28 * Math.sin(Math.min(rho / 0.45, 1) * Math.PI * 0.5) - 0.45 * Math.max(0, (rho - 0.45) / 0.55) ** 1.6;
  return CHORD_MAX * body * tipRound(rho);
}

/** Blade twist: the section angle above the rotation plane for a constant geometric pitch. */
export function pitchAngleAt(r: number): number {
  return Math.atan(PITCH / (2 * Math.PI * Math.max(r, 0.014)));
}

/** Point on the blade surface at radius fraction v (0 root, 1 tip) and section parameter u (0 = trailing edge, then the lower side). */
export function bladePoint(u: number, v: number): [number, number, number] {
  const rho = 1 - (1 - v) ** 1.5;
  const r = ROOT_RADIUS + rho * (PROP_RADIUS - ROOT_RADIUS);
  const chord = chordAt(rho);
  const phi = (u - Math.floor(u)) * Math.PI * 2;
  const x = (1 + Math.cos(phi)) / 2;
  // Signed sqrt(x): negative on the lower side, zero at the leading edge, so the nose stays smooth.
  const sx = -Math.cos(phi / 2);
  const sgn = sx >= 0 ? 1 : -1;
  const poly = -0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4;
  const thickness = (0.0016 * (1 - rho) + 0.0006) * tipRound(rho);
  const h = 5 * thickness * (0.2969 * sx + sgn * poly) + 0.16 * chord * x * (1 - x);
  const q = (x - 0.4) * chord + 0.004 * rho * rho;
  const beta = pitchAngleAt(r);
  const sb = Math.sin(beta);
  const cb = Math.cos(beta);
  return [r, -q * sb + h * cb, q * cb + h * sb];
}

function addBlade(b: MeshBuilder): void {
  b.kind = KIND.PROP;
  b.aoFn = (x, _y, z) => 0.55 + 0.45 * Math.min(1, Math.max(0, (Math.hypot(x, z) - PROP_HUB_RADIUS) / 0.012));
  surface(b, bladePoint, SECTION_SEGMENTS, RADIAL_SEGMENTS, { wrapU: true });
  b.aoFn = null;
}

function hexagon(across: number): Pt[] {
  const r = across / Math.sqrt(3);
  return Array.from({ length: 6 }, (_, i): Pt => [r * Math.cos((i * Math.PI) / 3), r * Math.sin((i * Math.PI) / 3)]);
}

function addHub(b: MeshBuilder): void {
  b.kind = KIND.PROP_HUB;
  lathe(b, [[0, -0.0025], [0.0079, -0.0025], [0.0088, -0.0016], [0.0088, 0.0012], [0.0078, 0.0025], [0.005, 0.0025], [0, 0.0025]], 28, { hardAngle: 0.9 });
  b.kind = KIND.STEEL;
  plate(b, hexagon(0.0075), [], 0.0025, 0.0062, { hardAngle: 0.6 });
}

/** The whole rotor mesh (blades plus hub and nut), un-mirrored or mirrored for the opposite rotation. */
export function buildPropMesh(mirrored: boolean): MeshData {
  const b = new MeshBuilder();
  if (mirrored) b.push(affineFromBasis([1, 0, 0], [0, 1, 0], [0, 0, -1], [0, 0, 0]));
  for (let i = 0; i < PROP_BLADES; i++) {
    b.push(affineRotY((i * Math.PI * 2) / PROP_BLADES));
    addBlade(b);
    b.pop();
  }
  addHub(b);
  if (mirrored) b.pop();
  return b.finish();
}
