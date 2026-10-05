// Combined scene trace (BVH proxies + terrain heightfield), hit shading, environment and the radiance-probe lookup. Included by every
// pass that traces rays for lighting (shadow, gi, spec, probe_update). Group GRP layout: see src/render/rt/layouts.ts.
#include "common/world_bindings.wgsl"
#include "lighting/sky_safe.wgsl"
#include "rt/rt_terrain.wgsl"
#include "rt/rt_bvh.wgsl"

@group(${GRP}) @binding(3) var probeR : texture_3d<f32>;
@group(${GRP}) @binding(4) var probeG : texture_3d<f32>;
@group(${GRP}) @binding(5) var probeB : texture_3d<f32>;
@group(${GRP}) @binding(10) var probeSampler : sampler;
@group(${GRP}) @binding(11) var cloudShadowTex : texture_2d<f32>;

const KIND_MISS : u32 = 0u;
const KIND_TERRAIN : u32 = 1u;
const KIND_PRIM : u32 = 2u;
const SH_Y0 : f32 = 0.282095;
const SH_Y1 : f32 = 0.488603;
const GROUND_ALBEDO : f32 = 0.15;
const HORIZON_EPS : f32 = -0.0145;
const SHADOW_RAY_RANGE : f32 = 1500.0;
const NEAR_SHADOW_RANGE : f32 = 64.0;
const LEAF_TRANSMISSION : f32 = 0.8;
// Light that stays in a leaf crown is scattered by leaves, which reflect AND transmit (reflectance + transmittance of a green leaf: red 0.10, green 0.22,
// blue 0.07), so a crown seen along a ray inside it glows with the single-scatter albedo, not with the proxy's reflectance-only albedo (0.09 green). Diffuse
// light crosses a leafy layer with a Kubelka-Munk effective extinction of sqrt(1 - albedo) = 0.88 of the beam's.
const CANOPY_SCATTER_ALBEDO : vec3f = vec3f(0.10, 0.22, 0.07);
const CANOPY_DIFFUSE_TAU_SCALE : f32 = 0.88;
// The RT textures are fp16 (max 65504). Pre-exposed radiance is only bounded by exposure x sky/sun brightness (pre-exposure reaches 1000 at
// night), so every value is clamped before it is stored; an Inf in a history texture turns into NaN (Inf * 0) and then spreads through the
// temporal reprojection and the a-trous weights as hard-edged black blocks.
const MAX_RADIANCE : f32 = 6.0e4;
// An SH-L1 coefficient sums up to 4 pi Y0 ~ 3.5 radiances.
const MAX_PROBE_RADIANCE : f32 = 1.5e4;
const MIN_CLOUD_SUN_Y : f32 = 0.05;

// The probe update reads the previous frame's probes, whose exposure differs by pre / prevPre; everything else reads current ones.
var<private> probeGain : f32 = 1.0;

struct SceneHit { t : f32, kind : u32, prim : u32 }

fn hasTerrain() -> bool { return (rp.cfg.w & FLAG_TERRAIN) != 0u; }
fn bvhCap(steps : u32) -> u32 { return max(steps, 64u); }

fn traceScene(o : vec3f, d : vec3f, tMax : f32, steps : u32) -> SceneHit {
  var h = SceneHit(tMax, KIND_MISS, 0u);
  let b = traceBvh(o, d, tMax, bvhCap(steps));
  if (b.prim != NO_NODE) { h = SceneHit(b.t, KIND_PRIM, b.prim); }
  if (hasTerrain()) {
    let tt = traceTerrain(o, d, h.t, steps);
    if (tt >= 0.0) { h = SceneHit(tt, KIND_TERRAIN, 0u); }
  }
  return h;
}

// Fraction of the key light that reaches o along d: 0 behind terrain or an opaque proxy, partial through leaf-canopy crowns.
fn keyVisibility(o : vec3f, d : vec3f, tMax : f32, steps : u32) -> f32 {
  let v = traceBvhTransmit(o, d, tMax, bvhCap(steps) * 2u);
  if (v > 0.0 && hasTerrain() && traceTerrain(o, d, tMax, steps) >= 0.0) { return 0.0; }
  return v;
}

fn keyIsMoon() -> bool { return frame.misc.w == 1u; }

