// Grass generation, all on the GPU with no readback. Two dispatches:
//   patches: one thread per cell of a camera-centred but world-anchored grid of PATCH x PATCH m cells. Cells outside the map, the
//            frustum or the grass distance are dropped; the rest append 64-slot chunks to a work list (atomic) sized by distance thinning.
//   blades:  one workgroup per chunk (indirect). A slot is a deterministic blade: hash(cell, slot) -> position, then rejection by the
//            terrain maps, slope, water, distance thinning and the frustum. Survivors are appended per LOD to the instance buffer.
// Slot index doubles as the blade's rank: a blade survives distance thinning when (slot + 0.5) / slots < keep(d), so far patches only
// enumerate the first keep(d) fraction of their slots and the visible blade set never depends on which chunk it lands in.
#include "vegetation/veg_params.wgsl"
#include "terrain/ground_color.wgsl"
#include "vegetation/grass_blade.wgsl"

// 0 chunk count, 1..3 instances per LOD, 4 visible patches
@group(2) @binding(1) var<storage, read_write> counters : array<atomic<u32>, 8>;
@group(2) @binding(2) var<storage, read_write> chunks : array<vec4u>;
@group(2) @binding(3) var<storage, read_write> blades : array<Blade>;

const CHUNK : u32 = 64u;
const DISPATCH_ROW : u32 = 4096u;

// Fraction of the slots that survive at distance d: full density inside the full-density radius, then constant screen-space density.
fn grassKeep(d : f32) -> f32 {
  let far = vp.grass.y;
  let k = min(1.0, sq(vp.grass.z / max(d, 1.0e-3)));
  return k * (1.0 - smoothstep(0.72 * far, far, d));
}

@compute @workgroup_size(64)
fn patches(@builtin(global_invocation_id) gid : vec3u) {
  let side = u32(vp.cells.z);
  if (gid.x >= side * side) { return; }
  let ci = vp.cells.x + i32(gid.x % side);
  let cj = vp.cells.y + i32(gid.x / side);
  let size = vp.grass.x;
  let lo = vec2f(f32(ci), f32(cj)) * size;
  let ctr = lo + vec2f(0.5 * size);
  let cam = frame.camPos.xyz;
  let dn = length(max(abs(cam.xz - ctr) - vec2f(0.5 * size), vec2f(0.0)));
  if (dn > vp.grass.y) { return; }
  let t = terrainTexel(ctr);
  let pad = size / frame.terrain.y + 1.0;
  if (any(t < vec2f(-pad)) || any(t > vec2f(frame.terrain.x - 1.0 + pad))) { return; }

  let h00 = terrainHeightAt(lo);
  let h10 = terrainHeightAt(lo + vec2f(size, 0.0));
  let h01 = terrainHeightAt(lo + vec2f(0.0, size));
  let h11 = terrainHeightAt(lo + vec2f(size));
  let hc = terrainHeightAt(ctr);
  let yMin = min(min(min(h00, h10), min(h01, h11)), hc) - 0.3;
  let yMax = max(max(max(h00, h10), max(h01, h11)), hc) + 0.9;
  let mid = vec3f(ctr.x, 0.5 * (yMin + yMax), ctr.y);
  if (!frustumSphereVisible(mid, 0.7072 * size + 0.5 * (yMax - yMin))) { return; }
  let dy = max(abs(cam.y - mid.y) - 0.5 * (yMax - yMin), 0.0);
  let keep = grassKeep(length(vec2f(dn, dy)));
  let slots = u32(ceil(vp.grass2.w * keep));
  if (slots == 0u) { return; }
  let nch = (slots + CHUNK - 1u) / CHUNK;
  let base = atomicAdd(&counters[0], nch);
  atomicAdd(&counters[4], 1u);
  for (var k = 0u; k < nch; k++) {
    if (base + k < vp.caps.w) { chunks[base + k] = vec4u(bitcast<u32>(ci), bitcast<u32>(cj), k * CHUNK, slots); }
  }
}

