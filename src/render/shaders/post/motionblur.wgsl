// Camera + object motion blur before TAA (render resolution), after McGuire et al. 2012 "A Reconstruction Filter for Plausible
// Motion Blur": tile-max velocity -> 3x3 neighbour max -> depth-aware gather along the dominant velocity.
// Velocity is prevUV - currUV (unjittered) scaled to pixels of exposure: v = motion * size * shutter, shutter = exposureTime / dt.
// Sky pixels carry no motion vector, so their (pure rotation) velocity is rebuilt from the camera matrices.
#include "common/frame.wgsl"
#include "common/math.wgsl"

const TILE : u32 = ${TILE}u;
const SAMPLES : i32 = ${SAMPLES};
const EXPOSURE_TIME : f32 = ${EXPOSURE_TIME};
const MAX_SHUTTER : f32 = ${MAX_SHUTTER};
const MAX_BLUR_PX : f32 = ${MAX_BLUR_PX};
const MAX_BLUR_FRAC : f32 = ${MAX_BLUR_FRAC};
const MIN_BLUR_PX : f32 = ${MIN_BLUR_PX};
const DEPTH_SOFT_REL : f32 = ${DEPTH_SOFT_REL};
const DEPTH_SOFT_MIN : f32 = ${DEPTH_SOFT_MIN};
const SKY_Z : f32 = 1e6;

@group(1) @binding(0) var hdrTex : texture_2d<f32>;
@group(1) @binding(1) var motionTex : texture_2d<f32>;
@group(1) @binding(2) var depthTex : texture_depth_2d;
@group(1) @binding(3) var<storage, read_write> tileMax : array<vec2f>;
@group(1) @binding(4) var<storage, read_write> tileNeighbor : array<vec2f>;
@group(1) @binding(5) var outTex : texture_storage_2d<rgba16float, write>;

fn tileCount(dims : vec2u) -> vec2u { return (dims + vec2u(TILE - 1u)) / TILE; }

fn skyMotionUv(uv : vec2f) -> vec2f {
  let dir = viewRayDir(uv);
  let cur = frame.viewProjUnjittered * vec4f(dir, 0.0);
  let prev = frame.prevViewProj * vec4f(dir, 0.0);
  if (cur.w <= 0.0 || prev.w <= 0.0) { return vec2f(0.0); }
  let c = cur.xy / cur.w;
  let p = prev.xy / prev.w;
  return vec2f(p.x - c.x, c.y - p.y) * 0.5;
}

fn limitBlur(v : vec2f, dims : vec2f) -> vec2f {
  let maxLen = min(MAX_BLUR_PX, MAX_BLUR_FRAC * dims.y);
  let l = length(v);
  return select(v, v * (maxLen / l), l > maxLen);
}

// Blur vector in pixels covered during the exposure (full length, the gather is centred on the pixel).
fn blurVelocity(p : vec2u, dims : vec2u, depth : f32) -> vec2f {
  let d = vec2f(dims);
  var m : vec2f;
  if (depth > 0.0) { m = textureLoad(motionTex, p, 0).xy; } else { m = skyMotionUv((vec2f(p) + 0.5) / d); }
  let shutter = clamp(EXPOSURE_TIME / max(frame.params.x, 1e-4), 0.0, MAX_SHUTTER);
  return limitBlur(m * d * shutter, d);
}

fn linearZ(depth : f32) -> f32 { return select(SKY_Z, frame.params.z / depth, depth > 0.0); }

var<workgroup> wgVel : array<vec2f, 256>;

@compute @workgroup_size(16, 16)
fn tile_max(@builtin(workgroup_id) wid : vec3u, @builtin(local_invocation_index) li : u32) {
  let dims = textureDimensions(hdrTex);
  let p = wid.xy * TILE + vec2u(li % TILE, li / TILE);
  var v = vec2f(0.0);
  if (p.x < dims.x && p.y < dims.y) { v = blurVelocity(p, dims, textureLoad(depthTex, p, 0)); }
  wgVel[li] = v;
  for (var s = 128u; s > 0u; s = s >> 1u) {
    workgroupBarrier();
    if (li < s && dot(wgVel[li + s], wgVel[li + s]) > dot(wgVel[li], wgVel[li])) { wgVel[li] = wgVel[li + s]; }
  }
  if (li == 0u) { tileMax[wid.y * tileCount(dims).x + wid.x] = wgVel[0]; }
}

@compute @workgroup_size(8, 8)
fn neighbor_max(@builtin(global_invocation_id) gid : vec3u) {
  let tiles = tileCount(textureDimensions(hdrTex));
  if (gid.x >= tiles.x || gid.y >= tiles.y) { return; }
  var best = vec2f(0.0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let t = vec2i(gid.xy) + vec2i(dx, dy);
      if (t.x < 0 || t.y < 0 || t.x >= i32(tiles.x) || t.y >= i32(tiles.y)) { continue; }
      let v = tileMax[u32(t.y) * tiles.x + u32(t.x)];
      if (dot(v, v) > dot(best, best)) { best = v; }
    }
  }
  tileNeighbor[gid.y * tiles.x + gid.x] = best;
}

fn cone(dist : f32, len : f32) -> f32 { return saturate(1.0 - dist / max(len, 1e-3)); }
fn cylinder(dist : f32, len : f32) -> f32 { return select(0.0, 1.0 - smoothstep(0.95 * len, 1.05 * len, dist), len > 1e-3); }

@compute @workgroup_size(8, 8)
fn blur(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(hdrTex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let center = textureLoad(hdrTex, gid.xy, 0);
  let vN = tileNeighbor[(gid.y / TILE) * tileCount(dims).x + gid.x / TILE];
  let lenN = length(vN);
  if (lenN < MIN_BLUR_PX) { textureStore(outTex, gid.xy, center); return; }
  let dC = textureLoad(depthTex, gid.xy, 0);
  let zC = linearZ(dC);
  let lenC = length(blurVelocity(gid.xy, dims, dC));
  let jitter = fract(52.9829189 * fract(dot(vec2f(gid.xy) + 5.588238 * f32(frame.misc.x & 63u), vec2f(0.06711056, 0.00583715))));
  let hi = vec2i(dims) - vec2i(1);
  // The pixel's own streak covers ~lenC pixels, so it is worth N/lenC gather samples (at most N).
  let wC = f32(SAMPLES) / max(lenC, 1.0);
  var sum = center.rgb * wC;
  var wsum = wC;
  for (var i = 0; i < SAMPLES; i++) {
    let t = (f32(i) + jitter) / f32(SAMPLES) - 0.5;
    let q = clamp(vec2i(floor(vec2f(gid.xy) + 0.5 + vN * t)), vec2i(0), hi);
    let qu = vec2u(q);
    let dY = textureLoad(depthTex, qu, 0);
    let zY = linearZ(dY);
    let lenY = length(blurVelocity(qu, dims, dY));
    let dist = abs(t) * lenN;
    let soft = DEPTH_SOFT_MIN + DEPTH_SOFT_REL * min(zC, zY);
    let fore = saturate(1.0 + (zC - zY) / soft);
    let back = saturate(1.0 + (zY - zC) / soft);
    let a = fore * cone(dist, lenY) + back * cone(dist, lenC) + 2.0 * cylinder(dist, lenY) * cylinder(dist, lenC);
    sum += textureLoad(hdrTex, qu, 0).rgb * a;
    wsum += a;
  }
  textureStore(outTex, gid.xy, vec4f(sum / wsum, center.a));
}
