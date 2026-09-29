// Combined scene trace (BVH proxies + terrain heightfield), hit shading, environment and the radiance-probe lookup. Included by every
// pass that traces rays for lighting (shadow, gi, spec, probe_update). Group GRP layout: see src/render/rt/layouts.ts.
#include "common/world_bindings.wgsl"
#include "common/atmosphere_sample.wgsl"
#include "rt/rt_terrain.wgsl"
#include "rt/rt_bvh.wgsl"

@group(${GRP}) @binding(3) var probeR : texture_3d<f32>;
@group(${GRP}) @binding(4) var probeG : texture_3d<f32>;
@group(${GRP}) @binding(5) var probeB : texture_3d<f32>;
@group(${GRP}) @binding(10) var probeSampler : sampler;

const KIND_MISS : u32 = 0u;
const KIND_TERRAIN : u32 = 1u;
const KIND_PRIM : u32 = 2u;
const SH_Y0 : f32 = 0.282095;
const SH_Y1 : f32 = 0.488603;
const GROUND_ALBEDO : f32 = 0.15;
const HORIZON_EPS : f32 = -0.0145;
const SHADOW_RAY_RANGE : f32 = 1500.0;
const NEAR_SHADOW_RANGE : f32 = 250.0;

// The probe update reads the previous frame's probes, whose exposure differs by pre / prevPre; everything else reads current ones.
var<private> probeGain : f32 = 1.0;

struct SceneHit { t : f32, kind : u32, prim : u32 }

fn hasTerrain() -> bool { return (rp.cfg.w & FLAG_TERRAIN) != 0u; }
fn bvhCap(steps : u32) -> u32 { return max(steps, 64u); }

fn traceScene(o : vec3f, d : vec3f, tMax : f32, steps : u32) -> SceneHit {
  var h = SceneHit(tMax, KIND_MISS, 0u);
  let b = traceBvh(o, d, tMax, bvhCap(steps), false);
  if (b.prim != NO_NODE) { h = SceneHit(b.t, KIND_PRIM, b.prim); }
  if (hasTerrain()) {
    let tt = traceTerrain(o, d, h.t, steps);
    if (tt >= 0.0) { h = SceneHit(tt, KIND_TERRAIN, 0u); }
  }
  return h;
}

fn occluded(o : vec3f, d : vec3f, tMax : f32, steps : u32) -> bool {
  if (traceBvh(o, d, tMax, bvhCap(steps), true).prim != NO_NODE) { return true; }
  return hasTerrain() && traceTerrain(o, d, tMax, steps) >= 0.0;
}

// Light and sky colours at a height (nits / lux, NOT pre-exposed), matching lighting/deferred.wgsl.
struct Env { sunE : vec3f, moonE : vec3f, zenith : vec3f, ground : vec3f }

fn envAt(y : f32) -> Env {
  let r = atmosRadiusAtHeight(y);
  let sunE = frame.sunIrradiance.rgb * frame.sunIrradiance.w * sampleTransmittance(r, frame.sunDir.y);
  let moonUp = select(0.0, 1.0, frame.moonDir.y > HORIZON_EPS);
  let moonE = frame.moonIrradiance.rgb * moonUp * sampleTransmittance(r, frame.moonDir.y);
  let zenith = sampleSkyView(vec3f(0.0, 1.0, 0.0));
  let direct = sunE * max(frame.sunDir.y, 0.0) + moonE * max(frame.moonDir.y, 0.0);
  return Env(sunE, moonE, zenith, GROUND_ALBEDO * (direct * INV_PI + 0.6 * zenith));
}

fn envRadiance(dir : vec3f, e : Env) -> vec3f {
  return mix(sampleSkyView(dir), e.ground, 1.0 - smoothstep(-0.08, 0.0, dir.y));
}

fn keyIsMoon() -> bool { return frame.misc.w == 1u; }
fn keyIrradiance(e : Env) -> vec3f { return select(e.sunE, e.moonE, keyIsMoon()); }
fn fillIrradiance(e : Env) -> vec3f { return select(e.moonE, e.sunE, keyIsMoon()); }
fn fillDir() -> vec3f { return select(frame.moonDir.xyz, frame.sunDir.xyz, keyIsMoon()); }

// Cosine-weighted mean incident radiance (E / pi) from the SH-L1 probes, pre-exposed. Falls back to a sky/ground blend outside the grid.
fn shIrradiance(c : vec4f, n : vec3f) -> f32 {
  return SH_Y0 * c.x + (2.0 / 3.0) * SH_Y1 * (c.y * n.y + c.z * n.z + c.w * n.x);
}

