import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { KIND, MeshBuilder, VERTEX_STRIDE, card, norm, octEncode, packMeshes, tube, type MeshData } from './meshBuilder';
import { buildVariantAssets } from './variants';

const SLOW = 60000;

/** Reference decoder: the JavaScript twin of octDecode in shaders/common/math.wgsl. */
function octDecode(x: number, y: number): Vec3 {
  const ex = x * 2 - 1, ey = y * 2 - 1;
  let nx = ex, ny = ey;
  const nz = 1 - Math.abs(ex) - Math.abs(ey);
  const t = Math.min(Math.max(-nz, 0), 1);
  nx += ex >= 0 ? -t : t;
  ny += ey >= 0 ? -t : t;
  const l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}

const zero = (): number => 0;

function straightTube(sides: number, tip = false): MeshData {
  const b = new MeshBuilder();
  const pts: Vec3[] = [[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0]];
  tube(b, pts, [0.3, 0.25, 0.2, 0.1], { sides, kind: KIND.bark, sway: (y) => y / 3, ao: zero, phase: 0.5, tip });
  return b.build();
}

describe('octEncode', () => {
  it('round-trips unit vectors over the whole sphere, lower hemisphere included, inside [0, 1]', () => {
    const out: [number, number] = [0, 0];
    let worst = 0;
    for (let i = 0; i < 4000; i++) {
      const z = 1 - (2 * (i + 0.5)) / 4000, r = Math.sqrt(1 - z * z), a = i * 2.399963229728653;
      const n: Vec3 = [r * Math.cos(a), r * Math.sin(a), z];
      octEncode(n, out);
      expect(out[0]).toBeGreaterThanOrEqual(0);
      expect(out[0]).toBeLessThanOrEqual(1);
      expect(out[1]).toBeGreaterThanOrEqual(0);
      expect(out[1]).toBeLessThanOrEqual(1);
      const d = octDecode(out[0], out[1]);
      worst = Math.max(worst, Math.hypot(d[0] - n[0], d[1] - n[1], d[2] - n[2]));
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('maps the axes to the documented corners', () => {
    const out: [number, number] = [0, 0];
    expect(octEncode([0, 0, 1], out)).toEqual([0.5, 0.5]);
    expect(octEncode([1, 0, 0], out)).toEqual([1, 0.5]);
    expect(octEncode([0, -1, 0], out)).toEqual([0.5, 0]);
    expect(octEncode([0, 0, -1], out)).toEqual([1, 1]);
  });
});

describe('tube', () => {
  it('sweeps a ring per point with a duplicated seam vertex and two triangles per side', () => {
    const m = straightTube(6);
    expect(m.vertexCount).toBe(4 * 7);
    expect(m.idx.length / 3).toBe(3 * 6 * 2);
    expect(Math.max(...m.idx)).toBeLessThan(m.vertexCount);
  });

  it('places every ring vertex at its radius from the axis with an outward, taper-tilted normal', () => {
    const m = straightTube(8);
    const radii = [0.3, 0.25, 0.2, 0.1];
    for (let i = 0; i < m.vertexCount; i++) {
      const ring = Math.floor(i / 9);
      expect(Math.hypot(m.pos[i * 3], m.pos[i * 3 + 2])).toBeCloseTo(radii[ring], 5);
      const radial = norm([m.pos[i * 3], 0, m.pos[i * 3 + 2]]);
      const along = m.nrm[i * 3] * radial[0] + m.nrm[i * 3 + 2] * radial[2];
      expect(along).toBeGreaterThan(0.9);
      expect(m.nrm[i * 3 + 1]).toBeGreaterThan(0);
    }
  });

  it('runs the bark texture along the branch in metres and wraps u once around', () => {
    const m = straightTube(4);
    expect(m.uv[1]).toBeCloseTo(0, 6);
    expect(m.uv[(3 * 5) * 2 + 1]).toBeCloseTo(3 / 32, 6);
    for (let j = 0; j <= 4; j++) expect(m.uv[j * 2]).toBeCloseTo(j / 4, 6);
  });

  it('closes a tapering twig to a point and carries sway, kind and phase per vertex', () => {
    const m = straightTube(5, true);
    for (let j = 0; j <= 5; j++) expect(Math.hypot(m.pos[(18 + j) * 3], m.pos[(18 + j) * 3 + 2])).toBeCloseTo(0, 6);
    for (let i = 0; i < m.vertexCount; i++) {
      expect(m.attr[i * 4 + 2]).toBe(KIND.bark);
      expect(m.attr[i * 4 + 3]).toBe(128);
      expect(m.attr[i * 4 + 1]).toBe(Math.round((m.pos[i * 3 + 1] / 3) * 255));
    }
  });

  it('ignores a single point', () => {
    const b = new MeshBuilder();
    tube(b, [[0, 0, 0]], [1], { sides: 5, kind: 0, sway: zero, ao: zero, phase: 0 });
    expect(b.vertexCount).toBe(0);
  });
});

describe('card', () => {
  it('builds a two-triangle sprite spanning the atlas rectangle, upright side up', () => {
    const b = new MeshBuilder();
    card(b, [1, 2, 3], [0.5, 0, 0], [0, 1, 0], { rect: [0.5, 0, 1, 0.5], kind: KIND.leaf, normalAt: () => [0, 1, 0], aoAt: () => 0.5, swayAt: () => 1, phase: 0.25 });
    const m = b.build();
    expect(m.vertexCount).toBe(4);
    expect(m.idx.length).toBe(6);
    expect(Array.from(m.pos.slice(0, 3))).toEqual([0.5, 1, 3]);
    expect(Array.from(m.pos.slice(6, 9))).toEqual([1.5, 3, 3]);
    expect(m.uv[1]).toBe(0.5);
    expect(m.uv[5]).toBe(0);
    expect(Array.from(m.attr.slice(0, 4))).toEqual([128, 255, KIND.leaf, 64]);
  });
});

describe('packMeshes', () => {
  const meshes = buildVariantAssets().slice(0, 9).flatMap((v) => v.lods);
  const packed = packMeshes(meshes);
  const dv = new DataView(packed.vertices.buffer);

  it('lays the meshes out back to back with contiguous vertex and index ranges', () => {
    let vertices = 0, indices = 0;
    packed.ranges.forEach((r, i) => {
      expect(r.baseVertex).toBe(vertices);
      expect(r.firstIndex).toBe(indices);
      expect(r.vertexCount).toBe(meshes[i].vertexCount);
      expect(r.indexCount).toBe(meshes[i].idx.length);
      vertices += r.vertexCount;
      indices += r.indexCount;
    });
    expect(packed.vertices.byteLength).toBe(vertices * VERTEX_STRIDE);
    expect(packed.indices.length).toBe(indices);
  });

  it('keeps indices mesh-local so baseVertex offsets them at draw time', () => {
    packed.ranges.forEach((r, i) => {
      for (let k = 0; k < r.indexCount; k++) expect(packed.indices[r.firstIndex + k]).toBe(meshes[i].idx[k]);
    });
  }, SLOW);

  it('writes each vertex as position f32x3, octahedral normal unorm16x2, uv unorm16x2 and attr unorm8x4', () => {
    let worstNormal = 0, worstUv = 0;
    packed.ranges.forEach((r, mi) => {
      const m = meshes[mi];
      for (let i = 0; i < r.vertexCount; i += 7) {
        const o = (r.baseVertex + i) * VERTEX_STRIDE;
        for (let c = 0; c < 3; c++) expect(dv.getFloat32(o + c * 4, true)).toBe(m.pos[i * 3 + c]);
        const n = octDecode(dv.getUint16(o + 12, true) / 65535, dv.getUint16(o + 14, true) / 65535);
        worstNormal = Math.max(worstNormal, Math.hypot(n[0] - m.nrm[i * 3], n[1] - m.nrm[i * 3 + 1], n[2] - m.nrm[i * 3 + 2]));
        worstUv = Math.max(worstUv, Math.abs(dv.getUint16(o + 16, true) / 65535 - m.uv[i * 2]), Math.abs(dv.getUint16(o + 18, true) / 65535 - m.uv[i * 2 + 1]));
        for (let k = 0; k < 4; k++) expect(packed.vertices[o + 20 + k]).toBe(m.attr[i * 4 + k]);
      }
    });
    expect(worstNormal).toBeLessThan(1e-3);
    expect(worstUv).toBeLessThanOrEqual(1 / 65535);
  }, SLOW);

  it('packs an empty list to empty buffers', () => {
    const e = packMeshes([]);
    expect(e.vertices.length).toBe(0);
    expect(e.indices.length).toBe(0);
    expect(e.ranges).toEqual([]);
  });
});
