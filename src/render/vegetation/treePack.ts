import type { MeshData } from './meshBuilder';
import { VARIANT_DEFS, type VariantAsset, type VariantDef } from './variants';

// Built tree variants packed into one transferable buffer, for the disk cache (treeCache.ts) and the build workers (treeBuildPool.ts).

/** The meshes and bounds of every variant in one buffer: a header of counts, then each mesh's arrays back to back. */
export function packAssets(assets: readonly VariantAsset[]): ArrayBuffer {
  const meshes = assets.flatMap((a) => a.lods);
  const parts: ArrayBufferView[] = [];
  const header = new Float64Array(1 + assets.length * 3 + meshes.length * 2);
  let h = 0;
  header[h++] = assets.length;
  for (const a of assets) { header[h++] = a.height; header[h++] = a.centreY; header[h++] = a.radius; }
  for (const m of meshes) { header[h++] = m.vertexCount; header[h++] = m.idx.length; }
  parts.push(header);
  for (const m of meshes) parts.push(m.pos, m.nrm, m.uv, m.attr, m.idx);
  // Each array starts on a 4-byte boundary.
  const size = parts.reduce((n, p) => n + Math.ceil(p.byteLength / 4) * 4, 0);
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), o); o += Math.ceil(p.byteLength / 4) * 4; }
  return out.buffer;
}

/** Assets packed by packAssets, for the variants `defs` (every variant by default); null if the buffer does not hold that many. */
export function unpackAssets(buffer: ArrayBuffer, defs: readonly VariantDef[] = VARIANT_DEFS): VariantAsset[] | null {
  const count = new Float64Array(buffer, 0, 1)[0];
  if (count !== defs.length) return null;
  const header = new Float64Array(buffer, 0, 1 + count * 3 + count * 3 * 2);
  let o = header.byteLength, h = 1 + count * 3;
  const take = <T extends ArrayBufferView>(make: (b: ArrayBuffer, off: number, n: number) => T, n: number, bytes: number): T => {
    const v = make(buffer, o, n);
    o += Math.ceil((n * bytes) / 4) * 4;
    return v;
  };
  const meshes: MeshData[] = [];
  for (let k = 0; k < count * 3; k++) {
    const vertexCount = header[h++], indices = header[h++];
    meshes.push({
      vertexCount,
      pos: take((b, off, n) => new Float32Array(b, off, n), vertexCount * 3, 4),
      nrm: take((b, off, n) => new Float32Array(b, off, n), vertexCount * 3, 4),
      uv: take((b, off, n) => new Float32Array(b, off, n), vertexCount * 2, 4),
      attr: take((b, off, n) => new Uint8Array(b, off, n), vertexCount * 4, 1),
      idx: take((b, off, n) => new Uint32Array(b, off, n), indices, 4),
    });
  }
  if (o !== buffer.byteLength) return null;
  return defs.map((def, i) => ({
    def, lods: [meshes[i * 3], meshes[i * 3 + 1], meshes[i * 3 + 2]], height: header[1 + i * 3], centreY: header[2 + i * 3], radius: header[3 + i * 3],
  }));
}
