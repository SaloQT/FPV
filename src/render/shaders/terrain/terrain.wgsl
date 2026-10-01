// Terrain G-buffer pass: clipmap vertex placement plus the layered PBR material. Group 2 is declared in bindings.wgsl.
// Debug views (TerrainParams.debugMode): 1 lod level colour with grid lines, 2 slope, 3 layer weights, 4 wetness.
#include "terrain/ground_color.wgsl"
#include "terrain/clipmap.wgsl"
#include "terrain/detail_sample.wgsl"
#include "terrain/gbuffer.wgsl"

const MICRO_FREQ : f32 = 0.8;
const MICRO_SLOPE : f32 = 0.12;
const MICRO_FADE : f32 = 2.5;  // makes the relief vanish early: at grazing sun it turns into a lit/unlit mosaic

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) world : vec3f,
  @location(1) info : vec3f,  // level, morph, spacing
};

@vertex
fn vs(@builtin(vertex_index) vid : u32, @builtin(instance_index) iid : u32) -> VsOut {
  let g = gridVertex(tiles[iid], vid);
  var y = terrainHeightMirrored(g.xz);
  if (g.morph > 0.0) { y = mix(y, coarseHeight(g), g.morph); }
  let w = vec3f(g.xz.x, y, g.xz.y);
  var o : VsOut;
  o.pos = frame.viewProj * vec4f(w, 1.0);
  o.world = w;
  o.info = vec3f(g.level, g.morph, g.spacing);
  return o;
}

fn layerMaterial(layer : i32) -> f32 {
  switch (layer) {
    case 0, 1, 6: { return 1.0; }
    case 3, 4: { return 6.0; }
    default: { return 10.0; }
  }
}

fn heatRamp(t : f32) -> vec3f {
  let x = saturate1(t);
  return saturate(vec3f(1.5 - abs(4.0 * x - 3.0), 1.5 - abs(4.0 * x - 2.0), 1.5 - abs(4.0 * x - 1.0)));
}

fn debugColor(mode : u32, in : VsOut, n : vec3f, lw : LayerWeights, wet : f32, gridLine : f32) -> vec3f {
  switch (mode) {
    case 1u: {
      let hue = 0.5 + 0.5 * cos(TAU * (in.info.x * 0.17 + vec3f(0.0, 0.33, 0.67)));
      return mix(hue * (0.35 + 0.65 * (1.0 - in.info.y)), vec3f(0.0), gridLine);
    }
    case 2u: { return heatRamp(acos(saturate1(n.y)) / 1.0472); }
    case 3u: {
      let s = max(dot(lw.lo, vec4f(1.0)) + dot(lw.hi, vec4f(1.0)), 1e-4);
      let c = vec3f(lw.hi.x + lw.lo.w, lw.lo.x + lw.lo.y + lw.hi.w, lw.hi.y + lw.hi.z) + lw.lo.z * vec3f(0.55, 0.4, 0.2);
      return c / s;
    }
    default: { return mix(vec3f(0.08), vec3f(0.1, 0.35, 1.0), wet); }
  }
}

