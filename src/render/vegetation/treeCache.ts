import { Rng } from '../../world/track/rng';
import { hash64, importClosure, stableText, type Closure } from './sourceClosure';
import { packAssets, unpackAssets } from './treePack';
import type { LeafAtlas } from './leafAtlas';
import { VARIANT_DEFS, type VariantAsset, type VariantDef } from './variants';

/**
 * A disk cache of the built tree meshes (variants.ts treeAsset), one entry per tree variant, and of the painted leaf atlas (leafAtlas.ts),
 * so a start at the extreme tier, whose crowns take a minute or two to build, only pays for it once. In a browser the entries go to
 * IndexedDB, under Node (the offline render tools) to .cache/tree-meshes/ in the working directory, or the directory FPV_TREE_CACHE_DIR
 * names; with neither, nothing is cached. Every entry is stored deflated (the extreme tier's atlas goes from 224 MB to 26 MB, its meshes
 * from 107 MB to about 50 MB), which takes under a second each way.
 *
 * The keys hash the code the entries are built from, found by following the imports (sourceClosure.ts) rather than listed by hand:
 * - a tree variant: the closure of treeGen.ts and treePack.ts, and variants.ts with its variant table cut out (and the imports only the
 *   table used); then that variant's own table entry and the plan its plan function returns. So a new plan function or parameters for one
 *   variant rebuild that variant only; a change to the mesh builder (treeGen.ts and what it imports) rebuilds them all;
 * - the leaf atlas: the closure of leafAtlas.ts.
 * An edit elsewhere in the folder (grass, placement, the module itself) keeps every entry. If a closure has an import it cannot follow
 * (a package, a computed import), nothing is cached, with a warning, rather than risk a stale tree.
 */