// Fraction of the key light the clouds let through to world point p, from the top-down cloud shadow map (r = sun, g = moon; params.cloud =
// centre xz, extent, 0). The map is baked for columns at y = 0, so a point above the datum reads the column its light ray crosses.
fn cloudTransmittance(p : vec3f) -> f32 {
  let key = keyDir();
  let xz = p.xz - key.xz * (p.y / max(key.y, MIN_CLOUD_SUN_Y));
  let uv = (xz - rp.cloud.xy) / rp.cloud.z + 0.5;
  let t = textureSampleLevel(cloudShadowTex, linearClamp, uv, 0.0);
  return select(t.r, t.g, keyIsMoon());
}

// Light and sky colours at a height (nits / lux, NOT pre-exposed), matching lighting/deferred.wgsl.
struct Env { sunE : vec3f, moonE : vec3f, zenith : vec3f, ground : vec3f }

fn envAt(y : f32) -> Env {
  let r = atmosRadiusAtHeight(y);
  // Retain RGB * enable (including signed zero), but skip extinction for an exactly inactive light.
  var sunE = frame.sunIrradiance.rgb * frame.sunIrradiance.w;
  if (frame.sunIrradiance.w != 0.0) { sunE *= sampleTransmittance(r, frame.sunDir.y); }
  let moonUp = select(0.0, 1.0, frame.moonDir.y > HORIZON_EPS);
  var moonE = frame.moonIrradiance.rgb * moonUp;
  if (moonUp > 0.0) { moonE *= sampleTransmittance(r, frame.moonDir.y); }
  let zenith = skyNits(vec3f(0.0, 1.0, 0.0));
  let direct = sunE * max(frame.sunDir.y, 0.0) + moonE * max(frame.moonDir.y, 0.0);
  return Env(sunE, moonE, zenith, GROUND_ALBEDO * (direct * INV_PI + 0.6 * zenith));
}

fn envRadiance(dir : vec3f, e : Env) -> vec3f {
  return mix(skyNits(dir), e.ground, 1.0 - smoothstep(-0.08, 0.0, dir.y));
}

// Pre-exposed environment radiance toward dir, safe to store in fp16.
fn skyRadiance(dir : vec3f, e : Env) -> vec3f {
  return min(envRadiance(dir, e) * frame.params.y, vec3f(MAX_RADIANCE));
}

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
  let irr = clamp(vec3f(shIrradiance(r, n), shIrradiance(g, n), shIrradiance(b, n)) * probeGain, vec3f(0.0), vec3f(MAX_RADIANCE));
  return mix(fallback, irr, w);
}

struct Surface { n : vec3f, albedo : vec3f, metal : f32, emissive : vec3f, ao : f32, trans : f32 }

fn terrainSurface(p : vec3f) -> Surface {
  let uv = (terrainTexel(p.xz) + 0.5) / frame.terrain.x;
  let nrm = textureSampleLevel(terrainNormalTex, linearClamp, uv, 0.0);
  let maps = textureSampleLevel(terrainMapsTex, linearClamp, uv, 0.0);
  let n = normalize(nrm.xyz * 2.0 - 1.0);
  let rock = smoothstep(0.55, 0.8, 1.0 - n.y);
  var alb = mix(vec3f(0.12, 0.16, 0.06), vec3f(0.25, 0.18, 0.11), saturate1(maps.x));
  alb = mix(alb, vec3f(0.3), rock) * mix(1.0, 0.6, saturate1(maps.w));
  return Surface(n, alb, 0.0, vec3f(0.0), nrm.a, 0.0);
}

fn primSurface(prim : u32, p : vec3f, d : vec3f) -> Surface {
  var n = primNormal(prim, p);
  n = select(n, -n, dot(n, d) > 0.0);
  let m = primMaterial(prim);
  return Surface(n, m.albedo, m.metalness, m.emissive, 1.0, select(0.0, 1.0, primIsCanopy(prim)));
}

fn surfaceAt(h : SceneHit, p : vec3f, d : vec3f) -> Surface {
  if (h.kind == KIND_TERRAIN) { return terrainSurface(p); }
  return primSurface(h.prim, p, d);
}

// Cosine term of a surface that may be translucent (leaf crowns): the unlit side still receives the light that crossed the leaves.
fn lightCosine(s : Surface, l : vec3f) -> f32 {
  let ndl = dot(s.n, l);
  return max(ndl, 0.0) + LEAF_TRANSMISSION * s.trans * max(-ndl, 0.0);
}

