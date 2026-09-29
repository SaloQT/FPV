import { deriveSeed } from '../../world/track/rng';
import { fbm2, hash2, smoothstep, valueNoise2 } from './noise';
import type { TerrainFields } from './terrainFields';
import { VARIANTS_OF } from './variants';

export const MAX_SLOPE_DEG = 30;
const MAX_TAN = Math.tan((MAX_SLOPE_DEG * Math.PI) / 180);
export const MIN_SOIL = 0.3;
/** Tree and bush spawn density at full wetness is this much above the dry value. */
const WET_BONUS = 1.45;
/** Rivers are drawn where the flow map is above this; nothing grows in them. */
const RIVER_FLOW = 0.85;

export interface Pick {
  variant: number;
  /** Uniform scale for plants; radius in metres for rocks (the rock meshes have a 1 m radius). */
  scale: number;
  yaw: number;
  /** Packed unorm8x4 colour multiplier (decoded as value * 2). */
  tint: number;
}

const pack = (r: number, g: number, b: number, a: number): number => {
  const q = (v: number): number => Math.round(Math.min(Math.max(v * 0.5, 0), 1) * 255);
  return (q(r) | (q(g) << 8) | (q(b) << 16) | (q(a) << 24)) >>> 0;
};

/** Scene-independent density fields and species rules for trees, bushes and rocks; every draw is a hash of the cell, so results do not depend on visit order. */
export class PlacementRules {
  private readonly sStand: number;
  private readonly sLine: number;
  private readonly sBush: number;
  private readonly sConifer: number;
  private readonly sClump: number;
  private readonly sDraw: number;
  private readonly lo: number;
  private readonly range: number;
  private readonly water: number;

  constructor(private readonly f: TerrainFields, seed: number) {
    const s = (k: number): number => deriveSeed(seed, k) | 0;
    this.sStand = s(1); this.sLine = s(2); this.sBush = s(3); this.sConifer = s(4); this.sClump = s(5); this.sDraw = s(6);
    this.lo = f.data.minHeight;
    this.range = Math.max(f.data.maxHeight - f.data.minHeight, 1);
    this.water = f.data.waterLevel;
  }

  private draw(cx: number, cz: number, k: number): number {
    return hash2(cx, cz, this.sDraw + k * 7919);
  }

