#include "rt/rt_trace_io.wgsl"
#ifdef GI_RECORDED
@group(${GRP}) @binding(12) var giHit0 : texture_2d<f32>;
@group(${GRP}) @binding(13) var giHit1 : texture_2d<f32>;
fn recordedGiHit(px : vec2i, ray : u32) -> SceneHit {
  var record : vec2f;
  if (ray == 0u) { record = textureLoad(giHit0, px, 0).xy; }
  else { record = textureLoad(giHit1, px, 0).xy; }
  if (record.y < 0.0) { return SceneHit(record.x, KIND_TERRAIN, 0u); }
  if (record.y > 0.0) { return SceneHit(record.x, KIND_PRIM, u32(record.y) - 1u); }
  return SceneHit(record.x, KIND_MISS, 0u);
}
#endif
#ifdef SHADE_VISIBILITY
@group(${GRP}) @binding(14) var giVisibility0 : texture_2d<f32>;
@group(${GRP}) @binding(15) var giVisibility1 : texture_2d<f32>;
fn recordedGiVisibility(px : vec2i, ray : u32) -> f32 {
  if (ray == 0u) { return textureLoad(giVisibility0, px, 0).x; }
  return textureLoad(giVisibility1, px, 0).x;
}
#endif

#ifdef VISIBILITY_ONLY
@compute @workgroup_size(8, 4, 2)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (!inRt(gid.xy)) { return; }
  let px = vec2i(gid.xy);
  let pix = loadPixel(px);
  var vis = 1.0;
  if (pix.ok && rp.dbg.x != 5u) {
    let h = recordedGiHit(px, gid.z);
    if (h.kind != KIND_MISS) {
      let d = basisFromNormal(pix.n) * cosineHemisphere(noise2(px, 1u + gid.z));
      let origin = pix.pos + pix.n * (0.04 + 0.004 * pix.z);
      let p = origin + d * h.t;
      let s = surfaceAt(h, p, d);
      let key = keyDir();
      if (lightCosine(s, key.xyz) > 0.0 && key.y > -0.03) {
        if (h.t < NEAR_SHADOW_RANGE) {
          let o = p + s.n * (0.04 + 0.003 * h.t);
          vis = keyVisibility(o, key.xyz, SHADOW_RAY_RANGE, max(16u, rp.cfg.y / 3u));
        } else if (h.kind == KIND_TERRAIN) { vis = s.ao; }
        vis *= cloudTransmittance(p);
      }
    }
  }
  if (gid.z == 0u) { textureStore(out0, px, vec4f(vis)); }
  else { textureStore(out1, px, vec4f(vis)); }
}
#else
#include "rt/rt_trace_io.wgsl"
#ifdef TRACE_ONLY
fn encodeGiHit(h : SceneHit) -> vec4f {
  var code = 0.0;
  if (h.kind == KIND_TERRAIN) { code = -1.0; }
  else if (h.kind == KIND_PRIM) { code = f32(h.prim + 1u); }
  return vec4f(h.t, code, 0.0, 0.0);
}
@compute @workgroup_size(8, 4)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (!inRt(gid.xy)) { return; }
  let px = vec2i(gid.xy);
  let pix = loadPixel(px);
  if (!pix.ok || rp.dbg.x == 5u) {
    textureStore(out0, px, vec4f(0.0)); textureStore(out1, px, vec4f(0.0)); return;
  }
  let basis = basisFromNormal(pix.n);
  let origin = pix.pos + pix.n * (0.04 + 0.004 * pix.z);
  let d0 = basis * cosineHemisphere(noise2(px, 1u));
  let h0 = traceScene(origin, d0, rp.f.w, rp.cfg.y);
  textureStore(out0, px, encodeGiHit(h0));
  let d1 = basis * cosineHemisphere(noise2(px, 2u));
  let h1 = traceScene(origin, d1, rp.f.w, rp.cfg.y);
  textureStore(out1, px, encodeGiHit(h1));
}
#else


// Diffuse GI: `giRays` cosine-weighted rays per RT texel (blue noise rotated per frame). A hit returns its shaded radiance (direct light with a
// secondary shadow ray, probe bounce, emission), a miss the sky / ground colour. out0 = (mean radiance, mean short-range visibility),
// out1 = the probe-grid irradiance at the pixel, used by the temporal pass to re-seed disoccluded history and as the whole result at 0 rays.
#include "rt/rt_trace_io.wgsl"

const CONTACT_RANGE : f32 = 2.0;

// At two rays per pixel, each z lane traces one unchanged sample. The first lane
// combines them in the original order after the shared-memory barrier. Other ray
// counts keep the serial path. Every invocation reaches the barrier, even sky and
// partial edge tiles.
var<workgroup> rayResult : array<vec4f, 32>;