fn probeIrradiance(p : vec3f, n : vec3f, e : Env) -> vec3f {
  let dim = vec3f(rp.probeDim.xyz);
  let c = p / rp.f.y;
  let rel = c - vec3f(rp.probeLo.xyz);
  let m = min(rel, dim - 1.0 - rel);
  let w = smoothstep(0.0, 2.0, min(m.x, min(m.y, m.z)));
  let fallback = mix(e.ground, e.zenith, saturate1(n.y * 0.5 + 0.5)) * frame.params.y;
  if (w <= 0.0) { return fallback; }
  let uv = (c + 0.5) / dim;
  let r = textureSampleLevel(probeR, probeSampler, uv, 0.0);
  let g = textureSampleLevel(probeG, probeSampler, uv, 0.0);
  let b = textureSampleLevel(probeB, probeSampler, uv, 0.0);
  let irr = max(vec3f(shIrradiance(r, n), shIrradiance(g, n), shIrradiance(b, n)), vec3f(0.0)) * probeGain;
  return mix(fallback, irr, w);
}

struct Surface { n : vec3f, albedo : vec3f, metal : f32, emissive : vec3f, ao : f32 }

fn terrainSurface(p : vec3f) -> Surface {
  let uv = (terrainTexel(p.xz) + 0.5) / frame.terrain.x;
  let nrm = textureSampleLevel(terrainNormalTex, linearClamp, uv, 0.0);
  let maps = textureSampleLevel(terrainMapsTex, linearClamp, uv, 0.0);
  let n = normalize(nrm.xyz * 2.0 - 1.0);
  let rock = smoothstep(0.55, 0.8, 1.0 - n.y);
  var alb = mix(vec3f(0.12, 0.16, 0.06), vec3f(0.25, 0.18, 0.11), saturate1(maps.x));
  alb = mix(alb, vec3f(0.3), rock) * mix(1.0, 0.6, saturate1(maps.w));
  return Surface(n, alb, 0.0, vec3f(0.0), nrm.a);
}

fn primSurface(prim : u32, p : vec3f, d : vec3f) -> Surface {
  var n = primNormal(prim, p);
  n = select(n, -n, dot(n, d) > 0.0);
  let m = primMaterial(prim);
  return Surface(n, m.albedo, m.metalness, m.emissive, 1.0);
}

fn surfaceAt(h : SceneHit, p : vec3f, d : vec3f) -> Surface {
  if (h.kind == KIND_TERRAIN) { return terrainSurface(p); }
  return primSurface(h.prim, p, d);
}

// Outgoing radiance (pre-exposed) of a diffuse hit: key light (with a shadow ray for near hits), the other light, probe bounce, emission.
fn shadeSurface(s : Surface, p : vec3f, t : f32, kind : u32, e : Env, steps : u32) -> vec3f {
  let pre = frame.params.y;
  let key = keyDir();
  let ndlK = max(dot(s.n, key.xyz), 0.0);
  var vis = 1.0;
  if (ndlK > 0.0 && key.y > -0.03) {
    if (t < NEAR_SHADOW_RANGE) {
      let o = p + s.n * (0.04 + 0.003 * t);
      vis = select(1.0, 0.0, occluded(o, key.xyz, SHADOW_RAY_RANGE, max(16u, steps / 3u)));
    } else if (kind == KIND_TERRAIN) {
      vis = s.ao;
    }
  }
  let ndlF = max(dot(s.n, fillDir()), 0.0);
  let direct = (keyIrradiance(e) * (ndlK * vis) + fillIrradiance(e) * ndlF) * (pre * INV_PI);
  let diffuse = s.albedo * (1.0 - 0.7 * s.metal);
  return diffuse * (direct + probeIrradiance(p + s.n * 0.5, s.n, e)) + s.emissive * (EMISSIVE_MAX_NITS * pre);
}

// Blue-noise + R2 sample in [0,1)^2; `salt` decorrelates independent uses at the same pixel.
fn noise2(px : vec2i, salt : u32) -> vec2f {
  let seed = rp.dbg.y;
  let shift = vec2i(i32((salt * 37u + seed) & 127u), i32((salt * 91u + (seed >> 7u)) & 127u));
  let bn = textureLoad(blueNoise, (px + shift) & vec2i(127), 0).rg;
  let idx = f32((frameIndex() + salt * 7u) & 1023u);
  return fract(bn + idx * vec2f(0.7548776662, 0.5698402910));
}