// Outgoing radiance (pre-exposed) of a diffuse hit: key light (with a shadow ray for near hits, attenuated by the clouds), the other light,
// probe bounce, emission. Clamped to what the fp16 probe / history textures can hold (pre-exposure reaches 1000 at night).
#ifdef SHADE_VISIBILITY
var<private> giVisibilityValue : f32 = 1.0;
#endif
fn shadeSurface(s : Surface, p : vec3f, t : f32, kind : u32, e : Env, steps : u32) -> vec3f {
  let pre = frame.params.y;
  let key = keyDir();
  let cosK = lightCosine(s, key.xyz);
  var vis = 1.0;
  if (cosK > 0.0 && key.y > -0.03) {
#ifdef SHADE_VISIBILITY
    vis = giVisibilityValue;
#else
    if (t < NEAR_SHADOW_RANGE) {
      let o = p + s.n * (0.04 + 0.003 * t);
      vis = keyVisibility(o, key.xyz, SHADOW_RAY_RANGE, max(16u, steps / 3u));
    } else if (kind == KIND_TERRAIN) {
      vis = s.ao;
    }
    vis *= cloudTransmittance(p);
#endif
  }
  let direct = (keyIrradiance(e) * (cosK * vis) + fillIrradiance(e) * lightCosine(s, fillDir())) * (pre * INV_PI);
  let diffuse = s.albedo * (1.0 - 0.7 * s.metal);
  let emission = min(s.emissive * (EMISSIVE_MAX_NITS * pre), vec3f(MAX_RADIANCE));
  return min(diffuse * (direct + probeIrradiance(p + s.n * 0.5, s.n, e)) + emission, vec3f(MAX_RADIANCE));
}

// Transmittance of the leaf chord that a hit `h` ends inside: 1 for a plain surface, the crown's Beer-Lambert share otherwise. A pass that
// needs it for more than one output term integrates the chord once (via this) and passes it on, so a crown costs one optical-depth
// integration per ray instead of one per consumer.
fn hitChordT(h : SceneHit, o : vec3f, d : vec3f) -> f32 {
  if (h.kind != KIND_PRIM || !primIsCanopy(h.prim)) { return 1.0; }
  return exp(-CANOPY_DIFFUSE_TAU_SCALE * canopyOpticalDepth(h.prim, o, d, rp.f.w));
}

// Radiance (pre-exposed) arriving along a ray o + t*d that hit `h`, with the chord's transmittance already integrated by the caller
// (`hitChordT(h, o, d)`). A ray entering a leaf crown mostly sees light that crossed the leaves, so the crown's own shading is blended
// with the environment behind it by that transmittance.
fn hitRadianceChord(h : SceneHit, o : vec3f, d : vec3f, e : Env, steps : u32, chord : f32) -> vec3f {
  let p = o + d * h.t;
  var s = surfaceAt(h, p, d);
  if (s.trans <= 0.0) { return shadeSurface(s, p, h.t, h.kind, e, steps); }
  s.albedo = CANOPY_SCATTER_ALBEDO;
  let lit = shadeSurface(s, p, h.t, h.kind, e, steps);
  return mix(lit, skyRadiance(d, e), chord);
}

fn hitRadiance(h : SceneHit, o : vec3f, d : vec3f, e : Env, steps : u32) -> vec3f {
  return hitRadianceChord(h, o, d, e, steps, hitChordT(h, o, d));
}

// How much of a hit's short-range occlusion is real, from the chord transmittance the caller already integrated: a leaf crown is porous, so
// a ray that ends in one only counts for the share of its chord's light the leaves stop, while any other hit is fully solid.
fn hitSolidity(h : SceneHit, chord : f32) -> f32 {
  if (h.kind != KIND_PRIM || !primIsCanopy(h.prim)) { return 1.0; }
  return 1.0 - chord;
}

// Blue-noise + R2 sample in [0,1)^2; `salt` decorrelates independent uses at the same pixel.
fn noise2(px : vec2i, salt : u32) -> vec2f {
  let seed = rp.dbg.y;
  let shift = vec2i(i32((salt * 37u + seed) & 127u), i32((salt * 91u + (seed >> 7u)) & 127u));
  let bn = textureLoad(blueNoise, (px + shift) & vec2i(127), 0).rg;
  let idx = f32((frameIndex() + salt * 7u) & 1023u);
  return fract(bn + idx * vec2f(0.7548776662, 0.5698402910));
}