#ifdef SHADE_ONLY
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (!inRt(gid.xy)) { return; }
  let px = vec2i(gid.xy);
  let pix = loadPixel(px);
  if (!pix.ok) {
    textureStore(out0, px, vec4f(0.0));
    textureStore(out1, px, vec4f(0.0));
    return;
  }
  let e = envAt(pix.pos.y);
  let probeE = probeIrradiance(pix.pos + pix.n * 0.3, pix.n, e);
  textureStore(out1, px, fp16Safe(vec4f(probeE, 1.0)));
  if (rp.dbg.x == 5u) {
    textureStore(out0, px, fp16Safe(vec4f(probeE, 1.0)));
    return;
  }
  let basis = basisFromNormal(pix.n);
  let origin = pix.pos + pix.n * (0.04 + 0.004 * pix.z);
  let steps = rp.cfg.y;
  var sum = vec3f(0.0);
  var vis = 0.0;
  for (var r = 0u; r < 2u; r++) {
    let d = basis * cosineHemisphere(noise2(px, 1u + r));
    let h = recordedGiHit(px, r);
#ifdef SHADE_VISIBILITY
    giVisibilityValue = recordedGiVisibility(px, r);
#endif
    if (h.kind == KIND_MISS) {
      sum += skyRadiance(d, e);
      vis += 1.0;
    } else {
      var chord = 1.0;
      if (h.kind == KIND_PRIM && primIsCanopy(h.prim)) { chord = hitChordT(h, origin, d); }
      sum += hitRadianceChord(h, origin, d, e, steps, chord);
      if (h.t < CONTACT_RANGE) {
        vis += 1.0 - hitSolidity(h, chord) * (1.0 - saturate1(h.t / CONTACT_RANGE));
      } else { vis += 1.0; }
    }
  }
  textureStore(out0, px, fp16Safe(vec4f(sum * 0.5, vis * 0.5)));
}
#else
@compute @workgroup_size(8, 2, 2)
fn main(@builtin(global_invocation_id) gid : vec3u, @builtin(local_invocation_index) local : u32) {
  let px = vec2i(gid.xy);
  let inside = inRt(gid.xy);
#ifdef SHADE_VISIBILITY
  if (inside) { giVisibilityValue = recordedGiVisibility(px, gid.z); }
#endif
  var pix : PixelInfo;
  if (inside) { pix = loadPixel(px); }
#ifdef SHADE_ONLY
  let rays = 2u; // The CPU selects this pipeline only for the two-ray configuration.
#else
  let rays = rp.cfg.z;
#endif
  let paired = rays == 2u;
  var sum = vec3f(0.0);
  var vis = 0.0;
  if (inside && pix.ok && (gid.z == 0u || paired)) {
  let e = envAt(pix.pos.y);
  if (gid.z == 0u) {
  let probeE = probeIrradiance(pix.pos + pix.n * 0.3, pix.n, e);
  textureStore(out1, px, fp16Safe(vec4f(probeE, 1.0)));
  if (rays == 0u || rp.dbg.x == 5u) {
    textureStore(out0, px, fp16Safe(vec4f(probeE, 1.0)));
  }
  }
  if (rays > 0u && rp.dbg.x != 5u) {
  let basis = basisFromNormal(pix.n);
  let origin = pix.pos + pix.n * (0.04 + 0.004 * pix.z);
  let steps = rp.cfg.y;
  let start = select(0u, gid.z, paired);
  let end = select(rays, gid.z + 1u, paired);
#ifdef SHADE_ONLY
  { let r = gid.z;
    let d = basis * cosineHemisphere(noise2(px, 1u + r));
#ifdef SHADE_ONLY
    let h = recordedGiHit(px, r);
#else
    let h = traceScene(origin, d, rp.f.w, steps);
#endif
    if (h.kind == KIND_MISS) {
      sum += skyRadiance(d, e);
      vis += 1.0;
    } else {
      // A crown's chord transmittance is the same number for the radiance and the contact visibility, so it is integrated once per ray.
      // Past CONTACT_RANGE the visibility weight is exactly zero, so there the chord is needed by the radiance alone.
      var chord = 1.0;
      if (h.kind == KIND_PRIM && primIsCanopy(h.prim)) { chord = hitChordT(h, origin, d); }
      sum += hitRadianceChord(h, origin, d, e, steps, chord);
      if (h.t < CONTACT_RANGE) {
        vis += 1.0 - hitSolidity(h, chord) * (1.0 - saturate1(h.t / CONTACT_RANGE));
      } else {
        vis += 1.0;
      }
    }
    }
#else
  for (var r = start; r < end; r++) {
    let d = basis * cosineHemisphere(noise2(px, 1u + r));
#ifdef SHADE_ONLY
    let h = recordedGiHit(px, r);
#else
    let h = traceScene(origin, d, rp.f.w, steps);
#endif
    if (h.kind == KIND_MISS) {
      sum += skyRadiance(d, e);
      vis += 1.0;
    } else {
      // A crown's chord transmittance is the same number for the radiance and the contact visibility, so it is integrated once per ray.
      // Past CONTACT_RANGE the visibility weight is exactly zero, so there the chord is needed by the radiance alone.
      var chord = 1.0;
      if (h.kind == KIND_PRIM && primIsCanopy(h.prim)) { chord = hitChordT(h, origin, d); }
      sum += hitRadianceChord(h, origin, d, e, steps, chord);
      if (h.t < CONTACT_RANGE) {
        vis += 1.0 - hitSolidity(h, chord) * (1.0 - saturate1(h.t / CONTACT_RANGE));
      } else {
        vis += 1.0;
      }
    }
  }
#endif
  }
  }
  rayResult[local] = vec4f(sum, vis);
  workgroupBarrier();
  if (!inside || gid.z != 0u) { return; }
  if (!pix.ok) {
    textureStore(out0, px, vec4f(0.0));
    textureStore(out1, px, vec4f(0.0));
    return;
  }
  if (rays == 0u || rp.dbg.x == 5u) { return; }
  if (paired) {
    sum += rayResult[local + 16u].rgb;
    vis += rayResult[local + 16u].a;
  }
  let inv = 1.0 / f32(rays);
  textureStore(out0, px, fp16Safe(vec4f(sum * inv, vis * inv)));
}
#endif

#endif

#endif