const RAW = import.meta.glob(['./*.ts', '!./*.test.ts', '../../world/track/rng.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
/** The globbed sources by repo path (src/...), as sourceClosure.ts takes them. */
const SOURCES: Record<string, string> = Object.fromEntries(Object.entries(RAW).map(([k, v]) => [k.startsWith('../../') ? `src/${k.slice(6)}` : `src/render/vegetation/${k.slice(2)}`, v]));
/** Bump when the stored layout below changes. 2: entries are deflated. 3: one entry per tree variant. */
const FORMAT = 3;

const VARIANTS = 'src/render/vegetation/variants.ts';
/** The variant table of variants.ts, from its declaration to the closing bracket on a line of its own. */
const TABLE = /export const VARIANT_DEFS\b[\s\S]*?\n\];/;

const warned = new Set<string>();
function hashOf(c: Closure, sources: Readonly<Record<string, string>>, what: string): string | null {
  if (c.missing.length) {
    if (!warned.has(what)) { warned.add(what); console.warn(`tree cache: off for ${what}, the generator imports what it cannot follow: ${c.missing.join('; ')}`); }
    return null;
  }
  return hash64(c.files.map((f) => `${f}\n${sources[f]}`).join('\n'));
}

/** The files the tree meshes are built from (variants.ts counts less its table), with the texts to hash them by. */
export function treeCodeClosure(all: Readonly<Record<string, string>>): { closure: Closure; sources: Record<string, string> } {
  const text = all[VARIANTS] ?? '', cut = text.replace(TABLE, '');
  // No table found: keep the whole file (every variant then rebuilds on any table edit, which is safe).
  const sources = cut !== text ? { ...all, [VARIANTS]: cut } : { ...all };
  return { closure: importClosure(sources, [VARIANTS, 'src/render/vegetation/treeGen.ts', 'src/render/vegetation/treePack.ts'], new Set(cut !== text ? [VARIANTS] : [])), sources };
}

/** Hash of the code every tree variant is built with, or null when it cannot be followed. */
export function treeCodeHashOf(all: Readonly<Record<string, string>>): string | null {
  const { closure, sources } = treeCodeClosure(all);
  return hashOf(closure, sources, 'the tree meshes');
}

/** Hash of the code the leaf atlas is painted with, or null when it cannot be followed. */
export function atlasCodeHashOf(all: Readonly<Record<string, string>>): string | null {
  return hashOf(importClosure(all, ['src/render/vegetation/leafAtlas.ts']), all, 'the leaf atlas');
}

/** The part of a tree variant's key that is its own: its table entry and its plan (as its plan function returns it). */
export function variantText(def: VariantDef): string {
  return `${stableText({ ...def, plan: null })}\n${stableText(def.plan ? def.plan(new Rng(def.seed)) : null)}`;
}

let treeCode: string | null | undefined;
const treeCodeHash = (): string | null => (treeCode !== undefined ? treeCode : (treeCode = treeCodeHashOf(SOURCES)));

const variantKeys = new Map<string, string | null>();
/**
 * Key of tree variant `v`'s meshes (dense: the extreme tier's crowns), or null when not cached. The plan is generated afresh for the key
 * (variantPlan's memoised one may have been altered by a build).
 */
export function treeCacheKey(v: number, dense: boolean): string | null {
  const id = `${v}${dense}`;
  if (variantKeys.has(id)) return variantKeys.get(id)!;
  const code = treeCodeHash(), def = VARIANT_DEFS[v];
  let key: string | null = null;
  if (code !== null) {
    try {
      key = `tree-${FORMAT}-${dense ? 'dense' : 'plain'}-${v}-${hash64(`${code}\n${variantText(def)}\n${dense}`)}`;
    } catch (e) {
      if (!warned.has(def.name)) { warned.add(def.name); console.warn(`tree cache: off for ${def.name}, its plan cannot be hashed:`, e); }
    }
  }
  variantKeys.set(id, key);
  return key;
}

interface NodeFs {
  readFileSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array): void;
  mkdirSync(path: string, o: { recursive: true }): void;
  readdirSync(path: string): string[];
  unlinkSync(path: string): void;
}
/** Node's fs when running under Node (the repo has no @types/node, so it comes through the process global), else null. */
function nodeFs(): NodeFs | null {
  const proc = (globalThis as unknown as { process?: { versions?: { node?: string }; getBuiltinModule?: (name: string) => unknown } }).process;
  return proc?.versions?.node && proc.getBuiltinModule ? (proc.getBuiltinModule('node:fs') as NodeFs) : null;
}
/** The cache directory under Node: FPV_TREE_CACHE_DIR when set (agents building different sources at once keep apart), else .cache/tree-meshes. */
function cacheDir(): string {
  const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.FPV_TREE_CACHE_DIR || '.cache/tree-meshes';
}

/** `bytes` through a (de)compression stream, or null where the platform has none. */
async function deflate(bytes: BufferSource, inflate: boolean): Promise<ArrayBuffer | null> {
  if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(inflate ? new DecompressionStream('deflate-raw') : new CompressionStream('deflate-raw'));
  return new Response(stream).arrayBuffer();
}

/** An entry's kind: its key less the format and the source hash, so a new entry replaces older ones of any format. */
const kindOf = (key: string): string => key.replace(/^([a-z]+)-\d+-(.*)-[0-9a-f]{16}$/, '$1-$2');
/** Whether a stored entry is replaced by one under `key`: the same kind, or the all-variants tree entries of format 2 and before. */
const replaces = (key: string, stored: string): boolean => stored !== key && (kindOf(stored) === kindOf(key) || (key.startsWith('tree-') && /^trees-[12]-/.test(stored)));