@fragment
fn fs(in : VsOut) -> FsOut {
  let w = in.world;
  let dx = dpdx(w);
  let dy = dpdy(w);
  let fpXZ = max(length(dx.xz), length(dy.xz));
  let ts = terrainSampleAt(w.xz, fpXZ);
  let maps = ts.maps;
  let lw = terrainLayerWeights(w.xz, w.y, ts.normal.y, maps, tp.waterLevel);

  var wt = array<f32, 8>(lw.lo.x, lw.lo.y, lw.lo.z, lw.lo.w, lw.hi.x, lw.hi.y, lw.hi.z, lw.hi.w);
  var total = 0.0;
  for (var i = 0; i < GL_COUNT; i++) { total += wt[i]; }
  var lid = array<i32, 3>(0, 0, 0);
  var lwt = array<f32, 3>(0.0, 0.0, 0.0);
  for (var k = 0; k < 3; k++) {
    var bi = 0;
    var bv = -1.0;
    for (var i = 0; i < GL_COUNT; i++) {
      if (wt[i] > bv) { bv = wt[i]; bi = i; }
    }
    lid[k] = bi;
    lwt[k] = max(bv, 0.0);
    wt[bi] = 0.0;
  }

  var ctx : DsCtx;
  ctx.p = w;
  ctx.dx = dx;
  ctx.dy = dy;
  ctx.n = ts.normal;
  ctx.footprint = max(length(dx), length(dy));
  ctx.planes = (tp.flags & 1u) != 0u && ts.normal.y < 0.85;

  var albedo = vec3f(0.0);
  var rough = 0.0;
  var cavity = 0.0;
  var dn = vec3f(0.0);
  var bsum = 0.0;
  var best = 0.0;
  var bestLayer = GL_DIRT;
  let cutoff = 0.03 * max(total, 1e-4);
  for (var k = 0; k < 3; k++) {
    if (lwt[k] > cutoff) {
      let d = dsLayerDetail(lid[k], ctx);
      let p = lwt[k] * (0.45 + 1.1 * d.height);
      let b = p * p * p;
      albedo += b * layerMacroColor(lid[k], w.xz, w.y, maps) * d.tone;
      rough += b * d.rough;
      cavity += b * d.ao;
      dn += b * d.dn;
      bsum += b;
      if (b > best) { best = b; bestLayer = lid[k]; }
    }
  }
  if (bsum > 1e-6) {
    let inv = 1.0 / bsum;
    albedo *= inv;
    rough *= inv;
    cavity *= inv;
    dn *= inv;
  } else {
    albedo = glBaseColor(GL_DIRT);
    rough = glRoughness(GL_DIRT);
    cavity = 1.0;
  }

  let mr = tnFbmD(w.xz * MICRO_FREQ, i32(tp.octaves), fpXZ * MICRO_FREQ * MICRO_FADE);
  let n = normalize(ts.normal + dn - MICRO_SLOPE * vec3f(mr.y, 0.0, mr.z));
  let microAo = 1.0 - 0.3 * smoothstep(0.0, 0.7, -mr.x);

  // Damp ground darkens and gains some gloss, but only the waterline is a film of water: a valley floor must not read as wet asphalt.
  var wet = 0.6 * smoothstep(0.35, 0.9, maps.w);
  if (tp.waterLevel > -1.0e8) { wet = max(wet, 1.0 - smoothstep(0.0, 1.2, w.y - tp.waterLevel)); }
  let turfShare = (lw.lo.x + lw.lo.y) / max(total, 1e-4);
  // A wet sward is not a glossy film; blades shed water, so only bare soil, gravel and loam take the damp response in full.
  wet *= (1.0 - lw.hi.z / max(total, 1e-4)) * (1.0 - 0.8 * turfShare);
  // Ground under a canopy sees less sky: the same darkening the blade roots get, so turf and ground share one AO response.
  cavity *= 1.0 - 0.3 * turfShare;

  var out : FsOut;
  var emissive = 0.0;
  if (tp.debugMode != 0u) {
    let fw = fpXZ / in.info.z;
    let gp = abs(fract(w.xz / in.info.z + 0.5) - 0.5);
    let gridLine = 1.0 - smoothstep(0.0, 1.5 * fw + 1e-4, min(gp.x, gp.y));
    albedo = debugColor(tp.debugMode, in, n, lw, wet, gridLine);
    cavity = 1.0;
    rough = 1.0;
    emissive = 0.6;
  }
  // The detail cavity darkens only the ambient term, and its mean over the texture is well below 1: keep it a partial effect so shade is not black.
  out.albedo = vec4f(clamp(albedo, vec3f(0.0), vec3f(1.0)), saturate1(ts.ao * mix(1.0, cavity * microAo, 0.6)));
  out.normal = vec4f(octEncode(n), saturate1(rough), 0.0);
  out.misc = vec4f(layerMaterial(bestLayer) / 255.0, 0.0, wet, emissive);
  out.motion = motionVector(w);
  return out;
}
