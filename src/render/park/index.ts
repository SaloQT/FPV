import type { Quat, Vec3 } from '../../contracts';
import { GBUFFER_TARGETS, DEPTH_STATE, type FrameInfo, type RenderContext, type RenderModule, type RTPrimitive } from '../contracts';
import type { ParkRuntime } from '../../world/park/runtime';
import type { BodyPose, ParkPart } from '../../world/park/types';
import { pose, rotate, clamp } from '../../world/park/math';
import { GuestMode } from '../../world/park/crowd';
import { PARK_DT } from '../../world/park/ridePhysics';
import { GUEST_SEAT_Y, guestPoseDefines, guestRenderSpeed } from '../../world/park/guestPose';
import { parkMesh } from './mesh';

export type ParkModule = RenderModule & { stats(): { visibleParts: number; visibleGuests: number; parts: number; guests: number; uploadBytes: number; testedParts: number } };
const STRIDE = 32, GUEST_GROUP = 8, HERO_GROUP = 13, GABLE_GROUP = 14, GROUPS = 15;
/** Largest on-screen gap, in pixels, between a round part's faceted mesh and its exact physical surface (below 48 sides). */
export const ROUND_MESH_ERROR = 0.5;
interface Cluster { ids: number[]; x: number; y: number; z: number; radius: number }

