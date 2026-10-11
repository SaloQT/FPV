import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';
import { ATLAS_W, COLOUR_RANGE, TILE, TILES_X, TILE_SIZE, buildLeafAtlas, type LeafAtlas } from './leafAtlas';
import { VARIANT_DEFS, VARIANTS_OF } from './variants';

const SLOW = 60000;
const CUT = 128;
let built: LeafAtlas | null = null;
const atlas = (): LeafAtlas => (built ??= buildLeafAtlas());

const constant = (src: string, name: string): number => {
  const m = src.match(new RegExp(`const ${name}\\s*:\\s*\\w+\\s*=\\s*([-0-9.eE+]+);`));
  if (!m) throw new Error(`const ${name} not found`);
  return Number(m[1]);
};

/** Sorted painted albedo (variant tone x atlas multiplier, the shader's col before tint and drift) of one channel over the opaque texels of a tile. */
function albedo(variant: number, tile: number, channel: number): number[] {
  const data = atlas().colour[0], tone = VARIANT_DEFS[variant].tone[channel];
  const ox = (tile % TILES_X) * TILE_SIZE, oy = Math.floor(tile / TILES_X) * TILE_SIZE, out: number[] = [];
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const o = ((oy + y) * ATLAS_W + ox + x) * 4;
      if (data[o + 3] >= CUT) out.push(tone * (data[o + channel] / 255) * COLOUR_RANGE);
    }
  }
  return out.sort((a, b) => a - b);
}

const quantile = (v: readonly number[], q: number): number => v[Math.min(Math.floor(q * v.length), v.length - 1)];

describe('leaf albedo', () => {
  it('keeps broadleaf green reflectance inside the physical 0.05-0.15 band (0.1-0.15 for sunlit green leaves, less for shaded and dead ones)', () => {
    const tiles: [number, number][] = [[VARIANTS_OF.oak[0], TILE.sprig], [VARIANTS_OF.oak[1], TILE.sprig], [VARIANTS_OF.birch[0], TILE.birch], [VARIANTS_OF.bush[0], TILE.shrub]];
    for (const [v, tile] of tiles) {
      const g = albedo(v, tile, 1);
      expect(quantile(g, 0.5)).toBeGreaterThan(0.06);
      expect(quantile(g, 0.5)).toBeLessThan(0.13);
      expect(quantile(g, 0.98)).toBeLessThan(0.16);
      expect(quantile(g, 0.1)).toBeGreaterThan(0.03);
    }
  }, SLOW);

  it('paints conifer needles dark blue-green: green 0.04-0.08 on average, red under half of it, blue between', () => {
    const conifers = [...VARIANTS_OF.spruce, ...VARIANTS_OF.pine, ...VARIANTS_OF.juniper];
    for (const v of conifers) {
      const [r, g, b] = [0, 1, 2].map((c) => albedo(v, TILE.needles, c));
      const mean = (a: readonly number[]): number => a.reduce((s, x) => s + x, 0) / a.length;
      expect(mean(g)).toBeGreaterThan(0.04);
      expect(mean(g)).toBeLessThan(0.08);
      expect(mean(r)).toBeLessThan(mean(g) * 0.55);
      expect(mean(b)).toBeGreaterThan(mean(r) * 0.8);
      expect(mean(b)).toBeLessThan(mean(g));
    }
  }, SLOW);
});

describe('shaders/vegetation/tree.wgsl foliage shading', () => {
  const src = resolveShader('vegetation/tree.wgsl');

  it('gives the waxy upper face of a broadleaf a broad sheen that cannot wash a card white, and keeps undersides, needles and far cards fully rough', () => {
    expect(constant(src, 'LEAF_ROUGHNESS')).toBeGreaterThanOrEqual(0.65);
    expect(constant(src, 'LEAF_ROUGHNESS')).toBeLessThan(0.9);
    expect(constant(src, 'LEAF_BACK_ROUGHNESS')).toBeGreaterThan(constant(src, 'LEAF_ROUGHNESS'));
    expect(constant(src, 'NEEDLE_ROUGHNESS')).toBeGreaterThanOrEqual(0.9);
    expect(constant(src, 'BLOB_ROUGHNESS')).toBeGreaterThan(constant(src, 'LEAF_ROUGHNESS'));
    expect(constant(src, 'CONE_ROUGHNESS')).toBeGreaterThanOrEqual(constant(src, 'BLOB_ROUGHNESS'));
  });

  it('paints the underside of a broadleaf paler, within what a real leaf reflects, and never greys it out', () => {
    expect(constant(src, 'LEAF_BACK_LIGHTEN')).toBeGreaterThan(1.05);
    expect(constant(src, 'LEAF_BACK_LIGHTEN')).toBeLessThan(1.5);
    expect(constant(src, 'LEAF_BACK_GREY')).toBeGreaterThanOrEqual(0);
    expect(constant(src, 'LEAF_BACK_GREY')).toBeLessThan(0.3);
  });

  it('dithers the leaf alpha against a moving threshold with TAA, and cuts at a fixed 0.5 without it', () => {
    expect(src).toContain('fn alphaThreshold(');
    expect(src).toContain('(frame.misc.y & 4u) == 0u) { return 0.5; }');
    expect(src).toContain('/ alphaWidth + 0.5) <= alphaThreshold(');
    expect(src).toContain('mix(t, 0.5, saturate1(length(motion * frame.screen.xy) - 0.5))');
  });

  it('keeps an ambient floor so crown interiors are darker but never black', () => {
    expect(constant(src, 'LEAF_AO_FLOOR')).toBeGreaterThanOrEqual(0.25);
    expect(constant(src, 'LEAF_AO_FLOOR')).toBeLessThan(1);
    expect(constant(src, 'BARK_AO_FLOOR')).toBeGreaterThanOrEqual(0.3);
  });

  it('lets a broadleaf lamina reach unit translucency, the 0.8 reflectance ratio being applied by the lighting', () => {
    const lamina = Math.min(...VARIANTS_OF.oak.map((v) => VARIANT_DEFS[v].translucency)) * constant(src, 'LEAF_TRANSMIT');
    expect(lamina).toBeGreaterThanOrEqual(0.95);
    expect(VARIANT_DEFS[VARIANTS_OF.spruce[0]].translucency).toBeLessThan(VARIANT_DEFS[VARIANTS_OF.oak[0]].translucency);
  });
});
