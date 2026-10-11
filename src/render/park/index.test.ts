import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vec3 } from '../../contracts';
import type { FrameInfo, RenderContext, SceneData } from '../contracts';
import type { ParkRuntime } from '../../world/park/runtime';
import type { BodyPose, ParkPart } from '../../world/park/types';
import { GuestMode } from '../../world/park/crowd';
import { rotate } from '../../world/park/math';
import { GUEST_ANKLE_Y, GUEST_SEAT_Y, guestLegPose } from '../../world/park/guestPose';
import { parkMesh } from './mesh';
import { createParkModule, ROUND_MESH_ERROR } from './index';

interface BufferMock { label: string; bytes: Uint8Array; destroy(): void }
function fixture(hiddenProxy = false, externalRayProxy = false, extraParts: ParkPart[] = []) {
  const buffers = new Map<string, BufferMock>(), writes: { label: string; offset: number; size: number }[] = [];
  const device = {
    createBuffer(d: GPUBufferDescriptor) { const buffer = { label: d.label!, bytes: new Uint8Array(d.size), destroy: vi.fn() }; buffers.set(buffer.label, buffer); return buffer; },
    queue: { writeBuffer(buffer: BufferMock, offset: number, source: Float32Array | Uint32Array, start = 0, length = source.length - start) {
      const bytes = new Uint8Array(source.buffer, source.byteOffset + start * source.BYTES_PER_ELEMENT, length * source.BYTES_PER_ELEMENT);
      buffer.bytes.set(bytes, offset); writes.push({ label: buffer.label, offset, size: bytes.byteLength });
    } },
    createBindGroupLayout: () => ({}), createBindGroup: () => ({}), createRenderPipeline: () => ({}), createPipelineLayout: () => ({}),
  };
  const rt = { remove: vi.fn(), setStatic: vi.fn(), setDynamic: vi.fn() };
  const rc = { device, module: () => ({}), frame: { layout: {} }, world: { layout: {} }, rt } as unknown as RenderContext;
  const part = (shape: ParkPart['shape'], pos: Vec3, body: number): ParkPart => ({ shape, pos, body, rot: [0, 0, 0, 1], half: [1, 1, 1], color: [0.4, 0.2, 0.1], roughness: 0.8, metalness: 0, emissive: 0, solid: true, detail: 0 });
  // Deliberately interleave static/dynamic parts; draw grouping must retain the correct resident slot.
  const parts = [part('cylinder', [0.5, 0, -12], 0), part('box', [-2, 0, -8], -1), part('cone', [2, 0, -12], -1)];
  parts[0].surface = 'concrete'; parts[1].surface = 'timber'; parts[2].surface = 'fabric';
  if (hiddenProxy) parts[1].render = false;
  if (externalRayProxy) parts[1].rayTrace = false;
  parts.push(...extraParts);
  const crowd = { count: 2, pos: new Float64Array([0, 0, -6, 3, 0, -8]), previous: new Float64Array([0, 0, -6, 3, 0, -8]),
    seatBlend: new Float64Array(2), previousSeatBlend: new Float64Array(2), seatAngle: new Float64Array(2).fill(1.45), straddle: new Float32Array(2), seatFront: new Float32Array(2).fill(0.31),
    stairFlight: new Int16Array(2).fill(-1),
    height: new Float32Array([1.75, 1.6]), yaw: new Float64Array(2), mode: new Uint8Array(2), tint: new Float32Array([0.2, 0.3, 0.4, 0.5, 0.4, 0.3]), vel: new Float64Array([1, 0, 0, 0, 0, 0]) };
  const runtime = { park: { parts, bodies: [{}] }, crowd, tick: 250, renderTime: 1,
    bodyPose(_id: number, time: number, out: BodyPose) { out.pos[0] = time; out.pos[1] = out.pos[2] = 0; return out; },
    guestSeat(_id: number, out: BodyPose) { out.rot[0] = out.rot[1] = 0; out.rot[2] = out.rot[3] = Math.SQRT1_2; return out; },
    guestTransferPose(_id: number, blend: number, out: BodyPose) { out.rot = [0, 0, 0, 1]; out.pos = [blend, 0, -6]; return out; },
    guestStairContacts(_id: number, _position: ArrayLike<number>, time: number, out: Float32Array) { out.set([0, -0.12, 0.15 + time / 100, 0.1]); return true; },
    guestCapsule(_id: number, a: Vec3, b: Vec3) { a[0] = b[0] = 0; },
  };
  const frame = (frameIndex: number, reverse = false): FrameInfo => ({ frameIndex, dt: 0.25, time: frameIndex / 60, width: 1600, height: 900,
    camera: { pos: [0, 0, 0], quat: reverse ? [0, 1, 0, 0] : [0, 0, 0, 1], fovY: Math.PI / 2, aspect: 16 / 9, near: 0.05, far: 1000 }, astro: {} as FrameInfo['astro'], quad: null });
  const mod = createParkModule(); mod.init(rc); mod.setScene!(rc, { park: runtime as unknown as ParkRuntime } as SceneData);
  const instanceBuffer = () => buffers.get('resident park instances')!;
  const records = () => new Float32Array(instanceBuffer().bytes.buffer);
  const record = (slot: number) => records().slice(slot * 32, (slot + 1) * 32);
  const draws: { mesh: string; slots: number[] }[] = []; let currentMesh = '';
  const pass = { setPipeline() {}, setBindGroup() {}, setVertexBuffer(_slot: number, b: BufferMock) { currentMesh = b.label; },
    draw(_vertices: number, instances: number, _firstVertex: number, firstInstance: number) {
      const indices = new Uint32Array(buffers.get('visible park instance indices')!.bytes.buffer);
      draws.push({ mesh: currentMesh, slots: [...indices.slice(firstInstance, firstInstance + instances)] });
    } } as unknown as GPURenderPassEncoder;
  const update = (index: number, reverse = false) => { const f = frame(index, reverse); draws.length = 0; mod.update!(rc, f); mod.encodeGBuffer!(pass, rc, f); };
  const contacts = (encoded: number) => new Float32Array(buffers.get('park stair foot contacts')!.bytes.buffer).slice((encoded - 2) * 8, (encoded - 1) * 8);
  return { runtime, crowd, mod, writes, instanceBuffer, record, contacts, draws, update, rt };
}