// Share of the blades that are tall meadow stems: an unmown patch fades in over several metres rather than starting at a wall.
fn meadowAmount(xz : vec2f) -> f32 {
  return smoothstep(0.46, 0.76, tnFbm(xz * 0.045 + vec2f(5.0, 11.0), 2)) * 0.85;
}

fn species(xz : vec2f, wetN : f32, rPick : f32, tuftDist : ptr<function, f32>) -> u32 {
  *tuftDist = 1.0;
  let cell = floor(xz / 1.4);
  let ic = bitcast<vec2u>(vec2i(cell));
  if (hash21(ic) < 0.16) {
    let centre = (cell + vec2f(0.25 + 0.5 * hash21(ic + vec2u(7u, 3u)), 0.25 + 0.5 * hash21(ic + vec2u(11u, 5u)))) * 1.4;
    *tuftDist = distance(xz, centre) / 0.32;
    if (*tuftDist < 1.0 && rPick < 0.85) { return 2u; }
  }
  let weedN = tnFbm(xz * 0.35 + vec2f(29.0, 83.0), 2);
  if (weedN > 0.6 && rPick < 0.4 * smoothstep(0.6, 0.74, weedN)) { return 4u; }
  if (wetN > 0.62 && hash21(bitcast<vec2u>(vec2i(floor(xz * 3.0)))) < 0.5 * smoothstep(0.62, 0.85, wetN)) { return 3u; }
  return select(0u, 1u, rPick < meadowAmount(xz));
}

// Share of blades that carry a flower head. Meadow flowers are rare on average and come in drifts: a broad patch field (tens of metres)
// times a metre-scale cluster field, so most of the sward has none and a drift has a few per square metre.
fn flowerRate(xz : vec2f) -> f32 {
  let drift = smoothstep(0.58, 0.76, tnFbm(xz * 0.06 + vec2f(3.0, 71.0), 2));
  let cluster = smoothstep(0.40, 0.68, tnFbm(xz * 0.8 + vec2f(53.0, 9.0), 2));
  return 0.00025 + 0.012 * drift * cluster;
}

// Mostly the drift's own colour (whites and yellows common, violet less, poppy red rare) with the odd stray from another species.
fn flowerCode(clump : f32, r : u32) -> u32 {
  let c = select(clump, u01(r >> 4u), u01(r >> 12u) < 0.2);
  return select(select(select(4u, 3u, c < 0.9), 2u, c < 0.7), 1u, c < 0.35);
}

