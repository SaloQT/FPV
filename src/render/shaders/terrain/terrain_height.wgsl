// Height, normal and material-map lookups that stay defined outside the finite terrain: the map is mirrored across its borders
// (continuous heights) and faded toward a flat far height over TERRAIN_FAR_FADE_M so the horizon never ends in a cliff.
#include "common/world_bindings.wgsl"

const TERRAIN_FAR_FADE_M : f32 = 600.0;
const TERRAIN_FAR_FRACTION : f32 = 0.35;

// Triangle-wave fold of continuous texel coordinates into [0, N - 1].
fn terrainMirrorTexel(t : vec2f) -> vec2f {
  let w = frame.terrain.x - 1.0;
  let m = t - 2.0 * w * floor(t / (2.0 * w));
  return select(m, vec2f(2.0 * w) - m, m > vec2f(w));
}

fn terrainMirrorXz(xz : vec2f) -> vec2f {
  return frame.terrainOrigin.xy + terrainMirrorTexel(terrainTexel(xz)) * frame.terrain.y;
}

// Metres from xz to the nearest point of the sampled map (0 inside).
fn terrainOutsideDistance(xz : vec2f) -> f32 {
  let t = terrainTexel(xz);
  let o = max(max(-t, t - vec2f(frame.terrain.x - 1.0)), vec2f(0.0));
  return length(o) * frame.terrain.y;
}

fn terrainFarHeight() -> f32 {
  return frame.terrain.z + TERRAIN_FAR_FRACTION * (frame.terrain.w - frame.terrain.z);
}

fn terrainHeightMirrored(xz : vec2f) -> f32 {
  let h = terrainHeightAt(terrainMirrorXz(xz));
  return mix(h, terrainFarHeight(), smoothstep(0.0, TERRAIN_FAR_FADE_M, terrainOutsideDistance(xz)));
}

// Normal of terrainHeightMirrored by central differences over +-eps metres.
fn terrainNormalFD(xz : vec2f, eps : f32) -> vec3f {
  let dx = terrainHeightMirrored(xz + vec2f(eps, 0.0)) - terrainHeightMirrored(xz - vec2f(eps, 0.0));
  let dz = terrainHeightMirrored(xz + vec2f(0.0, eps)) - terrainHeightMirrored(xz - vec2f(0.0, eps));
  return normalize(vec3f(-dx, 2.0 * eps, -dz));
}

struct TerrainSample {
  normal : vec3f,
  ao : f32,
  maps : vec4f,  // soil, flow, deposit, wetness
};

fn terrainTapUv(xzMirrored : vec2f) -> vec2f {
  return (terrainTexel(xzMirrored) + 0.5) / frame.terrain.x;
}

// Smooth normal, horizon AO and material maps at any world xz. `footprint` is the pixel size in metres: beyond the texel size the
// textures are box-filtered by four taps, because they have no mips and would otherwise shimmer in the distance.
fn terrainSampleAt(xz : vec2f, footprint : f32) -> TerrainSample {
  let cell = frame.terrain.y;
  let inside = terrainOutsideDistance(xz) <= 0.0;
  var s : TerrainSample;
  var nrm = vec3f(0.0);
  var ao = 0.0;
  var maps = vec4f(0.0);
  let r = select(0.0, 0.5 * (footprint - cell), footprint > 1.2 * cell);
  let taps = select(1, 4, r > 0.0);
  for (var i = 0; i < taps; i++) {
    let o = select(vec2f(0.0), vec2f(select(-r, r, (i & 1) != 0), select(-r, r, (i & 2) != 0)), r > 0.0);
    let uv = terrainTapUv(terrainMirrorXz(xz + o));
    let c = textureSampleLevel(terrainNormalTex, linearClamp, uv, 0.0);
    nrm += c.xyz * 2.0 - 1.0;
    ao += c.w;
    maps += textureSampleLevel(terrainMapsTex, linearClamp, uv, 0.0);
  }
  let inv = 1.0 / f32(taps);
  s.ao = ao * inv;
  s.maps = maps * inv;
  if (inside) {
    s.normal = normalize(nrm);
  } else {
    s.normal = terrainNormalFD(xz, max(cell, 0.5 * footprint));
  }
  return s;
}
