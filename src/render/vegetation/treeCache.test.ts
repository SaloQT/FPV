import { describe, expect, it } from 'vitest';
import type { MeshData } from './meshBuilder';
import { atlasCacheKey, atlasCodeHashOf, loadCachedAtlas, packAtlas, storeCachedAtlas, treeCacheKey, treeCodeClosure, treeCodeHashOf, unpackAtlas, variantText } from './treeCache';
import { packAssets, unpackAssets } from './treePack';
import { VARIANT_DEFS, type VariantAsset } from './variants';

// Every .ts file of the repo's src/ (tests left out), by repo path: what the closures are checked against, wider than treeCache's own glob.
const RAW = import.meta.glob(['../../**/*.ts', '!../../**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const repoPath = (k: string): string => {
  const parts = ['src', 'render', 'vegetation'];
  for (const p of k.split('/')) if (p === '..') parts.pop(); else if (p !== '.') parts.push(p);
  return parts.join('/');
};
const SOURCES: Record<string, string> = Object.fromEntries(Object.entries(RAW).map(([k, v]) => [repoPath(k), v]));

function mesh(seed: number, vertexCount: number): MeshData {
  const f = (n: number): Float32Array => Float32Array.from({ length: n }, (_, i) => Math.sin(seed * 7 + i));
  return {
    vertexCount, pos: f(vertexCount * 3), nrm: f(vertexCount * 3), uv: f(vertexCount * 2),
    // An attribute count that is not a multiple of 4 bytes per array checks the padding between arrays.
    attr: Uint8Array.from({ length: vertexCount * 4 }, (_, i) => (seed + i) & 255),
    idx: Uint32Array.from({ length: vertexCount * 3 }, (_, i) => (i * 7 + seed) % vertexCount),
  };
}

describe('tree mesh cache', () => {
  it('reads back exactly the meshes and bounds it stored', () => {
    const assets: VariantAsset[] = VARIANT_DEFS.map((def, i) => ({
      def, lods: [mesh(i, 5 + i), mesh(i + 100, 3), mesh(i + 200, 1)], height: i + 0.5, centreY: i / 3, radius: 2 * i + 0.25,
    }));
    const back = unpackAssets(packAssets(assets))!;
    expect(back).not.toBeNull();
    back.forEach((a, i) => {
      expect(a.def).toBe(VARIANT_DEFS[i]);
      expect([a.height, a.centreY, a.radius]).toEqual([assets[i].height, assets[i].centreY, assets[i].radius]);
      a.lods.forEach((m, k) => {
        const o = assets[i].lods[k];
        expect(m.vertexCount).toBe(o.vertexCount);
        for (const f of ['pos', 'nrm', 'uv', 'attr', 'idx'] as const) expect(Array.from(m[f])).toEqual(Array.from(o[f]));
      });
    });
  });

  it('keys each tree variant, dense (extreme) and plain apart', () => {
    expect(treeCacheKey(3, true)).not.toBe(treeCacheKey(3, false));
    expect(treeCacheKey(3, true)).toBe(treeCacheKey(3, true));
    expect(treeCacheKey(3, false)).not.toBe(treeCacheKey(4, false));
    expect(treeCacheKey(3, false)).toMatch(/^tree-\d+-plain-3-[0-9a-f]{16}$/);
  });

  it('follows every import of the generators: none it cannot follow, so the cache is on', () => {
    expect(treeCodeClosure(SOURCES).closure.missing).toEqual([]);
    expect(treeCodeHashOf(SOURCES)).not.toBeNull();
    expect(atlasCodeHashOf(SOURCES)).not.toBeNull();
    // treeCache.ts globs only its own folder and rng.ts: a generator import from elsewhere turns its keys off (null), caught here.
    VARIANT_DEFS.forEach((d, v) => { if (d.rock < 0) expect(treeCacheKey(v, false), d.name).not.toBeNull(); });
    expect(atlasCacheKey(512)).not.toBeNull();
  });

  it('changes the tree key for an edit to any file the meshes are built from, and keeps it for any other file', () => {
    const { closure } = treeCodeClosure(SOURCES), base = treeCodeHashOf(SOURCES);
    // The mesh builder, the plans' helpers and rng.ts are inputs; grass, placement and the module are not, nor the plan-only treePlanBroad.ts.
    for (const f of ['src/render/vegetation/treeGen.ts', 'src/render/vegetation/meshBuilder.ts', 'src/render/vegetation/leafAtlas.ts', 'src/render/vegetation/treePlan.ts', 'src/world/track/rng.ts']) expect(closure.files).toContain(f);
    for (const f of ['src/render/vegetation/grass.ts', 'src/render/vegetation/placement.ts', 'src/render/vegetation/index.ts', 'src/render/vegetation/treePlanBroad.ts']) expect(closure.files).not.toContain(f);
    for (const f of Object.keys(SOURCES)) {
      const edited = treeCodeHashOf({ ...SOURCES, [f]: `${SOURCES[f]}\nconst edited = 1;` });
      if (closure.files.includes(f)) expect(edited, f).not.toBe(base);
      else expect(edited, f).toBe(base);
    }
  });

  it('keeps the tree key for an edit inside the variant table, which each variant keys on its own entry and plan instead', () => {
    const variants = 'src/render/vegetation/variants.ts';
    const tweaked = SOURCES[variants].replace(/tree\('birch weeping', 17,/, "tree('birch weeping', 17.5,");
    expect(tweaked).not.toBe(SOURCES[variants]);
    expect(treeCodeHashOf({ ...SOURCES, [variants]: tweaked })).toBe(treeCodeHashOf(SOURCES));
    // Outside the table it counts.
    expect(treeCodeHashOf({ ...SOURCES, [variants]: `${SOURCES[variants]}\nconst edited = 1;` })).not.toBe(treeCodeHashOf(SOURCES));
  });

  it('changes a variant\'s own part with its table entry or its plan, and only that variant\'s', () => {
    const birch = VARIANT_DEFS.findIndex((d) => d.name === 'birch weeping'), oak = VARIANT_DEFS.findIndex((d) => d.name === 'oak forest');
    const def = VARIANT_DEFS[birch];
    expect(variantText({ ...def, height: def.height + 0.5 })).not.toBe(variantText(def));
    const plan = def.plan!;
    expect(variantText({ ...def, plan: (r) => ({ ...plan(r), trunkRadius: plan(r).trunkRadius * 1.1 }) })).not.toBe(variantText(def));
    expect(variantText(VARIANT_DEFS[oak])).toBe(variantText(VARIANT_DEFS[oak]));
  });

  it('keys the leaf atlas on the atlas painter\'s code only', () => {
    const base = atlasCodeHashOf(SOURCES);
    expect(atlasCodeHashOf({ ...SOURCES, 'src/render/vegetation/leafAtlas.ts': `${SOURCES['src/render/vegetation/leafAtlas.ts']}\nconst e = 1;` })).not.toBe(base);
    expect(atlasCodeHashOf({ ...SOURCES, 'src/render/vegetation/treeLeafShapes.ts': `${SOURCES['src/render/vegetation/treeLeafShapes.ts']}\nconst e = 1;` })).not.toBe(base);
    expect(atlasCodeHashOf({ ...SOURCES, 'src/render/vegetation/treeGen.ts': `${SOURCES['src/render/vegetation/treeGen.ts']}\nconst e = 1;` })).toBe(base);
  });

  it('reads back exactly the leaf atlas it stored, keyed by tile size', () => {
    const level = (n: number, k: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31 + k) & 255);
    const atlas = { tileSize: 512, colour: [level(4 * 9, 1), level(4 * 3, 2), level(5, 3)], data: [level(4 * 9, 4), level(4 * 3, 5), level(5, 6)] };
    const back = unpackAtlas(packAtlas(atlas))!;
    expect(back.tileSize).toBe(512);
    for (const f of ['colour', 'data'] as const) back[f].forEach((l, i) => expect(Array.from(l)).toEqual(Array.from(atlas[f][i])));
    expect(atlasCacheKey(512)).not.toBe(atlasCacheKey(1024));
  });

  it('stores entries deflated, reads them back exactly, and replaces older entries of the same kind', async () => {
    // A tile size no tier uses, so the real cache's entries are left alone.
    const fs = nodeFs(), dir = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.FPV_TREE_CACHE_DIR || '.cache/tree-meshes', old = `atlas-1-3-${'0'.repeat(16)}`, key = atlasCacheKey(3)!;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/${old}.bin`, new Uint8Array(8));
    // Mostly transparent, like the painted atlas: a leaf on clear texels.
    const level = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i % 4000 < 600 ? (i * 37) & 255 : 0));
    const atlas = { tileSize: 3, colour: [level(1 << 18), level(1 << 16)], data: [level(1 << 18), level(1 << 16)] };
    await storeCachedAtlas(key, atlas);
    const files = fs.readdirSync(dir);
    expect(files).toContain(`${key}.bin`);
    expect(files).not.toContain(`${old}.bin`);
    expect(fs.statSync(`${dir}/${key}.bin`).size).toBeLessThan(packAtlas(atlas).byteLength / 4);
    const back = (await loadCachedAtlas(key))!;
    for (const f of ['colour', 'data'] as const) back[f].forEach((l, i) => expect(Array.from(l)).toEqual(Array.from(atlas[f][i])));
    fs.unlinkSync(`${dir}/${key}.bin`);
  });
});

/** The repo has no @types/node, so node:fs comes through the process global like in sim/perf.test.ts. */
function nodeFs(): {
  mkdirSync(path: string, o: { recursive: true }): void; writeFileSync(path: string, data: Uint8Array): void; readdirSync(path: string): string[];
  statSync(path: string): { size: number }; unlinkSync(path: string): void;
} {
  return (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process.getBuiltinModule('node:fs') as ReturnType<typeof nodeFs>;
}