@compute @workgroup_size(64)
fn blades_main(@builtin(workgroup_id) wg : vec3u, @builtin(local_invocation_index) li : u32) {
  let lin = wg.x + wg.y * DISPATCH_ROW;
  if (lin >= min(atomicLoad(&counters[0]), vp.caps.w)) { return; }
  let ch = chunks[lin];
  let slot = ch.z + li;
  if (slot >= ch.w) { return; }
  let seed = u32(vp.cells.w);
  let h = pcg3(vec3u(ch.x, ch.y ^ (seed * 0x9E3779B1u), slot));
  let size = vp.grass.x;
  let xz = (vec2f(bitcast<vec2i>(ch.xy)) + vec2f(u01(h.x), u01(h.y))) * size;
  let tt = terrainTexel(xz);
  if (any(tt < vec2f(1.0)) || any(tt > vec2f(frame.terrain.x - 2.0))) { return; }

  let y = terrainHeightAt(xz);
  let cam = frame.camPos.xyz;
  let d = distance(vec3f(xz.x, y, xz.y), cam);
  let keep = grassKeep(d);
  if ((f32(slot) + 0.5) / vp.grass2.w >= keep) { return; }
  if (!frustumSphereVisible(vec3f(xz.x, y + 0.3, xz.y), 0.85)) { return; }

  let maps = terrainMapsAt(xz);
  let nrm = terrainNormalAt(xz);
  let hRel = (y - frame.terrain.z) / max(frame.terrain.w - frame.terrain.z, 1.0);
  if (maps.x < 0.1 || nrm.y < 0.72 || hRel > 0.88 || y < vp.grass2.z + 0.3) { return; }
  let lw = terrainLayerWeights(xz, y, nrm.y, maps, vp.grass2.z);
  let cover = (lw.lo.x + lw.lo.y) / max(dot(lw.lo, vec4f(1.0)) + dot(lw.hi, vec4f(1.0)), 1.0e-4);
  let wetN = saturate1(maps.w * 1.8);
  let density = smoothstep(0.08, 0.62, cover) * (0.45 + 0.55 * wetN) * (1.0 - 0.65 * smoothstep(0.75, 0.98, maps.y));
  if (u01(h.z) >= density) { return; }

  let g = pcg3(h + vec3u(7u, 13u, 29u));
  let q = pcg3(g + vec3u(101u, 211u, 307u));
  let rPick = u01(g.x);
  let rH = u01(g.y);
  let rW = u01(g.z);
  var tuftDist = 1.0;
  let sp = species(xz, wetN, rPick, &tuftDist);
  var height = 0.0;
  var widthMm = 0.0;
  switch (sp) {
    case 0u: { height = 0.06 + 0.12 * rH; widthMm = 3.5 + 2.0 * rW; }
    case 1u: { height = (0.25 + 0.35 * rH) * (0.5 + 0.5 * saturate(meadowAmount(xz) / 0.5)); widthMm = 4.0 + 3.0 * rW; }
    case 2u: { height = (0.13 + 0.17 * rH) * (1.0 - 0.35 * tuftDist); widthMm = 5.0 + 3.0 * rW; }
    case 3u: { height = 0.35 + 0.25 * rH; widthMm = 7.0 + 3.0 * rW; }
    default: { height = 0.04 + 0.08 * rH; widthMm = 12.0 + 10.0 * rW; }
  }
  height *= 0.85 + 0.35 * wetN;
  // Tufts rise and fall over about a metre: the correlated height survives distance averaging, unlike per-blade height, and gives the mid-field relief.
  if (sp <= 1u) { height *= 0.7 + 0.6 * smoothstep(0.3, 0.7, tnFbm(xz * 1.3 + vec2f(37.0, 91.0), 2)); }

  var code = 0u;
  if (sp != 3u) {
    if (u01(q.y) < flowerRate(xz)) {
      code = flowerCode(hash21(bitcast<vec2u>(vec2i(floor(xz / 9.0)))), q.z);
      height = max(height, 0.18 + 0.25 * rH);
    } else if (sp == 1u && u01(q.z) < 0.12) {
      code = 5u;
    }
  }

  var yaw = u01(q.x);
  if (sp == 2u) { yaw = fract(atan2(xz.y - (floor(xz.y / 1.4) + 0.5) * 1.4, xz.x - (floor(xz.x / 1.4) + 0.5) * 1.4) / TAU); }
  let dry = max(glDryness(xz, maps.w), 0.7 * (1.0 - smoothstep(0.15, 0.6, cover)));
  let thin = clamp(inverseSqrt(max(keep, 1.0e-4)), 1.0, 5.0);
  let lod = select(select(2u, 1u, d < vp.grass2.y), 0u, d < vp.grass2.x);

  var b : Blade;
  b.pos = vec3f(xz.x, y - 0.02, xz.y);
  b.height = height;
  b.halfWidth = 0.0005 * widthMm * thin * select(1.0, 1.35, lod == 2u);
  b.nrm = pack2x16snorm(nrm.xz);
  b.tint = pack4x8unorm(vec4f(sqrt(saturate(grassTintFromMaps(xz, maps) * 2.0)), f32(code) / 255.0));
  b.info = u32(yaw * 4095.0) | (sp << 12u) | (u32(dry * 255.0) << 15u) | ((q.z >> 23u) << 23u);
  let idx = atomicAdd(&counters[1u + lod], 1u);
  let cap = vp.caps[lod];
  if (idx < cap) {
    let base = select(select(vp.caps.x + vp.caps.y, vp.caps.x, lod == 1u), 0u, lod == 0u);
    blades[base + idx] = b;
  }
}
