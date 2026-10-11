import { describe, expect, it } from 'vitest';
import { resolveShader } from '../shaderLib';
import { SCAN_LAYERS, parseBarkScans, scanMipSkip } from './barkScans';

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(n: 'node:fs'): { readFileSync(u: URL): Uint8Array } } }).process.getBuiltinModule('node:fs');
const file = nodeFs.readFileSync(new URL('../../../public/textures/bark/bark.bin', import.meta.url));
const scans = parseBarkScans(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);

describe('photoscanned bark', () => {
  it('holds every layer the shader reads, with a full BC7 mip chain down to 4x4', () => {
    expect(scans.layers.map((l) => l.name)).toEqual([...SCAN_LAYERS]);
    expect(scans.size >> (scans.mips - 1)).toBe(4);
    for (const tex of ['colour', 'surface'] as const) {
      scans.blocks[tex].forEach((b, m) => expect(b.byteLength).toBe(((scans.size >> m) / 4) ** 2 * 16 * SCAN_LAYERS.length));
    }
  });

  it('comes from CC0 scans, each named with its source', () => {
    for (const l of scans.layers) {
      expect(l.licence).toBe('CC0 1.0');
      expect(l.source).toMatch(/^https:\/\/(ambientcg\.com|polyhaven\.com|www\.cgbookcase\.com)\//);
    }
  });

  it('gives the shader the same tile sizes as the file', () => {
    const src = resolveShader('vegetation/tree_bark.wgsl');
    const m = /const SCAN_METRES = array<f32, 6>\(([^)]*)\);/.exec(src);
    expect(m).not.toBeNull();
    expect(m![1].split(',').map(Number)).toEqual(scans.layers.map((l) => l.metres));
    const along = /const SCAN_ALONG = array<f32, 6>\(([^)]*)\);/.exec(src);
    expect(along).not.toBeNull();
    expect(along![1].split(',').map(Number)).toEqual(scans.layers.map((l) => l.along));
    SCAN_LAYERS.forEach((name, i) => expect(src).toContain(`const SCAN_${name.toUpperCase().replace('-', '_')} : i32 = ${i};`));
  });

  it('is used from the high tier up, at half resolution on high', () => {
    expect(scanMipSkip('low')).toBeNull();
    expect(scanMipSkip('medium')).toBeNull();
    expect(scanMipSkip('high')).toBe(1);
    expect(scanMipSkip('ultra')).toBe(0);
    expect(scanMipSkip('extreme')).toBe(0);
  });

  it('rejects a damaged file', () => {
    expect(() => parseBarkScans(new ArrayBuffer(8))).toThrow();
    const cut = file.buffer.slice(file.byteOffset, file.byteOffset + 4096) as ArrayBuffer;
    expect(() => parseBarkScans(cut)).toThrow();
  });
});