/** Static records stay on the GPU. Visibility draws indices into them; only moving poses and visible guests are uploaded. */
export function createParkModule(): ParkModule {
  let runtime: ParkRuntime | undefined, pipeline: GPURenderPipeline, layout: GPUBindGroupLayout, group: GPUBindGroup, buffer: GPUBuffer, indexBuffer: GPUBuffer, contactBuffer: GPUBuffer;
  let data = new Float32Array(32), indices = new Uint32Array(1), capacity = 1, visibleParts = 0, visibleGuests = 0, uploadBytes = 0, testedParts = 0, staticCount = 0;
  const meshes: { buffer: GPUBuffer; count: number }[] = [], groups = Array.from({ length: GROUPS }, () => [] as number[]);
  let poses: BodyPose[] = [], oldGuests = new Float64Array(0), oldGuestRot = new Float64Array(0), oldGuestAnim = new Float32Array(0);
  let contactData = new Float32Array(16), oldGuestContacts = new Float32Array(0);
  const currentContact = new Float32Array(8);
  let moving: number[] = [], proxySlots: number[] = [], proxies: RTPrimitive[] = [], clusters: Cluster[] = [];
  let radii = new Float32Array(0), extents = new Float32Array(0), roundRadius2 = new Float32Array(0), shapeGroups = new Uint8Array(0), slots = new Uint32Array(0), lastSeen = new Int32Array(0);
  let distanceLimit2 = new Float64Array(0), extent2 = new Float64Array(0), selectionFlags = new Uint8Array(0);
  const position: Vec3 = [0, 0, 0], rotation: Quat = [0, 0, 0, 1], previous: Vec3 = [0, 0, 0], previousRotation: Quat = [0, 0, 0, 1], seat = pose();
  const right: Vec3 = [0, 0, 0], up: Vec3 = [0, 0, 0], forward: Vec3 = [0, 0, 0];
  function posePart(part: ParkPart): void {
    if (part.body < 0) { for (let k = 0; k < 3; k++) position[k] = part.pos[k]; for (let k = 0; k < 4; k++) rotation[k] = part.rot[k]; return; }
    const b = poses[part.body], a = b.rot, q = part.rot; rotate(a, part.pos, position);
    for (let k = 0; k < 3; k++) position[k] += b.pos[k];
    rotation[0] = a[3] * q[0] + a[0] * q[3] + a[1] * q[2] - a[2] * q[1];
    rotation[1] = a[3] * q[1] - a[0] * q[2] + a[1] * q[3] + a[2] * q[0];
    rotation[2] = a[3] * q[2] + a[0] * q[1] - a[1] * q[0] + a[2] * q[3];
    rotation[3] = a[3] * q[3] - a[0] * q[0] - a[1] * q[1] - a[2] * q[2];
  }
  const primitive = (p: ParkPart): RTPrimitive => ({ type: p.shape === 'box' ? 'obb' : p.shape === 'sphere' ? 'ellipsoid' : p.shape, center: [...p.pos], half: [...p.half], rot: [...p.rot],
    material: { albedo: p.color, roughness: p.roughness, metalness: p.metalness, ...(p.emissive ? { emissive: p.color.map(c => c * p.emissive) as Vec3 } : {}) } });
  function bindBuffers(rc: RenderContext): void {
    group = rc.device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: indexBuffer } }, { binding: 2, resource: { buffer: contactBuffer } }] });
  }
  function reserveContacts(rc: RenderContext, guests: number): void {
    const floats = Math.max(16, 16 * guests);
    if (contactBuffer && floats <= contactData.length) return;
    contactData = new Float32Array(2 ** Math.ceil(Math.log2(floats))); contactBuffer?.destroy();
    contactBuffer = rc.device.createBuffer({ label: 'park stair foot contacts', size: contactData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    if (buffer) bindBuffers(rc);
  }
  function reserve(rc: RenderContext, n: number) {
    if (n <= capacity && buffer) return;
    capacity = 2 ** Math.ceil(Math.log2(Math.max(64, n))); data = new Float32Array(capacity * STRIDE); indices = new Uint32Array(capacity);
    buffer?.destroy(); indexBuffer?.destroy();
    buffer = rc.device.createBuffer({ label: 'resident park instances', size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    indexBuffer = rc.device.createBuffer({ label: 'visible park instance indices', size: indices.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    bindBuffers(rc);
  }
  function initializePart(o: number, a: ParkPart): void {
    posePart(a); data.fill(0, o, o + STRIDE);
    data.set(position, o); data[o + 3] = a.roughness; data.set(rotation, o + 4); data.set(a.half, o + 8); data[o + 11] = a.metalness;
    data.set(a.color, o + 12); data[o + 15] = a.emissive; data.set(position, o + 16); data[o + 19] = 1; data.set(rotation, o + 20);
    data[o + 27] = data[o + 31] = -Math.max(0, ['paint', 'concrete', 'timber', 'fabric', 'masonry', 'foliage', 'glass', 'paving'].indexOf(a.surface ?? 'paint'));
  }
  return {
    name: 'park', sharedOverlayPass: true,
    init(rc) {
      layout = rc.device.createBindGroupLayout({ entries: [0, 1, 2].map(binding => ({ binding, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' as const } })) });
      const module = rc.module('park/parts.wgsl', guestPoseDefines());
      pipeline = rc.device.createRenderPipeline({ label: 'resident park parts and skinned guests', layout: rc.device.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, layout] }),
        vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 28, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32' }] }] },
        fragment: { module, entryPoint: 'fs', targets: GBUFFER_TARGETS }, primitive: { topology: 'triangle-list', cullMode: 'back' }, depthStencil: DEPTH_STATE });
      for (const shape of ['box', 'cylinder', 'sphere', 'cone', 'guest'] as const) for (const sides of [12, 6]) {
        const vertices = parkMesh(shape, sides), b = rc.device.createBuffer({ label: `park ${shape} ${sides}`, size: vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        rc.device.queue.writeBuffer(b, 0, vertices); meshes.push({ buffer: b, count: vertices.length / 7 });
      }
      // Large aprons, domes and roofs need a smooth silhouette without increasing every thin rail's mesh cost.
      for (const shape of ['cylinder', 'sphere', 'cone'] as const) {
        const vertices = parkMesh(shape, 48), b = rc.device.createBuffer({ label: `park ${shape} 48`, size: vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        rc.device.queue.writeBuffer(b, 0, vertices); meshes.push({ buffer: b, count: vertices.length / 7 });
      }
      const hero = parkMesh('guestHero', 24), heroBuffer = rc.device.createBuffer({ label: 'park guest hero', size: hero.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      rc.device.queue.writeBuffer(heroBuffer, 0, hero); meshes.push({ buffer: heroBuffer, count: hero.length / 7 });
      const gable = parkMesh('gable'), gableBuffer = rc.device.createBuffer({ label: 'park exact triangular prism', size: gable.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      rc.device.queue.writeBuffer(gableBuffer, 0, gable); meshes.push({ buffer: gableBuffer, count: gable.length / 7 });
      reserveContacts(rc, 1); reserve(rc, 64);
    },
    setScene(rc, scene) {
      runtime = scene.park; rc.rt.remove('park'); rc.rt.remove('park-moving'); visibleParts = visibleGuests = uploadBytes = testedParts = 0;
      if (!runtime) return;
      const p = runtime.park; poses = p.bodies.map(() => pose());
      for (let i = 0; i < poses.length; i++) runtime.bodyPose(i, runtime.renderTime, poses[i]);
      radii = Float32Array.from(p.parts, a => Math.hypot(...a.half)); extents = Float32Array.from(p.parts, a => Math.max(...a.half));
      // Generated part metadata is immutable. Keep squared limits in Float64 to preserve the exact
      // existing comparisons while avoiding object reads and repeated powers in the per-frame loop.
      distanceLimit2 = Float64Array.from(p.parts, (a, i) => Math.min((1900 + radii[i]) ** 2, a.detail === 1 ? 10000 : a.detail === 2 ? 900 : Infinity));
      extent2 = Float64Array.from(extents, n => n * n);
      selectionFlags = Uint8Array.from(p.parts, a => (a.render === false ? 1 : 0) | (a.emissive === 0 ? 0 : 2));
      shapeGroups = Uint8Array.from(p.parts, a => a.shape === 'box' ? 0 : a.shape === 'cylinder' ? 2 : a.shape === 'sphere' ? 4 : a.shape === 'gable' ? GABLE_GROUP : 6);
      roundRadius2 = Float32Array.from(p.parts, a => (a.shape === 'sphere' ? Math.max(a.half[0], a.half[1], a.half[2]) : Math.max(a.half[0], a.half[2])) ** 2);
      lastSeen = new Int32Array(runtime.crowd.count).fill(-2); slots = new Uint32Array(p.parts.length); moving = []; const statics: number[] = [];
      p.parts.forEach((a, i) => (a.body < 0 ? statics : moving).push(i)); staticCount = statics.length;
      reserveContacts(rc, runtime.crowd.count); reserve(rc, p.parts.length + runtime.crowd.count);
      [...statics, ...moving].forEach((id, slot) => { slots[id] = slot; initializePart(slot * STRIDE, p.parts[id]); });
      // Small spatial clusters skip individual checks for whole out-of-view blocks without losing tall or crossing geometry.
      const cells = new Map<string, number[]>();
      for (const id of statics) { const a = p.parts[id]; if (a.render === false) continue; const key = `${Math.floor(a.pos[0] / 48)},${Math.floor(a.pos[2] / 48)}`; let ids = cells.get(key); if (!ids) cells.set(key, ids = []); ids.push(id); }
      clusters = [...cells.values()].map(ids => {
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        for (const id of ids) { const a = p.parts[id].pos, r = radii[id]; x0 = Math.min(x0, a[0] - r); x1 = Math.max(x1, a[0] + r); y0 = Math.min(y0, a[1] - r); y1 = Math.max(y1, a[1] + r); z0 = Math.min(z0, a[2] - r); z1 = Math.max(z1, a[2] + r); }
        return { ids, x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, radius: Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 };
      });
      proxySlots = []; proxies = [];
      for (const id of moving) { const a = p.parts[id]; if (a.rayTrace === false || a.detail !== 0 || !(a.solid || a.emissive > 0)) continue; proxySlots.push(slots[id]); proxies.push(primitive(a)); }
      for (let i = 0; i < runtime.crowd.count; i++) proxies.push({ type: 'capsule', a: [0, 0, 0], b: [0, 0, 0], radius: 0.23, material: { albedo: [0.2, 0.3, 0.4], roughness: 0.85, metalness: 0 } });
      oldGuests = runtime.crowd.pos.slice(); oldGuestRot = new Float64Array(runtime.crowd.count * 4); oldGuestAnim = new Float32Array(runtime.crowd.count * 4); for (let i = 0; i < runtime.crowd.count; i++) oldGuestRot[i * 4 + 3] = 1;
      oldGuestContacts = new Float32Array(runtime.crowd.count * 8);
      rc.rt.setStatic('park', statics.map(id => p.parts[id]).filter(a => a.rayTrace !== false && a.detail === 0 && (a.solid || a.emissive > 0)).map(primitive));
      if (p.parts.length) rc.device.queue.writeBuffer(buffer, 0, data, 0, p.parts.length * STRIDE);
    },
    update(rc, f: FrameInfo) {
      if (!runtime) return; const r = runtime, p = r.park, c = r.crowd;
      for (const g of groups) g.length = 0;
      for (let i = 0; i < poses.length; i++) r.bodyPose(i, r.renderTime, poses[i]);
      for (const id of moving) {
        const o = slots[id] * STRIDE; posePart(p.parts[id]);
        for (let k = 0; k < 3; k++) { data[o + 16 + k] = data[o + k]; data[o + k] = position[k]; }
        for (let k = 0; k < 4; k++) { data[o + 20 + k] = data[o + 4 + k]; data[o + 4 + k] = rotation[k]; }
      }
      const cam = f.camera.pos; rotate(f.camera.quat, [1, 0, 0], right); rotate(f.camera.quat, [0, 1, 0], up); rotate(f.camera.quat, [0, 0, -1], forward);
      const tanY = Math.tan(f.camera.fovY / 2), tanX = tanY * f.camera.aspect, padX = Math.hypot(1, tanX), padY = Math.hypot(1, tanY);
      const visible = (x: number, y: number, z: number, radius: number) => {
        x -= cam[0]; y -= cam[1]; z -= cam[2]; const depth = x * forward[0] + y * forward[1] + z * forward[2];
        return depth + radius > f.camera.near && Math.abs(x * right[0] + y * right[1] + z * right[2]) < depth * tanX + radius * padX && Math.abs(x * up[0] + y * up[1] + z * up[2]) < depth * tanY + radius * padY;
      };
      const completelyVisible = (cell: Cluster) => {
        const x = cell.x - cam[0], y = cell.y - cam[1], z = cell.z - cam[2], depth = x * forward[0] + y * forward[1] + z * forward[2], radius = cell.radius;
        return depth - radius > f.camera.near && Math.abs(x * right[0] + y * right[1] + z * right[2]) + radius * padX < depth * tanX && Math.abs(x * up[0] + y * up[1] + z * up[2]) + radius * padY < depth * tanY;
      };
      let entireClusterVisible = false;
      // Round meshes have their vertices on the exact surface, so an n-sided mesh lies inside it by up to r(1 - cos(pi/n)).
      // Each part gets the coarsest mesh whose gap stays within ROUND_MESH_ERROR pixels on screen.
      const pixelsPerMetre = f.height / (2 * Math.tan(f.camera.fovY / 2)), roundLimit = (sides: number) => (ROUND_MESH_ERROR / ((1 - Math.cos(Math.PI / sides)) * pixelsPerMetre)) ** 2;
      const smallPixelFactor = 0.2025 / (f.height * f.height), smoothPixelFactor = roundLimit(12), coarsePixelFactor = roundLimit(6);
      testedParts = 0;
      const cx = cam[0], cy = cam[1], cz = cam[2], fx = forward[0], fy = forward[1], fz = forward[2];
      const rx = right[0], ry = right[1], rz = right[2], ux = up[0], uy = up[1], uz = up[2], near = f.camera.near;
      const selectPart = (id: number) => {
        testedParts++; const flags = selectionFlags[id]; if (flags & 1) return;
        const slot = slots[id], o = slot * STRIDE, x = data[o] - cx, y = data[o + 1] - cy, z = data[o + 2] - cz, radius = radii[id];
        if (!entireClusterVisible) {
          const depth = x * fx + y * fy + z * fz;
          if (!(depth + radius > near && Math.abs(x * rx + y * ry + z * rz) < depth * tanX + radius * padX && Math.abs(x * ux + y * uy + z * uz) < depth * tanY + radius * padY)) return;
        }
        const d2 = x * x + y * y + z * z, pixelDistance2 = Math.max(1, d2);
        if (d2 > distanceLimit2[id] || !(flags & 2) && extent2[id] < smallPixelFactor * pixelDistance2) return;
        const shape = shapeGroups[id];
        const round = shape > 0 && shape < 8, detailedRound = round && roundRadius2[id] > smoothPixelFactor * pixelDistance2;
        const coarse = round ? roundRadius2[id] < coarsePixelFactor * pixelDistance2 : d2 > 12100;
        groups[shape === GABLE_GROUP ? GABLE_GROUP : detailedRound ? 9 + shape / 2 : shape + (coarse ? 1 : 0)].push(slot);
      };
      for (const cell of clusters) if (visible(cell.x, cell.y, cell.z, cell.radius)) { entireClusterVisible = completelyVisible(cell); for (const id of cell.ids) selectPart(id); }
      entireClusterVisible = false;
      for (const id of moving) selectPart(id);
      visibleParts = groups.reduce((n, g) => n + g.length, 0); visibleGuests = 0;
      const alpha = clamp((r.renderTime - (r.tick - 1) * PARK_DT) / PARK_DT, 0, 1);
      let contactCount = 0;
      for (let i = 0; i < c.count; i++) {
        const ci = i * 3, qi = i * 4, h = c.height[i], x = c.pos[ci], y = c.pos[ci + 1], z = c.pos[ci + 2];
        if (!visible(x, y, z, h)) continue;
        const d2 = (x - cam[0]) ** 2 + (y - cam[1]) ** 2 + (z - cam[2]) ** 2; if (d2 >= 810000) continue;
        const seating = c.previousSeatBlend[i] + alpha * (c.seatBlend[i] - c.previousSeatBlend[i]);
        const seated = c.mode[i] === GuestMode.Riding && seating === 1, transferring = !seated && (c.seatBlend[i] > 0 || c.previousSeatBlend[i] > 0);
        if (seated) { const q = r.guestSeat(i, seat, r.renderTime).rot; for (let k = 0; k < 4; k++) rotation[k] = q[k]; rotate(q, [0, -GUEST_SEAT_Y * h, 0], position); for (let k = 0; k < 3; k++) position[k] += seat.pos[k]; }
        else if (transferring) { const transfer = r.guestTransferPose(i, seating, seat, r.renderTime); for (let k = 0; k < 4; k++) rotation[k] = transfer.rot[k]; for (let k = 0; k < 3; k++) position[k] = transfer.pos[k]; }
        else { rotation[0] = rotation[2] = 0; rotation[1] = Math.sin(c.yaw[i] / 2); rotation[3] = Math.cos(c.yaw[i] / 2); }
        for (let k = 0; k < 3; k++) { if (!seated && !transferring) position[k] = c.previous[ci + k] + alpha * (c.pos[ci + k] - c.previous[ci + k]); previous[k] = oldGuests[ci + k]; oldGuests[ci + k] = position[k]; }
        for (let k = 0; k < 4; k++) previousRotation[k] = oldGuestRot[qi + k];
        const visibleLastFrame = lastSeen[i] === f.frameIndex - 1;
        if (!visibleLastFrame) { for (let k = 0; k < 3; k++) previous[k] = position[k]; for (let k = 0; k < 4; k++) previousRotation[k] = rotation[k]; } lastSeen[i] = f.frameIndex;
        const slot = p.parts.length + visibleGuests++, o = slot * STRIDE; groups[d2 < 225 ? HERO_GROUP : GUEST_GROUP + (d2 > 3025 ? 1 : 0)].push(slot);
        data.set(position, o); data[o + 3] = c.seatFront[i]; data.set(rotation, o + 4); data[o + 8] = data[o + 9] = data[o + 10] = h; data[o + 11] = c.seatAngle[i];
        data[o + 12] = c.tint[ci]; data[o + 13] = c.tint[ci + 1]; data[o + 14] = c.tint[ci + 2]; data[o + 15] = c.straddle[i];
        data.set(previous, o + 16); data[o + 19] = 0.3 + (i % 17) / 24; data.set(previousRotation, o + 20);
        oldGuestRot.set(rotation, qi);
        const speed = guestRenderSpeed(c.vel[ci], c.vel[ci + 2], seated);
        data[o + 24] = r.renderTime + i * 0.71; data[o + 25] = speed; data[o + 26] = seating; data[o + 27] = 1;
        const stairContact = !seated && !transferring && c.stairFlight[i] >= 0 && r.guestStairContacts(i, position, r.renderTime, currentContact);
        if (stairContact) { data[o + 27] = 2 + contactCount; contactData.set(currentContact, contactCount++ * 8); }
        // Last rendered animation is authoritative across pauses, boarding transitions and skipped/culling frames.
        for (let k = 0; k < 4; k++) data[o + 28 + k] = visibleLastFrame ? oldGuestAnim[qi + k] : data[o + 24 + k];
        if (visibleLastFrame && oldGuestAnim[qi + 3] >= 2) { data[o + 31] = 2 + contactCount; contactData.set(oldGuestContacts.subarray(i * 8, i * 8 + 8), contactCount++ * 8); }
        for (let k = 0; k < 4; k++) oldGuestAnim[qi + k] = data[o + 24 + k];
        if (stairContact) oldGuestContacts.set(currentContact, i * 8);
      }
      let count = 0; for (const g of groups) for (const slot of g) indices[count++] = slot;
      const changed = (moving.length + visibleGuests) * STRIDE;
      if (changed) rc.device.queue.writeBuffer(buffer, staticCount * STRIDE * 4, data, staticCount * STRIDE, changed);
      if (count) rc.device.queue.writeBuffer(indexBuffer, 0, indices, 0, count);
      if (contactCount) rc.device.queue.writeBuffer(contactBuffer, 0, contactData, 0, contactCount * 8);
      uploadBytes = changed * 4 + count * 4 + contactCount * 32;
      for (let i = 0; i < proxySlots.length; i++) { const proxy = proxies[i]; if (!('rot' in proxy) || !('half' in proxy)) continue; const o = proxySlots[i] * STRIDE;
        for (let k = 0; k < 3; k++) proxy.center[k] = data[o + k]; for (let k = 0; k < 4; k++) proxy.rot[k] = data[o + 4 + k];
      }
      for (let i = 0; i < c.count; i++) { const proxy = proxies[proxySlots.length + i]; if (proxy.type === 'capsule') r.guestCapsule(i, proxy.a, proxy.b, r.renderTime); }
      rc.rt.setDynamic('park-moving', proxies);
    },
    encodeGBuffer(pass) { if (!runtime) return; pass.setPipeline(pipeline); pass.setBindGroup(2, group); let base = 0;
      for (let g = 0; g < GROUPS; g++) { const count = groups[g].length; if (count) { pass.setVertexBuffer(0, meshes[g].buffer); pass.draw(meshes[g].count, count, 0, base); } base += count; } },
    stats: () => ({ visibleParts, visibleGuests, parts: runtime?.park.parts.length ?? 0, guests: runtime?.crowd.count ?? 0, uploadBytes, testedParts }),
    destroy() { for (const m of meshes) m.buffer.destroy(); buffer?.destroy(); indexBuffer?.destroy(); contactBuffer?.destroy(); },
  };
}