  /** Tree or bush candidate of fine cell (cx, cz) at (x, z). Fills `out` and returns 1 for a tree, 2 for a bush, 0 for none. */
  plant(cx: number, cz: number, x: number, z: number, out: Pick): number {
    const f = this.f;
    const stand = smoothstep(0.44, 0.6, fbm2(x / 380, z / 380, this.sStand, 3));
    const treeMax = 0.03 + 0.97 * stand;
    const bushNoise = smoothstep(0.35, 0.65, fbm2(x / 70, z / 70, this.sBush, 2));
    const bushMax = 0.2 * (0.3 + 0.7 * bushNoise) * (0.4 + 0.6 * stand);
    const u = this.draw(cx, cz, 0);
    if (u >= Math.min(0.85, treeMax * WET_BONUS) + bushMax) return 0;

    const soil = f.soil(x, z);
    if (soil <= MIN_SOIL) return 0;
    const tan = f.gradient(x, z);
    if (tan >= MAX_TAN) return 0;
    const h = f.height(x, z);
    if (h < this.water + 0.8) return 0;
    const flow = f.flow(x, z);
    if (flow >= RIVER_FLOW) return 0;
    const hRel = (h - this.lo) / this.range;
    const line = 0.66 + 0.2 * (valueNoise2(x / 140, z / 140, this.sLine) - 0.5);
    if (hRel >= line) return 0;

    const wet = f.wetness(x, z);
    const wetF = 0.55 + 0.9 * wet;
    const base = smoothstep(0.3, 0.55, soil) * (1 - smoothstep(0.3, MAX_TAN, tan)) * (1 - smoothstep(line - 0.14, line, hRel)) * (1 - smoothstep(0.6, RIVER_FLOW, flow));
    const dTree = Math.min(0.85, treeMax * wetF) * base;
    const dBush = bushMax * wetF * base;
    const r2 = this.draw(cx, cz, 1), r3 = this.draw(cx, cz, 2), r4 = this.draw(cx, cz, 3), r5 = this.draw(cx, cz, 4);
    const conifer = smoothstep(0, 0.4, hRel + 0.5 * (fbm2(x / 260, z / 260, this.sConifer, 2) - 0.5)) * (1 - 0.35 * wet);
    out.yaw = this.draw(cx, cz, 5) * Math.PI * 2;
    const b = 0.85 + 0.3 * r5, hue = (this.draw(cx, cz, 6) - 0.5) * 0.16;
    if (u < dTree) {
      if (r2 < conifer) {
        const pine = 0.15 + 0.7 * (1 - smoothstep(0.3, 0.7, soil)) * (1 - wet);
        out.variant = r3 < pine ? VARIANTS_OF.pine[0] : VARIANTS_OF.spruce[(r3 - pine) / (1 - pine) < 0.5 ? 0 : 1];
        out.tint = pack(b * (1 + 0.4 * hue), b, b * (1 - 0.4 * hue), 1);
      } else {
        const birch = 0.08 + 0.4 * wet;
        out.variant = r3 < birch ? VARIANTS_OF.birch[0] : VARIANTS_OF.oak[(r3 - birch) / (1 - birch) < 0.5 ? 0 : 1];
        out.tint = pack(b * (1 + hue), b, b * (1 - hue), 1);
      }
      out.scale = (0.72 + 0.58 * Math.pow(r4, 0.9)) * (1 - 0.3 * smoothstep(line - 0.25, line, hRel));
      return 1;
    }
    if (u < dTree + dBush) {
      out.variant = r3 < 0.2 + 0.5 * conifer ? VARIANTS_OF.juniper[0] : VARIANTS_OF.bush[0];
      out.scale = 0.6 + r4;
      out.tint = pack(b * (1 + hue), b, b * (1 - hue), 1);
      return 2;
    }
    return 0;
  }

  /** Rock candidate of fine cell (cx, cz): steep, bare or stream-side ground, in clumps. Fills `out` (scale = radius) and returns whether one is wanted. */
  rock(cx: number, cz: number, x: number, z: number, out: Pick): boolean {
    const f = this.f;
    const clump = 0.35 + 1.15 * smoothstep(0.42, 0.62, fbm2(x / 50, z / 50, this.sClump, 2));
    const u = this.draw(cx, cz, 10);
    if (u >= 0.6 * clump) return false;
    const h = f.height(x, z);
    if (h < this.water + 0.3) return false;
    const flow = f.flow(x, z);
    if (flow >= 0.9) return false;
    const steep = smoothstep(0.27, 0.7, f.gradient(x, z));
    const bare = 1 - smoothstep(0.22, 0.4, f.soil(x, z));
    const stream = smoothstep(0.3, 0.55, flow) * (1 - smoothstep(0.8, 0.9, flow));
    if (u >= Math.max(0.5 * steep, 0.6 * bare, 0.35 * stream, 0.02) * clump) return false;
    const r = this.draw(cx, cz, 11);
    const size = Math.min(0.3 * Math.pow(1 - this.draw(cx, cz, 12), -0.6), 4);
    const rocks = VARIANTS_OF.rock;
    if (steep > 0.5) out.variant = r < 0.6 ? rocks[3] : rocks[0];
    else if (bare > 0.5) out.variant = r < 0.55 ? rocks[2] : rocks[0];
    else if (stream > 0.4) out.variant = r < 0.7 ? rocks[1] : rocks[2];
    else out.variant = rocks[r < 0.35 ? 0 : r < 0.65 ? 1 : r < 0.85 ? 2 : 3];
    out.scale = size;
    out.yaw = this.draw(cx, cz, 13) * Math.PI * 2;
    const g = 0.8 + 0.4 * this.draw(cx, cz, 14), warm = (this.draw(cx, cz, 15) - 0.5) * 0.12;
    out.tint = pack(g * (1 + warm), g, g * (1 - warm), 1);
    return true;
  }
}
