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
// Forest-floor cover (src/render/terrain/groundCover.ts): r = canopy cover. Colour only; it never decides where a blade grows.
@group(2) @binding(4) var groundCoverTex : texture_2d<f32>;

const CHUNK : u32 = 64u;
const DISPATCH_ROW : u32 = 4096u;

// Projected blade height (px) at which a blade changes level: 15 vertices down to GRASS_LOD0_PX, 7 down to
// GRASS_LOD1_PX, a single quad below that. These are apparent size, so they hold at any resolution or lens.
// GRASS_LOD_BLEND is the width of each threshold's dither band as a fraction of the threshold.
//
// The two numbers are calibrated so that a blade of the mean species height (about 0.25 m) crosses each threshold
// at the same distance the old fixed distance bands did, at 1080p and the app's 100-degree lens:
// proj[1][1] * screenH/2 = 453 px per metre at 1 m, so 10.3 px is 0.25 * 453 / 10.8 m and 3.3 px is
// 0.25 * 453 / 33.6 m, the ultra tier's two bands. Anything much larger and the whole sward drops a level at once:
// the far half of the field becomes flat single quads, which is where the card-like look comes from. The point of
// choosing by size rather than by distance is only that a 4 cm blade no longer pays for 15 vertices out to 10.8 m.
const GRASS_LOD0_PX : f32 = 10.3;
const GRASS_LOD1_PX : f32 = 3.3;
const GRASS_LOD_BLEND : f32 = 0.55;

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
  if (vp.wind.w > 0.0 && length(ctr) < vp.wind.w + size) { return; }
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
  // Broadleaf forbs (plantain, dandelion and daisy rosettes, clover, yarrow) are a share of every meadow, a few percent of the sward
  // everywhere and up to a third in their patches; more on thin, trampled soil.
  if (rPick < 0.05 + 0.3 * smoothstep(0.5, 0.72, weedN)) { return 4u; }
  // Rushes and sedges take only genuinely wet ground, in clumps; a damp meadow is still grass and flowers.
  if (wetN > 0.85 && hash21(bitcast<vec2u>(vec2i(floor(xz * 3.0)))) < 0.5 * smoothstep(0.85, 0.98, wetN)) { return 3u; }
  return select(0u, 1u, rPick < meadowAmount(xz));
}

// Share of blades that carry a flower head. Meadow flowers are rare on average and come in drifts: a broad patch field (tens of metres)
// times a metre-scale cluster field, so most of the sward has none and a drift has a few per square metre.
fn flowerRate(xz : vec2f) -> f32 {
  let drift = smoothstep(0.45, 0.72, tnFbm(xz * 0.06 + vec2f(3.0, 71.0), 2));
  let cluster = smoothstep(0.35, 0.65, tnFbm(xz * 0.8 + vec2f(53.0, 9.0), 2));
  // A hay meadow is studded with flowers (knapweed, buttercup, ox-eye daisy) at a few per square metre; a grazed sward far fewer.
  return 0.002 + 0.03 * drift * cluster + 0.03 * meadowAmount(xz) * cluster;
}

// A summer hay meadow is mostly yellow buttercup, with purple knapweed, red clover and white ox-eye daisy in places: daisy 12%,
// buttercup 43%, knapweed 22%, clover 23%. The lead species changes field by field (a smooth field tens of metres across) but takes only
// 40% of a drift; the rest follows those meadow-wide shares, so no patch is one colour and daisy-led patches are rare. Knapweed heads stand
// apart among the grass, so about half of its draws stay plain blades (see blades_main) and even a knapweed-led patch is mostly green.
fn flowerCode(clump : f32, r : u32) -> u32 {
  // u01 wants a full 32-bit hash (it keeps the top 24 bits): re-hash r for each draw rather than shifting it, which collapsed both draws
  // toward 0 and made every flower a daisy.
  let c = select(clump, u01(pcg(r ^ 0x68bc21ebu)), u01(pcg(r ^ 0x02e5be93u)) < 0.6);
  let code = select(select(select(4u, 3u, c < 0.77), 2u, c < 0.55), 1u, c < 0.12);
  return select(code, 0u, code == 3u && u01(pcg(r ^ 0x51ed2705u)) < 0.5);
}

