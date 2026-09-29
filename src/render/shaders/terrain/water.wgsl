// Water surface: a flat plane at TerrainParams.waterLevel drawn over the clipmap tiles whose terrain dips below it (see index.ts).
// Two drifting 2-octave FBM height layers give the normals; the albedo is the analytic refraction of the bed (Beer-Lambert absorption
// over the refracted path plus in-scattered deep colour), which the deferred pass lights like any opaque surface.
#include "terrain/ground_color.wgsl"
#include "terrain/clipmap.wgsl"
#include "terrain/gbuffer.wgsl"

const WATER_ABSORB : vec3f = vec3f(0.55, 0.14, 0.09);
const WATER_DEEP : vec3f = vec3f(0.010, 0.040, 0.046);
const WATER_MATERIAL : f32 = 8.0;

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) world : vec3f,
};

@vertex
fn vs(@builtin(vertex_index) vid : u32, @builtin(instance_index) iid : u32) -> VsOut {
  let g = gridVertex(tiles[iid], vid);
  let w = vec3f(g.xz.x, tp.waterLevel, g.xz.y);
  var o : VsOut;
  o.pos = frame.viewProj * vec4f(w, 1.0);
  o.world = w;
  return o;
}

@fragment
fn fs(in : VsOut) -> FsOut {
  let w = in.world;
  let dx = dpdx(w);
  let dy = dpdy(w);
  let fp = max(length(dx.xz), length(dy.xz));
  let toCam = frame.camPos.xyz - w;
  let v = toCam / max(length(toCam), 1e-3);
  let t = tp.time;

  let a = tnFbmD(w.xz * 0.42 + vec2f(0.21, 0.13) * t, 2, fp * 0.42);
  let b = tnFbmD(w.xz * 1.55 + vec2f(-0.33, 0.47) * t, 2, fp * 1.55);
  let n = normalize(vec3f(-(0.075 * a.y + 0.046 * b.y), 1.0, -(0.075 * a.z + 0.046 * b.z)));

  let ts = terrainSampleAt(w.xz, fp);
  let bed = terrainHeightMirrored(w.xz);
  let depth = max(tp.waterLevel - bed, 0.0);
  let sinI2 = 1.0 - sq(max(dot(n, v), 0.0));
  let path = depth / max(sqrt(1.0 - sinI2 / 1.769), 0.3);
  let trans = exp(-WATER_ABSORB * path);
  var bedColor = vec3f(0.02);
  if (depth < 8.0) { bedColor = groundBaseColorAt(w.xz, bed, ts.normal.y, ts.maps, tp.waterLevel); }
  var albedo = bedColor * trans + WATER_DEEP * (1.0 - trans);

  let foamNoise = tnFbm(w.xz * 2.2 + vec2f(0.4, -0.25) * t, 2);
  let foam = max(1.0 - smoothstep(0.0, 0.1, depth), (1.0 - smoothstep(0.02, 0.45, depth)) * smoothstep(0.35, 0.75, foamNoise));
  albedo = mix(albedo, vec3f(0.75), foam);
  let rough = mix(0.04 + 0.16 * smoothstep(0.3, 4.0, fp), 0.55, foam);

  var out : FsOut;
  out.albedo = vec4f(clamp(albedo, vec3f(0.0), vec3f(1.0)), 1.0);
  out.normal = vec4f(octEncode(n), rough, 0.0);
  out.misc = vec4f(WATER_MATERIAL / 255.0, 0.0, 0.0, 0.0);
  out.motion = motionVector(w);
  return out;
}