function openDb(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('fpv-tree-meshes', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('meshes');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The buffer stored under `key`, inflated, or null (none stored, unreadable, or no storage). */
async function loadBuffer(key: string): Promise<ArrayBuffer | null> {
  try {
    const stored = await loadStored(key);
    return stored ? await deflate(stored, true) : null;
  } catch {
    return null;
  }
}

/** The bytes stored under `key` as they are, or null. */
async function loadStored(key: string): Promise<ArrayBuffer | null> {
  try {
    const fs = nodeFs();
    if (fs) {
      const bytes = fs.readFileSync(`${cacheDir()}/${key}.bin`);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    }
    const db = await openDb();
    if (!db) return null;
    const buffer = await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
      const req = db.transaction('meshes').objectStore('meshes').get(key);
      req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return buffer ?? null;
  } catch {
    return null;
  }
}

/** Stores a buffer deflated under `key`, dropping older entries it replaces (`replaces`) so they do not pile up. Failures are ignored. */
async function storeBuffer(key: string, raw: ArrayBuffer): Promise<void> {
  try {
    const buffer = await deflate(raw, false);
    if (!buffer) return;
    const fs = nodeFs();
    if (fs) {
      const DIR = cacheDir();
      fs.mkdirSync(DIR, { recursive: true });
      for (const f of fs.readdirSync(DIR)) if (f.endsWith('.bin') && replaces(key, f.slice(0, -4))) fs.unlinkSync(`${DIR}/${f}`);
      fs.writeFileSync(`${DIR}/${key}.bin`, new Uint8Array(buffer));
      return;
    }
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('meshes', 'readwrite'), store = tx.objectStore('meshes');
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        for (const k of keys.result) if (replaces(key, String(k))) store.delete(k);
        store.put(buffer, key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // A full disk or a private window only costs the next start a rebuild.
  }
}

/** The cached meshes of tree variant `v` under `key`, or null. */
export async function loadCachedVariant(key: string, v: number): Promise<VariantAsset | null> {
  const buffer = await loadBuffer(key);
  return (buffer && unpackAssets(buffer, [VARIANT_DEFS[v]])?.[0]) ?? null;
}

/** Stores one tree variant's meshes under `key`. */
export function storeCachedVariant(key: string, asset: VariantAsset): Promise<void> {
  return storeBuffer(key, packAssets([asset]));
}

let atlasCode: string | null | undefined;
/** Key of the leaf atlas painted at `tileSize`, by the code it is painted with; null when not cached. */
export function atlasCacheKey(tileSize: number): string | null {
  if (atlasCode === undefined) atlasCode = atlasCodeHashOf(SOURCES);
  return atlasCode === null ? null : `atlas-${FORMAT}-${tileSize}-${hash64(`${atlasCode}\n${tileSize}`)}`;
}

/** The leaf atlas (both mip pyramids) in one buffer: a header of the tile size and each level's length, then the levels. */
export function packAtlas(a: LeafAtlas): ArrayBuffer {
  const levels = [...a.colour, ...a.data];
  const header = new Uint32Array(2 + levels.length);
  header.set([a.tileSize, a.colour.length, ...levels.map((l) => l.length)]);
  const out = new Uint8Array(header.byteLength + levels.reduce((n, l) => n + Math.ceil(l.length / 4) * 4, 0));
  out.set(new Uint8Array(header.buffer));
  let o = header.byteLength;
  for (const l of levels) { out.set(l, o); o += Math.ceil(l.length / 4) * 4; }
  return out.buffer;
}

export function unpackAtlas(buffer: ArrayBuffer): LeafAtlas | null {
  const [tileSize, count] = new Uint32Array(buffer, 0, 2);
  const lengths = new Uint32Array(buffer, 8, count * 2);
  let o = 8 + count * 2 * 4;
  const levels = Array.from(lengths, (n) => { const l = new Uint8Array(buffer, o, n); o += Math.ceil(n / 4) * 4; return l; });
  return o === buffer.byteLength ? { tileSize, colour: levels.slice(0, count), data: levels.slice(count) } : null;
}

/** The cached leaf atlas for `key`, or null. */
export async function loadCachedAtlas(key: string): Promise<LeafAtlas | null> {
  const buffer = await loadBuffer(key);
  return buffer ? unpackAtlas(buffer) : null;
}

/** Stores the leaf atlas under `key`. */
export function storeCachedAtlas(key: string, atlas: LeafAtlas): Promise<void> {
  return storeBuffer(key, packAtlas(atlas));
}