// Woodland understorey, drawn by the same blade pipeline where the sward gives way to the forest floor. It travels in the blade's head code
// (FLOOR_FERN frond, FLOOR_HERB leaf of a woodland herb or seedling, FLOOR_STICK fallen stick; see grass.wgsl), not as new species. Ferns and herbs grow as plants: a crown at a jittered spot in some cells of
// a grid, its fronds or leaves radiating from it (their yaw points away from the crown). Rates are per square metre, so a slot's chance
// is divided by the slots per square metre and by the distance thinning, as the flowers are. Ferns (bracken at the stand's edge and in
// its light gaps) come in patches tens of metres across and never within 3 m of the racing line, where a waist-high frond would read as
// an obstacle; herbs follow the green patches of the floor (terrainMaterialWeights); sticks lie everywhere under the crowns. `forest` is
// the cover texel (r canopy, g conifer share, b forest-ness), weighed as the terrain's forest floor is (groundCoverAt in terrain.wgsl).
// Returns (code, yaw 0..1), code 0 for none. Visual only: no colliders.
const FLOOR_FERN : u32 = 16u;
const FLOOR_HERB : u32 = 17u;
const FLOOR_STICK : u32 = 18u;

fn floorPlant(xz : vec2f, forest : vec3f, trackM : f32, keep : f32, r : u32) -> vec2f {
  let canopy = forest.x * smoothstep(0.25, 0.6, forest.z) * 1.6;
  let stand = smoothstep(0.4, 0.75, canopy);
  let edge = smoothstep(0.1, 0.25, forest.x) * (1.0 - stand);
  if (stand + edge <= 0.0) { return vec2f(0.0); }
  let perSlot = vp.grass.x * vp.grass.x / (max(vp.grass2.w, 1.0) * max(keep, 1.0e-3));
  let u = u01(pcg(r ^ 0x3c6ef372u));
  let broad = 1.0 - 0.5 * forest.y;
  let fern = smoothstep(0.38, 0.56, tnFbm(xz * 0.05 + vec2f(11.0, 77.0), 2)) * (0.7 * stand * broad + edge) * step(3.0, trackM);
  let herb = (smoothstep(0.5, 0.66, tnFbm(xz * 0.075 + vec2f(43.0, 21.0), 2)) + 0.2) * stand * broad;
  // One plant crown per cell at most: a fern (0.35 m reach, about 8 fronds) or a herb (0.2 m reach, about 9 leaves).
  let cell = floor(xz / 1.3);
  let ic = bitcast<vec2u>(vec2i(cell));
  let pick = hash21(ic + vec2u(31u, 17u));
  let centre = (cell + vec2f(0.2 + 0.6 * hash21(ic + vec2u(3u, 41u)), 0.2 + 0.6 * hash21(ic + vec2u(59u, 7u)))) * 1.3;
  let off = xz - centre;
  let yaw = fract(atan2(off.y, off.x) / TAU + 1.0);
  if (pick < 0.8 * fern) {
    if (length(off) < 0.35 && u < 8.0 / (PI * 0.35 * 0.35) * perSlot) { return vec2f(f32(FLOOR_FERN), yaw); }
  } else if (pick < 0.8 * fern + 0.7 * herb) {
    if (length(off) < 0.2 && u < 9.0 / (PI * 0.2 * 0.2) * perSlot) { return vec2f(f32(FLOOR_HERB), yaw); }
  }
  // Twigs and fallen branches, about one per 4 square metres under a closed canopy.
  if (u01(pcg(r ^ 0x9b05688cu)) < 0.25 * stand * perSlot) { return vec2f(f32(FLOOR_STICK), u01(pcg(r ^ 0x51ed2705u))); }
  return vec2f(0.0);
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
  // All three of terrainLayerWeights, glDryness and grassTintFromMaps want the same glDryness(xz, maps.w); take it once.
  let dryField = glDryness(xz, maps.w);
  let lw = terrainLayerWeightsDry(xz, y, nrm.y, maps, vp.grass2.z, dryField);
  let cover = (lw.lo.x + lw.lo.y) / max(dot(lw.lo, vec4f(1.0)) + dot(lw.hi, vec4f(1.0)), 1.0e-4);
  let wetN = saturate1(maps.w * 1.8);
  // Grass gives way to the forest floor under closed crowns: almost entirely under conifers (dense, acid needle duff), mostly under
  // broadleaves, where only shade-tolerant tufts keep to the light gaps. Visual only: grass has no colliders.
  let coverTexel = textureSampleLevel(groundCoverTex, linearClamp, (terrainTexel(xz) + 0.5) / frame.terrain.x, 0.0);
  let forest = coverTexel.xyz;
  // The worn race course (cover alpha: distance to the racing line over 25.5 m, see trackWear in terrain.wgsl): no blades down its
  // trodden middle, fewer on its margins.
  let trodden = 1.0 - smoothstep(0.03, 0.14, coverTexel.w);
  let underCanopy = smoothstep(0.25, 0.5, forest.x) * smoothstep(0.25, 0.6, forest.z) * mix(0.8, 0.95, forest.y);
  // The washed bed of a stream (streamBed, the same channels the terrain draws as stones) holds only a few sprigs; the sward there drew
  // a dense meadow over ground the terrain paints as gravel, whose pale stones then showed between the blades as a bright speckle.
  let bedHere = smoothstep(0.5, 0.9, streamBed(xz, maps.y));
  let density = smoothstep(0.08, 0.62, cover) * (0.45 + 0.55 * wetN) * (1.0 - 0.65 * smoothstep(0.75, 0.98, maps.y)) * (1.0 - underCanopy)
    * (1.0 - 0.85 * bedHere);
  var floorYaw = -1.0;
  var floorKind = 0u;
  if (u01(h.z) >= density * (1.0 - 0.85 * trodden)) {
    let fp = floorPlant(xz, forest, coverTexel.w * 25.5, keep, h.z);
    if (fp.x < 0.5) { return; }
    floorKind = u32(fp.x + 0.5);
    floorYaw = fp.y;
  }

  let g = pcg3(h + vec3u(7u, 13u, 29u));
  let q = pcg3(g + vec3u(101u, 211u, 307u));
  let rPick = u01(g.x);
  let rH = u01(g.y);
  let rW = u01(g.z);
  var tuftDist = 1.0;
  // Under closed crowns the sward is shade grass: darker, bluer, lower and still green, never the straw of an open, parched bank.
  let shade = smoothstep(0.3, 0.65, forest.x);
  // Rushes line the stream banks; the washed bed itself only holds low sprigs among the stones.
  let bank = smoothstep(0.62, 0.8, maps.y) * (1.0 - smoothstep(0.86, 0.95, maps.y));
  let bed = bedHere;
  var sp = species(xz, wetN, rPick, &tuftDist);
  if (u01(pcg(q.x)) < 0.6 * bank) { sp = 3u; }
  if (sp == 1u && u01(pcg(q.y)) < shade) { sp = 0u; }
  // Understorey records keep species 4 (a forb: no flower, no seed head) and carry their kind in the head code.
  if (floorKind != 0u) { sp = 4u; }
  var height = 0.0;
  var widthMm = 0.0;
  // A sward mixes fine-leaved grasses (fescues and bents, 1-3 mm) with a few broad ones (cocksfoot, ryegrass, 6-10 mm): most blades are
  // narrow and a few are wide, rather than all of one width.
  switch (sp) {
    case 0u: { height = 0.06 + 0.12 * rH; widthMm = 2.0 + 5.0 * rW * rW; }
    case 1u: { height = (0.25 + 0.35 * rH) * (0.5 + 0.5 * saturate(meadowAmount(xz) / 0.5)); widthMm = 2.0 + 7.5 * rW * rW; }
    case 2u: { height = (0.13 + 0.17 * rH) * (1.0 - 0.35 * tuftDist); widthMm = 5.0 + 3.0 * rW; }
    case 3u: { height = 0.35 + 0.25 * rH; widthMm = 7.0 + 3.0 * rW; }
    default: { height = 0.04 + 0.08 * rH; widthMm = 12.0 + 10.0 * rW; }
  }
  // Fern fronds 40-90 cm long and 14-24 cm across their widest pinnae; herb and seedling leaves 15-35 cm long and 5-9 cm wide; sticks
  // 0.3-1.3 m long, 1-3.5 cm thick.
  if (floorKind == FLOOR_FERN) { height = 0.4 + 0.5 * rH; widthMm = 140.0 + 100.0 * rW; }
  if (floorKind == FLOOR_HERB) { height = 0.15 + 0.2 * rH; widthMm = 50.0 + 40.0 * rW; }
  if (floorKind == FLOOR_STICK) { height = 0.3 + 1.0 * rH * rH; widthMm = 10.0 + 25.0 * rW * rW; }
  height *= 0.85 + 0.35 * wetN;
  // Tufts rise and fall over about a metre: the correlated height survives distance averaging, unlike per-blade height, and gives the mid-field relief.
  if (sp <= 1u) { height *= 0.7 + 0.6 * smoothstep(0.3, 0.7, tnFbm(xz * 1.3 + vec2f(37.0, 91.0), 2)); }
  if (floorKind == 0u) { height *= (1.0 - 0.3 * shade) * (1.0 - 0.7 * bed); }

  var code = 0u;
  // Wet ground has its own flowers (ragged robin, meadowsweet, marsh marigold) among the rushes, at half the meadow's rate.
  let flowerScale = select(1.0, 0.5, sp == 3u);
  // Distance thinning keeps only a share `keep` of the blades (each drawn wider for the grass it stands for); flowers are counted per
  // square metre, so a kept blade is that much likelier to carry one and a far meadow keeps its flowers.
  if (floorKind == 0u && u01(q.y) < min(flowerScale * flowerRate(xz) / max(keep, 1.0e-3), 0.35) * (1.0 - shade) * (1.0 - bed)) {
    code = flowerCode(saturate(1.6 * (tnFbm(xz * 0.025 + vec2f(41.0, 17.0), 2) - 0.5) + 0.5), q.z);
  }
  if (floorKind != 0u) {
    code = floorKind;
  } else if (code != 0u) {
    // Meadow flowers hold their heads at or just above the top of the sward round them (knapweed, ox-eye daisy and buttercup 30-70 cm in
    // a hay meadow, lower in a grazed sward), where they catch the light and the eye.
    // The top of the local sward: the tallest meadow (or grazed) grass here, with the same wetness and tuft factors the blades get.
    let ma = meadowAmount(xz);
    let tuftH = 0.7 + 0.6 * smoothstep(0.3, 0.7, tnFbm(xz * 1.3 + vec2f(37.0, 91.0), 2));
    let swardTop = mix(0.18, 0.6 * (0.5 + 0.5 * saturate(ma / 0.5)), smoothstep(0.05, 0.3, ma)) * (0.85 + 0.35 * wetN) * tuftH;
    height = max(height, swardTop * (0.9 + 0.3 * rH));
  } else if (sp == 1u && u01(q.z) < 0.22) {
    // Flowering stems stand a hand or two above the leafy sward, seed heads up in the light, some lodged by wind and rain (see grass.wgsl).
    code = 5u;
    height *= 1.25 + 0.45 * rH;
    // A flowering stem is a round culm 2-3 mm thick; its head (grass.wgsl) is drawn wider than that.
    widthMm = 2.0 + 1.0 * rW;
  }

  var yaw = u01(q.x);
  if (floorYaw >= 0.0) { yaw = floorYaw; }
  if (sp == 2u) { yaw = fract(atan2(xz.y - (floor(xz.y / 1.4) + 0.5) * 1.4, xz.x - (floor(xz.x / 1.4) + 0.5) * 1.4) / TAU); }
  let dry = max(dryField, 0.7 * (1.0 - smoothstep(0.15, 0.6, cover))) * (1.0 - shade);
  // A kept blade is drawn wider for the grass it stands for; understorey is counted per square metre instead (floorPlant), so it keeps
  // its own size at any distance.
  let thin = select(clamp(inverseSqrt(max(keep, 1.0e-4)), 1.0, 5.0), 1.0, floorKind != 0u);
  // Level of detail by projected size, not by distance. A blade h metres tall at view depth z covers
  // h * proj[1][1] * screenH/2 / z pixels, so a fixed pixel height keeps the tessellation matched to how
  // big the blade actually is: the same blade keeps its 15 vertices at 12 m on a 1080p screen and drops to
  // one quad at 30 m, but at 4K it is still one quad at 12 m and only earns the detail from 6 m. A
  // distance threshold cannot do that - it hands a 25 px blade at 8K a single quad. The thresholds are
  // calibrated back to the old distance bands for a typical blade; see GRASS_LOD0_PX.
  let viewZ = max(abs(dot(frame.view[2].xyz, vec3f(xz.x, y, xz.y)) + frame.view[2].w), 1.0e-3);
  let px = height * frame.proj[1][1] * frame.screen.y * 0.5 / viewZ;
  // Each threshold is dithered over a band instead of being a hard cut, so the ring a hard cut draws is
  // spread over neighbouring blades and the sward reads the same either side of it. The random is a stable
  // hash of the blade's own slot, so a blade keeps its level frame to frame and nothing flickers.
  let rLod = fract(u01(h.x) * 0.7548776662 + u01(h.z) * 0.5698402910);
  let e0 = GRASS_LOD0_PX * (1.0 + (rLod - 0.5) * GRASS_LOD_BLEND);
  let e1 = GRASS_LOD1_PX * (1.0 + (rLod - 0.5) * GRASS_LOD_BLEND);
  // Flowers always take the finest level: a head needs the full strip to be round, and they are rare enough to cost nothing.
  var lod = select(select(select(2u, 1u, px > e1), 0u, px > e0), 0u, code >= 1u && code <= 4u);
  // Understorey always takes the middle level: the finest one's buffer fills with the near sward first (tall fronds would rank in it
  // out to 30 m and be the ones dropped), and the coarsest is one quad, too few rows for a frond's outline.
  if (floorKind != 0u) { lod = 1u; }

  var b : Blade;
  b.pos = vec3f(xz.x, y - 0.02, xz.y);
  b.height = height;
  b.halfWidth = 0.0005 * widthMm * thin * select(1.0, 1.35, lod == 2u);
  b.nrm = pack2x16snorm(nrm.xz);
  let turf = grassTintFromMapsDry(xz, maps, dryField * (1.0 - shade)) * mix(vec3f(1.0), vec3f(0.72, 0.82, 0.7) * mix(vec3f(1.0), GL_CANOPY_LIGHT, 0.6), shade);
  b.tint = pack4x8unorm(vec4f(sqrt(saturate(turf * 2.0)), f32(code) / 255.0));
  b.info = u32(yaw * 4095.0) | (sp << 12u) | (u32(dry * 255.0) << 15u) | ((q.z >> 23u) << 23u);
  let idx = atomicAdd(&counters[1u + lod], 1u);
  let cap = vp.caps[lod];
  if (idx < cap) {
    let base = select(select(vp.caps.x + vp.caps.y, vp.caps.x, lod == 1u), 0u, lod == 0u);
    blades[base + idx] = b;
  }
}
