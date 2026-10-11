import type { RenderQuality } from '../../contracts';

/**
 * Photoscanned bark (public/textures/bark/bark.bin, built by tools/bark/build_bark_scans.py from CC0 scans; see LICENSE.md there). Two BC7
 * texture arrays, one layer per scan: `colour` holds albedo and ambient occlusion, `surface` the normal, height and roughness. The tree
 * shader maps them on the near trunks at the high tier and up; the low and medium tiers, and any device without BC compression, keep the
 * procedural bark.
 */
export const BARK_SCANS_URL = `${import.meta.env.BASE_URL}textures/bark/bark.bin`;

/** Layer order in the arrays; tree_bark.wgsl's SCAN_* constants match. */
export const SCAN_LAYERS = ['pine-plates', 'pine-flakes', 'oak', 'spruce', 'beech', 'birch-paper'] as const;

/** `metres` of bark one tile covers round the limb and `along` up it (a tall scan is stored squeezed into its square tile, whole). */
export interface BarkScanLayer { name: string; metres: number; along: number; source: string; licence: string }

export interface BarkScans {
  size: number;
  mips: number;
  layers: BarkScanLayer[];
  /** Per texture ('colour', 'surface'), per mip, the BC7 blocks of every layer one after the other. */
  blocks: { colour: Uint8Array[]; surface: Uint8Array[] };
}

/** Tiers that use the scans, and how many of the top mips they skip (the high tier loads them at half resolution). */
export function scanMipSkip(tier: RenderQuality): number | null {
  if (tier === 'low' || tier === 'medium') return null;
  return tier === 'high' ? 1 : 0;
}

/** Parses bark.bin; throws on anything malformed. */
export function parseBarkScans(buf: ArrayBuffer): BarkScans {
  const view = new DataView(buf);
  if (buf.byteLength < 8 || new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'BRK1') throw new Error('bark.bin: bad magic');
  const jsonLength = view.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jsonLength))) as { size: number; mips: number; layers: BarkScanLayer[] };
  if (head.layers.length !== SCAN_LAYERS.length || head.layers.some((l, i) => l.name !== SCAN_LAYERS[i])) throw new Error('bark.bin: unexpected layers');
  let at = 8 + jsonLength;
  const blocks = { colour: [] as Uint8Array[], surface: [] as Uint8Array[] };
  for (const tex of ['colour', 'surface'] as const) {
    for (let m = 0; m < head.mips; m++) {
      const side = Math.max(head.size >> m, 4), bytes = (side / 4) * (side / 4) * 16 * head.layers.length;
      if (at + bytes > buf.byteLength) throw new Error('bark.bin: truncated');
      blocks[tex].push(new Uint8Array(buf, at, bytes));
      at += bytes;
    }
  }
  return { size: head.size, mips: head.mips, layers: head.layers, blocks };
}

/** Loads the scans, or null when they are missing or unreadable (the procedural bark stands in). */
export async function loadBarkScans(url = BARK_SCANS_URL): Promise<BarkScans | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return parseBarkScans(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** The two texture arrays on the GPU, skipping the top `skip` mips. */
export function uploadBarkScans(dev: GPUDevice, scans: BarkScans, skip: number): { colour: GPUTexture; surface: GPUTexture } {
  const layers = scans.layers.length, size = scans.size >> skip, mips = scans.mips - skip;
  const make = (tex: 'colour' | 'surface', format: GPUTextureFormat): GPUTexture => {
    const t = dev.createTexture({ label: `bark-scans-${tex}`, size: [size, size, layers], mipLevelCount: mips, format, dimension: '2d', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    for (let m = 0; m < mips; m++) {
      const side = Math.max(size >> m, 4), blocksPerRow = side / 4;
      dev.queue.writeTexture({ texture: t, mipLevel: m }, scans.blocks[tex][m + skip], { bytesPerRow: blocksPerRow * 16, rowsPerImage: blocksPerRow }, [side, side, layers]);
    }
    return t;
  };
  return { colour: make('colour', 'bc7-rgba-unorm-srgb'), surface: make('surface', 'bc7-rgba-unorm') };
}