describe('resident park instance uploads and temporal history', () => {
  beforeEach(() => { vi.stubGlobal('GPUShaderStage', { VERTEX: 1 }); vi.stubGlobal('GPUBufferUsage', { STORAGE: 128, COPY_DST: 8, VERTEX: 32 }); });
  afterEach(() => vi.unstubAllGlobals());

  it('preserves primitive visibility and mesh detail at distance and pixel-size boundaries', () => {
    const extra: ParkPart[] = [], shapes: ParkPart['shape'][] = ['box', 'cylinder', 'sphere', 'cone', 'gable'];
    for (const shape of shapes) for (const detail of [0, 1, 2] as const) for (const emissive of [0, 0.2]) {
      for (const distance of [29.999, 30, 30.001, 99.999, 100, 100.001, 109.999, 110, 110.001, 1900, 1902]) for (const radius of [0.004, 0.05, 1.8]) {
        extra.push({ shape, pos: [0, 0, -distance], body: extra.length % 2 ? -1 : 0, rot: [0, 0, 0, 1], half: [radius, radius, radius], color: [0.4, 0.2, 0.1], roughness: 0.8, metalness: 0,
          emissive, solid: true, detail, render: extra.length % 19 ? undefined : false });
      }
    }
    const f = fixture(false, false, extra); f.update(1);
    const parts = f.runtime.park.parts, ordered = [...parts.filter(p => p.body < 0), ...parts.filter(p => p.body >= 0)], expected = new Map<string, number[]>();
    const tanY = Math.tan(Math.PI / 4), tanX = tanY * 16 / 9, padX = Math.hypot(1, tanX), padY = Math.hypot(1, tanY);
    for (let slot = 0; slot < ordered.length; slot++) {
      const part = ordered[slot], data = f.record(slot), x = data[0], y = data[1], z = data[2], depth = -z;
      const radius = Math.fround(Math.hypot(...part.half)), extent = Math.fround(Math.max(...part.half)), d2 = x ** 2 + y ** 2 + z ** 2;
      if (part.render === false || !(depth + radius > 0.05 && Math.abs(x) < depth * tanX + radius * padX && Math.abs(y) < depth * tanY + radius * padY)) continue;
      if (d2 > (1900 + radius) ** 2 || part.detail === 1 && d2 > 10000 || part.detail === 2 && d2 > 900 || part.emissive === 0 && extent ** 2 < 0.2025 / (900 * 900) * Math.max(1, d2)) continue;
      const roundRadius2 = Math.fround(Math.max(...part.half) ** 2), rounded = part.shape !== 'box' && part.shape !== 'gable';
      // A round part's facet gap on screen, r (1 - cos(pi/n)) pixels-per-metre / distance, stays within ROUND_MESH_ERROR below 48 sides.
      const pixels = (n: number) => Math.sqrt(roundRadius2) * (1 - Math.cos(Math.PI / n)) * (900 / (2 * Math.tan(Math.PI / 4))) / Math.sqrt(Math.max(1, d2));
      const sides = rounded ? pixels(12) > ROUND_MESH_ERROR ? 48 : pixels(6) > ROUND_MESH_ERROR ? 12 : 6 : d2 > 12100 ? 6 : 12;
      if (rounded && sides < 48) expect(pixels(sides)).toBeLessThanOrEqual(ROUND_MESH_ERROR * (1 + 1e-6));
      const mesh = part.shape === 'gable' ? 'park exact triangular prism' : `park ${part.shape} ${sides}`;
      if (!expected.has(mesh)) expected.set(mesh, []); expected.get(mesh)!.push(slot);
    }
    const actual = new Map(f.draws.filter(d => !d.mesh.startsWith('park guest')).map(d => [d.mesh, [...d.slots].sort((a, b) => a - b)]));
    expect(actual).toEqual(expected);
    f.mod.destroy!();
  });

  it('draws correct interleaved static and moving parts without rewriting static records', () => {
    const f = fixture(), before = f.instanceBuffer().bytes.slice(0, 2 * 32 * 4); f.writes.length = 0;
    f.update(1); f.runtime.renderTime = 2; f.update(2);
    expect(f.instanceBuffer().bytes.slice(0, before.length)).toEqual(before);
    expect(f.writes.filter(w => w.label === 'resident park instances').every(w => w.offset >= before.length)).toBe(true);
    const resolved = f.draws.flatMap(draw => draw.slots.map(slot => ({ mesh: draw.mesh, pos: [...f.record(slot).slice(0, 3)] })));
    expect(resolved).toContainEqual({ mesh: 'park box 12', pos: [-2, 0, -8] });
    expect(resolved).toContainEqual({ mesh: 'park cone 48', pos: [2, 0, -12] });
    expect(resolved).toContainEqual({ mesh: 'park cylinder 48', pos: [2.5, 0, -12] });
    expect(f.record(2).slice(16, 19)).toEqual(new Float32Array([1.5, 0, -12]));
    expect([f.record(0)[27], f.record(1)[27], f.record(2)[27]]).toEqual([-2, -3, -1]);
    expect([f.record(3)[27], f.record(4)[27]]).toEqual([1, 1]);
    expect(resolved.filter(d => d.mesh.startsWith('park guest'))).toHaveLength(2);
    f.mod.destroy!();
  });

  it('has zero guest pose/animation motion while simulation is paused despite wall-clock frame deltas', () => {
    const f = fixture(); f.update(1); f.update(2);
    for (const slot of [3, 4]) {
      const record = f.record(slot);
      expect(record.slice(24, 28)).toEqual(record.slice(28, 32));
      expect(record.slice(0, 3)).toEqual(record.slice(16, 19));
      expect(record.slice(4, 8)).toEqual(record.slice(20, 24));
    }
    f.mod.destroy!();
  });

  it('retains stair targets across pauses, landing boundaries and culling without sharing another guest history', () => {
    const f = fixture(); f.update(1); f.crowd.stairFlight[0] = 0; f.update(2);
    expect(f.record(3)[27]).toBeGreaterThanOrEqual(2); expect(f.record(3)[31]).toBe(1);
    const first = f.contacts(f.record(3)[27]); f.update(3);
    expect(f.contacts(f.record(3)[31])).toEqual(first); expect(f.contacts(f.record(3)[27])).toEqual(first);
    f.runtime.renderTime += 0.25; f.update(4);
    expect(f.contacts(f.record(3)[31])).toEqual(first);
    const last = f.contacts(f.record(3)[27]); f.crowd.stairFlight[0] = -1; f.update(5);
    expect(f.record(3)[27]).toBe(1); expect(f.contacts(f.record(3)[31])).toEqual(last);
    f.crowd.stairFlight[0] = 0; f.update(6, true); f.runtime.renderTime += 1; f.update(7);
    expect(f.record(3).slice(24, 28)).toEqual(f.record(3).slice(28, 32));
    expect(f.record(4)[27]).toBe(1); expect(f.record(4)[31]).toBe(1);
    f.mod.destroy!();
  });

  it('renders at least one actual walking shoe sole on the interpolated paving plane in every LOD', () => {
    const f = fixture(); f.crowd.pos[1] = f.crowd.previous[1] = 12.2;
    for (const [distance, mesh] of [[20, parkMesh('guestHero', 24)], [35, parkMesh('guest', 12)], [80, parkMesh('guest', 6)]] as const) for (let phase = 0; phase < 24; phase++) {
      f.crowd.pos[2] = f.crowd.previous[2] = -distance; f.runtime.renderTime = 1 + phase / 24; f.update(phase + 1);
      const record = f.record(3), h = record[9]; let minimum = Infinity;
      for (let v = 0; v < mesh.length; v += 7) {
        const code = Math.floor(mesh[v + 6]); if (code >> 4 !== 3) continue;
        const gait = guestLegPose(record[24], record[25], h, (code & 1) !== 0);
        // guestForm scales only X/Z at the shoes; limb() keeps the whole sole horizontal.
        const local: Vec3 = [mesh[v] * h, (mesh[v + 1] + gait.ankle[0] - GUEST_ANKLE_Y - gait.drop) * h, (mesh[v + 2] + gait.ankle[1]) * h];
        minimum = Math.min(minimum, record[1] + rotate([...record.slice(4, 8)] as [number, number, number, number], local)[1]);
      }
      expect(minimum).toBeCloseTo(12.2, 5);
    }
    f.mod.destroy!();
  });

  it('selects close-up anatomy only nearby and preserves identity and motion across guest LOD changes', () => {
    const f = fixture(); f.update(1);
    expect(f.draws.find(draw => draw.mesh === 'park guest hero')?.slots).toEqual([3, 4]);
    const previous = f.record(3);
    f.crowd.pos[2] = -20; f.crowd.previous.set(f.crowd.pos); f.update(2);
    expect(f.draws.find(draw => draw.mesh === 'park guest 12')?.slots).toContain(3);
    expect(f.record(3).slice(16, 19)).toEqual(previous.slice(0, 3));
    expect(f.record(3).slice(12, 16)).toEqual(previous.slice(12, 16));
    f.crowd.pos[2] = -80; f.crowd.previous.set(f.crowd.pos); f.update(3);
    expect(f.draws.find(draw => draw.mesh === 'park guest 6')?.slots).toContain(3);
    expect(f.record(3)[19]).toBe(previous[19]);
    f.mod.destroy!();
  });

  it('keeps a planted tree woody proxy in ray tracing while its detailed vegetation mesh owns drawing', () => {
    const f = fixture(true); f.update(1);
    expect(f.draws.some(draw => draw.mesh.startsWith('park box'))).toBe(false);
    expect(f.mod.stats().visibleParts).toBe(2);
    const proxies = f.rt.setStatic.mock.calls.find(call => call[0] === 'park')![1];
    expect(proxies).toHaveLength(2);
    expect(proxies.some((p: { type: string; center: Vec3 }) => p.type === 'obb' && p.center[0] === -2)).toBe(true);
    f.mod.destroy!();
  });

  it('does not duplicate a woody shadow proxy owned by vegetation and keeps physical parts intact', () => {
    const f = fixture(true, true); f.update(1);
    const proxies = f.rt.setStatic.mock.calls.find(call => call[0] === 'park')![1];
    expect(proxies).toHaveLength(1); expect(proxies[0].type).toBe('cone');
    expect(f.runtime.park.parts[1].solid).toBe(true); expect(f.runtime.park.parts).toHaveLength(3);
    f.mod.destroy!();
  });

  it('retains the actual prior walking pose when boarding changes the skeletal pose', () => {
    const f = fixture(); f.update(1); const walking = f.record(3);
    f.crowd.mode[0] = GuestMode.Riding; f.crowd.seatBlend[0] = f.crowd.previousSeatBlend[0] = 1; f.runtime.renderTime = 1.05; f.update(2);
    const riding = f.record(3);
    expect(riding[26]).toBe(1); expect(riding[30]).toBe(0);
    expect(riding.slice(28, 32)).toEqual(walking.slice(24, 28));
    expect(riding.slice(20, 24)).toEqual(walking.slice(4, 8));
    expect(riding.slice(4, 8)).not.toEqual(riding.slice(20, 24));
    f.mod.destroy!();
  });

  it('keeps a seated pelvis rigidly attached at interpolated rotating poses instead of lerping its foot origin', () => {
    const f = fixture(); f.crowd.mode[0] = GuestMode.Riding; f.crowd.seatBlend[0] = f.crowd.previousSeatBlend[0] = 1;
    f.crowd.previous.set([0, 0, -6, 3, 0, -8]); f.crowd.pos.set([0.8, 1.2, -6, 3, 0, -8]);
    f.runtime.renderTime = 0.999; f.update(1);
    const record = f.record(3), height = f.crowd.height[0];
    const pelvis = rotate([...record.slice(4, 8)] as [number, number, number, number], [0, GUEST_SEAT_Y * height, 0]);
    for (let k = 0; k < 3; k++) expect(record[k] + pelvis[k]).toBeCloseTo(0, 6); // Fixture seat is at the origin.
    f.mod.destroy!();
  });

  it('samples partial boarding at render time and preserves the previous rendered knee pose', () => {
    const f = fixture(); f.update(1); const before = f.record(3);
    f.crowd.mode[0] = GuestMode.Boarding; f.crowd.previousSeatBlend[0] = 0.2; f.crowd.seatBlend[0] = 0.4;
    f.crowd.seatAngle[0] = 1.8; f.crowd.straddle[0] = 1; f.crowd.vel[0] = 0.5; f.crowd.vel[2] = 0; f.runtime.renderTime = 0.998; f.update(2); const transfer = f.record(3);
    expect(transfer[0]).toBeCloseTo(0.3, 6); expect(transfer[26]).toBeCloseTo(0.3, 6); expect(transfer[11]).toBeCloseTo(1.8, 6);
    // The feet keep stepping at the pace the body really moves while it is carried to the seat, so the stride does not jump when the transfer starts.
    expect(transfer[25]).toBeCloseTo(0.5, 6); expect(transfer[15], 'astride flag reaches the shader').toBe(1); expect(transfer.slice(28, 32)).toEqual(before.slice(24, 28));
    f.update(3); expect(f.record(3).slice(24, 28)).toEqual(f.record(3).slice(28, 32));
    f.mod.destroy!();
  });

  it('resets history after culling and does not reuse another guest compacted into the same slot', () => {
    const f = fixture(); f.update(1); f.crowd.pos[0] = 100; f.update(2);
    expect(f.mod.stats().visibleGuests).toBe(1); expect(f.record(3)[19]).toBeCloseTo(0.3 + 1 / 24);
    f.crowd.pos[0] = 0.2; f.crowd.previous.set(f.crowd.pos); f.runtime.renderTime = 8; f.update(3);
    const returned = f.record(3);
    expect(f.mod.stats().visibleGuests).toBe(2);
    expect(returned.slice(0, 3)).toEqual(returned.slice(16, 19));
    expect(returned.slice(4, 8)).toEqual(returned.slice(20, 24));
    expect(returned.slice(24, 28)).toEqual(returned.slice(28, 32));
    f.mod.destroy!();
  });
});
