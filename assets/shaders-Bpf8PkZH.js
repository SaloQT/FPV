var e=Object.assign({"./shaders/common/atmosphere_sample.wgsl":`// Atmosphere LUT sampling (Hillaire 2020, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique").
// Include AFTER common/world_bindings.wgsl. The atmosphere module fills the LUTs with EXACTLY these parameterisations
// (the *Params functions below are the inverses it needs when rendering into a LUT texel).
//
// Radii are in km. Rb = frame.sky.x (planet), Rt = frame.sky.y (atmosphere top). World +Y is "up"; the planet centre is
// (0, -(Rb + datum), 0) far below, so local up is +Y everywhere in the few-km-wide world.
// Radius of a world-space height y:  r = Rb + frame.sky.z + (y - frame.camPos.y) / 1000   (sky.z = camera height above the datum, km).
//
// transmittanceLUT  rgba16float 256x64, rgb = transmittance from height r along zenith cosine mu to the atmosphere top (planet ignored).
//   uv = (x_mu, x_r);  H = sqrt(Rt^2 - Rb^2);  rho = sqrt(r^2 - Rb^2);  x_r = rho / H
//   d = -r*mu + sqrt(r^2*(mu^2-1) + Rt^2);  d_min = Rt - r;  d_max = rho + H;  x_mu = (d - d_min) / (d_max - d_min)
//   Texel (i,j) is generated at uv = ((i + 0.5) / 256, (j + 0.5) / 64) and sampled at uv directly (no sub-texel remap).
// multiScatterLUT   rgba16float 32x32, rgb = multiple-scattering luminance factor. uv = (mu_sun*0.5 + 0.5, (r - Rb) / (Rt - Rb)),
//   both remapped with unitToSubUv(., 32).
// skyViewLUT        rgba16float 192x108, rgb = sky radiance (nits, not pre-exposed) seen from the CAMERA radius r = Rb + frame.sky.z,
//   rebuilt every frame for the current sun. uv = skyViewUv(): v = zenith angle with the horizon at v = 0.5 and sqrt-compressed toward it
//   (upper half: sky, lower half: below the horizon), u = sqrt((1 - cosAz) / 2) where cosAz is the cosine of the azimuth between the
//   view and the sun measured on the horizontal plane. Both remapped with unitToSubUv (unit 0 and 1 land on the first and last texel centres). When rendering a texel, use
//   up = (0,1,0), sunDir = (sqrt(1 - mu_s^2), mu_s, 0), viewDir = (sinZ*cosAz, cosZ, sinZ*sqrt(1 - cosAz^2)) from skyViewParams().
// aerialPerspective rgba16float 32x32x32 froxels: xy = screen uv (texel centres), z = apDistanceToSlice(distance from the camera along the
//   pixel ray) with texel k centred at (k + 0.5) / 32. rgb = in-scattered radiance (nits, not pre-exposed) from the camera to that distance,
//   a = mean RGB transmittance over the same distance. Composite:  colour = colour * a + rgb.

const AP_SLICES : f32 = 32.0;
const AP_MAX_DISTANCE_M : f32 = 40000.0;
const AP_DEPTH_K : f32 = 6.0;

fn atmosRadiusAtHeight(worldY : f32) -> f32 {
  return max(frame.sky.x + frame.sky.z + (worldY - frame.camPos.y) * 0.001, frame.sky.x + 1e-4);
}

fn unitToSubUv(u : f32, res : f32) -> f32 { return (u * (res - 1.0) + 0.5) / res; }
fn subUvToUnit(u : f32, res : f32) -> f32 { return (u - 0.5 / res) * (res / (res - 1.0)); }

fn transmittanceUv(r : f32, mu : f32) -> vec2f {
  let rb = frame.sky.x;
  let rt = frame.sky.y;
  let h = sqrt(max(rt * rt - rb * rb, 0.0));
  let rho = sqrt(max(r * r - rb * rb, 0.0));
  let d = max(0.0, -r * mu + sqrt(max(r * r * (mu * mu - 1.0) + rt * rt, 0.0)));
  let dMin = rt - r;
  let dMax = rho + h;
  return vec2f(saturate1((d - dMin) / max(dMax - dMin, 1e-6)), saturate1(rho / h));
}

// Inverse of transmittanceUv: returns (r, mu) for a LUT uv.
fn transmittanceParams(uv : vec2f) -> vec2f {
  let rb = frame.sky.x;
  let rt = frame.sky.y;
  let h = sqrt(max(rt * rt - rb * rb, 0.0));
  let rho = h * uv.y;
  let r = sqrt(rho * rho + rb * rb);
  let dMin = rt - r;
  let dMax = rho + h;
  let d = dMin + uv.x * (dMax - dMin);
  let mu = select(clamp((h * h - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0), 1.0, d == 0.0);
  return vec2f(r, mu);
}

fn sampleTransmittance(r : f32, mu : f32) -> vec3f {
  return textureSampleLevel(transmittanceLUT, linearClamp, transmittanceUv(r, mu), 0.0).rgb;
}

// Cosine of the azimuth between a direction and the sun, both projected on the horizontal plane (1 when either is vertical).
fn azimuthCosToSun(dir : vec3f) -> f32 {
  let s = vec2f(frame.sunDir.x, frame.sunDir.z);
  let v = vec2f(dir.x, dir.z);
  let sl = length(s);
  let vl = length(v);
  if (sl < 1e-5 || vl < 1e-5) { return 1.0; }
  return dot(s, v) / (sl * vl);
}

fn skyViewUv(dir : vec3f, r : f32) -> vec2f {
  let rb = frame.sky.x;
  let cosBeta = sqrt(max(r * r - rb * rb, 0.0)) / r;
  let beta = acos(cosBeta);
  let zenithHorizon = PI - beta;
  let zenith = acos(clamp(dir.y, -1.0, 1.0));
  var v : f32;
  if (zenith < zenithHorizon) {
    v = (1.0 - sqrt(1.0 - zenith / zenithHorizon)) * 0.5;
  } else {
    v = sqrt(saturate1((zenith - zenithHorizon) / beta)) * 0.5 + 0.5;
  }
  let u = sqrt(saturate1(0.5 - 0.5 * azimuthCosToSun(dir)));
  return vec2f(unitToSubUv(u, 192.0), unitToSubUv(v, 108.0));
}

// Inverse of skyViewUv for camera radius r: returns (cos zenith, cos azimuth-to-sun).
fn skyViewParams(uv : vec2f, r : f32) -> vec2f {
  let rb = frame.sky.x;
  let u = subUvToUnit(uv.x, 192.0);
  let v = subUvToUnit(uv.y, 108.0);
  let cosBeta = sqrt(max(r * r - rb * rb, 0.0)) / r;
  let beta = acos(cosBeta);
  let zenithHorizon = PI - beta;
  var cosZenith : f32;
  if (v < 0.5) {
    let c = 1.0 - 2.0 * v;
    cosZenith = cos(zenithHorizon * (1.0 - c * c));
  } else {
    let c = 2.0 * v - 1.0;
    cosZenith = cos(zenithHorizon + beta * c * c);
  }
  return vec2f(cosZenith, 1.0 - 2.0 * u * u);
}

// Sky radiance (nits, not pre-exposed) toward a world direction from the camera's radius.
fn sampleSkyView(dir : vec3f) -> vec3f {
  let uv = skyViewUv(dir, frame.sky.x + frame.sky.z);
  return textureSampleLevel(skyViewLUT, linearClamp, uv, 0.0).rgb;
}

fn apSliceToDistance(w : f32) -> f32 {
  return AP_MAX_DISTANCE_M * (exp(AP_DEPTH_K * w) - 1.0) / (exp(AP_DEPTH_K) - 1.0);
}
fn apDistanceToSlice(d : f32) -> f32 {
  return log(1.0 + d * (exp(AP_DEPTH_K) - 1.0) / AP_MAX_DISTANCE_M) / AP_DEPTH_K;
}

// rgb = in-scatter (nits), a = transmittance; faded to (0, 1) inside the first froxel where the LUT has no data.
fn sampleAerialPerspective(screenUv : vec2f, distanceM : f32) -> vec4f {
  let ap = textureSampleLevel(aerialPerspective, linearClamp, vec3f(screenUv, apDistanceToSlice(distanceM)), 0.0);
  let fade = saturate1(distanceM / apSliceToDistance(0.5 / AP_SLICES));
  return vec4f(ap.rgb * fade, mix(1.0, ap.a, fade));
}
`,"./shaders/common/frame.wgsl":`// Group 0, binding 0: per-frame uniforms. Layout mirrored by writeFrameUniforms() in src/render/frameUniforms.ts.
// Conventions: world is +Y up, +X east, -Z north. Depth is reverse-Z (near = 1, far = 0), infinite far plane.
struct Frame {
  view : mat4x4f,
  proj : mat4x4f,               // includes TAA jitter
  viewProj : mat4x4f,           // includes TAA jitter (use for rasterisation)
  viewProjUnjittered : mat4x4f, // use for motion vectors (current frame)
  invView : mat4x4f,
  invProj : mat4x4f,            // inverse of the jittered proj
  invViewProj : mat4x4f,        // inverse of the jittered viewProj (use to reconstruct world pos from depth)
  prevViewProj : mat4x4f,       // previous frame, unjittered
  celestial : mat4x4f,          // upper-left 3x3: J2000 equatorial -> world axes
  camPos : vec4f,               // xyz = world position (m), w = simulation time (s)
  screen : vec4f,               // x,y = render width,height (px); z,w = reciprocals
  jitter : vec4f,               // xy = current jitter (NDC units), zw = previous
  sunDir : vec4f,               // xyz = unit vector toward the sun, w = angular radius (rad)
  sunIrradiance : vec4f,        // rgb = illuminance at the TOP of the atmosphere on a surface facing the sun (lux, ~1.27e5); shaders multiply by transmittance(surface height, sun zenith) from transmittanceLUT. w = 1 if above horizon
  moonDir : vec4f,              // xyz = toward the moon, w = angular radius (rad)
  moonIrradiance : vec4f,       // rgb = top-of-atmosphere illuminance from the moon in lux (phase-dependent, ~0.3 at full moon); apply transmittance like the sun. w = illuminated fraction
  terrain : vec4f,              // x = N samples per side, y = cellSize (m), z = minHeight, w = maxHeight
  terrainOrigin : vec4f,        // xy = world (x,z) of sample (0,0), zw = world extent (m)
  misc : vec4u,                 // x = frame index, y = quality flags, z = per-frame random seed, w = KEY LIGHT flag: 0 => sunShadow texture holds the SUN's visibility, 1 => the MOON's. y bits: 1 = rtSpecular, 2 = bloom, 4 = taa
  params : vec4f,               // x = dt (s), y = PRE-EXPOSURE (multiply all HDR writes), z = near, w = far (unused: infinite)
  sky : vec4f,                  // x = planet radius (km), y = atmosphere top radius (km), z = camera height above datum (km), w = night-sky brightness scale
};

@group(0) @binding(0) var<uniform> frame : Frame;
`,"./shaders/common/math.wgsl":`const PI : f32 = 3.14159265358979;
const TAU : f32 = 6.28318530717959;
const INV_PI : f32 = 0.31830988618379;
const EMISSIVE_MAX_NITS : f32 = 20000.0;

fn saturate1(x : f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn sq(x : f32) -> f32 { return x * x; }

// PCG hash (Jarzynski/Olano). Good quality, cheap; use for per-pixel/per-thread randomness.
fn pcg(v : u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn pcg3(v : vec3u) -> vec3u {
  var x = v * 1664525u + 1013904223u;
  x.x += x.y * x.z; x.y += x.z * x.x; x.z += x.x * x.y;
  x = x ^ (x >> vec3u(16u));
  x.x += x.y * x.z; x.y += x.z * x.x; x.z += x.x * x.y;
  return x;
}
fn u01(h : u32) -> f32 { return f32(h >> 8u) * (1.0 / 16777216.0); }
fn hash11(x : u32) -> f32 { return u01(pcg(x)); }
fn hash21(p : vec2u) -> f32 { return u01(pcg(p.x + pcg(p.y))); }
fn hash31(p : vec3u) -> f32 { return u01(pcg3(p).x); }

// Octahedral unit-vector encoding into [0,1]^2 (for the G-buffer normal).
fn octEncode(n : vec3f) -> vec2f {
  let a = n / (abs(n.x) + abs(n.y) + abs(n.z));
  var e = a.xy;
  if (a.z < 0.0) { e = (1.0 - abs(a.yx)) * select(vec2f(-1.0), vec2f(1.0), a.xy >= vec2f(0.0)); }
  return e * 0.5 + 0.5;
}
fn octDecode(f : vec2f) -> vec3f {
  let e = f * 2.0 - 1.0;
  var n = vec3f(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  let t = saturate1(-n.z);
  n.x += select(t, -t, n.x >= 0.0);
  n.y += select(t, -t, n.y >= 0.0);
  return normalize(n);
}

// Orthonormal basis around n (Duff et al. 2017).
fn basisFromNormal(n : vec3f) -> mat3x3f {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  let t = vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
  let bt = vec3f(b, s + n.y * n.y * a, -n.y);
  return mat3x3f(t, bt, n);
}

fn cosineHemisphere(u : vec2f) -> vec3f {
  let r = sqrt(u.x);
  let phi = TAU * u.y;
  return vec3f(r * cos(phi), r * sin(phi), sqrt(max(0.0, 1.0 - u.x)));
}

fn luminance(c : vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

// World position from reverse-Z depth and pixel-centre UV (uses the jittered inverse matrix).
fn worldFromDepth(uv : vec2f, depth : f32) -> vec3f {
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  let w = frame.invViewProj * ndc;
  return w.xyz / w.w;
}

// Camera-space ray direction (world axes) for a pixel-centre UV.
fn viewRayDir(uv : vec2f) -> vec3f {
  let p = worldFromDepth(uv, 0.0001);
  return normalize(p - frame.camPos.xyz);
}
`,"./shaders/common/pbr.wgsl":`// Shared BRDF helpers (GGX / Smith-correlated / Schlick). Include after common/math.wgsl (PI, INV_PI, saturate1).
// Roughness arguments are PERCEPTUAL (the G-buffer value); alpha = roughness^2 is derived inside.

const MIN_DIRECT_ROUGHNESS : f32 = 0.06;
// Leaves transmit about 0.8 of what they reflect (same figure as LEAF_TRANSMISSION in rt/rt_scene.wgsl).
const LEAF_TRANSMITTANCE : f32 = 0.8;

fn dGGX(nh : f32, alpha : f32) -> f32 {
  let a2 = alpha * alpha;
  let d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d + 1e-7);
}

fn vSmithGGXCorrelated(nv : f32, nl : f32, alpha : f32) -> f32 {
  let a2 = alpha * alpha;
  let gv = nl * sqrt(nv * nv * (1.0 - a2) + a2);
  let gl = nv * sqrt(nl * nl * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}

fn fSchlick(f0 : vec3f, vh : f32) -> vec3f {
  let f = pow(1.0 - saturate1(vh), 5.0);
  return f0 + (vec3f(1.0) - f0) * f;
}

// Split-sum environment BRDF (Karis, "Physically Based Shading on Mobile"): returns f0 * A + B.
fn envBrdfApprox(f0 : vec3f, roughness : f32, nv : f32) -> vec3f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let r = roughness * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  let ab = vec2f(-1.04, 1.04) * a004 + r.zw;
  return f0 * ab.x + vec3f(ab.y);
}

// Horizon-based specular occlusion (Lagarde & de Rousiers 2014).
fn specularOcclusion(nv : f32, ao : f32, roughness : f32) -> f32 {
  return saturate1(pow(nv + ao, exp2(-16.0 * roughness - 1.0)) - 1.0 + ao);
}

// Colour of the light a leaf of reflectance \`c\` passes: chlorophyll absorbs red and blue on the way through far more than green and the cell walls
// scatter little blue back out, so a backlit leaf glows a saturated yellow-green (a leaf's transmittance peaks near 550 nm and has almost no blue).
// Saturation is raised about the luminance, which it keeps, then tilted toward yellow.
fn leafTransmitColour(c : vec3f) -> vec3f {
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  return max(vec3f(l) + (c - vec3f(l)) * 1.15, vec3f(0.0)) * vec3f(1.08, 1.04, 0.7);
}

// The forward-scattered share of the light a leaf of translucency \`t\` passes, seen from its shaded side: a thin lamina scatters most of what it
// transmits within a few tens of degrees of the beam, so a leaf against the sun glows several times brighter than the diffuse transmission in
// directLight alone, and the glow falls off quickly away from the sun line. Fades in as the leaf turns its back to the light.
const LEAF_GLOW : f32 = 1.6;
const LEAF_GLOW_POWER : f32 = 10.0;
fn leafForwardScatter(l : vec3f, n : vec3f, v : vec3f, transmitColor : vec3f, t : f32, e : vec3f) -> vec3f {
  let beam = pow(saturate1(dot(-l, v)), LEAF_GLOW_POWER);
  let back = saturate1(0.2 - 1.2 * dot(n, l));
  return transmitColor * (t * LEAF_GLOW * LEAF_TRANSMITTANCE * beam * back * INV_PI) * e;
}

// A leaf passes the light that falls on its back side on through it about evenly in every direction (a thin, scattering lamina): seen from
// any side away from the light it glows with its transmittance times the light, like a lit sheet of paper, not only along the sun line.
// directLight keeps a quarter of that off the sun line (the share every translucent surface gets); this adds the rest for leaves, so a
// backlit crown glows yellow-green wherever the sun reaches its leaves, and is dark only where they shade each other.
fn leafBackDiffuse(l : vec3f, n : vec3f, v : vec3f, transmitColor : vec3f, t : f32, e : vec3f) -> vec3f {
  let back = t * saturate1(-dot(n, l)) * 0.75 * (1.0 - pow(saturate1(dot(-l, v)), 4.0)) * LEAF_TRANSMITTANCE;
  return transmitColor * (back * INV_PI) * e;
}

// The GGX specular part of directLight alone (the same expression), so a caller can scale it.
fn directSpecular(l : vec3f, n : vec3f, v : vec3f, f0 : vec3f, roughness : f32, e : vec3f, angRadius : f32) -> vec3f {
  let ndl = dot(n, l);
  if (ndl <= 0.0) { return vec3f(0.0); }
  let nv = max(dot(n, v), 1e-3);
  let h = normalize(l + v);
  let rc = max(roughness, MIN_DIRECT_ROUGHNESS);
  let alpha = saturate1(rc * rc + 0.5 * angRadius);
  return fSchlick(f0, saturate1(dot(v, h))) * (dGGX(saturate1(dot(n, h)), alpha) * vSmithGGXCorrelated(nv, ndl, alpha) * ndl) * e;
}

// Outgoing radiance from one directional light. \`e\` is the illuminance on a surface facing the light (lux), \`angRadius\` the
// light's angular radius (rad, widens the specular lobe so a point-like sun does not alias into a 1e9 nit speck).
// translucency > 0 adds wrapped diffuse plus back-lit transmission (foliage), the transmitted light coloured \`transmitColor\` (leafTransmitColour
// of the albedo for leaves, the albedo itself for anything else).
fn directLight(l : vec3f, n : vec3f, v : vec3f, diffuseColor : vec3f, transmitColor : vec3f, f0 : vec3f, roughness : f32,
               translucency : f32, e : vec3f, angRadius : f32) -> vec3f {
  let ndl = dot(n, l);
  // A quarter of a fully translucent leaf's lit range wraps past the terminator; more flattens the sunlit-to-shaded gradient of a crown.
  let wrap = 0.25 * translucency;
  let diffuseNl = saturate1((ndl + wrap) / (1.0 + wrap));
  let back = translucency * saturate1(-ndl) * (0.25 + 0.75 * pow(saturate1(dot(-l, v)), 4.0)) * LEAF_TRANSMITTANCE;
  var lo = (diffuseColor * diffuseNl + transmitColor * back) * INV_PI;
  if (ndl > 0.0) {
    let nv = max(dot(n, v), 1e-3);
    let h = normalize(l + v);
    let nh = saturate1(dot(n, h));
    let vh = saturate1(dot(v, h));
    let rc = max(roughness, MIN_DIRECT_ROUGHNESS);
    let alpha = saturate1(rc * rc + 0.5 * angRadius);
    lo += fSchlick(f0, vh) * (dGGX(nh, alpha) * vSmithGGXCorrelated(nv, ndl, alpha) * ndl);
  }
  return lo * e;
}
`,"./shaders/common/world_bindings.wgsl":`#include "common/math.wgsl"
#include "common/frame.wgsl"

// Group 1: world resources owned by the Renderer (see WorldBindings in src/render/contracts.ts).
@group(1) @binding(0)  var linearClamp : sampler;
@group(1) @binding(1)  var linearRepeat : sampler;
@group(1) @binding(2)  var terrainHeight : texture_2d<f32>;
@group(1) @binding(3)  var terrainMaxPyr : texture_2d<f32>;
@group(1) @binding(4)  var terrainNormalTex : texture_2d<f32>;
@group(1) @binding(5)  var terrainMapsTex : texture_2d<f32>;
@group(1) @binding(6)  var transmittanceLUT : texture_2d<f32>;
@group(1) @binding(7)  var multiScatterLUT : texture_2d<f32>;
@group(1) @binding(8)  var skyViewLUT : texture_2d<f32>;
@group(1) @binding(9)  var aerialPerspective : texture_3d<f32>;
@group(1) @binding(10) var blueNoise : texture_2d<f32>;

// World (x,z) -> continuous texel coordinates in the terrain grids.
fn terrainTexel(xz : vec2f) -> vec2f {
  return (xz - frame.terrainOrigin.xy) / frame.terrain.y;
}
fn terrainInside(xz : vec2f) -> bool {
  let t = terrainTexel(xz);
  return all(t >= vec2f(0.0)) && all(t <= vec2f(frame.terrain.x - 1.0));
}

fn terrainLoad(ij : vec2i) -> f32 {
  let n = i32(frame.terrain.x);
  return textureLoad(terrainHeight, clamp(ij, vec2i(0), vec2i(n - 1)), 0).x;
}

// Bilinear height matching the CPU TerrainSampler (triangulated cells: diagonal from (i,j) to (i+1,j+1)).
fn terrainHeightAt(xz : vec2f) -> f32 {
  let t = clamp(terrainTexel(xz), vec2f(0.0), vec2f(frame.terrain.x - 1.001));
  let i = vec2i(floor(t));
  let f = t - vec2f(i);
  let h00 = terrainLoad(i);
  let h10 = terrainLoad(i + vec2i(1, 0));
  let h01 = terrainLoad(i + vec2i(0, 1));
  let h11 = terrainLoad(i + vec2i(1, 1));
  // Two triangles split along the (0,0)-(1,1) diagonal.
  if (f.x >= f.y) { return h00 + (h10 - h00) * f.x + (h11 - h10) * f.y; }
  return h00 + (h11 - h01) * f.x + (h01 - h00) * f.y;
}

fn terrainNormalAt(xz : vec2f) -> vec3f {
  let uv = (terrainTexel(xz) + 0.5) / frame.terrain.x;
  let c = textureSampleLevel(terrainNormalTex, linearClamp, uv, 0.0);
  return normalize(c.xyz * 2.0 - 1.0);
}

// x = soil, y = flow, z = deposit, w = wetness
fn terrainMapsAt(xz : vec2f) -> vec4f {
  let uv = (terrainTexel(xz) + 0.5) / frame.terrain.x;
  return textureSampleLevel(terrainMapsTex, linearClamp, uv, 0.0);
}
`,"./shaders/lighting/deferred.wgsl":`// Deferred lighting compute pass: G-buffer + RT results -> pre-exposed HDR radiance. Writes EVERY pixel of \`hdr\` (sky pixels get 0,
// or the skyView LUT colour when FALLBACK_SKY is defined because no module draws the sky). Physical units in, pre-exposed out.
#include "common/world_bindings.wgsl"
#include "lighting/sky_safe.wgsl"
#include "common/pbr.wgsl"
#include "rt/rt_map.wgsl"
#include "park/lights.wgsl"
#include "park/shadows.wgsl"

@group(2) @binding(0) var gAlbedo : texture_2d<f32>;
@group(2) @binding(1) var gNormal : texture_2d<f32>;
@group(2) @binding(2) var gMisc : texture_2d<f32>;
@group(2) @binding(3) var gDepth : texture_depth_2d;
@group(2) @binding(4) var sunShadowTex : texture_2d<f32>;
@group(2) @binding(5) var giDiffuseTex : texture_2d<f32>;
@group(2) @binding(6) var giSpecularTex : texture_2d<f32>;
@group(2) @binding(7) var hdrOut : texture_storage_2d<rgba16float, write>;

const GRASS_MATERIAL : u32 = 2u;
const SWARD_FLOOR_MATERIAL : u32 = 11u;
const MAX_HDR : f32 = 60000.0;
const AMBIENT_SAMPLES : u32 = 16u;
const GROUND_ALBEDO : f32 = 0.15;
const HORIZON_EPS : f32 = -0.0145;
// A thin leaf reflects the ambient light that falls on its front and transmits (about 0.8 of that, LEAF_TRANSMITTANCE) what falls on its back; a crown's outer leaf sees
// a darker back, so 0.7 of the back-face share is taken (rt_scene.wgsl: the crown proxy's own scatter model). The back face's light comes from as open a sky as the front's,
// so it is taken in proportion to the leaf's openness: a leaf deep in a crown sees leaves behind it, not sky.
const LEAF_AMBIENT_BACK : f32 = 0.7;
// The baked and traced occlusion of a leaf is mostly other leaves, which are not black: they reflect and transmit about 0.22 (green) of what falls on them and
// that light is scattered on into the crown (multiple scattering), so the occluded part of the ambient is partly refilled. Only a quarter is refilled: with
// half, crown interiors came out nearly as bright as the outer leaves, flatter than any photograph of a crown. The refill is in proportion to the leaf's own
// openness too, since the light scattered into a pocket is what got into that part of the crown: a fixed refill held the deepest pockets at a third of the open
// ambient, 1.2 to 2 stops under the frame where photographs of crowns sit 4 to 5.
const LEAF_AO_FILL : f32 = 0.25;
// Near-field aerial perspective in shade: the share of in-scatter that is skylight rather than direct sun, and the distances (m) over which
// the shading of the air fades out (see the composite at the end of main).
const AP_SHADE_SKY_SHARE : f32 = 0.35;
const AP_SHADE_RANGE_M : vec2f = vec2f(60.0, 400.0);
// G-buffer material id of leaves (FOLIAGE_ID in vegetation/tree.wgsl, MAT_FOLIAGE in objects/track_materials.wgsl).
const FOLIAGE_MATERIAL : u32 = 5u;
// Share of a leaf's direct specular taken back when the eye looks straight toward the sun through it (see its use).
const LEAF_BACKLIT_GLINT_CUT : f32 = 0.85;
// A spray or leaf cluster is a porous volume: most mirror directions off a leaf run into its neighbours, so a translucent leaf reflects only
// this share of the sky the split-sum term gives an open surface, less again by the square of its occlusion (a leaf deep in the crown sees leaves in nearly
// every mirror direction, and those leaves are themselves in shade). Without it dark needles pick up a grey-blue sky sheen and read teal, and crown interiors a grey sheen that lifts their shadows.
const LEAF_SPECULAR_OCCLUSION : f32 = 0.35;

// Depth- and normal-aware upsample of the RT-resolution signals (sun shadow, GI, specular) to a full-resolution pixel. Every RT texel stands
// for the full-res pixel rtSourcePixel() picks this frame (the RT passes use the same mapping), so its depth and normal are re-read from the
// G-buffer there instead of binding the RT aux textures (this pass is at the 16 sampled-texture limit).
struct RtSample { shadow : f32, diffuse : vec4f, specular : vec4f };

const RT_DEPTH_SIGMA : f32 = 0.02;
const RT_NORMAL_POWER : f32 = 8.0;
const RT_MIN_WEIGHT : f32 = 1e-4;

// A non-finite texel (NaN * weight 0 is still NaN, so one would poison its whole bilinear footprint) reads as "no data", never as a black block.
fn finite4(v : vec4f) -> vec4f { return select(vec4f(0.0), v, abs(v) <= vec4f(MAX_HDR)); }

fn rtLoad(q : vec2i) -> RtSample {
  let shadow = textureLoad(sunShadowTex, q, 0).x;
  return RtSample(select(1.0, shadow, shadow >= 0.0 && shadow <= 1.0), finite4(textureLoad(giDiffuseTex, q, 0)), finite4(textureLoad(giSpecularTex, q, 0)));
}

// Specular is accumulated premultiplied by its confidence so an unconfident (zero) neighbour does not darken a confident one.
fn rtAdd(acc : ptr<function, RtSample>, s : RtSample, w : f32) {
  (*acc).shadow += s.shadow * w;
  (*acc).diffuse += s.diffuse * w;
  (*acc).specular += vec4f(s.specular.rgb * s.specular.a, s.specular.a) * w;
}

fn rtResolve(acc : RtSample, wSum : f32) -> RtSample {
  let inv = 1.0 / wSum;
  return RtSample(acc.shadow * inv, acc.diffuse * inv, vec4f(acc.specular.rgb / max(acc.specular.a, RT_MIN_WEIGHT), acc.specular.a * inv));
}

fn sampleRT(px : vec2i, uv : vec2f, depth : f32, world : vec3f, n : vec3f) -> RtSample {
  let rtDims = vec2i(textureDimensions(giDiffuseTex));
  let fullDims = vec2i(textureDimensions(gDepth));
  if (rtDims.x == fullDims.x && rtDims.y == fullDims.y) { return rtLoad(px); }
  let div = select(4, 2, (fullDims.x + 1) / 2 == rtDims.x);
  let z = frame.params.z / depth;
  let p = uv * vec2f(rtDims) - 0.5;
  let base = vec2i(floor(p));
  let f = p - floor(p);
  let hi = rtDims - vec2i(1);
  var bilateral = RtSample(0.0, vec4f(0.0), vec4f(0.0));
  var bilinear = bilateral;
  var wSum = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let q = clamp(base + o, vec2i(0), hi);
    let bil = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
    let s = rtLoad(q);
    rtAdd(&bilinear, s, bil);
    let src = rtSourcePixel(q, div, fullDims, frame.misc.x);
    let dq = textureLoad(gDepth, src, 0);
    if (dq <= 0.0) { continue; }
    let nq = octDecode(textureLoad(gNormal, src, 0).xy);
    // Distance to this pixel's tangent plane, not the depth difference: on a grazing slope a tap a pixel away is metres deeper yet still coplanar.
    let planeDist = abs(dot(n, worldFromDepth((vec2f(src) + 0.5) * frame.screen.zw, dq) - world));
    let w = bil * exp(-planeDist / (RT_DEPTH_SIGMA * z)) * pow(max(dot(n, nq), 0.0), RT_NORMAL_POWER);
    rtAdd(&bilateral, s, w);
    wSum += w;
  }
  if (wSum > RT_MIN_WEIGHT) { return rtResolve(bilateral, wSum); }
  return rtResolve(bilinear, 1.0);
}

// Radiance (nits, not pre-exposed) of the ground seen from above: a Lambertian bounce of the key lights and the zenith sky.
fn groundRadiance(sunE : vec3f, moonE : vec3f, zenithSky : vec3f) -> vec3f {
  let direct = sunE * max(frame.sunDir.y, 0.0) + moonE * max(frame.moonDir.y, 0.0);
  return GROUND_ALBEDO * (direct * INV_PI + 0.6 * zenithSky);
}

// Sky radiance above the horizon, blending into the estimated ground below it.
fn envRadiance(dir : vec3f, ground : vec3f) -> vec3f {
  return mix(skyNits(dir), ground, 1.0 - smoothstep(-0.08, 0.0, dir.y));
}

// Cosine-weighted mean of the environment around n == Lambert irradiance / pi (used when no GI is available).
fn ambientFallback(n : vec3f, px : vec2i, ground : vec3f) -> vec3f {
  let basis = basisFromNormal(n);
  // Golden-ratio shift per frame so TAA averages the 16-sample noise instead of seeing a frozen screen-space pattern.
  let rot = fract(textureLoad(blueNoise, vec2i(px.x & 127, px.y & 127), 0).x + f32(frame.misc.x & 63u) * 0.6180339887);
  var sum = vec3f(0.0);
  for (var i = 0u; i < AMBIENT_SAMPLES; i++) {
    let u = vec2f((f32(i) + 0.5) / f32(AMBIENT_SAMPLES), fract(f32(i) * 0.7548776662 + rot));
    sum += envRadiance(basis * cosineHemisphere(u), ground);
  }
  return sum / f32(AMBIENT_SAMPLES);
}

// Total exposure at the camera's full night gain, as NIGHT_TOTAL_EXPOSURE in objects/common.wgsl and objects/ledGlow.ts (a test keeps them equal).
const EMISSIVE_NIGHT_TOTAL_EXPOSURE : f32 = 1186.0;

// Emitted light of an emissive surface (gate LEDs, lamps) in pre-exposed units: the physical value while it stays under the cap the LED glow ribbons
// use (objects/ledGlow.ts glowShown), which holds its display level near 4x its strength, at most 2.2. By day the cap never bites; at night a raw
// 20000-nit strip is thousands of times past white, and its bloom whites out the screen as the drone flies through a gate.
fn emissiveShown(strength : f32, pre : f32) -> f32 {
  return min(strength * EMISSIVE_MAX_NITS * pre, clamp(strength * 4.0, 0.15, 2.2) * max(1.0, pre / EMISSIVE_NIGHT_TOTAL_EXPOSURE));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(hdrOut);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let px = vec2i(gid.xy);
  let uv = (vec2f(gid.xy) + 0.5) * frame.screen.zw;
  let pre = frame.params.y;
  let depth = textureLoad(gDepth, px, 0);
  if (depth <= 0.0) {
#ifdef FALLBACK_SKY
    textureStore(hdrOut, px, vec4f(min(finiteNits(sampleSkyView(viewRayDir(uv))) * pre, vec3f(MAX_HDR)), 1.0));
#else
    textureStore(hdrOut, px, vec4f(0.0, 0.0, 0.0, 1.0));
#endif
    return;
  }

  let alb = textureLoad(gAlbedo, px, 0);
  let nrm = textureLoad(gNormal, px, 0);
  let msc = textureLoad(gMisc, px, 0);
  let n = octDecode(nrm.xy);
  // Grass (material 2) has no wetness; its misc.b carries the blade's sun occlusion inside the sward (grass.wgsl), the shade the blades cast
  // on each other, which the ray-traced shadow does not see.
  // The turf between the blades (material 11) carries the same occlusion in misc.g, where other materials keep translucency.
  let matId = u32(msc.r * 255.0 + 0.5);
  let grassy = matId == GRASS_MATERIAL;
  let swardFloor = matId == SWARD_FLOOR_MATERIAL;
  // Trees (material 5) carry in misc.b the sunlight their bark's own relief shades (tree.wgsl: the furrows), and are never wet.
  let barkShade = select(0.0, saturate1(msc.b), matId == FOLIAGE_MATERIAL);
  let swardShade = max(select(select(0.0, saturate1(msc.g), swardFloor), saturate1(msc.b), grassy), barkShade);
  let translucency = select(msc.g, 0.0, swardFloor);
  let wet = select(msc.b, 0.0, grassy || matId == FOLIAGE_MATERIAL);
  let rough = clamp(nrm.z * mix(1.0, 0.4, wet), 0.02, 1.0);
  let metal = saturate1(nrm.w);
  let baseColor = alb.rgb * mix(1.0, 0.6, wet);
  let diffuseColor = baseColor * (1.0 - metal);
  let f0 = mix(vec3f(0.04), baseColor, metal);

  let world = worldFromDepth(uv, depth);
  let toCam = frame.camPos.xyz - world;
  let dist = length(toCam);
  let v = toCam / max(dist, 1e-4);
  let nv = max(dot(n, v), 1e-3);

  let r = atmosRadiusAtHeight(world.y);
  let sunOn = frame.sunIrradiance.w != 0.0;
  let moonUp = select(0.0, 1.0, frame.moonDir.y > HORIZON_EPS);
  var sunE = vec3f(0.0);
  var moonE = vec3f(0.0);
  // These are uniform light-enable gates, not intensity approximations. Keep the irradiance
  // values for the ground bounce below, but do not sample extinction for an inactive light.
  if (sunOn) { sunE = frame.sunIrradiance.rgb * frame.sunIrradiance.w * sampleTransmittance(r, frame.sunDir.y); }
  if (moonUp > 0.0) { moonE = frame.moonIrradiance.rgb * moonUp * sampleTransmittance(r, frame.moonDir.y); }

  let rt = sampleRT(px, uv, depth, world, n);
  let visibility = rt.shadow;
  let keyIsMoon = frame.misc.w == 1u;
  let sunVis = select(visibility, 1.0, keyIsMoon) * (1.0 - swardShade);
  let moonVis = select(1.0, visibility, keyIsMoon) * (1.0 - swardShade);
  var sunDirect = vec3f(0.0);
  var moonDirect = vec3f(0.0);
  // Leaves (material 5: trees, track foliage, park plants) pass yellow-green light; other translucent surfaces pass their own colour.
  let leafy = u32(msc.r * 255.0 + 0.5) == FOLIAGE_MATERIAL;
  let transmitColor = select(diffuseColor, leafTransmitColour(diffuseColor), leafy);
  if (sunOn) { sunDirect = directLight(frame.sunDir.xyz, n, v, diffuseColor, transmitColor, f0, rough, translucency, sunE * sunVis, frame.sunDir.w); }
  if (moonUp > 0.0) { moonDirect = directLight(frame.moonDir.xyz, n, v, diffuseColor, transmitColor, f0, rough, translucency, moonE * moonVis, frame.moonDir.w); }
  // A leaf between the eye and the sun glows: the forward-scattered part of what it transmits.
  if (sunOn && leafy) { sunDirect += leafForwardScatter(frame.sunDir.xyz, n, v, transmitColor, msc.g, sunE * sunVis) + leafBackDiffuse(frame.sunDir.xyz, n, v, transmitColor, msc.g, sunE * sunVis); }
  // Looking toward the sun through a crown, the single-normal leaf model sees grazing GGX highlights on nearly every card that faces the sun a
  // little, which turns whole sprays cream-white; a real canopy shows only a scatter of glints there, most leaves hidden by others or turned
  // away. That share of the specular is taken back as the view turns toward the sun.
  if (sunOn && leafy) { sunDirect -= directSpecular(frame.sunDir.xyz, n, v, f0, rough, sunE * sunVis, frame.sunDir.w) * (LEAF_BACKLIT_GLINT_CUT * smoothstep(0.0, 0.7, -dot(frame.sunDir.xyz, v))); }
  let direct = sunDirect + moonDirect;
  let indoor = parkRoom(world) >= 0;
  var litDirect = select(direct, vec3f(0.0), indoor);
  let lightRange = parkLightRange(world);
  for (var i = 0u; i < lightRange.y; i++) {
    let index = parkLightIndex(lightRange.x + i); let eLocal = parkIrradiance(world, index);
    if (eLocal.w < 0.05 || max(eLocal.x, max(eLocal.y, eLocal.z)) < 0.001) { continue; }
    let l = normalize(park.data[index * 2u].xyz - world);
    if (dot(n, l) > 0.0) { litDirect += directLight(l, n, v, diffuseColor, diffuseColor, f0, rough, 0.0, eLocal.rgb, 0.02) * parkShadow(world + n * 0.035, l, max(0.0, eLocal.w - 0.35)); }
  }

  let zenithSky = skyNits(vec3f(0.0, 1.0, 0.0));
  let ground = groundRadiance(sunE, moonE, zenithSky);
  let gd = rt.diffuse;
  let gs = rt.specular;
  var ao = alb.a;
  var irradianceOverPi : vec3f;
  if (gd.a > 0.0) {
    irradianceOverPi = gd.rgb;
    ao = ao * gd.a;
  } else {
    irradianceOverPi = ambientFallback(n, px, ground) * pre;
  }
  let reflDir = normalize(mix(reflect(-v, n), n, rough * rough));
  let specRadiance = mix(envRadiance(reflDir, ground) * pre, gs.rgb, saturate1(gs.a));
  let leafAmbient = (1.0 + LEAF_AMBIENT_BACK * LEAF_TRANSMITTANCE * translucency * ao) * mix(ao, 1.0, LEAF_AO_FILL * translucency * ao);
  var indirect = diffuseColor * irradianceOverPi * leafAmbient
               + specRadiance * envBrdfApprox(f0, rough, nv) * specularOcclusion(nv, ao, rough) * select(1.0, LEAF_SPECULAR_OCCLUSION * ao * ao, leafy && msc.g > 0.0);
  if (indoor) { indirect = diffuseColor * gd.rgb * leafAmbient + gs.rgb * gs.a * envBrdfApprox(f0, rough, nv); }

  var color = litDirect * pre + indirect + emissiveShown(msc.a, pre) * alb.rgb;
  let ap = sampleAerialPerspective(uv, dist);
  // The aerial-perspective volume treats all air as sunlit; the air between the camera and a shaded surface nearby is mostly in the same
  // shade (under and among the trees), so near it keeps only the skylight-scattered share of its in-scatter. Far away the path runs through
  // open sunlit air above the canopy and the volume's value stands.
  let apShade = mix(1.0, mix(AP_SHADE_SKY_SHARE, 1.0, saturate1(visibility)), 1.0 - smoothstep(AP_SHADE_RANGE_M.x, AP_SHADE_RANGE_M.y, dist));
  if (!indoor) { color = color * select(1.0, ap.a, ap.a >= 0.0 && ap.a <= 1.0) + finiteNits(ap.rgb) * pre * apShade; }
  textureStore(hdrOut, px, vec4f(clamp(color, vec3f(0.0), vec3f(MAX_HDR)), 1.0));
}
`,"./shaders/lighting/sky_safe.wgsl":`// Sky-view LUT lookups that survive fp16 overflow. The LUT (rgba16float) holds un-exposed nits; near a low sun the aureole exceeds 65504 nits and
// the red channel stores Inf (a 12 x 5 texel patch at azimuth 0 for a 5 degree sun). A bilinear tap with weight 0 on such a texel then yields
// NaN (Inf * 0), and every consumer that averages it (GI rays, radiance probes, temporal history) is poisoned for good. Anything the LUT cannot
// represent reads as its largest finite value.
#include "common/atmosphere_sample.wgsl"

const SKY_NITS_MAX : f32 = 65000.0;

fn finiteNits(c : vec3f) -> vec3f { return select(vec3f(SKY_NITS_MAX), c, abs(c) <= vec3f(SKY_NITS_MAX)); }

fn skyNits(dir : vec3f) -> vec3f { return finiteNits(sampleSkyView(dir)); }
`,"./shaders/objects/common.wgsl":`// Shared helpers of the objects module: G-buffer packing, value noise, small SDFs and screen-space bump mapping.
#include "common/world_bindings.wgsl"

struct GOut {
  @location(0) albedo : vec4f,
  @location(1) normal : vec4f,
  @location(2) misc : vec4f,
  @location(3) motion : vec2f,
};

// Everything a material function decides about a pixel; packG turns it into the four G-buffer targets.
struct Surf {
  albedo : vec3f,
  ao : f32,
  normal : vec3f,
  roughness : f32,
  metalness : f32,
  emissive : f32,
  translucency : f32,
  material : u32,
};

// Total exposure (pre-exposure x exposure ratio) at the camera's full night gain: 2^(maxGainEv + DAY_TOTAL_EV) in post/exposure.ts, kept equal by a test.
const NIGHT_TOTAL_EXPOSURE : f32 = 1186.0;

// Display level (after exposure, 1 = clipping) the core of an LED glow may reach for an emissive strength; mirrored in objects/ledGlow.ts.
fn ledDisplay(strength : f32) -> f32 {
  return clamp(strength * 4.0, 0.15, 2.2);
}

// Glow level in pre-exposed units: the physical value while it stays under the cap, which holds the display level near ledDisplay (an uncapped
// halo clips to white, losing the LED colour, and overflows fp16 under the night pre-exposure). The exposure ratio is at most NIGHT_TOTAL_EXPOSURE / pre.
fn glowShown(strength : f32, energy : f32) -> f32 {
  let pre = frame.params.y;
  return min(strength * EMISSIVE_MAX_NITS * 0.35 * energy * pre, ledDisplay(strength) * max(1.0, pre / NIGHT_TOTAL_EXPOSURE));
}

// Camera distance (m) over which a gate's glow ribbons fade in, mirrored in objects/ledGlow.ts. A ribbon a metre from the lens would sweep across most
// of the screen at full strength and white out the frame at night as the drone flies through; the LED strip itself stays lit.
const GLOW_NEAR_FADE_M : vec2f = vec2f(1.0, 5.0);

fn glowNearFade(dist : f32) -> f32 {
  return smoothstep(GLOW_NEAR_FADE_M.x, GLOW_NEAR_FADE_M.y, dist);
}

fn uvOfClip(clip : vec4f) -> vec2f {
  let ndc = clip.xy / clip.w;
  return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

fn packG(s : Surf, prevClip : vec4f, currClip : vec4f) -> GOut {
  var o : GOut;
  o.albedo = vec4f(clamp(s.albedo, vec3f(0.0), vec3f(1.0)), saturate1(s.ao));
  o.normal = vec4f(octEncode(s.normal), saturate1(s.roughness), saturate1(s.metalness));
  o.misc = vec4f(f32(s.material) / 255.0, saturate1(s.translucency), 0.0, saturate1(s.emissive));
  let ok = prevClip.w > 1e-4 && currClip.w > 1e-4;
  o.motion = select(vec2f(0.0), uvOfClip(prevClip) - uvOfClip(currClip), ok);
  return o;
}

fn newSurf(albedo : vec3f, n : vec3f, roughness : f32, material : u32) -> Surf {
  return Surf(albedo, 1.0, n, roughness, 0.0, 0.0, 0.0, material);
}

fn vnoise2(p : vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let c = bitcast<vec2u>(vec2i(i));
  let a = hash21(c);
  let b = hash21(c + vec2u(1u, 0u));
  let d = hash21(c + vec2u(0u, 1u));
  let e = hash21(c + vec2u(1u, 1u));
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}

fn vnoise3(p : vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let c = bitcast<vec3u>(vec3i(i));
  let a = mix(mix(hash31(c), hash31(c + vec3u(1u, 0u, 0u)), u.x), mix(hash31(c + vec3u(0u, 1u, 0u)), hash31(c + vec3u(1u, 1u, 0u)), u.x), u.y);
  let b = mix(mix(hash31(c + vec3u(0u, 0u, 1u)), hash31(c + vec3u(1u, 0u, 1u)), u.x), mix(hash31(c + vec3u(0u, 1u, 1u)), hash31(c + vec3u(1u, 1u, 1u)), u.x), u.y);
  return mix(a, b, u.z);
}

fn fbm2(p : vec2f) -> f32 {
  return 0.5 * vnoise2(p) + 0.25 * vnoise2(p * 2.03 + 17.0) + 0.125 * vnoise2(p * 4.01 + 41.0) + 0.0625 * vnoise2(p * 8.07 + 73.0);
}

fn fbm3(p : vec3f) -> f32 {
  return 0.5 * vnoise3(p) + 0.25 * vnoise3(p * 2.03 + 17.0) + 0.125 * vnoise3(p * 4.01 + 41.0) + 0.0625 * vnoise3(p * 8.07 + 73.0);
}

// Signed distance to an axis-aligned box of half extents b centred at the origin.
fn sdBox(p : vec2f, b : vec2f) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}

// Anti-aliased coverage of a signed distance given the pixel footprint (metres).
fn sdCover(d : f32, footprint : f32) -> f32 {
  return saturate1(0.5 - d / max(footprint, 1e-5));
}

// Gradients of the uv coordinates on the surface, in world space. dp1/dp2 are dpdx/dpdy of the world position and duv1/duv2
// the same for uv; dividing by the determinant makes the result independent of the derivative sign convention.
struct UvGrad {
  gu : vec3f,
  gv : vec3f,
};

fn uvGradients(dp1 : vec3f, dp2 : vec3f, duv1 : vec2f, duv2 : vec2f, n : vec3f) -> UvGrad {
  let c2 = cross(dp2, n);
  let c1 = cross(n, dp1);
  let det = dot(dp1, c2);
  if (abs(det) < 1e-20) { return UvGrad(vec3f(0.0), vec3f(0.0)); }
  let k = 1.0 / det;
  return UvGrad((duv1.x * c2 + duv2.x * c1) * k, (duv1.y * c2 + duv2.y * c1) * k);
}

// Perturbs n for a height field whose uv partial derivatives are hu, hv (metres of height per metre of uv).
fn bumpNormal(n : vec3f, g : UvGrad, hu : f32, hv : f32) -> vec3f {
  return normalize(n - (hu * g.gu + hv * g.gv));
}

// Perturbs n by the world-space gradient of a scalar height field.
fn bumpFromGradient(n : vec3f, grad : vec3f) -> vec3f {
  return normalize(n - (grad - n * dot(grad, n)));
}
`,"./shaders/objects/glow.wgsl":`// Forward pass: additive camera-facing glow ribbons along the gate LED strips (a stand-in for bloom so the strips read as light sources).
#include "objects/track_bindings.wgsl"
#include "common/atmosphere_sample.wgsl"

struct GlowOut {
  @builtin(position) pos : vec4f,
  @location(0) side : f32,
  @location(1) @interpolate(flat) gate : u32,
  @location(2) halfWidth : f32,
  @location(3) dist : f32,
};

@vertex fn vsGlow(@location(0) p : vec3f, @location(1) t : vec3f, @location(2) sg : vec2f) -> GlowOut {
  let toCam = frame.camPos.xyz - p;
  let dist = length(toCam);
  let dirCam = toCam / max(dist, 1e-4);
  let r = cross(t, dirCam);
  let rl = length(r);
  let right = select(vec3f(0.0, 1.0, 0.0), r / max(rl, 1e-6), rl > 1e-4);
  let halfWidth = 0.02 + 0.008 * dist;
  var o : GlowOut;
  o.pos = frame.viewProj * vec4f(p + right * (sg.x * halfWidth) + dirCam * 0.012, 1.0);
  o.side = sg.x;
  o.gate = u32(sg.y + 0.5);
  o.halfWidth = halfWidth;
  o.dist = dist;
  return o;
}

@fragment fn fsGlow(in : GlowOut) -> @location(0) vec4f {
  let led = gateLed(in.gate);
  let s2 = in.side * in.side;
  let profile = (1.0 - s2) * (1.0 - s2) * exp(-2.0 * s2);
  let energy = clamp(0.04 / in.halfWidth, 0.25, 1.0);
  let ap = sampleAerialPerspective(in.pos.xy * frame.screen.zw, in.dist);
  let shown = glowShown(led.a, energy) * glowNearFade(in.dist);
  return vec4f(led.rgb * (shown * profile) * ap.a, 0.0);
}
`,"./shaders/objects/quad.wgsl":`// Quad G-buffer pipelines: the rigid body mesh and the spinning props, both moved by the model matrix from group 2.
#include "objects/quad_materials.wgsl"

const PROP_TIP_START : f32 = \${PROP_R} * 0.86;

struct BodyOut {
  @builtin(position) pos : vec4f,
  @location(0) obj : vec3f,
  @location(1) nrm : vec3f,
  @location(2) uv : vec2f,
  @location(3) ao : f32,
  @location(4) @interpolate(flat) a2 : f32,
  @location(5) @interpolate(flat) kind : u32,
  @location(6) prevClip : vec4f,
  @location(7) currClip : vec4f,
};

@vertex fn vsBody(@location(0) p : vec3f, @location(1) n : vec3f, @location(2) uv : vec2f, @location(3) attr : vec4f) -> BodyOut {
  var o : BodyOut;
  let w = quad.model * vec4f(p, 1.0);
  o.pos = frame.viewProj * w;
  o.obj = p;
  o.nrm = n;
  o.uv = uv;
  o.ao = attr.y;
  o.a2 = attr.z;
  o.kind = u32(attr.x + 0.5);
  o.prevClip = frame.prevViewProj * (quad.prevModel * vec4f(p, 1.0));
  o.currClip = frame.viewProjUnjittered * w;
  return o;
}

fn matIn(p : vec3f, n : vec3f, uv : vec2f, ao : f32, a2 : f32, kind : u32, fp : f32) -> MatIn {
  var m : MatIn;
  m.p = p;
  m.n = normalize(n);
  m.uv = uv;
  m.ao = ao;
  m.a2 = a2;
  m.kind = kind;
  m.fp = fp;
  return m;
}

@fragment fn fsBody(in : BodyOut) -> GOut {
  let fp = max(length(dpdx(in.obj)), length(dpdy(in.obj)));
  var s = shadeQuad(matIn(in.obj, in.nrm, in.uv, in.ao, in.a2, in.kind, fp));
  s.normal = normalize(quadRot() * s.normal);
  return packG(s, in.prevClip, in.currClip);
}

// ---- props ----

struct PropOut {
  @builtin(position) pos : vec4f,
  @location(0) local : vec3f,
  @location(1) nrm : vec3f,
  @location(2) ao : f32,
  @location(3) @interpolate(flat) kind : u32,
  @location(4) @interpolate(flat) motor : u32,
  @location(5) prevClip : vec4f,
  @location(6) currClip : vec4f,
};

// The clockwise mesh is drawn for instances 0 and 1 (motors 0 and 2), the counter-clockwise mesh for instances 2 and 3 (motors 1 and 3).
fn motorOfInstance(ii : u32) -> u32 {
  return select(2u * ii, 2u * (ii - 2u) + 1u, ii >= 2u);
}

@vertex fn vsProp(@location(0) p : vec3f, @location(1) n : vec3f, @location(2) uv : vec2f, @location(3) attr : vec4f, @builtin(instance_index) ii : u32) -> PropOut {
  let motor = motorOfInstance(ii);
  let sp = quad.spin[motor];
  let centre = quad.prop[motor].xyz;
  let rot = rotY(sp.x);
  let w = quad.model * vec4f(centre + rot * p, 1.0);
  var o : PropOut;
  o.pos = frame.viewProj * w;
  o.local = p;
  o.nrm = quadRot() * (rot * n);
  o.ao = attr.y;
  o.kind = u32(attr.x + 0.5);
  o.motor = motor;
  // Only blades carry their own spin in the motion vector; the hub is round, and a whole-turn jump would smear it.
  var prevRot = rot;
  if (o.kind == \${K_PROP}u) { prevRot = rotY(sp.y); }
  o.prevClip = frame.prevViewProj * (quad.prevModel * vec4f(centre + prevRot * p, 1.0));
  o.currClip = frame.viewProjUnjittered * w;
  return o;
}

fn bladeSurf(motor : u32, local : vec3f, n : vec3f, ao : f32) -> Surf {
  var s = newSurf(vec3f(0.045, 0.043, 0.042), normalize(n), 0.22, MAT_QUAD);
  // Front props (motors 0 and 3) get bright tips so the quad's heading reads from behind.
  let front = motor == 0u || motor == 3u;
  let tip = smoothstep(PROP_TIP_START, PROP_TIP_START + 0.004, length(local.xz));
  s.albedo = mix(s.albedo, select(vec3f(0.07, 0.07, 0.075), vec3f(0.9, 0.14, 0.02), front), tip);
  s.translucency = 0.25;
  s.ao = ao;
  return s;
}

@fragment fn fsProp(in : PropOut) -> GOut {
  let fp = max(length(dpdx(in.local)), length(dpdy(in.local)));
  let sp = quad.spin[in.motor];
  let blade = in.kind == \${K_PROP}u;
  // Blades thin out stochastically as the rotor speeds up (TAA integrates it into a fade); the hub and nut always stay.
  let noise = hash21(vec2u(in.pos.xy) + vec2u(pcg(frame.misc.x), 0u));
  if (blade && noise >= sp.z) { discard; }
  var s : Surf;
  if (blade) {
    s = bladeSurf(in.motor, in.local, in.nrm, in.ao);
  } else if (in.kind == \${K_STEEL}u) {
    s = steelSurf(matIn(in.local, in.nrm, vec2f(0.0), in.ao, 0.0, in.kind, fp), newSurf(vec3f(0.5), normalize(in.nrm), 0.5, MAT_QUAD));
  } else {
    s = newSurf(vec3f(0.03, 0.03, 0.034), normalize(in.nrm), 0.4, MAT_QUAD);
    s.ao = in.ao;
  }
  return packG(s, in.prevClip, in.currClip);
}
`,"./shaders/objects/quad_bindings.wgsl":`// Group 2 of the quad pipelines: model matrices, prop angles, LED state, plus the input struct shared by the material functions.
#include "objects/common.wgsl"

struct QuadU {
  model : mat4x4f,
  prevModel : mat4x4f,
  hub : array<vec4f, 4>,    // xyz = motor hub in body coordinates
  prop : array<vec4f, 4>,   // xyz = rotor plane centre in body coordinates
  spin : array<vec4f, 4>,   // x = angle about +Y, y = previous angle (rad), z = solid blade fraction, w = blur disc alpha
  led : array<vec4f, 4>,    // rgb = colour, a = emissive strength (fraction of EMISSIVE_MAX_NITS), rear left / right, front left / right
  sprite : array<vec4f, 5>, // xyz = body space anchor of the four LEDs and the lens glint, w = sprite radius at zero distance
  lens : vec4f,             // xyz = lens axis in body coordinates, w = sun glint strength
};

@group(2) @binding(0) var<uniform> quad : QuadU;

const MAT_QUAD : u32 = 4u;
const MAT_EMISSIVE : u32 = 7u;

struct MatIn {
  p : vec3f,   // body space position (origin at the centre of mass)
  n : vec3f,   // body space unit normal
  uv : vec2f,
  ao : f32,
  a2 : f32,
  kind : u32,
  fp : f32,    // pixel footprint in metres
};

fn quadRot() -> mat3x3f {
  return mat3x3f(quad.model[0].xyz, quad.model[1].xyz, quad.model[2].xyz);
}

// Rotation by a counter-clockwise (seen from above) angle about +Y; matches affineRotY on the CPU.
fn rotY(a : f32) -> mat3x3f {
  let c = cos(a);
  let s = sin(a);
  return mat3x3f(vec3f(c, 0.0, -s), vec3f(0.0, 1.0, 0.0), vec3f(s, 0.0, c));
}
`,"./shaders/objects/quad_carbon.wgsl":`// Carbon fibre of the frame plates and arms: a 2x2 twill weave with rounded tows that dive under their neighbours, evaluated in body space.
#include "objects/quad_bindings.wgsl"

const TOW : f32 = 0.0016;
const WEAVE_HEIGHT : f32 = 0.00025;

fn towProfile(t : f32) -> f32 {
  let x = 2.0 * t - 1.0;
  return sqrt(max(1.0 - x * x, 0.0));
}

// The warp tow (running along v) is on top in cell c; the pattern shifts by one cell per row, which gives the twill diagonal.
fn warpOver(c : vec2i) -> bool {
  return ((c.x + c.y) & 3) < 2;
}

// x = height in [0, 1], y = tone (the warp reads lighter than the weft), z = tow cross section profile, w = per cell random.
fn twill(uv : vec2f) -> vec4f {
  let cf = floor(uv);
  let c = vec2i(cf);
  let f = uv - cf;
  let over = warpOver(c);
  let across = select(f.y, f.x, over);
  let along = select(f.x, f.y, over);
  let lowUnder = select(warpOver(c + vec2i(-1, 0)), !warpOver(c + vec2i(0, -1)), over);
  let highUnder = select(warpOver(c + vec2i(1, 0)), !warpOver(c + vec2i(0, 1)), over);
  let dive = select(1.0, smoothstep(0.0, 0.45, along), lowUnder) * select(1.0, smoothstep(0.0, 0.45, 1.0 - along), highUnder);
  let prof = towProfile(across);
  let h = (0.25 + 0.75 * prof) * (0.35 + 0.65 * dive);
  let rnd = hash21(bitcast<vec2u>(c));
  return vec4f(h, select(0.7, 1.0, over), prof, rnd);
}

fn carbonSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_QUAD;
  let top = smoothstep(0.5, 0.85, abs(m.n.y));
  let uv = m.p.xz / TOW;
  // Past a few pixels per tow the weave averages out instead of aliasing.
  let fade = 1.0 - smoothstep(0.35, 0.8, m.fp / TOW);
  let w0 = twill(uv);
  let e = 0.05;
  let wu = twill(uv + vec2f(e, 0.0));
  let wv = twill(uv + vec2f(0.0, e));
  let d = clamp(vec2f(wu.x - w0.x, wv.x - w0.x) / e, vec2f(-4.0), vec2f(4.0));
  o.normal = bumpFromGradient(m.n, vec3f(d.x, 0.0, d.y) * (WEAVE_HEIGHT / TOW * fade * top));

  let tone = mix(0.85, w0.y, fade);
  let gap = mix(1.0, 0.5 + 0.5 * w0.z, fade);
  let variation = mix(1.0, 0.88 + 0.24 * w0.w, fade);
  let face = vec3f(0.034, 0.035, 0.04) * (tone * gap * variation);
  // Cut edges show the laminate: lighter, rougher, and banded by ply.
  let ply = vnoise2(vec2f(m.p.y * 3000.0, (m.p.x + m.p.z) * 400.0));
  let edge = vec3f(0.05, 0.05, 0.056) * (0.82 + 0.36 * mix(0.5, ply, fade));
  o.albedo = mix(edge, face, top);
  o.roughness = mix(0.55, 0.27, top);
  return o;
}
`,"./shaders/objects/quad_forward.wgsl":`// Quad forward pass: smoky blur discs where the props spin too fast to see, and additive glow sprites on the LEDs and the camera lens.
#include "objects/quad_bindings.wgsl"
#include "common/atmosphere_sample.wgsl"

const DISC_R : f32 = \${PROP_R} * 1.04;
const DISC_ALBEDO : vec3f = vec3f(0.06, 0.057, 0.055);

// Corner of the unit quad for the six vertices of two triangles.
fn cornerOf(vi : u32) -> vec2f {
  return vec2f(select(-1.0, 1.0, vi == 1u || vi == 2u || vi == 4u), select(-1.0, 1.0, vi == 2u || vi == 4u || vi == 5u));
}

struct DiscOut {
  @builtin(position) pos : vec4f,
  @location(0) rel : vec2f,
  @location(1) world : vec3f,
  @location(2) @interpolate(flat) motor : u32,
};

@vertex fn vsDisc(@builtin(vertex_index) vi : u32, @builtin(instance_index) motor : u32) -> DiscOut {
  let c = cornerOf(vi);
  let centre = quad.prop[motor].xyz;
  let w = quad.model * vec4f(centre + vec3f(c.x, 0.0, c.y) * DISC_R, 1.0);
  var o : DiscOut;
  o.pos = frame.viewProj * w;
  o.rel = c;
  o.world = w.xyz;
  o.motor = motor;
  return o;
}

@fragment fn fsDisc(in : DiscOut) -> @location(0) vec4f {
  let r = length(in.rel);
  // Empty over the hub, densest toward the tip ring, soft at the rim: blades spend the most time out there.
  let profile = smoothstep(0.14, 0.3, r) * (0.55 + 0.45 * smoothstep(0.55, 0.95, r)) * (1.0 - smoothstep(0.93, 1.0, r));
  let alpha = quad.spin[in.motor].w * profile;
  if (alpha < 1e-4) { discard; }
  let axis = normalize(quadRot() * vec3f(0.0, 1.0, 0.0));
  let rAtm = atmosRadiusAtHeight(in.world.y);
  let sun = frame.sunIrradiance.rgb * frame.sunIrradiance.w * sampleTransmittance(rAtm, frame.sunDir.y) * abs(dot(axis, frame.sunDir.xyz));
  let moonUp = select(0.0, 1.0, frame.moonDir.y > 0.0);
  let moon = frame.moonIrradiance.rgb * moonUp * sampleTransmittance(rAtm, max(frame.moonDir.y, 0.0)) * abs(dot(axis, frame.moonDir.xyz));
  let sky = sampleSkyView(vec3f(0.0, 1.0, 0.0));
  let lit = DISC_ALBEDO * ((sun + moon) * INV_PI + sky) * frame.params.y;
  let dist = length(frame.camPos.xyz - in.world);
  let ap = sampleAerialPerspective(in.pos.xy * frame.screen.zw, dist);
  return vec4f((lit * ap.a + ap.rgb * frame.params.y) * alpha, alpha);
}

struct SpriteOut {
  @builtin(position) pos : vec4f,
  @location(0) rel : vec2f,
  @location(1) @interpolate(flat) id : u32,
  @location(2) dist : f32,
  @location(3) facing : f32,
};

@vertex fn vsSprite(@builtin(vertex_index) vi : u32, @builtin(instance_index) id : u32) -> SpriteOut {
  let c = cornerOf(vi);
  let a = quad.sprite[id];
  let anchor = (quad.model * vec4f(a.xyz, 1.0)).xyz;
  let toCam = frame.camPos.xyz - anchor;
  let dist = length(toCam);
  let dirCam = toCam / max(dist, 1e-4);
  let right = vec3f(frame.view[0][0], frame.view[1][0], frame.view[2][0]);
  let up = vec3f(frame.view[0][1], frame.view[1][1], frame.view[2][1]);
  let radius = a.w + 0.006 * dist;
  // Pulled toward the camera so the glow is not cut by the part it sits on; hidden by \`facing\` when that part is between it and the eye.
  let w = anchor + dirCam * 0.006 + (right * c.x + up * c.y) * radius;
  let normal = select(vec3f(0.0, 1.0, 0.0), quad.lens.xyz, id == 4u);
  var o : SpriteOut;
  o.pos = frame.viewProj * vec4f(w, 1.0);
  o.rel = c;
  o.id = id;
  o.dist = dist;
  o.facing = smoothstep(-0.1, 0.3, dot(dirCam, normalize(quadRot() * normal)));
  return o;
}

// Display value of the sun's reflection in the lens dome: brightest when the half vector between sun and eye lines up with the lens axis.
fn lensGlint(dirCam : vec3f) -> f32 {
  let axis = normalize(quadRot() * quad.lens.xyz);
  let h = normalize(dirCam + frame.sunDir.xyz);
  let sunT = sampleTransmittance(atmosRadiusAtHeight(frame.camPos.y), max(frame.sunDir.y, 0.0));
  return quad.lens.w * pow(saturate1(dot(h, axis)), 24.0) * frame.sunIrradiance.w * saturate1(luminance(sunT) * 2.0);
}

@fragment fn fsSprite(in : SpriteOut) -> @location(0) vec4f {
  let r2 = dot(in.rel, in.rel);
  let k = max(1.0 - r2, 0.0);
  let profile = k * k * exp(-2.0 * r2);
  var colour = vec3f(1.0, 0.97, 0.9);
  var shown = 0.0;
  if (in.id < 4u) {
    let led = quad.led[in.id];
    colour = led.rgb;
    shown = glowShown(led.a, 1.0);
  } else {
    shown = lensGlint(normalize(frame.camPos.xyz - (quad.model * vec4f(quad.sprite[4].xyz, 1.0)).xyz));
  }
  let ap = sampleAerialPerspective(in.pos.xy * frame.screen.zw, in.dist);
  return vec4f(colour * (shown * profile * in.facing) * ap.a, 0.0);
}
`,"./shaders/objects/quad_materials.wgsl":`// Material dispatch of the quad by per vertex kind (K_* defines from materials.ts).
#include "objects/quad_carbon.wgsl"
#include "objects/quad_parts.wgsl"

fn shadeQuad(m : MatIn) -> Surf {
  var s = newSurf(vec3f(0.5), m.n, 0.5, MAT_QUAD);
  s.ao = m.ao;
  switch (m.kind) {
    case \${K_CARBON}u: { s = carbonSurf(m, s); }
    case \${K_ALU}u: { s = aluSurf(m, s); }
    case \${K_PCB}u: { s = pcbSurf(m, s); }
    case \${K_BATTERY}u: { s = batterySurf(m, s); }
    case \${K_RUBBER}u: { s = rubberSurf(m, s); }
    case \${K_MOTOR_BELL}u: { s = bellSurf(m, s); }
    case \${K_MOTOR_BASE}u: { s = baseSurf(m, s); }
    case \${K_PLASTIC}u: { s = plasticSurf(m, s); }
    case \${K_LENS}u: { s = lensSurf(m, s); }
    case \${K_LED}u: { s = ledSurf(m, s); }
    case \${K_WIRE}u: { s = wireSurf(m, s); }
    case \${K_STEEL}u: { s = steelSurf(m, s); }
    default: {}
  }
  return s;
}
`,"./shaders/objects/quad_parts.wgsl":`// Materials of the quad other than carbon: machined and anodised aluminium, circuit boards, battery, rubber, motors and small parts.
// All evaluated in body space; the material variant is per vertex a2.
#include "objects/quad_bindings.wgsl"

const GOLD : vec3f = vec3f(1.0, 0.78, 0.34);

fn variantOf(m : MatIn) -> u32 {
  return u32(m.a2 + 0.5);
}

// Fine grain of machined metal, faded out when a pixel spans more than the grain.
fn metalGrain(m : MatIn) -> f32 {
  return 1.0 + 0.1 * (vnoise3(m.p * 1800.0) - 0.5) * (1.0 - smoothstep(0.3, 1.0, m.fp / 0.0006));
}

fn aluSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_QUAD;
  let v = variantOf(m);
  let grain = metalGrain(m);
  o.metalness = 1.0;
  if (v == 1u) {
    o.albedo = vec3f(0.82, 0.13, 0.015) * grain;
    o.roughness = 0.34;
  } else if (v == 2u) {
    o.albedo = vec3f(0.06, 0.06, 0.065) * grain;
    o.roughness = 0.42;
  } else {
    o.albedo = vec3f(0.78, 0.79, 0.8) * grain;
    o.roughness = 0.3;
  }
  return o;
}

fn steelSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_QUAD;
  let gold = variantOf(m) == 1u;
  o.albedo = select(vec3f(0.62, 0.62, 0.64), GOLD, gold) * metalGrain(m);
  o.roughness = select(0.32, 0.3, gold);
  o.metalness = 1.0;
  return o;
}

// Solder mask with gold pads and copper traces on a 2.5 mm grid; the board edge shows raw fibreglass.
fn pcbSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_QUAD;
  let v = variantOf(m);
  var mask = vec3f(0.012, 0.013, 0.015);
  if (v == 1u) {
    mask = vec3f(0.008, 0.075, 0.03);
  } else if (v == 2u) {
    mask = vec3f(0.014, 0.02, 0.05);
  }
  let flatFace = smoothstep(0.7, 0.9, abs(m.n.y));
  let cs = 0.0025;
  let g = m.p.xz / cs;
  let cell = floor(g);
  let f = g - cell;
  let h = hash21(bitcast<vec2u>(vec2i(cell)) + vec2u(v * 977u + 13u, 29u));
  let fpc = m.fp;
  let pad = sdCover(length(f - 0.5) * cs - 0.00065, fpc) * step(0.62, h);
  let along = select(f.x, f.y, h < 0.46);
  let trace = sdCover(abs(along - 0.5) * cs - 0.00013, fpc) * step(0.3, h) * step(h, 0.62);
  let speck = 0.8 + 0.4 * vnoise2(m.p.xz * 900.0);
  let copper = mask * 2.6 + vec3f(0.012, 0.006, 0.0);
  let face = mix(mix(mask * speck, copper, trace), GOLD, pad);
  let fibre = vec3f(0.24, 0.2, 0.1) * (0.8 + 0.4 * vnoise2(vec2f(m.p.y * 1200.0, m.p.x + m.p.z) * 300.0));
  o.albedo = mix(fibre, face, flatFace);
  o.roughness = mix(0.7, mix(0.5, 0.3, pad), flatFace);
  o.metalness = pad * flatFace;
  return o;
}

// Black shrink wrap with a printed label on top (uv is the position on the pack face in metres) and a stripe along the sides.
fn batterySurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_QUAD;
  var col = vec3f(0.011, 0.011, 0.012) * (0.85 + 0.3 * fbm2(m.uv * 260.0));
  o.roughness = 0.42;
  let topFace = smoothstep(0.6, 0.85, m.n.y);
  if (topFace > 0.0) {
    let p = m.uv;
    let label = sdCover(sdBox(p, vec2f(0.0148, 0.0325)), m.fp);
    let band = sdCover(sdBox(p - vec2f(0.0, -0.0215), vec2f(0.0148, 0.0105)), m.fp);
    let logo = sdCover(length(p - vec2f(0.0, -0.0215)) - 0.0048, m.fp);
    let t = (p.y + 0.008) / 0.0052;
    let row = floor(t);
    let rowHash = hash11(u32(max(row, 0.0)) + 7u);
    let barHalf = 0.0012 + 0.0085 * rowHash;
    let bar = sdBox(vec2f(p.x + 0.0128 - barHalf, (fract(t) - 0.5) * 0.0052), vec2f(barHalf, 0.0011));
    let inRows = step(0.0, row) * step(row, 4.0);
    let text = sdCover(bar, m.fp) * inRows;
    var art = mix(vec3f(0.03, 0.03, 0.033), vec3f(0.55, 0.025, 0.02), band);
    art = mix(art, vec3f(0.82, 0.82, 0.8), max(logo, text));
    col = mix(col, art, label * topFace);
    o.roughness = mix(0.42, 0.35, label * topFace);
  }
  let sideFace = smoothstep(0.6, 0.85, abs(m.n.x));
  if (sideFace > 0.0) {
    col = mix(col, vec3f(0.5, 0.03, 0.025), sdCover(abs(m.uv.y) - 0.0016, m.fp) * sideFace);
  }
  o.albedo = col;
  return o;
}

fn rubberSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_QUAD;
  let strap = variantOf(m) == 1u;
  let fine = vnoise3(m.p * 700.0);
  o.albedo = select(vec3f(0.02), vec3f(0.014, 0.014, 0.016), strap) * (0.75 + 0.5 * mix(0.5, fine, 1.0 - smoothstep(0.3, 1.0, m.fp / 0.0014)));
  o.roughness = select(0.95, 0.7, strap);
  return o;
}

// Gunmetal bell: six painted kidney slots and turning rings on the top, grooves and an orange band on the wall, bare steel bearing dome.
fn bellSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_QUAD;
  let rel = m.p - quad.hub[variantOf(m) & 3u].xyz;
  let r = length(rel.xz);
  let yF = m.p.y + \${COM_Y};
  let sector = TAU / 6.0;
  let toSlot = abs(fract(atan2(rel.z, rel.x) / sector + 0.5) - 0.5) * sector;
  let top = smoothstep(0.6, 0.85, m.n.y);
  let wall = 1.0 - smoothstep(0.2, 0.5, abs(m.n.y));
  let slot = sdCover(sdBox(vec2f(toSlot * r, r - 0.0098), vec2f(0.003, 0.0007)) - 0.0004, m.fp) * top;
  let g0 = sdCover(abs(yF - 0.008) - 0.00035, m.fp);
  let g1 = sdCover(abs(yF - 0.01) - 0.00035, m.fp);
  let g2 = sdCover(abs(yF - 0.012) - 0.00035, m.fp);
  let groove = max(g0, max(g1, g2)) * wall;
  let band = sdCover(abs(yF - 0.01425) - 0.00075, m.fp) * wall;
  let rings = 1.0 + 0.07 * sin(r * 10500.0) * (1.0 - smoothstep(0.3, 0.9, m.fp / 0.0006)) * top;
  let paint = max(slot, groove);
  var col = mix(vec3f(0.11, 0.115, 0.13) * rings, vec3f(0.85, 0.14, 0.015), band);
  let dome = step(r, 0.0062) * step(0.0182, yF);
  col = mix(col, vec3f(0.006), paint);
  col = mix(col, vec3f(0.68, 0.68, 0.7), dome);
  o.albedo = col;
  o.metalness = 1.0 - paint;
  o.roughness = mix(0.32, 0.6, paint);
  o.ao = m.ao * mix(1.0, 0.45, slot);
  return o;
}

fn baseSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_QUAD;
  o.albedo = vec3f(0.035, 0.035, 0.04) * metalGrain(m);
  o.metalness = 0.85;
  o.roughness = 0.4;
  return o;
}

fn plasticSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_QUAD;
  let v = variantOf(m);
  o.albedo = vec3f(0.015);
  o.roughness = 0.55;
  if (v == 1u) {
    o.albedo = vec3f(0.85, 0.6, 0.02);
    o.roughness = 0.4;
  } else if (v == 2u) {
    o.albedo = vec3f(0.04, 0.04, 0.045);
    o.roughness = 0.5;
  } else if (v == 3u) {
    o.albedo = vec3f(0.65, 0.64, 0.6);
    o.roughness = 0.5;
  }
  return o;
}

fn lensSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_QUAD;
  o.albedo = vec3f(0.22, 0.07, 0.34);
  o.metalness = 0.65;
  o.roughness = 0.07;
  return o;
}

// The albedo is the emission colour (the deferred pass multiplies it by the emissive strength); a dark LED still reads as a small lens.
fn ledSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_EMISSIVE;
  let led = quad.led[variantOf(m) & 3u];
  let body = mix(0.15, 0.5, saturate1(led.a * 4.0));
  o.albedo = led.rgb * body;
  o.emissive = saturate1(led.a / body);
  o.roughness = 0.35;
  return o;
}

fn wireSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_QUAD;
  let v = variantOf(m);
  o.albedo = vec3f(0.012);
  o.roughness = 0.5;
  if (v == 1u) {
    o.albedo = vec3f(0.5, 0.02, 0.02);
  } else if (v == 2u) {
    o.albedo = vec3f(0.6, 0.4, 0.02);
  } else if (v == 3u) {
    o.albedo = vec3f(0.72, 0.35, 0.2) * (0.8 + 0.4 * vnoise3(m.p * 900.0));
    o.metalness = 0.9;
    o.roughness = 0.4;
  }
  return o;
}
`,"./shaders/objects/track.wgsl":`// Track G-buffer pipelines: the static world-space mesh (gates, obstacles, pad) and the animated cloth flags.
#include "objects/track_materials.wgsl"

struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) world : vec3f,
  @location(1) nrm : vec3f,
  @location(2) uv : vec2f,
  @location(3) ao : f32,
  @location(4) @interpolate(flat) a2 : f32,
  @location(5) @interpolate(flat) a3 : f32,
  @location(6) @interpolate(flat) kind : u32,
  @location(7) prevClip : vec4f,
  @location(8) currClip : vec4f,
};

@vertex fn vs(@location(0) p : vec3f, @location(1) n : vec3f, @location(2) uv : vec2f, @location(3) attr : vec4f) -> VOut {
  var o : VOut;
  let w = vec4f(p, 1.0);
  o.pos = frame.viewProj * w;
  o.world = p;
  o.nrm = n;
  o.uv = uv;
  o.ao = attr.y;
  o.a2 = attr.z;
  o.a3 = attr.w;
  o.kind = u32(attr.x + 0.5);
  o.prevClip = frame.prevViewProj * w;
  o.currClip = frame.viewProjUnjittered * w;
  return o;
}

@fragment fn fs(in : VOut) -> GOut {
  let dp1 = dpdx(in.world);
  let dp2 = dpdy(in.world);
  let duv1 = dpdx(in.uv);
  let duv2 = dpdy(in.uv);
  let n = normalize(in.nrm);
  var m : MatIn;
  m.world = in.world;
  m.n = n;
  m.uv = in.uv;
  m.ao = in.ao;
  m.a2 = in.a2;
  m.a3 = in.a3;
  m.kind = in.kind;
  m.grad = uvGradients(dp1, dp2, duv1, duv2, n);
  m.fp = max(length(dp1), length(dp2));
  return packG(shadeTrack(m), in.prevClip, in.currClip);
}

// ---- cloth flags ----

// Point of flag \`f\` at grid coordinate st (s along the wind from the hoist, t downward from the top edge).
fn clothPoint(f : Flag, st : vec2f, time : f32) -> vec3f {
  let width = f.a.w;
  let height = f.b.w;
  let seed = f.c.x;
  let dir = vec3f(trk.wind.x, 0.0, trk.wind.y);
  let side = vec3f(-dir.z, 0.0, dir.x);
  let stream = saturate1(trk.wind.z / 9.0);
  let s = st.x;
  let t = st.y;
  var p = f.a.xyz + dir * (s * width * mix(0.3, 1.0, stream)) - vec3f(0.0, t * height + (1.0 - stream) * 0.35 * width * s * s, 0.0);
  let gust = 0.8 + 0.2 * sin(time * 0.7 + seed * 1.3);
  let amp = width * (0.04 + 0.11 * stream) * gust * s;
  let w1 = sin(6.0 * s - time * (2.0 + 6.0 * stream) + seed + 2.0 * t);
  let w2 = sin(11.0 * s - time * (3.0 + 9.0 * stream) * 1.3 + seed * 1.7 + 5.0 * t);
  p += side * (amp * (w1 + 0.4 * w2));
  p.y += amp * 0.3 * w1 * stream;
  return p;
}

struct ClothOut {
  @builtin(position) pos : vec4f,
  @location(0) world : vec3f,
  @location(1) nrm : vec3f,
  @location(2) st : vec2f,
  @location(3) @interpolate(flat) flag : u32,
  @location(4) prevClip : vec4f,
  @location(5) currClip : vec4f,
};

@vertex fn vsCloth(@location(0) st : vec2f, @builtin(instance_index) ii : u32) -> ClothOut {
  let f = flags[ii];
  let e = 0.02;
  let p = clothPoint(f, st, trk.time.x);
  let ps = clothPoint(f, st + vec2f(e, 0.0), trk.time.x);
  let pt = clothPoint(f, st + vec2f(0.0, e), trk.time.x);
  var o : ClothOut;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.world = p;
  o.nrm = normalize(cross(ps - p, pt - p));
  o.st = st;
  o.flag = ii;
  o.prevClip = frame.prevViewProj * vec4f(clothPoint(f, st, trk.time.y), 1.0);
  o.currClip = frame.viewProjUnjittered * vec4f(p, 1.0);
  return o;
}

@fragment fn fsCloth(in : ClothOut, @builtin(front_facing) front : bool) -> GOut {
  let f = flags[in.flag];
  let fw = max(fwidth(in.st.y), 1e-4);
  let n = normalize(select(-in.nrm, in.nrm, front));
  let width = f.a.w;
  let height = f.b.w;
  let stripe = smoothstep(0.36 - fw, 0.36 + fw, in.st.y) - smoothstep(0.64 - fw, 0.64 + fw, in.st.y);
  let thread = vnoise2(vec2f(in.st.x * width, in.st.y * height) * 260.0);
  let weave = 0.88 + 0.24 * thread;
  var s = newSurf(mix(f.b.rgb, vec3f(0.78), stripe) * weave, n, 0.85, 9u);
  s.translucency = 0.45;
  s.ao = mix(0.7, 1.0, in.st.x);
  return packG(s, in.prevClip, in.currClip);
}
`,"./shaders/objects/track_bindings.wgsl":`// Group 2 of the track pipelines: time and wind, per-gate LED state and the cloth flags.
#include "objects/common.wgsl"

struct TrackU {
  time : vec4f,  // x = simulation time, y = previous frame time, z = dt
  wind : vec4f,  // xy = horizontal direction the air travels toward (unit), z = speed (m/s)
};

struct GateInfo {
  colour : vec4f, // rgb = frame colour
  state : vec4f,  // x = mode (0 idle, 1 active, 2 passed), y = pass flash 1..0
};

struct Flag {
  a : vec4f, // xyz = top of the hoist edge, w = width (m)
  b : vec4f, // rgb = colour, w = height (m)
  c : vec4f, // x = wave seed
};

@group(2) @binding(0) var<uniform> trk : TrackU;
@group(2) @binding(1) var<storage, read> gates : array<GateInfo>;
@group(2) @binding(2) var<storage, read> flags : array<Flag>;

const LED_ACTIVE : vec3f = vec3f(0.05, 0.9, 1.0);
const LED_FLASH : vec3f = vec3f(0.1, 1.0, 0.2);

// rgb = LED colour, a = emissive strength (fraction of EMISSIVE_MAX_NITS) of gate \`gi\` right now.
fn gateLed(gi : u32) -> vec4f {
  let g = gates[min(gi, arrayLength(&gates) - 1u)];
  var col = mix(g.colour.rgb, vec3f(1.0), 0.2);
  var s = 0.1;
  if (g.state.x > 1.5) {
    s = 0.03;
  } else if (g.state.x > 0.5) {
    col = LED_ACTIVE;
    s = 0.22 + 0.33 * (0.5 + 0.5 * sin(trk.time.x * 5.0));
  }
  let flash = g.state.y;
  return vec4f(mix(col, LED_FLASH, flash), mix(s, 0.6, flash));
}
`,"./shaders/objects/track_materials.wgsl":`// Procedural materials of the static track mesh, selected by the per-vertex kind (K_* defines from materials.ts).
#include "objects/track_bindings.wgsl"

const MAT_GATE : u32 = 3u;
const MAT_FOLIAGE : u32 = 5u;
const MAT_ROCK : u32 = 6u;
const MAT_EMISSIVE : u32 = 7u;
const MAT_GROUND : u32 = 10u;

struct MatIn {
  world : vec3f,
  n : vec3f,
  uv : vec2f,
  ao : f32,
  a2 : f32,
  a3 : f32,
  kind : u32,
  grad : UvGrad,
  fp : f32, // pixel footprint in metres
};

// Diagonal stripes with an analytic anti-aliasing width; returns 0 or 1 with a soft transition.
fn stripes(phase : f32, footprintPhase : f32) -> f32 {
  let t = abs(fract(phase) - 0.5) * 2.0;
  let w = footprintPhase * 2.0;
  let c = smoothstep(0.5 - w, 0.5 + w, t);
  return mix(c, 0.5, saturate1((footprintPhase - 0.15) * 5.0));
}

fn plankHeight(v : f32) -> f32 {
  let e = fract(v / 0.15);
  return 0.003 * smoothstep(0.0, 0.04, min(e, 1.0 - e));
}

fn wallSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_GROUND;
  let variant = u32(m.a2 + 0.5);
  let uv = m.uv;
  if (variant == 0u) {
    let row = floor(uv.y / 0.15);
    let tint = hash21(vec2u(u32(row + 512.0), u32(floor(uv.x / 1.3) + 512.0)));
    let grain = fbm2(vec2f(uv.x * 2.5, uv.y * 45.0) + tint * 31.0);
    o.albedo = vec3f(0.3, 0.16, 0.075) * (0.55 + 0.6 * tint) * (0.7 + 0.6 * grain);
    o.roughness = 0.8;
    let d = 1e-3;
    o.normal = bumpNormal(m.n, m.grad, 0.0, (plankHeight(uv.y + d) - plankHeight(uv.y - d)) / (2.0 * d));
    o.ao = m.ao * mix(0.5, 1.0, smoothstep(0.0, 0.08, min(fract(uv.y / 0.15), 1.0 - fract(uv.y / 0.15))));
  } else if (variant == 1u) {
    let st = stripes((uv.x + uv.y) / 0.5, m.fp / 0.5);
    o.albedo = mix(vec3f(0.62, 0.03, 0.025), vec3f(0.72, 0.72, 0.7), st);
    o.roughness = 0.4;
  } else if (variant == 2u) {
    let pit = fbm2(uv * 55.0);
    let panel = min(abs(fract(uv.x / 1.0 + 0.5) - 0.5), 1.0) * 1.0;
    let joint = 1.0 - smoothstep(0.0, 0.006, panel);
    o.albedo = vec3f(0.34, 0.335, 0.32) * (0.75 + 0.5 * fbm2(uv * 6.0)) * (1.0 - 0.6 * joint);
    o.roughness = 0.9;
    let d = 0.004;
    let hu = (fbm2((uv + vec2f(d, 0.0)) * 55.0) - pit) / d * 0.0012;
    let hv = (fbm2((uv + vec2f(0.0, d)) * 55.0) - pit) / d * 0.0012;
    o.normal = bumpNormal(m.n, m.grad, hu, hv);
  } else {
    let strand = fbm2(vec2f(uv.x * 7.0, uv.y * 90.0));
    let strap = smoothstep(0.43, 0.445, abs(fract(uv.x / 0.55) - 0.5));
    o.albedo = mix(vec3f(0.52, 0.36, 0.1), vec3f(0.7, 0.55, 0.2), strand) * (1.0 - 0.6 * strap);
    o.roughness = 0.95;
    o.translucency = 0.25;
  }
  return o;
}

fn rockHeight(p : vec3f, seed : f32) -> f32 {
  return 0.6 * vnoise3(p * 14.0 + seed * 91.0) + 0.4 * vnoise3(p * 33.0 + seed * 37.0);
}

fn rockSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_ROCK;
  let p = m.world;
  let e = 0.004;
  let h0 = rockHeight(p, m.a2);
  let grad = vec3f(rockHeight(p + vec3f(e, 0.0, 0.0), m.a2) - h0, rockHeight(p + vec3f(0.0, e, 0.0), m.a2) - h0, rockHeight(p + vec3f(0.0, 0.0, e), m.a2) - h0) / e * 0.018;
  o.normal = bumpFromGradient(m.n, grad);
  let strata = fbm3(p * vec3f(3.0, 9.0, 3.0) + m.a2 * 50.0);
  var col = mix(vec3f(0.22, 0.21, 0.2), vec3f(0.34, 0.3, 0.25), strata) * (0.75 + 0.5 * h0);
  let moss = saturate1((o.normal.y - 0.55) * 2.5) * smoothstep(0.35, 0.6, fbm3(p * 4.0 + 9.0));
  col = mix(col, vec3f(0.06, 0.13, 0.03), moss);
  o.albedo = col;
  o.roughness = mix(0.88, 0.98, moss);
  o.ao = m.ao * (0.75 + 0.25 * h0);
  return o;
}

fn padSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_GROUND;
  let p = m.uv;
  let border = sdCover(abs(sdBox(p, vec2f(0.5))) - 0.02, m.fp);
  let bar = min(sdBox(p - vec2f(-0.13, 0.0), vec2f(0.035, 0.21)), sdBox(p - vec2f(0.13, 0.0), vec2f(0.035, 0.21)));
  let cross = sdBox(p, vec2f(0.13, 0.035));
  let mark = sdCover(min(bar, cross), m.fp);
  let speck = vnoise2(p * 220.0) * (1.0 - saturate1(m.fp / 0.006));
  let foam = vec3f(0.07, 0.07, 0.075) * (0.8 + 0.4 * fbm2(p * 40.0) + 0.3 * speck);
  o.albedo = mix(mix(foam, vec3f(0.85, 0.55, 0.03), border), vec3f(0.8, 0.8, 0.78), mark);
  o.roughness = mix(0.9, 0.55, max(border, mark));
  // Use: the take-off spot in the middle is scuffed pale and the paint worn through where quads land, boots leave soil in patches
  // round the edge, and dust settles over all of it.
  let r = length(p);
  let worn = smoothstep(0.32, 0.05, r) * (0.4 + 0.6 * fbm2(p * 9.0));
  o.albedo = mix(o.albedo, mix(o.albedo, vec3f(0.16, 0.15, 0.14), 0.7), worn * 0.6);
  let boots = smoothstep(0.62, 0.72, fbm2(p * 6.0 + 11.0)) * smoothstep(0.25, 0.48, r);
  o.albedo = mix(o.albedo, vec3f(0.12, 0.09, 0.065), boots * 0.7);
  o.albedo = mix(o.albedo, vec3f(0.3, 0.27, 0.22), 0.18 * fbm2(p * 3.0 + 5.0));
  o.roughness = mix(o.roughness, 0.95, max(worn * 0.5, boots));
  return o;
}

fn coneSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_GATE;
  if (m.a3 > 0.5) {
    o.albedo = vec3f(0.03) * (0.7 + 0.6 * vnoise2(m.uv * 60.0));
    o.roughness = 0.8;
    return o;
  }
  let v = m.uv.y / max(m.a2, 0.01);
  let band = max(sdCover(abs(v - 0.5) - 0.07, m.fp / max(m.a2, 0.01)), sdCover(abs(v - 0.69) - 0.05, m.fp / max(m.a2, 0.01)));
  let scuff = fbm2(vec2f(m.uv.x * 5.0, m.uv.y * 20.0));
  let orange = vec3f(0.85, 0.16, 0.015) * (0.8 + 0.3 * scuff);
  // Dust and splashed soil on the lower third, sun-bleached paint on the shoulder.
  let dirt = smoothstep(0.38, 0.0, v) * (0.25 + 0.6 * fbm2(vec2f(m.uv.x * 9.0, m.uv.y * 30.0)));
  let faded = smoothstep(0.55, 1.0, v) * 0.18;
  let paint = mix(orange, vec3f(0.62, 0.2, 0.05), faded);
  o.albedo = mix(mix(paint, vec3f(0.72, 0.72, 0.7), band), vec3f(0.1, 0.075, 0.05), dirt * (1.0 - 0.5 * band));
  o.roughness = mix(0.45, 0.22, band) + 0.4 * dirt;
  return o;
}

// Container paints by a2 (materials.ts CONTAINER_COLOURS, kept equal by shaders.test.ts).
fn containerColour(i : u32) -> vec3f {
  var c = array<vec3f, 8>(
    vec3f(0.33, 0.055, 0.03),
    vec3f(0.025, 0.11, 0.32),
    vec3f(0.04, 0.2, 0.075),
    vec3f(0.62, 0.17, 0.02),
    vec3f(0.3, 0.3, 0.29),
    vec3f(0.6, 0.6, 0.57),
    vec3f(0.19, 0.03, 0.04),
    vec3f(0.6, 0.38, 0.02),
  );
  return c[min(i, 7u)];
}

// Structural steel paints by a2 (materials.ts STEEL_COLOURS): galvanised, red, white, yellow, blue.
fn steelColour(i : u32) -> vec3f {
  var c = array<vec3f, 5>(
    vec3f(0.42, 0.43, 0.44),
    vec3f(0.55, 0.04, 0.025),
    vec3f(0.72, 0.72, 0.7),
    vec3f(0.7, 0.45, 0.02),
    vec3f(0.04, 0.16, 0.38),
  );
  return c[min(i, 4u)];
}

// Height above the terrain, for dirt and splash near the ground.
fn aboveGround(p : vec3f) -> f32 {
  return p.y - terrainHeightAt(p.xz);
}

// Weathering of the track props, from the world position, the normal and the vertex AO: dust settled on faces that look up, grime in the
// crevices the AO marks, soil splashed up the bottom half metre, paint chipped off where crashes and transport knock it (mostly low down)
// and fine horizontal scuffs. Detail finer than a pixel (m.fp, metres) fades out so it does not shimmer.
// The large-scale terms are what still reads from 10-50 m, where the fine ones average out: rain streaks running down vertical faces,
// grime gathering over the bottom metre and a half, blotchy tone across a face and sun fading on faces turned to the sky and south.
struct Wear { dust : f32, grime : f32, splash : f32, chips : f32, scuff : f32, streak : f32, low : f32, tone : f32, fade : f32 };

fn wearAt(m : MatIn) -> Wear {
  let p = m.world;
  let h = aboveGround(p);
  let fine = 1.0 - saturate1(m.fp / 0.01);
  var w : Wear;
  w.dust = smoothstep(0.5, 0.95, m.n.y) * (0.3 + 0.7 * fbm3(p * 3.1));
  w.grime = saturate1((1.0 - m.ao) * 1.6) * (0.6 + 0.4 * fbm3(p * 7.0));
  w.splash = smoothstep(0.55, 0.0, h) * (0.3 + 0.7 * fbm3(p * vec3f(9.0, 2.5, 9.0)));
  w.chips = smoothstep(0.73, 0.8, fbm3(p * 9.0 + 7.0)) * (0.35 + 0.65 * smoothstep(1.3, 0.2, h)) * fine;
  w.scuff = smoothstep(0.82, 0.97, vnoise3(p * vec3f(4.0, 90.0, 4.0))) * smoothstep(0.4, 0.8, fbm3(p * 2.0 + 3.0)) * fine;
  // Streaks: a noise across the face (along its horizontal tangent) stretched down it; past a few centimetres a pixel they go to their mean.
  let vert = 1.0 - abs(m.n.y);
  let side = vec2f(-m.n.z, m.n.x);
  let across = dot(p.xz, side / max(length(side), 1e-4));
  let streak = smoothstep(0.5, 0.85, vnoise2(vec2f(across * 7.0, p.y * 0.6))) * (0.4 + 0.6 * fbm3(p * 0.8 + 5.0));
  w.streak = vert * mix(streak, 0.12, saturate1(m.fp / 0.05));
  w.low = smoothstep(1.6, 0.0, h);
  w.tone = fbm3(p * 0.45 + 3.7);
  w.fade = saturate1(m.n.y) * 0.7 + saturate1(m.n.z) * 0.3;
  return w;
}

// Applies wear to a painted surface: chips show \`bare\` (the metal or board under the paint, metalness \`bareMetal\`), scuffs lighten and
// roughen the paint, then grime, dust and splashed soil go on top.
fn weathered(s : Surf, w : Wear, bare : vec3f, bareMetal : f32) -> Surf {
  var o = s;
  // Paint is never one flat tone: blotches across a face, and sun-faded (paler, greyer) where it faces the sky.
  let fresh = o.albedo;
  let lum = dot(fresh, vec3f(0.2126, 0.7152, 0.0722));
  let paint = mix(fresh, vec3f(lum) * 1.15 + 0.02, 0.3 * w.fade) * (0.85 + 0.3 * w.tone);
  o.albedo = mix(paint, mix(paint, vec3f(dot(paint, vec3f(0.33))), 0.4) * 1.3 + 0.03, w.scuff * 0.6);
  o.roughness = min(o.roughness + 0.25 * w.scuff, 1.0);
  o.albedo = mix(o.albedo, bare, w.chips);
  o.metalness = mix(o.metalness, bareMetal, w.chips);
  o.roughness = mix(o.roughness, mix(0.85, 0.35, bareMetal), w.chips);
  o.albedo *= 1.0 - 0.45 * w.grime;
  o.albedo = mix(o.albedo, vec3f(0.31, 0.27, 0.22), 0.45 * w.dust);
  o.albedo = mix(o.albedo, vec3f(0.11, 0.085, 0.06), 0.8 * w.splash);
  o.roughness = mix(o.roughness, 0.9, max(0.5 * w.dust, 0.7 * w.splash));
  o.metalness *= 1.0 - max(w.dust, w.splash) * 0.8;
  // Rain streaks, and the grime that builds up toward the ground.
  o.albedo *= (1.0 - 0.45 * w.streak) * (1.0 - 0.2 * w.low);
  o.albedo = mix(o.albedo, vec3f(0.15, 0.125, 0.095), 0.25 * w.low * (0.5 + 0.5 * w.tone));
  o.roughness = min(o.roughness + 0.15 * w.low + 0.1 * w.streak, 1.0);
  return o;
}

fn containerSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_GATE;
  let p = m.world;
  let paint = containerColour(u32(m.a2 + 0.5));
  // Rain streaks run down from the roof edge, rust blooms in patches and along the bottom rail, dust splashes up from the ground.
  let streak = vnoise2(vec2f((p.x + p.z) * 9.0, p.y * 0.35));
  let rust = smoothstep(0.62, 0.8, fbm3(p * 1.7 + m.a2 * 13.0)) + smoothstep(0.35, 0.0, aboveGround(p)) * 0.4;
  let dust = smoothstep(0.7, 0.0, aboveGround(p)) * (0.3 + 0.5 * fbm3(p * 6.0));
  var col = paint * (0.8 + 0.3 * fbm3(p * 0.9)) * (0.88 + 0.12 * streak);
  col = mix(col, vec3f(0.17, 0.07, 0.03) * (0.7 + 0.6 * fbm3(p * 11.0)), saturate1(rust));
  col = mix(col, vec3f(0.14, 0.11, 0.08), dust);
  o.albedo = col;
  o.roughness = mix(0.5, 0.9, saturate1(rust + dust));
  return o;
}

fn concreteSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_GROUND;
  let variant = u32(m.a2 + 0.5);
  let p = m.world;
  let uv = m.uv;
  let grain = fbm3(p * 3.1);
  if (variant == 1u) {
    // Asphalt: dark binder with pale aggregate specks.
    let speck = smoothstep(0.72, 0.8, vnoise2(uv * 160.0)) * (1.0 - saturate1(m.fp / 0.01));
    o.albedo = vec3f(0.055, 0.054, 0.052) * (0.8 + 0.4 * grain) + vec3f(0.12) * speck;
    o.roughness = 0.92;
    return o;
  }
  // Cast concrete weathers to about 0.25-0.3: blotchy from the pour and the curing, darker in damp patches.
  let damp = smoothstep(0.55, 0.8, fbm3(p * 0.9 + 7.0));
  var col = vec3f(0.3, 0.295, 0.28) * (0.82 + 0.3 * grain) * (0.85 + 0.3 * fbm3(p * 0.35 + 1.3)) * (1.0 - 0.25 * damp);
  // Formwork: pour lines every 1.2 m and form-tie holes on a 0.6 m grid.
  let lift = abs(fract(uv.y / 1.2 + 0.5) - 0.5) * 1.2;
  let line = 1.0 - smoothstep(0.0, 0.008 + m.fp, lift);
  let tie = sdCover(length((fract(uv / 0.6) - 0.5) * 0.6) - 0.012, m.fp);
  col *= 1.0 - 0.25 * line - 0.5 * tie;
  if (variant == 2u) {
    // Weathered: darker rain stains running down.
    let stain = smoothstep(0.45, 0.75, vnoise2(vec2f((p.x - p.z) * 3.0, p.y * 0.25)));
    col = mix(col, col * 0.55, stain);
  }
  // A green-black film of algae on the faces turned from the sun (north, -z), low down and in the damp patches.
  let north = saturate1(-m.n.z) * (1.0 - abs(m.n.y));
  let algae = saturate1(north * (smoothstep(1.2, 0.0, aboveGround(p)) * (0.4 + 0.6 * fbm3(p * 3.0)) + 0.4 * damp));
  col = mix(col, vec3f(0.07, 0.085, 0.05), 0.6 * algae);
  col = mix(col, vec3f(0.13, 0.1, 0.07), smoothstep(0.5, 0.0, aboveGround(p)) * 0.6);
  o.albedo = col;
  o.roughness = 0.9;
  return o;
}

fn hazardSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_GATE;
  let st = stripes((m.uv.x + m.uv.y) / 0.4, m.fp / 0.4);
  let scuff = fbm3(m.world * 7.0);
  let yellow = vec3f(0.78, 0.5, 0.02) * (0.8 + 0.3 * scuff);
  o.albedo = mix(yellow, vec3f(0.025), st) * (1.0 - 0.3 * smoothstep(0.7, 0.9, scuff));
  o.roughness = mix(0.45, 0.6, st);
  return o;
}

fn steelSurf(m : MatIn, s : Surf) -> Surf {
  var o = s;
  o.material = MAT_GATE;
  let paint = u32(m.a2 + 0.5);
  let p = m.world;
  if (paint == 0u) {
    // Galvanised: grey metal with a faint spangle.
    let spangle = vnoise3(p * 40.0) * (1.0 - saturate1(m.fp / 0.02));
    o.albedo = steelColour(0u) * (0.85 + 0.25 * spangle);
    o.metalness = 0.85;
    o.roughness = 0.4 + 0.15 * fbm3(p * 5.0);
    return o;
  }
  let chips = smoothstep(0.7, 0.78, fbm3(p * 6.0 + 3.0));
  o.albedo = mix(steelColour(paint) * (0.88 + 0.2 * fbm3(p * 2.0)), vec3f(0.12, 0.09, 0.07), chips);
  o.roughness = mix(0.45, 0.8, chips);
  return o;
}

// Printed board of window walls and tunnel sleeves. A non-zero a2 encodes the opening it frames (materials.ts panelCode): a band of
// chevrons in the gate colour runs round it and a thin keyline outside that. Plain boards (a2 = 0) carry a gate-colour stripe at
// shoulder height.
fn panelSurf(m : MatIn, s : Surf, gate : u32) -> Surf {
  var o = s;
  o.material = MAT_GATE;
  let info = gates[min(gate, arrayLength(&gates) - 1u)];
  let uv = m.uv;
  let joint = abs(fract(uv.x / 1.22 + 0.5) - 0.5) * 1.22;
  var col = vec3f(0.52, 0.52, 0.5) * (0.9 + 0.12 * fbm2(uv * 3.0)) * (1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.006 + m.fp, joint)));
  if (m.a2 > 0.5) {
    let hw = floor(m.a2 / 1000.0) / 100.0;
    let hh = (m.a2 - floor(m.a2 / 1000.0) * 1000.0) / 100.0;
    let d = max(abs(uv.x) - hw, abs(uv.y) - hh);
    let st = stripes((uv.x + uv.y) / 0.3, m.fp / 0.3);
    let band = sdCover(d - 0.32, m.fp);
    let key = sdCover(abs(d - 0.45) - 0.03, m.fp);
    col = mix(col, mix(info.colour.rgb, vec3f(0.02), st), band);
    col = mix(col, info.colour.rgb, key);
  } else {
    let h = aboveGround(m.world);
    let stripe = sdCover(abs(h - 1.15) - 0.15, m.fp);
    col = mix(col, info.colour.rgb, stripe);
  }
  col = mix(col, vec3f(0.12, 0.1, 0.08), smoothstep(0.45, 0.0, aboveGround(m.world)) * 0.5);
  o.albedo = col;
  o.roughness = 0.65;
  return o;
}

fn shadeTrack(m : MatIn) -> Surf {
  var o = newSurf(vec3f(0.5), m.n, 0.7, MAT_GATE);
  o.ao = m.ao;
  let gate = u32(m.a3 + 0.5);
  switch (m.kind) {
    case \${K_GATE_FRAME}u: {
      let info = gates[min(gate, arrayLength(&gates) - 1u)];
      let grain = vnoise2(m.uv * 320.0) * (1.0 - saturate1(m.fp / 0.004));
      // Gate colours are display-bright; a gloss paint reflects at most about 0.75 of them.
      o.albedo = info.colour.rgb * 0.75 * (0.88 + 0.16 * grain);
      o.roughness = 0.4 + 0.12 * grain;
    }
    case \${K_GATE_CHEVRON}u: {
      let st = stripes((m.uv.x + m.uv.y) / 0.05, m.fp / 0.05);
      o.albedo = mix(vec3f(0.025), vec3f(0.78), st);
      o.roughness = mix(0.5, 0.3, st);
    }
    case \${K_GATE_LED}u: {
      let led = gateLed(gate);
      o.albedo = led.rgb;
      o.emissive = led.a;
      o.roughness = 0.3;
      o.material = MAT_EMISSIVE;
    }
    case \${K_GATE_BASE}u: {
      o.albedo = vec3f(0.03) * (0.7 + 0.6 * vnoise2(m.uv * 70.0));
      o.roughness = 0.85;
    }
    case \${K_GATE_CHECKER}u: {
      let c = (floor(m.uv.x / 0.03) + floor(m.uv.y / 0.03)) % 2.0;
      o.albedo = mix(vec3f(0.025), vec3f(0.78), abs(c));
      o.roughness = 0.4;
    }
    case \${K_CONE}u: { o = coneSurf(m, o); }
    case \${K_POLE}u: {
      let st = stripes(m.uv.y / 0.7, m.fp / 0.7);
      o.albedo = mix(vec3f(0.6, 0.03, 0.03), vec3f(0.75), st);
      o.roughness = 0.35;
    }
    case \${K_FLAGPOLE}u: {
      o.albedo = vec3f(0.78, 0.79, 0.8);
      o.metalness = 1.0;
      o.roughness = 0.3;
    }
    case \${K_WALL}u: { o = wallSurf(m, o); }
    case \${K_ROCK}u: { o = rockSurf(m, o); }
    case \${K_TRUNK}u: {
      let bark = fbm2(vec2f(m.uv.x * 7.0, m.uv.y * 1.2));
      o.albedo = vec3f(0.085, 0.07, 0.056) * (0.45 + 0.9 * bark);
      o.roughness = 0.95;
      o.material = MAT_FOLIAGE;
    }
    case \${K_PAD}u: { o = padSurf(m, o); }
    case \${K_PAD_EDGE}u: {
      o.albedo = vec3f(0.02);
      o.roughness = 0.9;
      o.material = MAT_GROUND;
    }
    case \${K_CONTAINER}u: { o = containerSurf(m, o); }
    case \${K_CONCRETE}u: { o = concreteSurf(m, o); }
    case \${K_HAZARD}u: { o = hazardSurf(m, o); }
    case \${K_STEEL_PAINT}u: { o = steelSurf(m, o); }
    case \${K_GATE_PANEL}u: { o = panelSurf(m, o, gate); }
    default: {}
  }
  // Weathering of the painted and moulded props (gates, poles, boards, steel, concrete); the LED strips, cones, rocks, trunks and the pad keep
  // their own. The kind picks what shows under chipped paint (bare: colour, metalness; a negative red keeps the surface's own colour) and
  // which terms apply; wearAt and weathered then run once, so the compiler inlines their noise once rather than once per kind.
  var bare = vec4f(-1.0);
  var chips = 1.0;
  var fade = 1.0;
  var scuff = 1.0;
  switch (m.kind) {
    case \${K_GATE_FRAME}u: { bare = vec4f(0.62, 0.62, 0.64, 0.9); }
    case \${K_GATE_CHEVRON}u, \${K_GATE_CHECKER}u, \${K_GATE_PANEL}u: { bare = vec4f(0.42, 0.4, 0.36, 0.0); }
    case \${K_GATE_BASE}u: { bare = vec4f(o.albedo, 0.0); chips = 0.0; }
    case \${K_POLE}u, \${K_STEEL_PAINT}u, \${K_CONTAINER}u, \${K_HAZARD}u: { bare = vec4f(0.5, 0.5, 0.52, 0.85); }
    // Concrete has no paint to chip or fade: knocked edges show the paler aggregate, the rest is streaks, grime and dust. Asphalt keeps its own.
    case \${K_CONCRETE}u: { if (u32(m.a2 + 0.5) != 1u) { bare = vec4f(0.36, 0.34, 0.31, 0.0); fade = 0.0; scuff = 0.0; } }
    case \${K_FLAGPOLE}u: { bare = vec4f(o.albedo, 1.0); chips = 0.0; }
    default: {}
  }
  if (bare.r >= 0.0) {
    var w = wearAt(m);
    w.chips *= chips;
    w.fade *= fade;
    w.scuff *= scuff;
    o = weathered(o, w, bare.rgb, bare.a);
  }
  return o;
}
`,"./shaders/park/lights.wgsl":`struct ParkLightScene { counts : vec4u, data : array<vec4f> }
#ifndef GRP
@group(2) @binding(8) var<storage, read> park : ParkLightScene;
#else
@group(\${GRP}) @binding(16) var<storage, read> park : ParkLightScene;
#endif
fn parkRoom(p : vec3f) -> i32 {
  for (var i = 0u; i < park.counts.y; i++) { let at = park.counts.x * 2u + i * 2u;
    if (all(p > park.data[at].xyz) && all(p < park.data[at + 1u].xyz)) { return i32(i); }
  }
  return -1;
}
fn parkLightRange(p : vec3f) -> vec2u {
  if (park.counts.x == 0u || any(abs(p.xz) >= vec2f(1024.0))) { return vec2u(0u); }
  let cell = vec2u((p.xz + 1024.0) / 32.0);
  return bitcast<vec2u>(park.data[park.counts.x * 2u + park.counts.y * 2u + cell.y * 64u + cell.x].xy);
}
fn parkLightIndex(at : u32) -> u32 {
  let base = park.counts.x * 2u + park.counts.y * 2u + 4096u;
  let indices = bitcast<vec4u>(park.data[base + at / 4u]); return indices[at & 3u];
}
fn parkIrradiance(p : vec3f, index : u32) -> vec4f {
  let a = park.data[index * 2u]; let b = park.data[index * 2u + 1u];
  let distance2 = dot(a.xyz - p, a.xyz - p);
  let fade = 1.0 - smoothstep(b.w * b.w * 0.6, b.w * b.w, distance2);
  return vec4f(b.rgb * a.w / max(distance2, 0.25) * fade, sqrt(distance2));
}
`,"./shaders/park/parts.wgsl":`#include "objects/common.wgsl"
struct Instance { pos : vec4f, rot : vec4f, half : vec4f, color : vec4f, previous : vec4f, previousRot : vec4f, anim : vec4f, previousAnim : vec4f }
@group(2) @binding(0) var<storage, read> instances : array<Instance>;
@group(2) @binding(1) var<storage, read> visibleInstances : array<u32>;
// anim.w = 1 is ordinary gait; >=2 points to a compact per-frame record, independently for previousAnim.
struct StairContact { feet : vec4f, pelvis : vec4f }
@group(2) @binding(2) var<storage, read> stairContacts : array<StairContact>;
fn rotatePart(q : vec4f, v : vec3f) -> vec3f { let t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
struct SkinVertex { pos : vec3f, normal : vec3f }
// Identity comes from persistent appearance data, never a compacted draw-instance index.
fn guestVariation(tint : vec3f, skin : f32) -> vec4f {
  let seed = dot(tint, vec3f(31.17, 73.29, 113.53)) + skin * 91.71;
  return fract(sin(vec4f(seed, seed + 13.7, seed + 41.3, seed + 67.9)) * vec4f(13758.5453, 43758.5453, 23421.631, 19423.718));
}
// Children have larger heads for their stature; the head grows about the base of the neck.
const GUEST_CHILD_HEAD_GAIN : f32 = \${GUEST_CHILD_HEAD_GAIN};
const GUEST_CHILD_HEIGHT : f32 = \${GUEST_CHILD_HEIGHT};
const GUEST_CHILD_SPAN : f32 = \${GUEST_CHILD_SPAN};
fn guestHeadScale(height : f32) -> f32 { return 1.0 + GUEST_CHILD_HEAD_GAIN * clamp((GUEST_CHILD_HEIGHT - height) / GUEST_CHILD_SPAN, 0.0, 1.0); }
// A rider astride a mount (instance colour w = 1) swings each thigh outward about the vertical through the hip, further for shorter riders.
const GUEST_HIP_X : f32 = \${GUEST_HIP_X};
const GUEST_STRADDLE_YAW : f32 = \${GUEST_STRADDLE_YAW};
const GUEST_STRADDLE_SPREAD : f32 = \${GUEST_STRADDLE_SPREAD};
const GUEST_STRADDLE_SHORT : f32 = \${GUEST_STRADDLE_SHORT};
const GUEST_HEIGHT_REFERENCE : f32 = \${GUEST_HEIGHT_REFERENCE};
fn straddleYaw(height : f32) -> f32 { return GUEST_STRADDLE_YAW + GUEST_STRADDLE_SPREAD * min(GUEST_STRADDLE_SHORT, max(0.0, GUEST_HEIGHT_REFERENCE - height)); }
fn guestForm(p : vec3f, n : vec3f, appearance : vec4f, height : f32) -> SkinVertex {
  let t = clamp((p.y - 0.80) / 0.10, 0.0, 1.0);
  let blend = t * t * (3.0 - 2.0 * t); let derivative = 60.0 * t * (1.0 - t);
  let body = vec2f(mix(0.88, 1.15, appearance.x), mix(0.88, 1.20, appearance.y));
  let grow = guestHeadScale(height);
  let head = vec2f(mix(0.82, 0.94, appearance.z), mix(0.95, 1.05, appearance.w)) * grow;
  let shape = mix(body, head, blend); let slope = (head - body) * derivative;
  // Inverse-transpose of the varying-width deformation, before both current and previous skeletal poses.
  let ky = 1.0 + (grow - 1.0) * blend; let stretch = ky + (grow - 1.0) * derivative * (p.y - 0.84);
  return SkinVertex(vec3f(p.x * shape.x, 0.84 + (p.y - 0.84) * ky, p.z * shape.y), normalize(vec3f(n.x / shape.x, (n.y - p.x * slope.x * n.x / shape.x - p.z * slope.y * n.z / shape.y) / stretch, n.z / shape.y)));
}
fn bendX(p : vec3f, c : f32, s : f32) -> vec3f { return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
const GUEST_SEAT_Y : f32 = \${GUEST_SEAT_Y};
const GUEST_SEAT_BACK_FACE : f32 = \${GUEST_SEAT_BACK_FACE};
const GUEST_SEAT_PAN_FRONT : f32 = \${GUEST_SEAT_PAN_FRONT};
const GUEST_KNEE_REACH : f32 = \${GUEST_KNEE_REACH};
const GUEST_HEAD_BACK : f32 = \${GUEST_HEAD_BACK};
const GUEST_TORSO_BACK : f32 = \${GUEST_TORSO_BACK};
const GUEST_SHOULDER_Y : f32 = \${GUEST_SHOULDER_Y};
const GUEST_ELBOW_Y : f32 = \${GUEST_ELBOW_Y};
const GUEST_PALM_Y : f32 = \${GUEST_PALM_Y};
const GUEST_GRIP_Y : f32 = \${GUEST_GRIP_Y};
const GUEST_GRIP_Z : f32 = \${GUEST_GRIP_Z};
const GUEST_HIP_Y : f32 = \${GUEST_HIP_Y};
const GUEST_KNEE_Y : f32 = \${GUEST_KNEE_Y};
const GUEST_ANKLE_Y : f32 = \${GUEST_ANKLE_Y};
const GUEST_GAIT_RATE : f32 = \${GUEST_GAIT_RATE};
const GUEST_GAIT_HEIGHT : f32 = \${GUEST_GAIT_HEIGHT};
const GUEST_STRIDE_LIMIT : f32 = \${GUEST_STRIDE_LIMIT};
const GUEST_STEP_LIFT : f32 = \${GUEST_STEP_LIFT};
const GUEST_KNEE_FLEX : f32 = \${GUEST_KNEE_FLEX};
const GUEST_SEATED_ANGLE : f32 = \${GUEST_SEATED_ANGLE};
struct GuestLeg { hip : vec2f, knee : vec2f, ankle : vec2f, drop : f32 }
fn guestRate(height : f32) -> f32 { return GUEST_GAIT_RATE * GUEST_GAIT_HEIGHT / max(height, 0.5); }
fn walkingLeg(anim : vec4f, height : f32, right : bool) -> GuestLeg {
  if (anim.w >= 2.0) {
    let contact = stairContacts[u32(anim.w - 2.0)]; let contactTargets = contact.feet; let reach = GUEST_HIP_Y - GUEST_ANKLE_Y;
    let hip = min(GUEST_HIP_Y - contact.pelvis.x, min(contactTargets.x + GUEST_ANKLE_Y + sqrt(max(0.0, reach * reach - contactTargets.y * contactTargets.y)), contactTargets.z + GUEST_ANKLE_Y + sqrt(max(0.0, reach * reach - contactTargets.w * contactTargets.w)))) - GUEST_KNEE_FLEX * clamp(anim.y / 1.2, 0.0, 1.0);
    let drop = GUEST_HIP_Y - hip; let point = select(contactTargets.xy, contactTargets.zw, right);
    let y = point.x + GUEST_ANKLE_Y + drop; let z = point.y; let dy = y - GUEST_HIP_Y;
    let distance = max(0.000000001, length(vec2f(dy, z))); let cb = min(1.0, distance / (2.0 * (GUEST_HIP_Y - GUEST_KNEE_Y))); let sb = sqrt(max(0.0, 1.0 - cb * cb));
    let ca = -dy / distance; let sa = -z / distance;
    return GuestLeg(vec2f(ca * cb - sa * sb, sa * cb + ca * sb), vec2f(2.0 * cb * cb - 1.0, -2.0 * cb * sb), vec2f(y, z), drop);
  }
  let activity = clamp(anim.y / 1.2, 0.0, 1.0);
  let stride = min(GUEST_STRIDE_LIMIT, max(anim.y, 0.0) * 3.141592654 / (2.0 * guestRate(height) * max(height, 0.5)));
  let phase = fract(anim.x * guestRate(height) / 6.283185307 + select(0.0, 0.5, right));
  let swing = fract(phase * 2.0); let stanceZ = (swing * 2.0 - 1.0) * stride; let reach = GUEST_HIP_Y - GUEST_ANKLE_Y;
  let swingZ = (1.0 + 2.0 * swing - 12.0 * swing * swing + 8.0 * swing * swing * swing) * stride;
  let liftWave = sin(3.141592654 * swing);
  let swingLift = GUEST_STEP_LIFT * activity * liftWave * liftWave;
  let drop = max(reach - sqrt(max(0.0, reach * reach - stanceZ * stanceZ)), reach - sqrt(max(0.0, reach * reach - swingZ * swingZ)) - swingLift) + GUEST_KNEE_FLEX * activity;
  let z = select(swingZ, stanceZ, phase < 0.5); let lift = select(swingLift, 0.0, phase < 0.5);
  let y = GUEST_ANKLE_Y + lift + drop; let dy = y - GUEST_HIP_Y;
  let distance = length(vec2f(dy, z)); let cb = min(1.0, distance / (2.0 * (GUEST_HIP_Y - GUEST_KNEE_Y))); let sb = sqrt(max(0.0, 1.0 - cb * cb));
  let ca = -dy / distance; let sa = -z / distance;
  return GuestLeg(vec2f(ca * cb - sa * sb, sa * cb + ca * sb), vec2f(2.0 * cb * cb - 1.0, -2.0 * cb * sb), vec2f(y, z), drop);
}
// Seated arm: shoulder angle and elbow bend that put the palm on the grip point (same as guestGripArm in guestPose.ts).
// Metres a seated guest sits forward of the seat centre (same as guestSeatSetback in guestPose.ts).
fn seatSetback(height : f32, panFront : f32) -> f32 { return max(0.0, max(max(GUEST_TORSO_BACK, GUEST_HEAD_BACK * guestHeadScale(height)) * height - GUEST_SEAT_BACK_FACE, panFront - GUEST_KNEE_REACH * height)); }
fn gripArm(height : f32, panFront : f32) -> vec2f {
  let upper = GUEST_SHOULDER_Y - GUEST_ELBOW_Y; let lower = GUEST_ELBOW_Y - GUEST_PALM_Y;
  let dy = GUEST_SEAT_Y + GUEST_GRIP_Y / height - GUEST_SHOULDER_Y; let dz = (GUEST_GRIP_Z + seatSetback(height, panFront)) / height;
  let reach = min(upper + lower - 0.0001, max(abs(upper - lower) + 0.0001, length(vec2f(dy, dz))));
  let toward = atan2(-dz, -dy); let bend = acos(clamp((upper * upper + reach * reach - lower * lower) / (2.0 * upper * reach), -1.0, 1.0));
  let shoulder = toward - bend; let elbowY = -upper * cos(shoulder); let elbowZ = -upper * sin(shoulder);
  let forearm = atan2(-(dz - elbowZ), -(dy - elbowY));
  return vec2f(shoulder, forearm - shoulder);
}
fn limb(p : vec3f, n : vec3f, joint : u32, weight : f32, anim : vec4f, height : f32, seatAngle : f32, straddle : f32, panFront : f32) -> SkinVertex {
  var v = SkinVertex(p, n);
  if (anim.w < 0.5) { return v; }
  let arm = joint == 2u || joint == 3u || joint == 10u || joint == 11u;
  let leg = joint >= 4u && joint <= 9u;
  var drop = 0.0;
  if (anim.z <= 0.0 && (anim.y > 0.00001 || anim.w >= 2.0)) {
    let pose = walkingLeg(anim, height, (joint & 1u) == 1u); drop = pose.drop;
    if (leg) {
      if (joint >= 8u) {
        // Independent ankle joints keep the complete sole level throughout stance.
        return SkinVertex(p + vec3f(0.0, pose.ankle.x - GUEST_ANKLE_Y - drop, pose.ankle.y), n);
      }
      if (joint >= 6u) {
        let childPivot = vec3f(0.0, GUEST_KNEE_Y, 0.0);
        v.pos = mix(p, bendX(p - childPivot, pose.knee.x, pose.knee.y) + childPivot, weight);
        v.normal = mix(n, bendX(n, pose.knee.x, pose.knee.y), weight);
      }
      let pivot = vec3f(0.0, GUEST_HIP_Y, 0.0);
      v.pos = bendX(v.pos - pivot, pose.hip.x, pose.hip.y) + pivot - vec3f(0.0, drop, 0.0);
      v.normal = bendX(v.normal, pose.hip.x, pose.hip.y); return v;
    }
  }
  if (joint == 1u) {
    // Small independent head turns keep queues alive without moving the physical torso capsule.
    let angle = sin(anim.x * 0.63) * 0.14; let c = cos(angle); let s = sin(angle);
    v.pos = vec3f(c * p.x + s * p.z, p.y - drop, -s * p.x + c * p.z);
    v.normal = vec3f(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
    return v;
  }
  if (!arm && !leg) { v.pos.y -= drop; return v; }
  let gait = cos(anim.x * guestRate(height) + select(0.0, 3.141592654, (joint & 1u) == 1u)) * min(anim.y, 1.2) * 0.42;
  let seated = anim.z;
  var grip = vec2f(0.7, 1.15);
  if (arm && seated > 0.0) { grip = gripArm(height, panFront); }
  let angle = select(gait, -gait, arm) * (1.0 - seated) + select(max(GUEST_SEATED_ANGLE, seatAngle), grip.x, arm) * seated;
  let pivot = vec3f(0.0, select(0.525, 0.785, arm), 0.0);
  // Shared elbow/knee rings blend both bones, keeping the surface joined throughout a ride.
  if ((joint >= 6u && joint <= 11u)) {
    let childPivot = vec3f(0.0, select(0.285, 0.615, arm), 0.0);
    let bend = select(-max(0.0, gait) * 0.75 * (1.0 - seated) - max(GUEST_SEATED_ANGLE, seatAngle) * seated, 0.12 * (1.0 - seated) + grip.y * seated, arm);
    let bc = cos(bend); let bs = sin(bend);
    v.pos = mix(p, bendX(p - childPivot, bc, bs) + childPivot, weight);
    v.normal = mix(n, bendX(n, bc, bs), weight);
  }
  let c = cos(angle); let s = sin(angle);
  v.pos = bendX(v.pos - pivot, c, s) + pivot - vec3f(0.0, drop, 0.0); v.normal = bendX(v.normal, c, s);
  if (leg && straddle > 0.0 && seated > 0.0) {
    let side = select(-1.0, 1.0, (joint & 1u) == 1u); let psi = -side * straddleYaw(height) * straddle * seated;
    let cy = cos(psi); let sy = sin(psi); let hx = side * GUEST_HIP_X; let d = v.pos.x - hx;
    v.pos = vec3f(hx + cy * d + sy * v.pos.z, v.pos.y, -sy * d + cy * v.pos.z);
    v.normal = vec3f(cy * v.normal.x + sy * v.normal.z, v.normal.y, -sy * v.normal.x + cy * v.normal.z);
  }
  return v;
}
struct Out { @builtin(position) pos : vec4f, @location(0) world : vec3f, @location(1) normal : vec3f,
  @location(2) color : vec4f, @location(3) params : vec4f, @location(4) prev : vec4f, @location(5) curr : vec4f, @location(6) local : vec3f,
  @location(7) surface : vec4f, @location(8) tint : vec3f }
@vertex fn vs(@location(0) p : vec3f, @location(1) n : vec3f, @location(2) jointf : f32, @builtin(instance_index) id : u32) -> Out {
  let a = instances[visibleInstances[id]]; let packedJoint = u32(jointf); let joint = packedJoint & 15u; let material = packedJoint >> 4u;
  let weight = fract(jointf) * 2.0; var appearance = vec4f(0.0);
  var shaped = SkinVertex(p, n);
  if (a.anim.w > 0.5) {
    appearance = guestVariation(a.color.rgb, a.previous.w);
    let hairstyle = u32(appearance.y * 5.0);
    if (material == 11u || (material == 4u && p.y > 0.955)) {
      let volume = select(vec3f(1.0), vec3f(1.06, 1.09, 1.04), hairstyle == 1u || hairstyle == 2u);
      shaped.pos = (p - vec3f(0.0, 0.929, 0.004)) * volume + vec3f(0.0, 0.929, 0.004); shaped.normal = normalize(n / volume);
    }
    if (material == 10u) {
      if (hairstyle < 3u) { shaped.pos = vec3f(0.0, 0.935, 0.04); }
      else if (hairstyle == 4u) { shaped.pos = vec3f(p.x * 2.5, p.y + 0.014, (p.z - 0.07) * 1.1 + 0.048); shaped.normal = normalize(n / vec3f(2.5, 1.0, 1.1)); }
    }
    shaped = guestForm(shaped.pos, shaped.normal, appearance, a.half.y);
  }
  var skinned = limb(shaped.pos, shaped.normal, joint, weight, a.anim, a.half.y, a.half.w, a.color.w, a.pos.w);
  if (a.anim.w > 0.5) { // A rider astride a mount has no seat back to sit clear of.
    skinned.pos.z -= seatSetback(a.half.y, a.pos.w) / a.half.y * a.anim.z * (1.0 - a.color.w); }
  let local = skinned.pos * a.half.xyz;
  let world = rotatePart(a.rot, local) + a.pos.xyz;
  var previousSkin = limb(shaped.pos, shaped.normal, joint, weight, a.previousAnim, a.half.y, a.half.w, a.color.w, a.pos.w).pos;
  if (a.anim.w > 0.5) { previousSkin.z -= seatSetback(a.half.y, a.pos.w) / a.half.y * a.previousAnim.z * (1.0 - a.color.w); }
  let previous = rotatePart(a.previousRot, previousSkin * a.half.xyz) + a.previous.xyz;
  var color = a.color;
  if (a.anim.w > 0.5) {
    let variant = appearance.z;
    let skin = mix(vec3f(0.12, 0.057, 0.03), vec3f(0.65, 0.39, 0.25), a.previous.w);
    if (material == 1u) { color = vec4f(mix(vec3f(0.12, 0.057, 0.03), vec3f(0.65, 0.39, 0.25), a.previous.w), 0.0); }
    if (material == 2u) { color = vec4f(mix(vec3f(0.028, 0.045, 0.07), vec3f(0.32, 0.26, 0.17), floor(variant * 3.0) * 0.5), 0.0); }
    if (material == 3u) { color = vec4f(select(vec3f(0.025, 0.026, 0.029), vec3f(0.55, 0.52, 0.47), variant > 0.67), 0.0); }
    if (material == 4u || material == 10u || material == 11u) { color = vec4f(mix(vec3f(0.014, 0.008, 0.005), vec3f(0.23, 0.13, 0.044), variant * variant), 0.0); }
    if (material == 5u) { color = vec4f(0.012, 0.008, 0.006, 0.0); }
    if (material == 6u) { color = vec4f(0.49, 0.48, 0.43, 0.0); }
    if (material == 7u) { color = vec4f(mix(vec3f(0.04, 0.018, 0.007), vec3f(0.06, 0.12, 0.13), appearance.y), 0.0); }
    if (material == 8u) { color = vec4f(mix(skin, skin * vec3f(0.88, 0.58, 0.61), 0.48), 0.0); }
    if (material == 9u) { color = vec4f(skin * vec3f(0.48, 0.34, 0.32), 0.0); }
  }
  var o : Out; o.pos = frame.viewProj * vec4f(world, 1.0); o.world = world;
  o.normal = normalize(rotatePart(a.rot, skinned.normal / max(a.half.xyz, vec3f(0.001))));
  o.color = color; o.tint = a.color.rgb; o.params = vec4f(a.pos.w, a.half.w, a.color.w, a.anim.w);
  let grainAxis = select(select(2.0, 1.0, a.half.y >= a.half.z), 0.0, a.half.x >= max(a.half.y, a.half.z));
  o.surface = vec4f(n, grainAxis);
  if (a.anim.w > 0.5) { o.surface = vec4f(p, f32(material)); o.params = vec4f(a.previous.w, appearance.w, appearance.z, a.anim.w); }
  o.prev = frame.prevViewProj * vec4f(previous, 1.0); o.curr = frame.viewProjUnjittered * vec4f(world, 1.0); o.local = local; return o;
}
@fragment fn fs(i : Out) -> GOut {
  let fp = max(length(dpdx(i.world)), length(dpdy(i.world)));
  let localNormal = abs(i.surface.xyz);
  let uv = select(select(i.local.xy, i.local.zy, localNormal.x > localNormal.z), i.local.xz, localNormal.y >= max(localNormal.x, localNormal.z));
  let uvFootprint = max(abs(dpdx(uv)), abs(dpdy(uv)));
  let restFootprint = abs(dpdx(i.surface.xyz)) + abs(dpdy(i.surface.xyz));
  if (i.params.w > 0.5) {
    let rest = i.surface.xyz; let material = u32(round(i.surface.w)); let outfit = i.params.y;
    let skin = mix(vec3f(0.12, 0.057, 0.03), vec3f(0.65, 0.39, 0.25), i.params.x);
    var color = i.color.rgb; var roughness = 0.87; var skinSurface = material == 1u || material == 8u || material == 9u;
    let shorts = outfit < 0.38 && material == 2u && rest.y < mix(0.31, 0.36, outfit / 0.38);
    let sleeves = outfit > 0.70 && material == 1u && rest.y < 0.70 && rest.y > 0.485;
    if (shorts) { color = skin; skinSurface = true; }
    if (sleeves) { color = i.tint; skinSurface = false; }
    let cloth = material == 0u || (material == 2u && !shorts) || sleeves;
    if (cloth) {
      let resolved = 1.0 - smoothstep(0.007, 0.028, fp);
      let weave = sin(rest.x * 2800.0) * sin(rest.y * 2800.0) * (1.0 - smoothstep(0.0004, 0.002, fp));
      let folds = sin(rest.y * 82.0 + sin(rest.x * 28.0) * 1.8) * 0.017 * resolved;
      color *= 1.0 + weave * 0.025 + folds;
      if (material == 0u) {
        let aa = max(restFootprint.y, 0.0005);
        let collar = 1.0 - smoothstep(0.004 - aa, 0.004 + aa, abs(rest.y - 0.831));
        let hem = 1.0 - smoothstep(0.001 - aa, 0.001 + aa, abs(rest.y - 0.532));
        color *= 1.0 - (collar * 0.18 + hem * 0.07) * resolved;
        if (outfit > 0.38 && outfit < 0.70) {
          let stripe = sin(rest.y * 102.0); color *= 1.0 + stripe * 0.12 * resolved;
        }
      }
    }
    if (skinSurface) { roughness = 0.55; color *= 1.0 + (vnoise3(rest * 1150.0) - 0.5) * 0.028 * (1.0 - smoothstep(0.0006, 0.003, fp)); }
    if (material == 4u || material == 10u || material == 11u) {
      roughness = 0.67;
      let strands = (vnoise3(rest * vec3f(920.0, 75.0, 920.0)) - 0.5) * (1.0 - smoothstep(0.001, 0.006, fp));
      color *= 1.0 + strands * 0.1;
    }
    if (material == 5u || material == 6u || material == 7u) { roughness = 0.28; }
    if (material == 3u) { roughness = 0.74; }
    var guest = newSurf(color, normalize(i.normal), roughness, select(10u, 9u, cloth));
    guest.translucency = select(0.0, 0.045, skinSurface);
    return packG(guest, i.prev, i.curr);
  }
  // All coordinates are in metres and remain attached to a moving ride, including its previous pose.
  let wood = select(select(i.local.zxy, i.local.yxz, i.surface.w < 1.5), i.local, i.surface.w < 0.5);
  let endGrain = select(select(localNormal.z, localNormal.y, i.surface.w < 1.5), localNormal.x, i.surface.w < 0.5);
  let microVisible = 1.0 - smoothstep(0.002, 0.012, fp);
  var s = newSurf(i.color.rgb, normalize(i.normal), i.params.x, 10u);
  s.metalness = i.params.y; s.emissive = i.color.w;
  let surface = i32(round(-i.params.w));
  var variation = 0.0;
  if (surface == 1) {
    // Concrete aggregate and fine pores have centred, low-amplitude contrast: no baked darkening.
    let aggregate = (vnoise3(i.local * 32.0) - 0.5) * (1.0 - smoothstep(0.008, 0.045, fp));
    let pores = (vnoise3(i.local * 155.0) - 0.5) * (1.0 - smoothstep(0.001, 0.006, fp));
    variation = aggregate * 0.095 + pores * pores * pores * 0.2;
    s.roughness = max(s.roughness, 0.8) + aggregate * 0.045 + pores * 0.035;
  } else if (surface == 2) {
    // The first wood coordinate follows the longest part axis, including rotated bench slats.
    let broad = (vnoise3(wood * vec3f(0.65, 7.0, 7.0)) - 0.5) * (1.0 - smoothstep(0.025, 0.16, fp));
    let fibres = (vnoise3(wood * vec3f(0.8, 125.0, 125.0)) - 0.5) * microVisible;
    let rings = sin(length(wood.yz) * 180.0 + broad * 3.0) * (1.0 - smoothstep(0.004, 0.026, fp));
    variation = broad * 0.14 + mix(fibres * 0.14, rings * 0.045, smoothstep(0.6, 0.95, endGrain));
    s.roughness = max(s.roughness, 0.62) + broad * 0.045;
  } else if (surface == 3) {
    let weaveVisible = 1.0 - smoothstep(0.0007, 0.0035, max(uvFootprint.x, uvFootprint.y));
    let weave = sin(uv.x * 1800.0) * sin(uv.y * 1800.0) * weaveVisible;
    variation = weave * 0.035;
    s.roughness = max(s.roughness, 0.86) + weave * 0.025;
    s.material = 9u;
  } else if (surface == 4) {
    let cellSize = vec2f(0.38, 0.18);
    let row = floor(uv.y / cellSize.y);
    let cell = uv / cellSize + vec2f(fract(row * 0.5), 0.0);
    let edgeDistance = min(fract(cell), vec2f(1.0) - fract(cell)) * cellSize;
    let aa = max(0.0001, max(uvFootprint.x, uvFootprint.y));
    let mortar = 1.0 - smoothstep(0.006 - aa, 0.006 + aa, min(edgeDistance.x, edgeDistance.y));
    let block = hash21(bitcast<vec2u>(vec2i(floor(cell)))) - 0.5;
    let resolved = 1.0 - smoothstep(0.045, 0.2, fp);
    // 9.61% mortar coverage for these dimensions; subtract the mean before modulating base albedo.
    variation = (block * 0.09 - (mortar - 0.09614) * 0.13) * resolved;
    s.roughness = max(s.roughness, 0.79) + (mortar - 0.09614) * 0.045 * resolved;
  } else if (surface == 5) {
    let leafVariation = (vnoise3(i.local * 3.0) - 0.5) * (1.0 - smoothstep(0.08, 0.35, fp));
    variation = leafVariation * 0.11; s.roughness = max(s.roughness, 0.77) + leafVariation * 0.04;
    s.translucency = 0.14; s.material = 5u;
  } else if (surface == 6) {
    s.roughness = min(s.roughness, 0.16); s.metalness = 0.0;
  } else if (surface == 7) {
    // A continuous metre-scaled paving field crosses the joined public path pieces.
    // The 4 mm joints and 1.2 mm chamfers fade at distance rather than aliasing into a grid.
    let size = vec2f(0.4, 0.2);
    let cell = i.world.xz / size + vec2f(fract(floor(i.world.z / size.y) * 0.5), 0.0);
    let fraction = fract(cell); let edge = min(fraction, vec2f(1.0) - fraction) * size;
    let axis = edge.x < edge.y; let distance = min(edge.x, edge.y);
    let aa = max(fp * 0.55, 0.0003);
    let resolved = 1.0 - smoothstep(0.055, 0.18, fp);
    let joint = 1.0 - smoothstep(0.002 - aa, 0.002 + aa, distance);
    let stone = hash21(bitcast<vec2u>(vec2i(floor(cell)))) - 0.5;
    let grain = (vnoise3(i.world * 65.0) - 0.5) * (1.0 - smoothstep(0.003, 0.02, fp));
    variation = (stone * 0.16 - (joint - 0.03) * 0.3) * resolved + grain * 0.055;
    s.roughness = 0.84 + (stone * 0.06 + joint * 0.08) * resolved;
    let bevelWidth = max(0.004, aa * 2.0); let t = clamp((distance - 0.002) / bevelWidth, 0.0, 1.0);
    let slope = 0.0012 / bevelWidth * 6.0 * t * (1.0 - t) * resolved * smoothstep(0.8, 0.98, i.normal.y);
    let slopeX = select(0.0, select(-1.0, 1.0, fraction.x < 0.5), axis) * slope;
    let slopeZ = select(select(-1.0, 1.0, fraction.y < 0.5), 0.0, axis) * slope;
    s.normal = normalize(s.normal - vec3f(slopeX, 0.0, slopeZ));
  } else {
    variation = (vnoise3(i.local * 90.0) - 0.5) * 0.1 * microVisible;
  }
  s.albedo *= 1.0 + variation;
  if (i.params.z > 0.0) { s.material = 7u; }
  return packG(s, i.prev, i.curr);
}
`,"./shaders/park/shadows.wgsl":`#include "rt/rt_prims.wgsl"
// Early-out visibility against the same static and refitted dynamic hierarchy used by GI.
fn parkShadow(o : vec3f, d : vec3f, distance : f32) -> f32 {
  let inv = 1.0 / select(d, vec3f(1e-8), abs(d) < vec3f(1e-8));
  var stack : array<u32, 32>; var sp = 0u;
  if (park.counts.z != 0xffffffffu) { stack[sp] = park.counts.z; sp++; }
  if (park.counts.w != 0xffffffffu) { stack[sp] = park.counts.w; sp++; }
  while (sp > 0u) {
    sp--; let node = stack[sp]; let a = bvhNodes[node * 2u]; let b = bvhNodes[node * 2u + 1u];
    let aa = (bitcast<vec3f>(a.xyz) - o) * inv; let bb = (bitcast<vec3f>(b.xyz) - o) * inv;
    let near = min(aa, bb); let far = max(aa, bb);
    if (max(max(near.x, near.y), max(near.z, 0.0)) > min(min(far.x, far.y), min(far.z, distance))) { continue; }
    if (b.w > 0u) { for (var k = 0u; k < b.w; k++) { if (intersectPrim(a.w + k, o, d, distance) < distance) { return 0.0; } } }
    else if (sp < 31u) { stack[sp] = a.w; stack[sp + 1u] = a.w + 1u; sp += 2u; }
  }
  return 1.0;
}
`,"./shaders/post/bloom.wgsl":`// Dual-filter bloom pyramid (Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare", SIGGRAPH 2014).
// Down: 13 bilinear taps = five overlapping 2x2 boxes (weights sum to 1). Up: 9-tap tent (1 2 1 / 2 4 2 / 1 2 1) / 16.
// The first downsample averages its five boxes with Karis weights 1 / (1 + luma) so a single fp16 firefly cannot flood the pyramid.
// Every pass renders one fullscreen triangle into one pyramid level; level weights are applied by the blend state (see bloom.ts).
@group(0) @binding(0) var srcTex : texture_2d<f32>;
@group(0) @binding(1) var srcSampler : sampler;

// gbuf.hdr is clamped to this by lighting; anything above (or an Inf) is a defect, not light.
const HDR_MAX : f32 = 60000.0;

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex fn vs(@builtin(vertex_index) i : u32) -> VsOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return VsOut(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}

fn tap(uv : vec2f, o : vec2f, ts : vec2f) -> vec3f {
  return textureSampleLevel(srcTex, srcSampler, uv + o * ts, 0.0).rgb;
}

fn tapSafe(uv : vec2f, o : vec2f, ts : vec2f) -> vec3f {
  return clamp(tap(uv, o, ts), vec3f(0.0), vec3f(HDR_MAX));
}

fn luma(c : vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment fn fs_down(in : VsOut) -> @location(0) vec4f {
  let ts = 1.0 / vec2f(textureDimensions(srcTex));
  let uv = in.uv;
  let a = tap(uv, vec2f(-2.0, 2.0), ts);
  let b = tap(uv, vec2f(0.0, 2.0), ts);
  let c = tap(uv, vec2f(2.0, 2.0), ts);
  let d = tap(uv, vec2f(-2.0, 0.0), ts);
  let e = tap(uv, vec2f(0.0, 0.0), ts);
  let f = tap(uv, vec2f(2.0, 0.0), ts);
  let g = tap(uv, vec2f(-2.0, -2.0), ts);
  let h = tap(uv, vec2f(0.0, -2.0), ts);
  let i = tap(uv, vec2f(2.0, -2.0), ts);
  let j = tap(uv, vec2f(-1.0, 1.0), ts);
  let k = tap(uv, vec2f(1.0, 1.0), ts);
  let l = tap(uv, vec2f(-1.0, -1.0), ts);
  let m = tap(uv, vec2f(1.0, -1.0), ts);
  let col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  return vec4f(col, 0.0);
}

@fragment fn fs_down_karis(in : VsOut) -> @location(0) vec4f {
  let ts = 1.0 / vec2f(textureDimensions(srcTex));
  let uv = in.uv;
  let a = tapSafe(uv, vec2f(-2.0, 2.0), ts);
  let b = tapSafe(uv, vec2f(0.0, 2.0), ts);
  let c = tapSafe(uv, vec2f(2.0, 2.0), ts);
  let d = tapSafe(uv, vec2f(-2.0, 0.0), ts);
  let e = tapSafe(uv, vec2f(0.0, 0.0), ts);
  let f = tapSafe(uv, vec2f(2.0, 0.0), ts);
  let g = tapSafe(uv, vec2f(-2.0, -2.0), ts);
  let h = tapSafe(uv, vec2f(0.0, -2.0), ts);
  let i = tapSafe(uv, vec2f(2.0, -2.0), ts);
  let j = tapSafe(uv, vec2f(-1.0, 1.0), ts);
  let k = tapSafe(uv, vec2f(1.0, 1.0), ts);
  let l = tapSafe(uv, vec2f(-1.0, -1.0), ts);
  let m = tapSafe(uv, vec2f(1.0, -1.0), ts);
  let g0 = (a + b + d + e) * 0.25;
  let g1 = (b + c + e + f) * 0.25;
  let g2 = (d + e + g + h) * 0.25;
  let g3 = (e + f + h + i) * 0.25;
  let g4 = (j + k + l + m) * 0.25;
  let w0 = 0.125 / (1.0 + luma(g0));
  let w1 = 0.125 / (1.0 + luma(g1));
  let w2 = 0.125 / (1.0 + luma(g2));
  let w3 = 0.125 / (1.0 + luma(g3));
  let w4 = 0.5 / (1.0 + luma(g4));
  let col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  return vec4f(col, 0.0);
}

@fragment fn fs_up(in : VsOut) -> @location(0) vec4f {
  let ts = 1.0 / vec2f(textureDimensions(srcTex));
  let uv = in.uv;
  let corners = tap(uv, vec2f(-1.0, 1.0), ts) + tap(uv, vec2f(1.0, 1.0), ts) + tap(uv, vec2f(-1.0, -1.0), ts) + tap(uv, vec2f(1.0, -1.0), ts);
  let edges = tap(uv, vec2f(0.0, 1.0), ts) + tap(uv, vec2f(-1.0, 0.0), ts) + tap(uv, vec2f(1.0, 0.0), ts) + tap(uv, vec2f(0.0, -1.0), ts);
  let centre = tap(uv, vec2f(0.0, 0.0), ts);
  return vec4f(corners * 0.0625 + edges * 0.125 + centre * 0.25, 0.0);
}
`,"./shaders/post/composite.wgsl":`// Final fullscreen pass: lens + rolling shutter resample, chroma bleed, bloom mix, exposure, vignette, sensor noise, filmic tonemap,
// grade, video-link artifacts, dither and the display encode. At most 12 filtered taps: 3 (chromatic aberration, 1 when the lens is off),
// 4 (sharpening), 2 (edge softness), 2 (chroma bleed), 1 (bloom). Everything else is arithmetic on registers.
// Defines: DITHER_LSB (one output code step, 0 = no dither), OUT_HW_SRGB (target format is *-srgb: hardware does the OETF).
#include "post/lens.wgsl"
#include "post/tonemap.wgsl"
#include "post/video.wgsl"

struct Params {
  size : vec4f,     // width, height, 1/width, 1/height
  lens : vec4f,     // k1, k2, zoom (1 + k1 + k2), chromatic aberration edge displacement / half diagonal
  look : vec4f,     // vignette strength, edge softness px at the corner, bloom mix (0 = off), noise amplitude
  shutter : vec4f,  // camera angular velocity xyz (rad/s, camera frame), focal length in pixels
  jello : vec4f,    // amplitude px, phase at frame centre, phase per unit v, readout time (s)
  video : vec4f,    // videoNoise, unused
  seed : vec4u,     // frame index, debug mode
};

@group(0) @binding(0) var resolvedTex : texture_2d<f32>;
@group(0) @binding(1) var bloomTex : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;
struct Exposure {
  ratio : vec4f,  // ratio, sensor gain EV over daylight, metered mean EV, total EV
  look : vec4f,   // highlight knee (scene-linear after the ratio, 1e12 = off), roll-off strength 0..1, white balance red and blue gains (0 = none)
};
@group(0) @binding(3) var<uniform> exposure : Exposure;
@group(0) @binding(4) var<uniform> P : Params;

const HDR_MAX : f32 = 60000.0;
const DITHER_LSB : f32 = \${DITHER_LSB};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex fn vs(@builtin(vertex_index) i : u32) -> VsOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return VsOut(vec4f(p * 2.0 - 1.0, 0.0, 1.0), vec2f(p.x, 1.0 - p.y));
}

// Camera white balance (post/whiteBalance.ts): red and blue gains, with green set so a grey keeps its luminance.
fn whiteBalance() -> vec3f {
  if (exposure.look.z <= 0.0 || exposure.look.w <= 0.0) { return vec3f(1.0); }
  return vec3f(exposure.look.z, (1.0 - 0.2126 * exposure.look.z - 0.0722 * exposure.look.w) / 0.7152, exposure.look.w);
}

fn fetch(uv : vec2f) -> vec3f {
  return min(max(textureSampleLevel(resolvedTex, samp, uv, 0.0).rgb, vec3f(0.0)), vec3f(HDR_MAX));
}

// Blurs are averaged in c / (1 + c) so one HDR highlight cannot swamp its neighbours.
fn squash(c : vec3f) -> vec3f { return c / (vec3f(1.0) + c); }
fn unsquash(c : vec3f) -> vec3f { return c / max(vec3f(1.0) - c, vec3f(1e-4)); }

// Sensor gain EV -6 (blue) .. +12 (red).
fn heatColor(ev : f32) -> vec3f {
  let x = saturate((ev + 6.0) / 18.0);
  return saturate(vec3f(1.5 - abs(4.0 * x - 3.0), 1.5 - abs(4.0 * x - 2.0), 1.5 - abs(4.0 * x - 1.0)));
}

// Contrast-adaptive sharpening (after AMD's CAS) of the resolved image, as a camera's processing does: the temporal resolve and the bilinear
// lens resample soften fine detail (leaves, needles, grass) to about half the local contrast a photograph of foliage shows. The four cross
// neighbours are pushed away from by up to the given amount, less where the neighbourhood is already near black or white, so edges get no halo.
// Works in the squashed domain c / (1 + c), where an HDR highlight cannot dominate.
const SHARPEN : f32 = 0.9;
fn sharpened(g : vec2f, amount : f32) -> vec3f {
  let c = squash(fetch(g));
  if (amount <= 0.0) { return unsquash(c); }
  let t = 1.0 / vec2f(textureDimensions(resolvedTex));
  let n = squash(fetch(g - vec2f(0.0, t.y)));
  let s = squash(fetch(g + vec2f(0.0, t.y)));
  let e = squash(fetch(g + vec2f(t.x, 0.0)));
  let w = squash(fetch(g - vec2f(t.x, 0.0)));
  let mn = min(c, min(min(n, s), min(e, w)));
  let mx = max(c, max(max(n, s), max(e, w)));
  let amp = sqrt(saturate(min(mn, vec3f(1.0) - mx) / max(mx, vec3f(1e-4))));
  let k = -amp * mix(0.125, 0.2, amount);
  return unsquash(saturate((c + k * (n + s + e + w)) / (vec3f(1.0) + 4.0 * k)));
}

// Resolved image at the lens-mapped position: sharpening, chromatic aberration, radial edge softness, analog chroma bleed.
fn sceneColor(L : LensCoords, uv : vec2f, size : vec2f, vn : f32, sharpen : f32) -> vec3f {
  var c = sharpened(L.g, sharpen);
  if (P.lens.w > 0.0) { c = vec3f(fetch(L.r).r, c.g, fetch(L.b).b); }
  let soft = P.look.y * L.rad * L.rad;
  if (soft > 0.01) {
    let o = normalize((uv - 0.5) * size + vec2f(1e-4)) * soft * P.size.zw;
    c = unsquash(0.5 * squash(c) + 0.25 * (squash(fetch(L.g + o)) + squash(fetch(L.g - o))));
  }
  let bleed = videoBleedPx(vn, size.x);
  if (bleed > 0.05) {
    let b = vec2f(bleed * P.size.z, 0.0);
    let c0 = squash(c);
    let c1 = squash(fetch(L.g - b));
    let c2 = squash(fetch(L.g - 2.0 * b));
    let ch = 0.45 * (c0 - lumaOf(c0)) + 0.33 * (c1 - lumaOf(c1)) + 0.22 * (c2 - lumaOf(c2));
    c = unsquash(max(vec3f(lumaOf(c0)) + ch, vec3f(0.0)));
  }
  return c;
}

@fragment fn fs(in : VsOut) -> @location(0) vec4f {
  let size = P.size.xy;
  let pix = in.pos.xy;
  let uv = pix * P.size.zw;
  let frame = P.seed.x;
  let debug = P.seed.y;
  let vn = P.video.x;

  var shift = rollingShift(uv, size, P.shutter.xyz, P.shutter.w, P.jello.w, P.jello);
  shift.x += videoSyncJitterPx(pix.y, frame, vn, size.x);
  let L = lensCoords(uv, size, P.lens.xyz, shift, P.lens.w);

  // Sharpening is a daylight look: at night it would only sharpen the sensor noise, so it fades out with the day curve (tonemap.wgsl).
  var c = sceneColor(L, uv, size, vn, SHARPEN * dayWeight(exposure.ratio.y));
  let bloomMix = P.look.z;
  if (bloomMix > 0.0) {
    let bl = min(max(textureSampleLevel(bloomTex, samp, L.g, 0.0).rgb, vec3f(0.0)), vec3f(HDR_MAX));
    c = select(c * (1.0 - bloomMix) + bl, bl, debug == 3u);
  }
  c *= exposure.ratio.x * lensVignette(L.rad, P.look.x) * whiteBalance();
  if (P.look.w > 0.0) { c += sensorNoise(c, pix, frame, exposure.ratio.y, P.look.w); }
  c *= L.edge;

  var e = gradeContrast(srgbEncode(tonemap(c, exposure.ratio.y, exposure.look.x, exposure.look.y)));
  if (debug == 2u) { e = mix(e, heatColor(exposure.ratio.y), 0.5); }
  e = videoPost(e, pix, uv, frame, vn);
  e = clamp(e + tpdfDither(pix, frame) * DITHER_LSB, vec3f(0.0), vec3f(1.0));
#ifdef OUT_HW_SRGB
  e = srgbDecode(e);
#endif
  return vec4f(e, 1.0);
}
`,"./shaders/post/histogram.wgsl":`// Auto-exposure metering on the resolved (pre-exposed) image.
//  hist   : two 64-bin log2-luminance histograms (ground = depth > 0, sky = depth 0, the sky pass's pixels), weighted towards the centre and
//           the ground, linear split between neighbouring bins.
//  reduce : the sky bins above (the ground's metered mean + SKY_CAP_EV) are folded onto that level, then the soft-clipped trimmed mean (dark
//           shade tail cut) and the bright-eighth EV -> scene-referred target exposure with highlight priority -> smoothed persistent state
//           -> \`ratioOut\`. Mirrors skyCapLevelEv / foldSky / meterFrame in post/exposure.ts.
// State is the TOTAL exposure in EV (pre-exposure * ratio), so CPU pre-exposure changes never look like a scene change.
const BINS : u32 = 64u;
const EV_MIN : f32 = \${EV_MIN};
const EV_MAX : f32 = \${EV_MAX};
const KEY : f32 = \${KEY};
const KEY_KNEE_EV : f32 = \${KEY_KNEE_EV};
const KEY_SLOPE : f32 = \${KEY_SLOPE};
const NIGHT_KNEE_EV : f32 = \${NIGHT_KNEE_EV};
const NIGHT_SLOPE : f32 = \${NIGHT_SLOPE};
const NIGHT_BLEND_HI_EV : f32 = \${NIGHT_BLEND_HI_EV};
const NIGHT_BLEND_LO_EV : f32 = \${NIGHT_BLEND_LO_EV};
const NIGHT_MARGIN_EV : f32 = \${NIGHT_MARGIN_EV};
const NIGHT_LAMP_EV : f32 = \${NIGHT_LAMP_EV};
// A night frame metered darker than the estimate lifts the gain (nightLiftFromEv / nightLiftRate / nightLiftMaxEv in post/exposure.ts).
const NIGHT_LIFT_FROM_EV : f32 = \${NIGHT_LIFT_FROM_EV};
const NIGHT_LIFT_RATE : f32 = \${NIGHT_LIFT_RATE};
const NIGHT_LIFT_MAX_EV : f32 = \${NIGHT_LIFT_MAX_EV};
const EXPECTED_MEAN_EV : f32 = \${EXPECTED_MEAN_EV};
const KNEE : f32 = \${KNEE};
const KNEE_W : f32 = \${KNEE_WIDTH};
const CENTER_BIAS : f32 = \${CENTER_BIAS};
const VERT_BIAS : f32 = \${VERT_BIAS};
const CLIP_FRAC : f32 = \${CLIP_FRAC};
const CLIP_EV : f32 = \${CLIP_EV};
// Sparse highlights (sunflecks): the brightest SPARSE_CLIP_FRAC may sit SPARSE_CLIP_EXTRA_EV above the CLIP_FRAC limit (see post/exposure.ts).
const SPARSE_CLIP_FRAC : f32 = \${SPARSE_CLIP_FRAC};
const SPARSE_CLIP_EXTRA_EV : f32 = \${SPARSE_CLIP_EXTRA_EV};
const PROTECT_MAX_EV : f32 = \${PROTECT_MAX_EV};
const STRIDE : u32 = \${STRIDE}u;
const WEIGHT_SCALE : f32 = \${WEIGHT_SCALE};
const TRIM_LOW : f32 = \${TRIM_LOW};
const TRIM_LOW_NIGHT : f32 = \${TRIM_LOW_NIGHT};
const TRIM_BLEND_LO_EV : f32 = \${TRIM_BLEND_LO_EV};
const TRIM_BLEND_HI_EV : f32 = \${TRIM_BLEND_HI_EV};
const TRIM_HIGH : f32 = \${TRIM_HIGH};
const SKY_CAP_EV : f32 = \${SKY_CAP_EV};
const HL_KNEE_EV : f32 = \${HL_KNEE_EV};
const HL_TAU : f32 = \${HL_TAU};
const HL_GAP_LO : f32 = \${HL_GAP_LO};
const HL_GAP_HI : f32 = \${HL_GAP_HI};
const SKY_GROUND_LO : f32 = \${SKY_GROUND_LO};
const SKY_GROUND_HI : f32 = \${SKY_GROUND_HI};
const SKY_UNCAPPED_EV : f32 = \${SKY_UNCAPPED_EV};
const TAU_BRIGHTEN : f32 = \${TAU_BRIGHTEN};
const TAU_DARKEN : f32 = \${TAU_DARKEN};
const DEADBAND : f32 = \${DEADBAND};
const MAX_DT : f32 = \${MAX_DT};
const DAY_TOTAL_EV : f32 = \${DAY_TOTAL_EV};
const MAX_GAIN_EV : f32 = \${MAX_GAIN_EV};
const MIN_GAIN_EV : f32 = \${MIN_GAIN_EV};
const MAX_RATIO_EV : f32 = \${MAX_RATIO_EV};
const LOG2_KEY : f32 = log2(KEY);

struct Params { pre : f32, dt : f32, frame : u32, reset : u32 };

@group(0) @binding(0) var resolved : texture_2d<f32>;
// [0, 64) ground bins, [64, 128) sky bins.
@group(0) @binding(1) var<storage, read_write> histogram : array<atomic<u32>, 128>;
@group(0) @binding(2) var<uniform> params : Params;
// state[0] = smoothed total exposure (EV, log2 of pre-exposure * ratio), state[1] = 1 once initialised, state[2] = smoothed highlight knee (EV after the ratio), state[3] = smoothed roll-off strength.
@group(0) @binding(3) var<storage, read_write> adapt : array<f32, 4>;
// ratioOut = (ratio, sensor gain EV over the daylight reference, metered mean EV, total exposure EV), then (highlight knee, scene-linear after the ratio; roll-off strength 0..1).
@group(0) @binding(4) var<storage, read_write> ratioOut : array<f32, 8>;
@group(0) @binding(5) var depthTex : texture_depth_2d;

var<workgroup> wgHist : array<atomic<u32>, 128>;
// The histogram the metering functions below work on; reduce fills it from the ground and sky bins.
var<workgroup> wgBins : array<f32, 64>;
var<workgroup> wgGround : array<f32, 64>;
var<workgroup> wgSky : array<f32, 64>;
// The ground's metered mean (skyCapLevelEv) and the share of weight it is based on, for the highlight roll-off.
var<workgroup> wgGroundMeanEv : f32;
var<workgroup> wgHasGround : f32;

fn softClipEv(ev : f32) -> f32 {
  let rel = ev - LOG2_KEY;
  return select(KNEE + KNEE_W * tanh((rel - KNEE) / KNEE_W), rel, rel <= KNEE) + LOG2_KEY;
}

@compute @workgroup_size(16, 16)
fn hist(@builtin(global_invocation_id) gid : vec3u, @builtin(local_invocation_index) li : u32) {
  if (li < 2u * BINS) { atomicStore(&wgHist[li], 0u); }
  workgroupBarrier();
  let dims = textureDimensions(resolved);
  let p = gid.xy * STRIDE + vec2u(params.frame % STRIDE, (params.frame / STRIDE) % STRIDE);
  if (p.x < dims.x && p.y < dims.y) {
    let l = dot(textureLoad(resolved, p, 0).rgb, vec3f(0.2126, 0.7152, 0.0722));
    // Skip NaN/Inf (exponent bits all set) instead of letting them poison a bin.
    if ((bitcast<u32>(l) & 0x7f800000u) != 0x7f800000u) {
      let q = (vec2f(p) + 0.5) / vec2f(dims) * 2.0 - 1.0;
      let radial = 1.0 - CENTER_BIAS * saturate(dot(q, q) * 0.5);
      let wTotal = u32(round(WEIGHT_SCALE * radial * (1.0 + VERT_BIAS * clamp(q.y, -1.0, 1.0))));
      let ev = log2(max(l, 1e-9));
      let pos = clamp((ev - EV_MIN) / (EV_MAX - EV_MIN) * f32(BINS) - 0.5, 0.0, f32(BINS - 1u));
      let i0 = u32(floor(pos));
      let w1 = u32(round(f32(wTotal) * (pos - floor(pos))));
      // The G-buffer is at render resolution, the resolved image at output resolution.
      let dd = vec2u(textureDimensions(depthTex));
      let dp = min(vec2u(vec2f(p) * vec2f(dd) / vec2f(dims)), dd - vec2u(1u));
      let base = select(0u, BINS, textureLoad(depthTex, dp, 0) == 0.0);
      atomicAdd(&wgHist[base + i0], wTotal - w1);
      atomicAdd(&wgHist[base + min(i0 + 1u, BINS - 1u)], w1);
    }
  }
  workgroupBarrier();
  if (li < 2u * BINS) {
    let v = atomicLoad(&wgHist[li]);
    if (v != 0u) { atomicAdd(&histogram[li], v); }
  }
}

fn binCenterEv(i : u32) -> f32 { return EV_MIN + (f32(i) + 0.5) / f32(BINS) * (EV_MAX - EV_MIN); }

// EV above which the brightest CLIP_FRAC of the weight lies, interpolated inside its bin (mirrors topQuantileEv in post/exposure.ts).
fn topQuantileEv(total : f32, fraction : f32) -> f32 {
  let want = fraction * total;
  let width = (EV_MAX - EV_MIN) / f32(BINS);
  var cum = 0.0;
  for (var k = BINS - 1u; k > 0u; k--) {
    let h = wgBins[k];
    if (cum + h >= want) { return binCenterEv(k) + (0.5 - (want - cum) / max(h, 1.0)) * width; }
    cum += h;
  }
  return binCenterEv(0u);
}

// Weight of the CPU's astronomy-based scene estimate (it is encoded in the pre-exposure) against the metered mean: 1 in the dark.
fn nightWeight(preEv : f32) -> f32 {
  return 1.0 - smoothstep(NIGHT_BLEND_LO_EV, NIGHT_BLEND_HI_EV, EXPECTED_MEAN_EV - preEv);
}

// The key falls with the scene luminance, the brightest CLIP_FRAC (sunlit ground, sky) may not sit more than CLIP_EV over the key (not in the dark),
// the sensor gain is limited both ways.
// In the dark the estimate replaces the metered mean, but a frame metered more than NIGHT_MARGIN_EV brighter than it (artificial light) still lowers the gain.
// In the dark the brightest CLIP_FRAC (lampEv: lamp-lit ground, walls, guests) may not sit more than CLIP_EV + NIGHT_LAMP_EV over the key.
fn targetTotalEv(meanEv : f32, highEv : f32, lampEv : f32, preEv : f32) -> f32 {
  let night = nightWeight(preEv);
  let used = mix(meanEv, EXPECTED_MEAN_EV, night);
  let lumEv = used - preEv;
  let keyEv = LOG2_KEY + KEY_SLOPE * min(lumEv - KEY_KNEE_EV, 0.0) + (NIGHT_SLOPE - KEY_SLOPE) * min(lumEv - NIGHT_KNEE_EV, 0.0);
  let shift = keyEv - used;
  let protectedShift = mix(max(min(shift, LOG2_KEY + CLIP_EV - highEv), shift - PROTECT_MAX_EV), shift, night);
  let floodlit = night * max(meanEv - EXPECTED_MEAN_EV - NIGHT_MARGIN_EV, 0.0);
  let lift = night * min(max(EXPECTED_MEAN_EV - meanEv - NIGHT_LIFT_FROM_EV, 0.0) * NIGHT_LIFT_RATE, NIGHT_LIFT_MAX_EV);
  let free = max(clamp(preEv + protectedShift - DAY_TOTAL_EV + lift, MIN_GAIN_EV, MAX_GAIN_EV) - floodlit, MIN_GAIN_EV);
  let lampGain = preEv + LOG2_KEY + CLIP_EV + NIGHT_LAMP_EV - lampEv - DAY_TOTAL_EV;
  let gain = max(mix(free, min(free, lampGain), night), MIN_GAIN_EV);
  return preEv + clamp(DAY_TOTAL_EV + gain - preEv, -MAX_RATIO_EV, MAX_RATIO_EV);
}

// Mean of the soft-clipped bin-centre EVs with the darkest trimLow and the brightest TRIM_HIGH of the weight cut.
fn trimmedMeanEv(trimLow : f32, total : f32) -> f32 {
  let lo = trimLow * total;
  let hi = (1.0 - TRIM_HIGH) * total;
  var cum = 0.0;
  var sum = 0.0;
  var kept = 0.0;
  for (var k = 0u; k < BINS; k++) {
    let h = wgBins[k];
    let w = max(min(cum + h, hi) - max(cum, lo), 0.0);
    sum += w * softClipEv(binCenterEv(k));
    kept += w;
    cum += h;
  }
  return sum / max(kept, 1e-6);
}

// The mean the exposure law works on: the night mean fading into the shade-trimmed one with the CPU grey-card luminance (shadeTrimWeight in exposure.ts).
fn meteredMeanEv(total : f32, preEv : f32) -> f32 {
  let night = trimmedMeanEv(TRIM_LOW_NIGHT, total);
  let w = smoothstep(TRIM_BLEND_LO_EV, TRIM_BLEND_HI_EV, EXPECTED_MEAN_EV - preEv);
  // Avoid the unused second 64-bin mean when the shade trim is fully off.
  if (w <= 0.0) { return night; }
  return night + w * (trimmedMeanEv(TRIM_LOW, total) - night);
}

// Cap level of the sky bins (skyCapLevelEv): the ground's metered mean plus SKY_CAP_EV, lifted away as the ground share of the weight falls.
fn skyCapLevelEv(preEv : f32) -> f32 {
  var tg = 0.0;
  var ts = 0.0;
  for (var k = 0u; k < BINS; k++) { tg += wgGround[k]; ts += wgSky[k]; }
  wgHasGround = select(0.0, 1.0, tg > 1.0);
  if (tg <= 1.0) { return SKY_UNCAPPED_EV; }
  for (var k = 0u; k < BINS; k++) { wgBins[k] = wgGround[k]; }
  let lift = 1.0 - smoothstep(SKY_GROUND_LO, SKY_GROUND_HI, tg / (tg + ts));
  wgGroundMeanEv = meteredMeanEv(tg, preEv);
  return wgGroundMeanEv + SKY_CAP_EV + lift * SKY_UNCAPPED_EV;
}

// highlightRoll: 0 while the sky median is within HL_GAP_LO EV of the ground's metered mean (daylight), 1 from HL_GAP_HI (dusk). Needs skyCapLevelEv's ground mean.
fn highlightRoll(groundMeanEv : f32) -> f32 {
  var ts = 0.0;
  for (var k = 0u; k < BINS; k++) { ts += wgSky[k]; }
  if (ts <= 1.0) { return 0.0; }
  let width = (EV_MAX - EV_MIN) / f32(BINS);
  var cum = 0.0;
  var median = EV_MAX;
  for (var k = BINS - 1u; k > 0u; k--) {
    let h = wgSky[k];
    if (cum + h >= 0.5 * ts) { median = binCenterEv(k) + (0.5 - (0.5 * ts - cum) / max(h, 1.0)) * width; break; }
    cum += h;
  }
  return smoothstep(HL_GAP_LO, HL_GAP_HI, median - groundMeanEv);
}

// wgBins = ground + sky with every sky bin above capEv moved onto capEv, split between the two bins around it (foldSky).
fn foldSky(capEv : f32) {
  let pos = clamp((capEv - EV_MIN) / (EV_MAX - EV_MIN) * f32(BINS) - 0.5, 0.0, f32(BINS - 1u));
  let kc = u32(floor(pos));
  let frac = pos - floor(pos);
  for (var k = 0u; k < BINS; k++) { wgBins[k] = wgGround[k]; }
  for (var k = 0u; k < BINS; k++) {
    if (k <= kc) { wgBins[k] += wgSky[k]; }
    else {
      wgBins[kc] += wgSky[k] * (1.0 - frac);
      wgBins[kc + 1u] += wgSky[k] * frac;
    }
  }
}

@compute @workgroup_size(64)
fn reduce(@builtin(local_invocation_index) i : u32) {
  wgGround[i] = f32(atomicExchange(&histogram[i], 0u));
  wgSky[i] = f32(atomicExchange(&histogram[BINS + i], 0u));
  workgroupBarrier();
  if (i != 0u) { return; }
  let preEv = log2(max(params.pre, 1e-12));
  let capEv = skyCapLevelEv(preEv);
  foldSky(capEv);
  var total = 0.0;
  for (var k = 0u; k < BINS; k++) { total += wgBins[k]; }
  var total_ev = adapt[0];
  var meanEv = ratioOut[2];
  var kneeEv = select(adapt[2], SKY_UNCAPPED_EV, adapt[1] < 0.5);
  var roll = select(adapt[3], 0.0, adapt[1] < 0.5);
  if (adapt[1] < 0.5) { total_ev = preEv; }
  if (total > 1.0) {
    meanEv = meteredMeanEv(total, preEv);
    let highEv = max(topQuantileEv(total, CLIP_FRAC), topQuantileEv(total, SPARSE_CLIP_FRAC) - SPARSE_CLIP_EXTRA_EV);
    let want = targetTotalEv(meanEv, highEv, topQuantileEv(total, CLIP_FRAC), preEv);
    if (adapt[1] < 0.5 || params.reset != 0u) {
      total_ev = want;
    } else {
      let err = want - total_ev;
      let eff = sign(err) * max(abs(err) - DEADBAND, 0.0);
      let tau = select(TAU_BRIGHTEN, TAU_DARKEN, err < 0.0);
      total_ev += eff * (1.0 - exp(-clamp(params.dt, 0.0, MAX_DT) / tau));
    }
    // highlightKneeEv: the cap's ground mean plus HL_KNEE_EV (off in the dark), in EV after the exposure ratio so a pre-exposure change leaves it alone.
    let kneeTarget = clamp(capEv - SKY_CAP_EV + HL_KNEE_EV + nightWeight(preEv) * SKY_UNCAPPED_EV + total_ev - preEv, -30.0, 40.0);
    var rollTarget = 0.0;
    if (wgHasGround > 0.5) { rollTarget = highlightRoll(wgGroundMeanEv); }
    let blend = select(1.0 - exp(-clamp(params.dt, 0.0, MAX_DT) / HL_TAU), 1.0, adapt[1] < 0.5 || params.reset != 0u);
    kneeEv += (kneeTarget - kneeEv) * blend;
    roll += (rollTarget - roll) * blend;
  }
  adapt[0] = total_ev;
  adapt[1] = 1.0;
  adapt[2] = kneeEv;
  adapt[3] = roll;
  let ratioEv = clamp(total_ev - preEv, -MAX_RATIO_EV, MAX_RATIO_EV);
  ratioOut[0] = exp2(ratioEv);
  ratioOut[1] = preEv + ratioEv - DAY_TOTAL_EV;
  ratioOut[2] = meanEv;
  ratioOut[3] = preEv + ratioEv;
  ratioOut[4] = exp2(clamp(kneeEv, -30.0, 40.0));
  ratioOut[5] = roll;
}
`,"./shaders/post/lens.wgsl":`// FPV lens and rolling shutter geometry. Every function maps an OUTPUT (sensor) uv to the uv to fetch from the rectilinear render.
// Radii are aspect-correct and normalised so the image corner has radius 1.

// Brown-Conrady radial model r_d = r_u (1 + k1 r_u^2 + k2 r_u^4), inverted per pixel with Newton (g is increasing and concave,
// so iterating from r_d approaches the root monotonically from below). \`zoom\` = 1 + k1 + k2 keeps the corner fixed: no black wedges, only a fisheye look.
// Returns (uvRect, outputRadius).
fn lensUndistort(uv : vec2f, size : vec2f, k1 : f32, k2 : f32, zoom : f32) -> vec3f {
  let hd = 0.5 * length(size);
  let p = (uv - 0.5) * size / hd;
  let len = length(p);
  let rd = len * zoom;
  var ru = rd;
  for (var i = 0; i < 4; i++) {
    let r2 = ru * ru;
    let g = ru * (1.0 + k1 * r2 + k2 * r2 * r2) - rd;
    ru -= g / (1.0 + 3.0 * k1 * r2 + 5.0 * k2 * r2 * r2);
  }
  return vec3f(0.5 + p * (ru / max(len, 1e-6)) * hd / size, len);
}

// Camera angular velocity \`omega\` (camera frame, rad/s) moves the scene during the readout: row at v exposes (v - 0.5) * readout later
// than the frame centre. Returns the scene displacement in pixels (y down) at that row; the caller samples at (uv - d / size).
// jello = (amplitude px, phase at frame centre, rad per unit v, unused): motor vibration seen through the same line-by-line readout.
fn rollingShift(uv : vec2f, size : vec2f, omega : vec3f, focalPx : f32, readout : f32, jello : vec4f) -> vec2f {
  let yn = uv.y - 0.5;
  let th = omega * (yn * readout);
  let c = (uv - 0.5) * size;
  var d = vec2f(focalPx * th.y - c.y * th.z, focalPx * th.x + c.x * th.z);
  d.x += jello.x * sin(jello.y + jello.z * yn);
  let lim = 0.08 * max(size.x, size.y);
  return clamp(d, vec2f(-lim), vec2f(lim));
}

// One-pixel anti-aliased edge of the image; 1 everywhere inside, so the identity lens never darkens a border pixel.
fn lensMask(uv : vec2f, size : vec2f) -> f32 {
  let d = (vec2f(0.5) - abs(uv - 0.5)) * size + 0.5;
  return saturate(d.x) * saturate(d.y);
}

struct LensCoords {
  g : vec2f,
  r : vec2f,
  b : vec2f,
  rad : f32,
  edge : vec3f,
};

// Lateral chromatic aberration: red magnified and blue shrunk about the centre, growing with r^3 so it is zero on axis.
// caRel = edge displacement in pixels / half diagonal in pixels.
// \`edge\` (the per-channel image-edge mask) is taken before the rolling-shutter and jello shift: that shift only slides the edge-clamped image,
// so a fast turn can never bring in black rows or columns, and only the lens itself (chromatic aberration at the rim) can darken a border pixel.
fn lensCoords(uv : vec2f, size : vec2f, k : vec3f, shiftPx : vec2f, caRel : f32) -> LensCoords {
  let u = lensUndistort(uv, size, k.x, k.y, k.z);
  let g = u.xy - shiftPx / size;
  let s = caRel * u.z * u.z;
  let c = u.xy - 0.5;
  let edge = vec3f(lensMask(vec2f(0.5) + c * (1.0 + s), size), lensMask(u.xy, size), lensMask(vec2f(0.5) + c * (1.0 - s), size));
  return LensCoords(g, vec2f(0.5) + (g - 0.5) * (1.0 + s), vec2f(0.5) + (g - 0.5) * (1.0 - s), u.z, edge);
}

// cos^4 natural falloff (a = tan of the field angle, roughly r / 2 for a wide FPV lens) times a mechanical barrel cut-off.
fn lensVignette(rad : f32, strength : f32) -> f32 {
  let a = 0.5 * rad;
  let nat = 1.0 / ((1.0 + a * a) * (1.0 + a * a));
  let mech = 1.0 - 0.22 * smoothstep(0.8, 1.15, rad);
  return mix(1.0, nat * mech, strength);
}

`,"./shaders/post/motionblur.wgsl":`// Camera + object motion blur before TAA (render resolution), after McGuire et al. 2012 "A Reconstruction Filter for Plausible
// Motion Blur": tile-max velocity -> 3x3 neighbour max -> depth-aware gather along the dominant velocity.
// Velocity is prevUV - currUV (unjittered) scaled to pixels of exposure: v = motion * size * shutter, shutter = exposureTime / dt.
// Sky pixels carry no motion vector, so their (pure rotation) velocity is rebuilt from the camera matrices.
#include "common/frame.wgsl"
#include "common/math.wgsl"

const TILE : u32 = \${TILE}u;
const SAMPLES : i32 = \${SAMPLES};
const EXPOSURE_TIME : f32 = \${EXPOSURE_TIME};
const MAX_SHUTTER : f32 = \${MAX_SHUTTER};
const MAX_BLUR_PX : f32 = \${MAX_BLUR_PX};
const MAX_BLUR_FRAC : f32 = \${MAX_BLUR_FRAC};
const MIN_BLUR_PX : f32 = \${MIN_BLUR_PX};
const DEPTH_SOFT_REL : f32 = \${DEPTH_SOFT_REL};
const DEPTH_SOFT_MIN : f32 = \${DEPTH_SOFT_MIN};
const SKY_Z : f32 = 1e6;
const HDR_MAX : f32 = 65000.0;

@group(1) @binding(0) var hdrTex : texture_2d<f32>;
@group(1) @binding(1) var motionTex : texture_2d<f32>;
@group(1) @binding(2) var depthTex : texture_depth_2d;
@group(1) @binding(3) var<storage, read_write> tileMax : array<vec2f>;
@group(1) @binding(4) var<storage, read_write> tileNeighbor : array<vec2f>;
@group(1) @binding(5) var outTex : texture_storage_2d<rgba16float, write>;
// x = the night sky's display factor (nightSkyScale in exposure.ts), the one TAA puts on every sky sample.
@group(1) @binding(6) var<uniform> mbParams : vec4f;

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

// One bad texel (NaN, or Inf times a zero weight) must not poison the weighted sum; NaN is tested on the bits since min/max/clamp with a NaN are implementation-defined.
fn safeHdr(v : vec3f) -> vec3f {
  return clamp(select(v, vec3f(0.0), (bitcast<vec3u>(v) & vec3u(0x7fffffffu)) > vec3u(0x7f800000u)), vec3f(0.0), vec3f(HDR_MAX));
}

// A sample at the level it will be displayed: TAA holds the night sky darker than the ground sample by sample, so a sky sample blurred into a
// foreground pixel must carry that factor already, or it shows up to 5x brighter than the sky beside it (a bright fringe round every crown).
fn shown(c : vec3f, depth : f32) -> vec3f { return c * select(1.0, mbParams.x, depth <= 0.0); }

// Inverse-luminance weight (Karis): a point light far brighter than its surroundings - a star, a gate LED - cannot dominate the gather. Without it
// a star behind fast foreground (a crown passing the camera at night) is gathered along the foreground's velocity and smears into a bright
// streak along the silhouette, brighter than both the leaves and the sky, though the star itself does not move.
fn karis(c : vec3f) -> f32 { return 1.0 / (1.0 + dot(c, vec3f(0.2126, 0.7152, 0.0722))); }

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
  let c0 = shown(safeHdr(center.rgb), dC);
  let wC = f32(SAMPLES) / max(lenC, 1.0) * karis(c0);
  var sum = c0 * wC;
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
    let c = shown(safeHdr(textureLoad(hdrTex, qu, 0).rgb), dY);
    let w = a * karis(c);
    sum += c * w;
    wsum += w;
  }
  // TAA applies the sky factor again to a sky pixel, so it is taken back out here.
  textureStore(outTex, gid.xy, vec4f(sum / wsum / select(1.0, max(mbParams.x, 1e-6), dC <= 0.0), center.a));
}
`,"./shaders/post/sensor.wgsl":`// Sensor model: Poisson-Gaussian noise in exposed scene-linear light, plus the integer hashes shared with video.wgsl.
// Post passes do not bind the frame uniform, so these hashes are local instead of common/math.wgsl (which needs \`frame\`).

const TAU : f32 = 6.28318530717959;

// shot: signal variance per unit signal at the reference gain (~3000 e- full well); read: read-noise sigma at unity gain.
// Both scale with the ISO gain (shot as G, read as sqrt(G) after the analog stage), so the relative grain falls as the signal rises.
// The exposure's gain EV is the whole brightening over noon; the first shutterEv of it is shutter time and aperture, not ISO. The ISO stage
// stops at maxGainEv; the rest of a starlight exposure (up to +22.8 EV) is optics and frame integration, which add no noise of their own.
// nrFloor: the camera's temporal noise reduction cuts the noise amplitude to this share at the full ISO gain (1 = off), linearly in gain EV.
// chroma: share of the noise variance that is independent per channel (the rest is one luma-correlated draw): a camera's colour
// noise is weaker than its luma noise, and it does not grow towards the night.
struct SensorModel {
  shot : f32,
  read : f32,
  maxGainEv : f32,
  chroma : f32,
  shutterEv : f32,
  nrFloor : f32,
};
const SENSOR : SensorModel = SensorModel(3.0e-4, 4.0e-3, 10.0, 0.2, 4.0, 0.33);

fn pcgHash(v : u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn pcg3d(v : vec3u) -> vec3u {
  var x = v * 1664525u + 1013904223u;
  x.x += x.y * x.z; x.y += x.z * x.x; x.z += x.x * x.y;
  x = x ^ (x >> vec3u(16u));
  x.x += x.y * x.z; x.y += x.z * x.x; x.z += x.x * x.y;
  return x;
}

// Uniform in the open interval (0, 1): safe to feed to log().
fn unitOpen(h : u32) -> f32 { return (f32(h >> 8u) + 0.5) * (1.0 / 16777216.0); }

// Four independent standard normals (two Box-Muller pairs) for one pixel of one frame.
fn gauss4(pix : vec2u, frame : u32) -> vec4f {
  let h0 = pcg3d(vec3u(pix, frame));
  let h1 = pcg3d(h0 ^ vec3u(0x9e3779b9u));
  let ra = sqrt(-2.0 * log(unitOpen(h0.x)));
  let rb = sqrt(-2.0 * log(unitOpen(h1.x)));
  let pa = TAU * unitOpen(h0.y);
  let pb = TAU * unitOpen(h1.y);
  return vec4f(ra * cos(pa), ra * sin(pa), rb * cos(pb), rb * sin(pb));
}

// Additive noise for the exposed signal \`c\`. amp is the user's videoNoise scaled to a multiplier; gainEv is the sensor gain over daylight.
fn sensorNoise(c : vec3f, pix : vec2f, frame : u32, gainEv : f32, amp : f32) -> vec3f {
  let isoEv = clamp(gainEv - SENSOR.shutterEv, 0.0, SENSOR.maxGainEv - SENSOR.shutterEv);
  let gain = exp2(isoEv);
  let nr = mix(1.0, SENSOR.nrFloor, isoEv / (SENSOR.maxGainEv - SENSOR.shutterEv));
  let sigma = (amp * nr) * sqrt(SENSOR.shot * max(c, vec3f(0.0)) * gain + SENSOR.read * SENSOR.read * gain);
  let g = gauss4(vec2u(pix), frame);
  return (sqrt(1.0 - SENSOR.chroma) * g.w + sqrt(SENSOR.chroma) * g.xyz) * sigma;
}
`,"./shaders/post/taau.wgsl":`// Temporal upsampling (TAAU) + resolve, one compute thread per OUTPUT pixel. Render res <= out res.
//   current  : 3x3 render-res taps around the pixel, weighted by the distance between each tap's jittered sample position and the output
//              pixel centre (gaussian fit of a Blackman-Harris window, Karis 2014), Karis 1/(1+luma) weights against fireflies
//   history  : out-res rgba16f (rgb pre-exposed, a = view depth of the closest sample), Catmull-Rom 5-tap reprojection by the motion
//              vector of the closest-depth tap, variance clipped in YCoCg (Salvi 2016), depth-based disocclusion
//   blend    : in the luma-compressed domain (c / (1 + luma)), which is a luminance-weighted average of the HDR values.
// Jitter convention (frameUniforms.ts): the jittered image is the scene shifted by +jitter NDC, so render pixel j samples the scene at the
// UNJITTERED position j + 0.5 - jitterPx, jitterPx = (jitter.x, -jitter.y) * 0.5 * renderSize.
#include "common/frame.wgsl"
#include "common/math.wgsl"

const HDR_MAX : f32 = 65000.0;
const SKY_W : f32 = 60000.0;
const KERNEL_K : f32 = \${KERNEL_K};
const KERNEL_SUM : f32 = 3.14159265 / KERNEL_K;
const VARIANCE_GAMMA : f32 = \${VARIANCE_GAMMA};
const FEEDBACK : f32 = \${FEEDBACK};
const FEEDBACK_MOTION : f32 = \${FEEDBACK_MOTION};
const MOTION_PX : f32 = \${MOTION_PX};
const DISOCC_LO : f32 = \${DISOCC_LO};
const DISOCC_HI : f32 = \${DISOCC_HI};
// Own motion (pixels per frame, beyond what the camera explains) from which a surface counts as moving by itself, its clip-box width
// and its least current-frame weight (see main()).
const OWN_MOTION_LO_PX : f32 = 0.25;
const OWN_MOTION_HI_PX : f32 = 1.25;
const OWN_MOTION_GAMMA : f32 = 0.75;
const OWN_MOTION_ALPHA : f32 = 0.6;

struct TaaParams {
  histScale : f32, // preExposure / prevPreExposure
  reset : u32,     // 1 = ignore the history texture
  skyScale : f32,  // factor on sky samples (night highlight compensation, nightSkyScale in exposure.ts), applied per sample before any blending
  pad : u32,
};

@group(1) @binding(0) var<uniform> taa : TaaParams;
@group(1) @binding(1) var histTex : texture_2d<f32>;
@group(1) @binding(2) var linSamp : sampler;
@group(1) @binding(3) var outResolved : texture_storage_2d<rgba16float, write>;
@group(1) @binding(4) var outHist : texture_storage_2d<rgba16float, write>;
@group(1) @binding(5) var motionTex : texture_2d<f32>;
@group(1) @binding(6) var depthTex : texture_depth_2d;
@group(2) @binding(0) var inputTex : texture_2d<f32>;

// NaN -> 0, tested on the bits (compilers may assume no NaN, and min/max/clamp with a NaN operand are implementation-defined). A NaN that
// reached the history would stay there for good and spread through the Catmull-Rom taps.
fn dropNan(v : vec3f) -> vec3f {
  return select(v, vec3f(0.0), (bitcast<vec3u>(v) & vec3u(0x7fffffffu)) > vec3u(0x7f800000u));
}

fn toYCoCg(c : vec3f) -> vec3f {
  return vec3f(0.25 * c.x + 0.5 * c.y + 0.25 * c.z, 0.5 * c.x - 0.5 * c.z, -0.25 * c.x + 0.5 * c.y - 0.25 * c.z);
}

fn fromYCoCg(c : vec3f) -> vec3f {
  let t = c.x - c.z;
  return vec3f(t + c.y, c.x + c.z, t - c.y);
}

// Moves q along the ray towards the box centre until it is inside the box.
fn clipToBox(lo : vec3f, hi : vec3f, q : vec3f) -> vec3f {
  let centre = 0.5 * (lo + hi);
  let ext = 0.5 * (hi - lo) + 1e-5;
  let r = q - centre;
  let a = abs(r) / ext;
  let m = max(a.x, max(a.y, a.z));
  return select(q, centre + r / m, m > 1.0);
}

fn compress(c : vec3f) -> vec3f { return c / (1.0 + luminance(c)); }

fn decompress(c : vec3f) -> vec3f {
  let l = min(luminance(c), 0.99998);
  return clamp(c / (1.0 - l), vec3f(0.0), vec3f(HDR_MAX));
}

// 5-tap Catmull-Rom (corner taps dropped) on the bilinear hardware; the alpha channel (depth) is not interpolated.
fn historyCatmullRom(uv : vec2f, size : vec2f) -> vec3f {
  let pos = uv * size;
  let p1 = floor(pos - 0.5) + 0.5;
  let f = pos - p1;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let p0 = (p1 - 1.0) / size;
  let p3 = (p1 + 2.0) / size;
  let p12 = (p1 + w2 / w12) / size;
  let sum = textureSampleLevel(histTex, linSamp, vec2f(p12.x, p0.y), 0.0).rgb * (w12.x * w0.y)
          + textureSampleLevel(histTex, linSamp, vec2f(p0.x, p12.y), 0.0).rgb * (w0.x * w12.y)
          + textureSampleLevel(histTex, linSamp, p12, 0.0).rgb * (w12.x * w12.y)
          + textureSampleLevel(histTex, linSamp, vec2f(p3.x, p12.y), 0.0).rgb * (w3.x * w12.y)
          + textureSampleLevel(histTex, linSamp, vec2f(p12.x, p3.y), 0.0).rgb * (w12.x * w3.y);
  let wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(sum / wsum, vec3f(0.0));
}

// Sky pixels have no useful motion vector: a point at infinity only rotates, so project the view ray with the previous rotation.
// Returns the previous-frame UV in xy and 1 in z when the ray was in front of the previous camera.
fn skyPrevUv(jitteredUv : vec2f) -> vec3f {
  let clip = frame.prevViewProj * vec4f(viewRayDir(jitteredUv), 0.0);
  let ndc = clip.xy / max(clip.w, 1e-6);
  return vec3f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, select(0.0, 1.0, clip.w > 1e-6));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let outSize = textureDimensions(outResolved);
  if (gid.x >= outSize.x || gid.y >= outSize.y) { return; }
  let oSize = vec2f(outSize);
  let rDim = textureDimensions(inputTex);
  let rSize = vec2f(rDim);
  let rMax = vec2i(rDim) - vec2i(1);
  let uv = (vec2f(gid.xy) + 0.5) / oSize;
  let jit = vec2f(frame.jitter.x, -frame.jitter.y) * 0.5 * rSize;
  let c = uv * rSize;
  let base = vec2i(floor(c + jit));
  // Supersampled input (ratio > 1) widens the kernel to output-pixel units; the 3x3 gather then truncates it.
  let rk = max(rSize / oSize, vec2f(1.0));

  var cSum = vec3f(0.0);
  var lSum = 0.0;
  var wSum = 0.0;
  var m1 = vec3f(0.0);
  var m2 = vec3f(0.0);
  var bMin = vec3f(1e9);
  var bMax = vec3f(-1e9);
  var dMax = 0.0;
  var dPix = clamp(base, vec2i(0), rMax);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let p = base + vec2i(i, j);
      let t = clamp(p, vec2i(0), rMax);
      let z = textureLoad(depthTex, t, 0);
      // The night sky is held darker than the ground per sample, before it is blended with anything: scaling the resolved pixel by its sky
      // share instead left the sky part of every leaf-sky edge pixel (and every motion-blurred one) up to 5x brighter than the sky beside it.
      let s = clamp(dropNan(textureLoad(inputTex, t, 0).rgb), vec3f(0.0), vec3f(HDR_MAX)) * select(1.0, taa.skyScale, z <= 0.0);
      let d = (vec2f(p) + 0.5 - jit - c) / rk;
      let w = exp(-KERNEL_K * dot(d, d));
      let kw = 1.0 / (1.0 + luminance(s));
      cSum += s * (w * kw);
      lSum += w * kw;
      wSum += w;
      let q = toYCoCg(s * kw);
      m1 += q;
      m2 += q * q;
      bMin = min(bMin, q);
      bMax = max(bMax, q);
      if (z > dMax) { dMax = z; dPix = t; }
    }
  }
  let cur = cSum / max(lSum, 1e-9);
  let curC = compress(cur);
  let storeW = select(SKY_W, min(frame.params.z / max(dMax, 1e-9), SKY_W), dMax > 0.0);

  var result = curC;
  if (taa.reset == 0u) {
    var mv = textureLoad(motionTex, dPix, 0).rg;
    var valid = true;
    if (dMax <= 0.0) {
      let sp = skyPrevUv((c + jit) / rSize);
      mv = sp.xy - uv;
      valid = sp.z > 0.5;
    }
    let prevUv = uv + mv;
    valid = valid && all(prevUv >= vec2f(0.0)) && all(prevUv <= vec2f(1.0));
    if (valid) {
      // Geometry that moves by itself (wind-blown grass blades and leaves): its motion vector minus the motion a static point at the same
      // depth gets from the camera alone. Thin swaying blades move several pixels a frame and their 3x3 neighbourhood spans every blade
      // colour, so the usual clip box keeps a smeared history; for them the box is tightened and the current frame weighs more, the way a
      // short real shutter freezes them. Static ground, rocks and buildings have no own motion and keep the full accumulation.
      var ownPx = 0.0;
      if (dMax > 0.0) {
        let wp = worldFromDepth((vec2f(dPix) + 0.5) / rSize, dMax);
        let pc = frame.prevViewProj * vec4f(wp, 1.0);
        let cc = frame.viewProjUnjittered * vec4f(wp, 1.0);
        if (pc.w > 1e-3 && cc.w > 1e-3) {
          let staticMv = vec2f(pc.x / pc.w - cc.x / cc.w, cc.y / cc.w - pc.y / pc.w) * 0.5;
          ownPx = length((mv - staticMv) * oSize);
        }
      }
      let own = smoothstep(OWN_MOTION_LO_PX, OWN_MOTION_HI_PX, ownPx);
      let gamma = mix(VARIANCE_GAMMA, OWN_MOTION_GAMMA, own);
      let hist = clamp(dropNan(historyCatmullRom(prevUv, oSize) * taa.histScale), vec3f(0.0), vec3f(HDR_MAX));
      let mean = m1 / 9.0;
      let sigma = sqrt(max(m2 / 9.0 - mean * mean, vec3f(0.0)));
      let lo = max(bMin, mean - gamma * sigma);
      let hi = min(bMax, mean + gamma * sigma);
      let histC = fromYCoCg(clipToBox(lo, hi, toYCoCg(compress(hist))));

      let speedPx = length(mv * oSize);
      let feedback = mix(FEEDBACK, FEEDBACK_MOTION, smoothstep(0.0, MOTION_PX, speedPx));
      // Current-frame weight scales with how much kernel mass this frame's jitter placed on the pixel (expected mass = KERNEL_SUM).
      var alpha = clamp((1.0 - feedback) * wSum / KERNEL_SUM, 0.0, 1.0);
      if (dMax > 0.0) {
        // The previous view depth of this surface vs the depth stored in the history: a closer history means it was occluded then.
        let world = worldFromDepth((vec2f(dPix) + 0.5) / rSize, dMax);
        let prevW = (frame.prevViewProj * vec4f(world, 1.0)).w;
        if (prevW > 1e-3) {
          let g = textureGather(3, histTex, linSamp, prevUv);
          let hw = min(min(g.x, g.y), min(g.z, g.w));
          alpha = max(alpha, smoothstep(DISOCC_LO, DISOCC_HI, (prevW - hw) / prevW));
        }
      }
      alpha = max(alpha, OWN_MOTION_ALPHA * own);
      result = mix(histC, curC, alpha);
    }
  }
  let outC = decompress(max(result, vec3f(0.0)));
  textureStore(outResolved, gid.xy, vec4f(outC, 1.0));
  textureStore(outHist, gid.xy, vec4f(outC, storeW));
}

// TAA disabled: plain bilinear resample of the render-res image (jitter-corrected, so it is exact when the ratio is 1).
@compute @workgroup_size(8, 8, 1)
fn upsample(@builtin(global_invocation_id) gid : vec3u) {
  let outSize = textureDimensions(outResolved);
  if (gid.x >= outSize.x || gid.y >= outSize.y) { return; }
  let rSize = vec2f(textureDimensions(inputTex));
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(outSize);
  let jit = vec2f(frame.jitter.x, -frame.jitter.y) * 0.5 * rSize;
  let s = clamp(dropNan(textureSampleLevel(inputTex, linSamp, (uv * rSize + jit) / rSize, 0.0).rgb), vec3f(0.0), vec3f(HDR_MAX));
  let z = textureLoad(depthTex, clamp(vec2i(uv * rSize), vec2i(0), vec2i(rSize) - vec2i(1)), 0);
  textureStore(outResolved, gid.xy, vec4f(s * select(1.0, taa.skyScale, z <= 0.0), 1.0));
}
`,"./shaders/post/tonemap.wgsl":`// Display transform: a hue-preserving filmic curve on luminance (Narkowicz's ACES fit) with a daylight shadow lift, sensor-style
// highlight desaturation, a smooth gamut compression, a mild FPV-camera grade and the sRGB OETF.
// Input is scene-linear light already multiplied by the exposure ratio (0.22 ~ mid grey); output of \`tonemap\` is display-linear in [0, 1].
// The curve acts on luminance only and the colour keeps its chromaticity, so hue does not skew with brightness the way a per-channel curve
// does (blue sky drifting to cyan, foliage to neon yellow-green). A colour that nears the gamut edge slides along the line to the grey of
// the same luminance (a smooth knee on its chroma), so the brightest channel approaches but never sits on white: a saturated sky keeps its
// gradient instead of a flat 255 plateau in one channel. Before the curve, luminance far above the ground (a dusk sky, 4-6 stops over it) is rolled
// off along its hue (see compressHighlights), so the sky and the sun-side horizon glow keep their colour below the clip.

struct Grade {
  preScale : f32,
  saturation : f32,
  contrast : f32,
  desatStart : f32,
  desatEnd : f32,
  gamutCeil : f32,
  gamutKnee : f32,
  dayPreScale : f32,
  dayToe : f32,
  dayGainLo : f32,
  dayGainHi : f32,
  hlSlope : f32,
  hlSoft : f32,
  midSat : f32,
  dayWhite : f32,
};

// preScale 0.64 puts the 0.22 key at about 0.2 display-linear (sRGB 0.48); saturation is the camera's colour matrix strength;
// desat: a scene luminance range (far above the 0.22 key: the sun and its glare, not a dusk horizon) over which the sensor saturates all three channels and
// the colour burns out to white.
// gamut: the brightest channel of a chromatic colour tops out at gamutCeil (display-linear; a neutral still reaches 1), and the chroma
// compression starts at gamutKnee of the room below that ceiling.
// day*: the camera's wide-dynamic-range shadow lift. With the sensor gain under dayGainLo (EV over the daylight reference) the toe of the curve
// is dayToe instead of 0.03 (deep shade reads a few codes brighter: photographs of sunlit landscapes keep real blacks under trees, p5 about code 15-20) and preScale falls to dayPreScale so the mid-tones and the sky stay put (grass at
// 0.26 scene-linear lands on the same code with either pair); it fades out by dayGainHi, because lifting shadows amplifies noise and a night camera
// (up to +22.8 EV) keeps the curve it was tuned with. The fade is long (4.5 to 16 EV) so that civil twilight (gain ~9-11) keeps a good part of the lift
// where the key falls and the ground is dim; a full moon (gain ~15) is already back on the night curve.
// hl*: the highlight roll-off of a wide-dynamic-range camera. Luminance above the knee (given per frame, see \`tonemap\`) loses stops: the slope is 1 at
// the knee and falls to hlSlope over about hlSoft stops, so a dusk sky 6 stops over the ground keeps its gradient and its hue below the clip.
// midSat: extra chroma in the mid-tones, the way a film or camera curve applied per channel saturates them (a curve on luminance alone keeps
// the scene's linear chroma, which reads flat and grey next to a photograph); it is 0 at black, so shadow noise stays grey, and fades out
// toward the highlights, so their roll-off to white stays clean. Daylight only: it fades with the shadow lift, so the night camera keeps its colour.
// dayWhite: by day the curve is scaled so this scene luminance (about 3.7 stops over the key) reaches display white, the way a camera's curve
// clips: sunlit cloud tops and the sky round the sun reach codes 240-255 as in photographs, instead of stalling near 236 on the fit's long
// shoulder (it needs 5x the key for code 250). dayPreScale is refit with it so the grass keeps its code. It fades with the shadow lift too.
const GRADE : Grade = Grade(0.64, 1.05, 0.15, 20.0, 500.0, 0.90, 0.72, 0.58, 0.045, 4.5, 16.0, 0.3, 0.9, 0.45, 4.0);
const TOE_NIGHT : f32 = 0.03;

fn lumaOf(c : vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

// 1 in daylight, 0 once the sensor gain is that of dusk or night.
fn dayWeight(gainEv : f32) -> f32 { return 1.0 - smoothstep(GRADE.dayGainLo, GRADE.dayGainHi, gainEv); }

fn preScaleFor(day : f32) -> f32 { return mix(GRADE.preScale, GRADE.dayPreScale, day); }
fn toeFor(day : f32) -> f32 { return mix(TOE_NIGHT, GRADE.dayToe, day); }

fn filmicRaw(a : f32, toe : f32) -> f32 { return a * (2.51 * a + toe) / (a * (2.43 * a + 0.59) + 0.14); }

// Daylight gain that puts scene luminance dayWhite on display white (1 at night, where the curve keeps its long shoulder).
fn whiteGain(day : f32) -> f32 { return mix(1.0, 1.0 / filmicRaw(GRADE.dayWhite * preScaleFor(day), toeFor(day)), day); }

// Odd around zero, so sensor noise on a black pixel averages to black instead of rectifying into a lifted floor. Slope at 0 is
// preScale * toe / 0.14 * whiteGain.
fn filmicLuma(x : f32, day : f32) -> f32 {
  return sign(x) * filmicRaw(abs(x) * preScaleFor(day), toeFor(day)) * whiteGain(day);
}

// Chroma of a colour of luma y is compressed with a hyperbolic knee on each side: its brightest channel approaches the gamut ceiling, and its
// dimmest approaches black, without reaching them. Both scale the chroma toward the grey of the same luma, so the hue stays; the lower one keeps
// a saturated yellow-green (sunlit grass after the mid-tone boost) from flattening its blue channel at 0.
fn kneeScale(c : f32, room : f32) -> f32 {
  let knee = GRADE.gamutKnee * room;
  if (c <= knee) { return 1.0; }
  let over = c - knee;
  let span = room - knee;
  return (knee + span * over / (over + span)) / c;
}
fn compressGamut(o : vec3f, y : f32) -> vec3f {
  let room = max(mix(GRADE.gamutCeil, 1.0, y * y * y * y) - y, 1e-4);
  let k = min(kneeScale(max(o.r, max(o.g, o.b)) - y, room), kneeScale(y - min(o.r, min(o.g, o.b)), max(y, 1e-4)));
  return vec3f(y) + (o - vec3f(y)) * k;
}

// Luminance beyond the knee in stops d: d for the first stop or so, then p per stop, with p going from 1 (roll = 0, nothing) to hlSlope (roll = 1).
// Applied to the luminance of a colour only, so its chromaticity stays.
fn compressHighlights(l : f32, knee : f32, roll : f32) -> f32 {
  if (l <= knee) { return l; }
  let d = log2(l / knee);
  let p = mix(1.0, GRADE.hlSlope, roll);
  return knee * exp2(p * d + (1.0 - p) * GRADE.hlSoft * (1.0 - exp2(-d * 1.442695 / GRADE.hlSoft)));
}

// Weight of the mid-tone saturation at display-linear luminance y: rises over the deep shadows, full from about code 50 to code 140, gone
// by code 225.
fn midTones(y : f32) -> f32 { return smoothstep(0.0, 0.03, y) * (1.0 - smoothstep(0.25, 0.75, y)); }

// gainEv: the sensor gain the auto exposure applied over the daylight reference (it picks the day or the night toe).
// knee, roll: scene-linear luminance (after the exposure ratio) above which highlights are compressed (1e12 = off) and how strongly (0..1).
fn tonemap(sceneLinear : vec3f, gainEv : f32, knee : f32, roll : f32) -> vec3f {
  let day = dayWeight(gainEv);
  let l = lumaOf(sceneLinear);
  let y = min(filmicLuma(compressHighlights(l, knee, roll), day), 1.0);
  let k = select(preScaleFor(day) * toeFor(day) / 0.14 * whiteGain(day), y / l, abs(l) > 1e-6);
  var o = sceneLinear * k;
  o = mix(o, vec3f(y), smoothstep(GRADE.desatStart, GRADE.desatEnd, l));
  o = vec3f(y) + (o - vec3f(y)) * (GRADE.saturation * (1.0 + GRADE.midSat * midTones(y) * day));
  return clamp(compressGamut(o, y), vec3f(0.0), vec3f(1.0));
}

fn srgbEncode(x : vec3f) -> vec3f {
  let c = clamp(x, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308));
}

fn srgbDecode(x : vec3f) -> vec3f {
  let c = clamp(x, vec3f(0.0), vec3f(1.0));
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

// Smoothstep-blended S-curve in the encoded domain: pivots at 0.5 and leaves 0 and 1 fixed.
fn gradeContrast(e : vec3f) -> vec3f {
  return mix(e, e * e * (3.0 - 2.0 * e), GRADE.contrast);
}

// Interleaved gradient noise (Jimenez 2014): a cheap, well-distributed per-pixel pattern.
fn ign(p : vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

// Triangular-PDF dither of +-1 output LSB: two decorrelated IGN lanes, rotated every frame so it averages out in time.
fn tpdfDither(pix : vec2f, frame : u32) -> f32 {
  let f = f32(frame & 63u);
  return ign(pix + vec2f(5.588238, 5.588238) * f) + ign(pix.yx + vec2f(47.0, 13.0) + vec2f(8.311, 3.917) * f) - 1.0;
}
`,"./shaders/post/video.wgsl":`// Analog VRX / digital VTX link artifacts. Everything scales with videoNoise (vn): grain and mild chroma bleed early, sync jitter and
// macroblocking in the middle, static bursts above 0.7. Colour work happens in the gamma-encoded domain, where real video is coded.
#include "post/sensor.wgsl"

const VIDEO_REF_WIDTH : f32 = 1280.0;

// Chroma is delayed along the scanline: it smears to the right by this many pixels at full noise.
fn videoBleedPx(vn : f32, width : f32) -> f32 {
  return 3.2 * saturate(vn * 1.2) * width / VIDEO_REF_WIDTH;
}

// Horizontal sync wobble per group of four rows, re-rolled every frame; only in the upper half of the noise range.
fn videoSyncJitterPx(row : f32, frame : u32, vn : f32, width : f32) -> f32 {
  let a = saturate((vn - 0.4) / 0.6);
  let h = unitOpen(pcgHash(u32(row * 0.25) * 2654435761u + frame * 40503u));
  return (h - 0.5) * 4.0 * a * a * width / VIDEO_REF_WIDTH;
}

// 0 = clean, 1 = pure static. A burst covers a band of rows for up to six frames; rarely the whole frame drops out.
fn videoBurstCover(v : f32, frame : u32, vn : f32) -> f32 {
  let p = smoothstep(0.7, 1.0, vn);
  // Below the existing burst threshold both selects are exactly zero.
  if (p <= 0.0) { return 0.0; }
  let h = pcg3d(vec3u(frame / 6u, 0x51u, 0x9du));
  let r = unitOpen(h.x);
  let y0 = unitOpen(h.y);
  let y1 = y0 + mix(0.03, 0.35, unitOpen(h.z));
  let band = smoothstep(y0, y0 + 0.004, v) * (1.0 - smoothstep(y1, y1 + 0.004, v));
  let full = select(0.0, 1.0, r >= 0.2 * p && r < 0.2 * p + 0.03 * p);
  return select(0.0, band, r < 0.2 * p) + full;
}

fn videoLuma(e : vec3f) -> f32 { return dot(e, vec3f(0.299, 0.587, 0.114)); }

// The camera's low-light colour processing on the encoded colour: below LOW_LIGHT_END luma the chroma is thinned (chroma noise reduction)
// and the white point drifts cool (the usual night grade, close to what a dark-adapted eye sees), fully so under LOW_LIGHT_START. Luma is kept.
const LOW_LIGHT_START : f32 = 0.03;
const LOW_LIGHT_END : f32 = 0.22;
const LOW_LIGHT_DESAT : f32 = 0.5;
const LOW_LIGHT_TINT : vec3f = vec3f(0.94, 0.99, 1.08);

fn lowLightGrade(e : vec3f) -> vec3f {
  let y = videoLuma(e);
  let k = 1.0 - smoothstep(LOW_LIGHT_START, LOW_LIGHT_END, y);
  if (k <= 0.0) { return e; }
  let o = mix(e, vec3f(y), LOW_LIGHT_DESAT * k) * mix(vec3f(1.0), LOW_LIGHT_TINT, k);
  return o * (y / max(videoLuma(o), 1e-4));
}

// 8x8 blocks with a per-block random offset before quantisation: coarse steps in luma, coarser in chroma, plus a small per-block DC error.
fn videoMacroblock(e : vec3f, pix : vec2f, frame : u32, vn : f32) -> vec3f {
  let m = smoothstep(0.5, 1.0, vn);
  if (m <= 0.0) { return e; }
  let h = pcg3d(vec3u(vec2u(pix) / 8u, frame / 5u));
  let ly = mix(256.0, 24.0, m);
  let lc = mix(256.0, 10.0, m * m);
  let y = videoLuma(e) + (unitOpen(h.z) - 0.5) * 0.03 * m;
  let yq = floor(y * ly + unitOpen(h.x)) / ly;
  let cq = floor((e - videoLuma(e)) * lc + vec3f(unitOpen(h.y))) / lc;
  return yq + cq;
}

// Scanline shimmer, block artifacts and static bursts on the encoded colour \`e\` of output pixel \`pix\` (uv = pix / size).
fn videoPost(e : vec3f, pix : vec2f, uv : vec2f, frame : u32, vn : f32) -> vec3f {
  let shimmer = 1.0 + vn * (0.06 * (unitOpen(pcgHash(u32(pix.y) + frame * 2246822519u)) - 0.5) - 0.02 * f32(u32(pix.y) & 1u));
  var o = videoMacroblock(lowLightGrade(e) * shimmer, pix, frame, vn);
  let cover = videoBurstCover(uv.y, frame, vn);
  if (cover > 0.0) {
    let snow = 0.1 + 0.75 * unitOpen(pcg3d(vec3u(vec2u(pix) / vec2u(2u, 1u), frame)).x);
    o = mix(o, vec3f(snow), saturate(cover) * 0.9);
  }
  return o;
}
`,"./shaders/post/whitebalance.wgsl":`// Camera auto white balance. \`meter\` reads the light falling on each sampled surface the way the deferred pass computes it: the key
// light (sun irradiance through the atmosphere, times its traced visibility and cosine) plus the diffuse GI (irradiance / pi and its
// visibility). That is a grey card at every pixel, whatever colour the surface is, so a frame of green leaves is not taken for a green
// light (a grey-world camera's mistake). Their mean log-chromaticity (ln r/g, ln b/g) is the illuminant estimate, each pixel weighted by the
// square root of its light: bright surfaces lead, as they do in a camera's white balance, so an open field balances on the sun and sky even
// with the shaded sides of trees in view, while a frame of forest shade, a few sunflecks aside, balances on the skylight there. \`resolve\` smooths it over time and turns
// it into the partial correction toward D65 a camera makes (post/whiteBalance.ts, whiteBalanceGains, mirrors it), written as red and blue
// gains into exposure.look.zw.
#include "common/world_bindings.wgsl"
#include "lighting/sky_safe.wgsl"

const WB_STRIDE : u32 = \${WB_STRIDE}u;
const WB_MAX_DIST : f32 = \${WB_MAX_DIST};
const WB_MIN_COUNT : f32 = \${WB_MIN_COUNT};
const WB_STRENGTH : f32 = \${WB_STRENGTH};
const WB_SOFT : f32 = \${WB_SOFT};
const WB_TAU : f32 = \${WB_TAU};
const WB_MAX_DT : f32 = \${WB_MAX_DT};
const WB_GAIN_LO : f32 = \${WB_GAIN_LO};
const WB_GAIN_HI : f32 = \${WB_GAIN_HI};
const WB_SUN_LO : f32 = \${WB_SUN_LO};
const WB_WARM_RG : f32 = \${WB_WARM_RG};
const WB_WARM_BG : f32 = \${WB_WARM_BG};
const WB_WARM_SUN_HI : f32 = \${WB_WARM_SUN_HI};
const WB_SUN_HI : f32 = \${WB_SUN_HI};
// ln(r/g), ln(b/g) of the fixed white point the night camera locks to (about 3600 K): it draws a moonless sky navy and the land cool grey.
const WB_NIGHT : vec2f = vec2f(\${WB_NIGHT_RG}, \${WB_NIGHT_BG});
const WB_FIXED : f32 = 1024.0;
const WB_LIMIT : f32 = 2.0;
// Weights are sqrt(pre-exposed irradiance / pi), at most WB_MAX_WEIGHT (a sunlit surface is about 1.2, deep shade 0.3), stored x WB_WEIGHT_FIXED.
const WB_MAX_WEIGHT : f32 = 4.0;
const WB_WEIGHT_FIXED : f32 = 256.0;

struct Params { dt : f32, reset : u32, pad0 : u32, pad1 : u32 };

@group(2) @binding(0) var gNormal : texture_2d<f32>;
@group(2) @binding(1) var gMisc : texture_2d<f32>;
@group(2) @binding(2) var gDepth : texture_depth_2d;
@group(2) @binding(3) var sunShadowTex : texture_2d<f32>;
@group(2) @binding(4) var giDiffuseTex : texture_2d<f32>;
@group(2) @binding(5) var<uniform> params : Params;
// Weighted sums of ln(r/g) and ln(b/g), and the weight (fixed point).
@group(2) @binding(6) var<storage, read_write> sums : array<atomic<i32>, 3>;
// state[0..1] = smoothed estimate (ln r/g, ln b/g), state[2] = 1 once initialised.
@group(2) @binding(7) var<storage, read_write> state : array<f32, 4>;
// The exposure buffer (post/exposure.ts): [1] = sensor gain EV over daylight, written by the exposure reduce this frame; [6], [7] = the
// red and blue gains this pass writes (0 = none, the composite then uses 1).
@group(2) @binding(8) var<storage, read_write> exposureOut : array<f32, 8>;

var<workgroup> wgA : array<i32, 64>;
var<workgroup> wgB : array<i32, 64>;
var<workgroup> wgN : array<i32, 64>;

// Pre-exposed irradiance / pi on the surface at full-resolution pixel q, or 0 where there is no opaque, lit, near surface.
fn cardLight(q : vec2i, dims : vec2i) -> vec3f {
  let depth = textureLoad(gDepth, q, 0);
  if (depth <= 0.0 || frame.params.z / depth > WB_MAX_DIST) { return vec3f(0.0); }
  if (textureLoad(gMisc, q, 0).a > 0.0) { return vec3f(0.0); }
  let rtDims = vec2i(textureDimensions(giDiffuseTex));
  let rq = clamp(q * rtDims / dims, vec2i(0), rtDims - 1);
  let gi = textureLoad(giDiffuseTex, rq, 0);
  if (gi.a <= 0.0) { return vec3f(0.0); }
  let n = octDecode(textureLoad(gNormal, q, 0).xy);
  var light = gi.rgb * gi.a;
  if (frame.sunIrradiance.w != 0.0 && frame.misc.w != 1u) {
    let sunE = frame.sunIrradiance.rgb * frame.sunIrradiance.w * sampleTransmittance(atmosRadiusAtHeight(frame.camPos.y), frame.sunDir.y);
    let vis = saturate1(textureLoad(sunShadowTex, rq, 0).x);
    light += sunE * (vis * max(dot(n, frame.sunDir.xyz), 0.0) * INV_PI * frame.params.y);
  }
  return light;
}

@compute @workgroup_size(8, 8)
fn meter(@builtin(global_invocation_id) gid : vec3u, @builtin(local_invocation_index) li : u32) {
  let dims = vec2i(textureDimensions(gDepth));
  let q = vec2i(gid.xy * WB_STRIDE + vec2u(WB_STRIDE / 2u));
  var s = vec3f(0.0);
  if (all(q < dims)) {
    let light = cardLight(q, dims);
    if (all(light > vec3f(1e-9)) && all(light < vec3f(1e9))) {
      let w = min(sqrt(dot(light, vec3f(0.2126, 0.7152, 0.0722))), WB_MAX_WEIGHT);
      s = vec3f(clamp(log(light.r / light.g), -WB_LIMIT, WB_LIMIT), clamp(log(light.b / light.g), -WB_LIMIT, WB_LIMIT), 1.0) * w;
    }
  }
  wgA[li] = i32(round(s.x * WB_FIXED));
  wgB[li] = i32(round(s.y * WB_FIXED));
  wgN[li] = i32(round(s.z * WB_WEIGHT_FIXED));
  workgroupBarrier();
  for (var o = 32u; o > 0u; o >>= 1u) {
    if (li < o) { wgA[li] += wgA[li + o]; wgB[li] += wgB[li + o]; wgN[li] += wgN[li + o]; }
    workgroupBarrier();
  }
  if (li == 0u && wgN[0] > 0) {
    atomicAdd(&sums[0], wgA[0]);
    atomicAdd(&sums[1], wgB[0]);
    atomicAdd(&sums[2], wgN[0]);
  }
}

@compute @workgroup_size(1)
fn resolve() {
  let a = f32(atomicExchange(&sums[0], 0)) / WB_FIXED;
  let b = f32(atomicExchange(&sums[1], 0)) / WB_FIXED;
  let n = f32(atomicExchange(&sums[2], 0)) / WB_WEIGHT_FIXED;
  var est = vec2f(state[0], state[1]);
  let fresh = state[2] < 0.5 || params.reset != 0u;
  if (n >= WB_MIN_COUNT) {
    let want = vec2f(a, b) / n;
    let k = select(1.0 - exp(-clamp(params.dt, 0.0, WB_MAX_DT) / WB_TAU), 1.0, fresh);
    est += (want - est) * k;
    state[2] = 1.0;
  } else if (fresh) {
    est = vec2f(0.0);
  }
  state[0] = est.x;
  state[1] = est.y;
  // Partial correction: nearly all of a small cast, less of a strong one. It fades out once the sun is down (blue hour stays blue); at
  // golden hour it balances the skylit shade, so the sunlit parts read warm. In the dark the camera locks to its fixed night white point.
  let night = smoothstep(WB_GAIN_LO, WB_GAIN_HI, exposureOut[1]);
  let lowSun = 1.0 - smoothstep(WB_SUN_LO, WB_SUN_HI, frame.sunDir.y);
  let f = WB_STRENGTH / (1.0 + length(est) / WB_SOFT) * (1.0 - night) * (1.0 - lowSun);
  // Golden hour keeps part of its amber (goldenWarmth in whiteBalance.ts): a camera does not neutralise a low sun completely.
  let warm = smoothstep(WB_SUN_LO, 0.0, frame.sunDir.y) * (1.0 - smoothstep(WB_SUN_HI, WB_WARM_SUN_HI, frame.sunDir.y)) * (1.0 - night);
  let g = exp(-f * est + night * WB_NIGHT + warm * vec2f(WB_WARM_RG, WB_WARM_BG));
  // Gains (red, 1, blue) rescaled so a grey keeps its luminance; the composite rebuilds green from the two.
  let y = 0.2126 * g.x + 0.7152 + 0.0722 * g.y;
  exposureOut[6] = g.x / y;
  exposureOut[7] = g.y / y;
}
`,"./shaders/rt/atrous.wgsl":`// One a-trous (edge-avoiding wavelet) iteration over a temporally accumulated signal. Defines: SHADOW | GI | SPEC, ITER (0.0/1.0/2.0),
// OUTFMT (storage format of the destination), FINAL (last iteration: applies the debug views and writes the G-buffer's own formats).
// Edge stops: world-space plane distance, normal, and luminance scaled by the temporal variance (tighter every iteration).
// Specular values are premultiplied by their confidence in .a; the FINAL pass divides it out and widens the stride with roughness.
#include "rt/rt_common.wgsl"

@group(\${GRP}) @binding(1) var auxDepth : texture_2d<f32>;
@group(\${GRP}) @binding(2) var auxNormal : texture_2d<f32>;
@group(\${GRP}) @binding(3) var srcTex : texture_2d<f32>;
@group(\${GRP}) @binding(4) var momTex : texture_2d<f32>;
@group(\${GRP}) @binding(5) var dstTex : texture_storage_2d<\${OUTFMT}, write>;
@group(\${GRP}) @binding(6) var<storage, read_write> varBuf : array<f32>;

const ITER : f32 = \${ITER};
const LUMA_FLOOR : f32 = 0.01;
const AO_VIEW_NITS : f32 = 4000.0;
const SHADOW_PENUMBRA_M : f32 = 0.5;
// ITER is a pipeline-creation constant, so this is evaluated once when the module is built rather than per pixel.
// The tighter 0.6^ITER schedule is the point of the iteration: the later passes accept less luma difference.
const SIGMA_ITER : f32 = 4.0 * pow(0.6, ITER);

fn tapWeight(i : i32) -> f32 {
  let a = abs(i);
  return select(select(1.0 / 16.0, 4.0 / 16.0, a == 1), 6.0 / 16.0, a == 0);
}

fn tapLuma(v : vec4f) -> f32 {
#ifdef SHADOW
  return v.x;
#else
  return luminance(v.rgb);
#endif
}

fn dstValue(v : vec4f, px : vec2i) -> vec4f {
#ifdef FINAL
  let dbg = rp.dbg.x;
#ifdef SHADOW
  return vec4f(select(0.0, v.x, dbg <= 1u), 0.0, 0.0, 0.0);
#endif
#ifdef GI
  let pre = frame.params.y;
  let a = max(v.a, 1.0 / 255.0);
  switch (dbg) {
    case 1u: { return vec4f(0.0, 0.0, 0.0, 1.0 / 255.0); }
    case 3u: { return vec4f(vec3f(AO_VIEW_NITS * pre * v.a), 1.0); }
    case 4u: { return vec4f(0.0, 0.0, 0.0, 1.0); }
    case 6u: {
      let m = textureLoad(momTex, px, 0);
      return vec4f(vec3f(min(sqrt(m.w) * 4.0, 1.0), min(m.z / 16.0, 1.0), 0.0) * (AO_VIEW_NITS * pre), 1.0);
    }
    default: { return vec4f(max(v.rgb, vec3f(0.0)), a); }
  }
#endif
#ifdef SPEC
  let on = dbg == 0u || dbg == 4u;
  return select(vec4f(0.0), vec4f(max(v.rgb, vec3f(0.0)) / max(v.a, 0.02), v.a), on);
#endif
#else
  return v;
#endif
}

// Signed distance along n of the world point a tap sees, as a function of its uv and linear depth only - the
// world position is never formed. worldFromDepth(uv, d) is (M * (x, y, d, 1)).xyz / w with M = invViewProj, so
//   dot(n, world) = (A.x*x + A.y*y + A.z*d + A.w) / (R.x*x + R.y*y + R.z*d + R.w)
// where A pairs n with each column of M and R is M's w row. That is two three-term dot products and one
// divide, against a 4x4 matrix-vector product (16 mul, 12 add) and its divide per tap. A depends on the
// texel's normal, so the caller builds it once per texel; R is the same every frame.
fn planeStop(uv : vec2f, linearZ : f32, A : vec4f, R : vec4f, near : f32) -> f32 {
  let d = near / linearZ;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  return (dot(A.xy, ndc) + A.z * d + A.w) / (dot(R.xy, ndc) + R.z * d + R.w);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (any(gid.xy >= rp.dims.xy)) { return; }
  let px = vec2i(gid.xy);
  let dims = rtSize();
  let z = textureLoad(auxDepth, px, 0).x;
  let centre = textureLoad(srcTex, px, 0);
  if (z <= 0.0) {
    textureStore(dstTex, px, fp16Safe(dstValue(centre, px)));
    return;
  }
  let an = textureLoad(auxNormal, px, 0);
  let n = octDecode(an.xy);
  // The edge stop compares each tap against this texel's own plane, so the centre's own dot(n, pos) is the
  // origin both sides are measured from.
  let m = frame.invViewProj;
  let planeA = vec4f(dot(n, m[0].xyz), dot(n, m[1].xyz), dot(n, m[2].xyz), dot(n, m[3].xyz));
  let planeR = vec4f(m[0].w, m[1].w, m[2].w, m[3].w);
  let near = frame.params.z;
  let plane0 = planeStop(pixelUv(rtSrc(px)), z, planeA, planeR, near);

  // The 3x3 moment sum that steers sigmaL is a pure function of momTex, the texel and the RT size, and momTex is the same texture for all
  // three iterations of a frame - so only the first iteration computes it. Later iterations read it back (a f32 value stored to a f32 buffer
  // is bit-identical to recomputing it), which removes 18 of the 27 moment fetches per texel. The early return above covers exactly the texels
  // that skip the write, and it runs before this point in every iteration alike, so a read is never uninitialised.
#ifdef VARSTORE
  var varSum = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let q = clamp(px + vec2i(i, j), vec2i(0), dims - vec2i(1));
      varSum += textureLoad(momTex, q, 0).w * select(0.5, 0.25, i != 0) * select(0.5, 0.25, j != 0);
    }
  }
  varBuf[u32(px.y) * u32(dims.x) + u32(px.x)] = varSum;
#else
  let varSum = varBuf[u32(px.y) * u32(dims.x) + u32(px.x)];
#endif
  let sigmaL = SIGMA_ITER * sqrt(max(varSum, 0.0)) + LUMA_FLOOR;
  let lc = tapLuma(centre);
  let zTol = 0.005 * z + 0.02;

  var stride = exp2(ITER);
#ifdef SPEC
  stride = max(1.0, round(stride * clamp(an.z / 0.6, 0.0, 1.0) * 1.5));
#endif
  let stepPx = i32(stride);
#ifdef SHADOW
  // A sun shadow's real penumbra is at most about SHADOW_PENUMBRA_M wide (a 50 m occluder at the sun's 0.5 degrees), but the 5x5 kernel
  // at stride 4 spans 16 RT texels, which on far ground is tens of metres: a lone tree's crisp shadow came out as a black blob several
  // times its size. Each tap is also weighted by its distance on the ground, so the blur never grows wider than the penumbra (or than
  // one texel's footprint, where that is wider and the noise is all sub-pixel).
  let texelM = z * 2.0 / (frame.proj[1][1] * f32(dims.y));
  let invSpread2 = 1.0 / sq(max(SHADOW_PENUMBRA_M, 1.5 * texelM));
  // The shadow signal is a single scalar channel: tapLuma() and dstValue() read .x only, so .y/.z/.w of every source tap and of the
  // accumulator are dead. Accumulating the scalar removes 3 of the 4 vector multiply-adds from each of the 25 taps, and lets the
  // shader fetch just the one channel it uses. The other signals keep the full rgba accumulator.
  var sum = 0.0;
#else
  var sum = vec4f(0.0);
#endif
  var wSum = 0.0;
  for (var j = -2; j <= 2; j++) {
    // tapWeight(j) is the same for all five taps of a row, so it is computed once per row instead of
    // once per tap: five times fewer evaluations over the 5x5 kernel. Bit-identical - it is the same
    // function on the same argument, just not recomputed 25 times for 5 distinct values.
    let twj = tapWeight(j);
    for (var i = -2; i <= 2; i++) {
      let q = px + vec2i(i, j) * stepPx;
      if (any(q < vec2i(0)) || any(q >= dims)) { continue; }
      let zq = textureLoad(auxDepth, q, 0).x;
      if (zq <= 0.0) { continue; }
      let s = textureLoad(srcTex, q, 0);
      let nq = octDecode(textureLoad(auxNormal, q, 0).xy);
      // dot(n, pq - pos), with neither world position formed.
      let wz = exp(-abs(planeStop(pixelUv(rtSrc(q)), zq, planeA, planeR, near) - plane0) / zTol);
      // dot^16 as four multiplies rather than pow(x, 16.0): the same function without the transcendental
      // (which a driver expands to a log2/exp2 pair plus a polynomial). Squaring twice and multiplying keeps
      // the taps independent, so they are not serialised down one dependency chain.
      let nd = max(dot(n, nq), 0.0);
      let nd2 = nd * nd;
      let wn = nd2 * nd2 * nd2 * nd2;
      // Both remaining stops only attenuate, so exp(a) * exp(b) is one exp(a + b) rather than two
      // transcendentals per tap. The exponent is a sum of two non-positive terms, so it stays <= 0 and
      // cannot overflow.
#ifdef SHADOW
      let w = tapWeight(i) * twj * wz * wn * exp(-abs(lc - tapLuma(s)) / sigmaL - f32(i * i + j * j) * sq(stride * texelM) * invSpread2);
#else
      let w = tapWeight(i) * twj * wz * wn * exp(-abs(lc - tapLuma(s)) / sigmaL);
#endif
#ifdef SHADOW
      sum += s.x * w;
#else
      sum += s * w;
#endif
      wSum += w;
    }
  }
#ifdef SHADOW
  // Reproduces select(centre, sum / wSum, ok) channel for channel: the scalar average carries .x, and the unused channels stay exactly
  // what the rgba form stored (centre's, on the degenerate wSum path, 0.0 otherwise - s.y/.z/.w are 0, so sum.y/.z/.w were 0).
  let acc = select(centre, vec4f(sum / wSum, 0.0, 0.0, 0.0), wSum > 1e-6);
  textureStore(dstTex, px, fp16Safe(dstValue(acc, px)));
#else
  textureStore(dstTex, px, fp16Safe(dstValue(select(centre, sum / wSum, wSum > 1e-6), px)));
#endif
}
`,"./shaders/rt/aux_pass.wgsl":`// Aux pass: linear depth and normal/roughness/metalness of the full-res pixel each RT texel represents this frame (rtSourcePixel).
// Read by the trace passes, the temporal/a-trous filters and (via the same pixel mapping) the bilateral upsample in lighting.
#include "rt/rt_common.wgsl"
#include "common/world_bindings.wgsl"

@group(\${GRP}) @binding(1) var gDepth : texture_depth_2d;
@group(\${GRP}) @binding(2) var gNormal : texture_2d<f32>;
@group(\${GRP}) @binding(3) var gMisc : texture_2d<f32>;
@group(\${GRP}) @binding(4) var rtDepthOut : texture_storage_2d<r32float, write>;
@group(\${GRP}) @binding(5) var rtNormalOut : texture_storage_2d<rgba16float, write>;

// Metalness value the aux normal's w carries for a leaf (above any real metalness, which is at most 1).
const AUX_FOLIAGE : f32 = 2.0;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (any(gid.xy >= rp.dims.xy)) { return; }
  let px = vec2i(gid.xy);
  let src = rtSrc(px);
  let z = linearDepth(textureLoad(gDepth, src, 0));
  var nrm = textureLoad(gNormal, src, 0);
  let misc = textureLoad(gMisc, src, 0);
  // misc.b is wetness, except on trees, where it is the shadow of the bark's furrows (tree.wgsl).
  let mat = u32(misc.r * 255.0 + 0.5);
  let wet = select(misc.b, 0.0, mat == 5u);
  // Thin grass alternates with the ground as coverage and sample pixels change. A blade's shading normal is unsuitable
  // for ray bias and history validation: use the underlying sward plane, while deferred lighting keeps the blade normal.
  let grass = u32(misc.r * 255.0 + 0.5) == 2u && misc.g > 0.0;
  if (grass && z > 0.0 && (rp.cfg.w & FLAG_TERRAIN) != 0u) {
    let pos = worldFromLinear(pixelUv(src), z);
    nrm = vec4f(octEncode(terrainNormalAt(pos.xz)), nrm.zw);
  }
  textureStore(rtDepthOut, px, vec4f(z, 0.0, 0.0, 0.0));
  // Foliage is never metal: its w carries AUX_FOLIAGE instead, so the trace passes know a leaf (rt_trace_io.wgsl loadPixel).
  textureStore(rtNormalOut, px, vec4f(nrm.xy, nrm.z * mix(1.0, 0.4, wet), select(nrm.w, AUX_FOLIAGE, mat == 5u)));
}
`,"./shaders/rt/gi.wgsl":`#include "rt/rt_trace_io.wgsl"
#ifdef GI_RECORDED
@group(\${GRP}) @binding(12) var giHit0 : texture_2d<f32>;
@group(\${GRP}) @binding(13) var giHit1 : texture_2d<f32>;
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
@group(\${GRP}) @binding(14) var giVisibility0 : texture_2d<f32>;
@group(\${GRP}) @binding(15) var giVisibility1 : texture_2d<f32>;
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


// Diffuse GI: \`giRays\` cosine-weighted rays per RT texel (blue noise rotated per frame). A hit returns its shaded radiance (direct light with a
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
`,"./shaders/rt/latch.wgsl":`// Remembers this frame's pre-exposure for the next frame's history/probe rescale (0 = no history yet).
#include "rt/rt_common.wgsl"

@group(\${GRP}) @binding(1) var<storage, read_write> prevPre : array<f32>;

@compute @workgroup_size(1)
fn main() {
  prevPre[0] = frame.params.y;
}
`,"./shaders/rt/probe_plan.wgsl":`// One invocation per physical probe texel: append traced probes or carry the old SH value.
// The trace pass reads only the previous set, so carry and trace output texels have disjoint owners.
#include "rt/rt_common.wgsl"

@group(\${GRP}) @binding(3) var probeR : texture_3d<f32>;
@group(\${GRP}) @binding(4) var probeG : texture_3d<f32>;
@group(\${GRP}) @binding(5) var probeB : texture_3d<f32>;
@group(\${GRP}) @binding(6) var newR : texture_storage_3d<rgba16float, write>;
@group(\${GRP}) @binding(7) var newG : texture_storage_3d<rgba16float, write>;
@group(\${GRP}) @binding(8) var newB : texture_storage_3d<rgba16float, write>;
@group(\${GRP}) @binding(9) var<storage, read> prevPre : array<f32>;
@group(\${GRP}) @binding(12) var<storage, read_write> activeIds : array<u32>;
struct ProbeDispatch { x : atomic<u32>, y : u32, z : u32, pad : u32 }
@group(\${GRP}) @binding(13) var<storage, read_write> dispatch : ProbeDispatch;

fn posmod3(a : vec3i, m : vec3i) -> vec3i { return ((a % m) + m) % m; }

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (any(gid >= rp.probeDim.xyz)) { return; }
  let dim = vec3i(rp.probeDim.xyz);
  let cell = vec3i(gid);
  let lattice = rp.probeLo.xyz + posmod3(cell - rp.probeLo.xyz, dim);
  let prevLo = rp.probePrev.xyz;
  let inPrev = all(lattice >= prevLo) && all(lattice < prevLo + dim);
  let fresh = rp.probePrev.w == 1 || !inPrev;
  let id = u32(cell.x + dim.x * (cell.y + dim.y * cell.z));
  let doTrace = fresh || (id % max(rp.dbg.z, 1u)) == rp.dbg.w;
  if (doTrace) {
    // Capacity is the complete grid; each valid cell can append exactly once.
    let slot = atomicAdd(&dispatch.x, 1u);
    activeIds[slot] = id;
    return;
  }
  let pp = prevPre[0];
  let ratio = select(1.0, frame.params.y / pp, pp > 0.0);
  let oldR = fp16Safe(textureLoad(probeR, cell, 0));
  let oldG = fp16Safe(textureLoad(probeG, cell, 0));
  let oldB = fp16Safe(textureLoad(probeB, cell, 0));
  textureStore(newR, cell, fp16Safe(oldR * ratio));
  textureStore(newG, cell, fp16Safe(oldG * ratio));
  textureStore(newB, cell, fp16Safe(oldB * ratio));
}
`,"./shaders/rt/probe_update.wgsl":`// Radiance probe grid update. One 64-thread workgroup per probe (dispatch = grid dimensions). The grid is toroidal: lattice coordinate c
// lives at texel posmod(c, dim). A probe is re-traced when it is fresh (entered the window / first frame) or on its turn in the rotating
// subset (id % K == phase); other probes only carry their old value forward, rescaled for the pre-exposure change. Each traced probe
// projects \`raysPerProbe\` Fibonacci-sphere radiance samples onto SH-L1 (one rgba16f 3D texture per colour channel = c0..c3) and blends
// them into the old value with the hysteresis factor.
#include "rt/rt_scene.wgsl"

@group(\${GRP}) @binding(6) var newR : texture_storage_3d<rgba16float, write>;
@group(\${GRP}) @binding(7) var newG : texture_storage_3d<rgba16float, write>;
@group(\${GRP}) @binding(8) var newB : texture_storage_3d<rgba16float, write>;
@group(\${GRP}) @binding(9) var<storage, read> prevPre : array<f32>;
#ifdef COMPACT
@group(\${GRP}) @binding(12) var<storage, read> activeIds : array<u32>;
#endif

const GOLDEN_ANGLE : f32 = 2.399963;
const PROBE_LIFT : f32 = 0.75;
const GROUP_SIZE : u32 = 64u;

var<workgroup> shR : array<vec4f, 64>;
var<workgroup> shG : array<vec4f, 64>;
var<workgroup> shB : array<vec4f, 64>;

fn posmod3(a : vec3i, m : vec3i) -> vec3i { return ((a % m) + m) % m; }

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg : vec3u, @builtin(local_invocation_index) lid : u32) {
  let dim = vec3i(rp.probeDim.xyz);
#ifdef COMPACT
  let activeId = activeIds[wg.x];
  let udim = rp.probeDim.xyz;
  let cell = vec3i(i32(activeId % udim.x), i32((activeId / udim.x) % udim.y), i32(activeId / (udim.x * udim.y)));
#else
  let cell = vec3i(wg);
#endif
  let lattice = rp.probeLo.xyz + posmod3(cell - rp.probeLo.xyz, dim);
  let prevLo = rp.probePrev.xyz;
  let inPrev = all(lattice >= prevLo) && all(lattice < prevLo + dim);
  let fresh = rp.probePrev.w == 1 || !inPrev;
  let id = u32(cell.x + dim.x * (cell.y + dim.y * cell.z));
  let doTrace = fresh || (id % max(rp.dbg.z, 1u)) == rp.dbg.w;
  let pp = prevPre[0];
  let ratio = select(1.0, frame.params.y / pp, pp > 0.0);
  let oldR = fp16Safe(textureLoad(probeR, cell, 0));
  let oldG = fp16Safe(textureLoad(probeG, cell, 0));
  let oldB = fp16Safe(textureLoad(probeB, cell, 0));
  if (!doTrace) {
    if (lid == 0u) {
      textureStore(newR, cell, fp16Safe(oldR * ratio));
      textureStore(newG, cell, fp16Safe(oldG * ratio));
      textureStore(newB, cell, fp16Safe(oldB * ratio));
    }
    return;
  }

  probeGain = ratio;
  var p = vec3f(lattice) * rp.f.y;
  p.y = max(p.y, select(0.0, terrainHeightAt(p.xz), hasTerrain()) + PROBE_LIFT);
  let e = envAt(p.y);
  let steps = rp.cfg.y;
  let total = u32(rp.probeLo.w);
  let h = pcg3(vec3u(bitcast<u32>(lattice.x), bitcast<u32>(lattice.y), bitcast<u32>(lattice.z) ^ (rp.dbg.y * 2654435761u)));
  let u = vec3f(f32(h.x >> 8u), f32(h.y >> 8u), f32(h.z >> 8u)) * (1.0 / 16777216.0);
  let axisZ = 1.0 - 2.0 * u.x;
  let axisS = sqrt(max(0.0, 1.0 - axisZ * axisZ));
  let basis = basisFromNormal(vec3f(axisS * cos(TAU * u.y), axisS * sin(TAU * u.y), axisZ));
  let phi0 = TAU * u.z;

  var cr = vec4f(0.0);
  var cg = vec4f(0.0);
  var cb = vec4f(0.0);
  for (var r = lid; r < total; r += GROUP_SIZE) {
    let z = 1.0 - 2.0 * (f32(r) + 0.5) / f32(total);
    let s = sqrt(max(0.0, 1.0 - z * z));
    let phi = GOLDEN_ANGLE * f32(r) + phi0;
    let d = basis * vec3f(s * cos(phi), s * sin(phi), z);
    let hit = traceScene(p, d, rp.f.w, steps);
    var radiance : vec3f;
    if (hit.kind == KIND_MISS) {
      radiance = skyRadiance(d, e);
    } else {
      radiance = hitRadiance(hit, p, d, e, steps);
    }
    radiance = min(radiance, vec3f(MAX_PROBE_RADIANCE));
    let y = vec4f(SH_Y0, SH_Y1 * d.y, SH_Y1 * d.z, SH_Y1 * d.x);
    cr += y * radiance.r;
    cg += y * radiance.g;
    cb += y * radiance.b;
  }
  shR[lid] = cr;
  shG[lid] = cg;
  shB[lid] = cb;
  workgroupBarrier();
  for (var stride = GROUP_SIZE / 2u; stride > 0u; stride = stride >> 1u) {
    if (lid < stride) {
      shR[lid] += shR[lid + stride];
      shG[lid] += shG[lid + stride];
      shB[lid] += shB[lid + stride];
    }
    workgroupBarrier();
  }
  if (lid == 0u) {
    let norm = 4.0 * PI / f32(total);
    let blend = select(1.0 - rp.f.z, 1.0, fresh);
    textureStore(newR, cell, fp16Safe(mix(oldR * ratio, shR[0] * norm, blend)));
    textureStore(newG, cell, fp16Safe(mix(oldG * ratio, shG[0] * norm, blend)));
    textureStore(newB, cell, fp16Safe(mix(oldB * ratio, shB[0] * norm, blend)));
  }
}
`,"./shaders/rt/rt_bvh.wgsl":`// Stack traversal of the packed BVH (see src/render/rt/bvh.ts for the layout). Two roots share one stack: the static tree
// (params.scene.x) and the small per-frame dynamic tree (params.scene.y). Children are box-tested when their parent is visited and
// pushed far-first, each with its entry distance so a popped node is skipped once a closer hit is known.
#include "rt/rt_prims.wgsl"
#include "rt/rt_canopy.wgsl"

const STACK_SIZE : u32 = 32u;

struct BvhHit { t : f32, prim : u32 }

// Entry distance of the ray into node n's box, or NO_HIT.
fn nodeEntry(n : u32, o : vec3f, inv : vec3f, tMax : f32) -> f32 {
  let lo = bitcast<vec3f>(bvhNodes[n * 2u].xyz);
  let hi = bitcast<vec3f>(bvhNodes[n * 2u + 1u].xyz);
  let a = (lo - o) * inv;
  let b = (hi - o) * inv;
  let t0 = max(max(min(a.x, b.x), min(a.y, b.y)), max(min(a.z, b.z), 0.0));
  let t1 = min(min(max(a.x, b.x), max(a.y, b.y)), min(max(a.z, b.z), tMax));
  return select(NO_HIT, t0, t0 <= t1);
}

// Node index and its entry distance share one 8-byte stack slot: the walk pops and pushes the pair together, so it moves one local word per
// step instead of two (a variable index forces the stack into per-thread local memory, where each lane's slot is a separate access).
struct BvhStackEntry { node : u32, entry : f32 }

// Nearest hit along o + t*d (unit d) within tMax. Visits at most \`cap\` nodes.
fn traceBvh(o : vec3f, d : vec3f, tMax : f32, cap : u32) -> BvhHit {
  var best = BvhHit(tMax, NO_NODE);
  let inv = 1.0 / select(d, vec3f(1e-8), abs(d) < vec3f(1e-8));
  var stack : array<u32, 32>;
  var sp = 0u;
  if (rp.scene.y != NO_NODE) { stack[sp] = rp.scene.y; sp++; }
  if (rp.scene.x != NO_NODE) { stack[sp] = rp.scene.x; sp++; }
  var visits = 0u;
  var descend = false;
  var top : BvhStackEntry;
  while ((sp > 0u || descend) && visits < cap) {
    if (!descend) {
      sp--;
      let popped = stack[sp];
      var entry = 0.0;
      if (popped != rp.scene.x && popped != rp.scene.y) { entry = nodeEntry(popped, o, inv, tMax); }
      top = BvhStackEntry(popped, entry);
    }
    descend = false;
    if (top.entry > best.t) { continue; }
    visits++;
    let n = top.node;
    let n0 = bvhNodes[n * 2u];
    let count = bvhNodes[n * 2u + 1u].w;
    if (count > 0u) {
      for (var k = 0u; k < count; k++) {
        var t = intersectPrim(n0.w + k, o, d, best.t);
        // A crown sphere the ray starts inside is met at its far side (rt_canopy.wgsl canopyInsideExit).
        if (t >= best.t && primIsCanopy(n0.w + k)) { t = canopyInsideExit(n0.w + k, o, d, best.t); }
        if (t < best.t) {
          best = BvhHit(t, n0.w + k);
        }
      }
      continue;
    }
    let tl = nodeEntry(n0.w, o, inv, best.t);
    let tr = nodeEntry(n0.w + 1u, o, inv, best.t);
    if (sp + 2u > STACK_SIZE) { continue; }
    let leftFirst = tl <= tr;
    let nearT = select(tr, tl, leftFirst);
    let farT = select(tl, tr, leftFirst);
    if (farT < NO_HIT) {
      stack[sp] = select(n0.w, n0.w + 1u, leftFirst);
      sp++;
    }
    if (nearT < NO_HIT) {
      // The near child is the very next pop. Carry it directly while the far
      // child stays on the stack; preserve the original overflow check above.
      top = BvhStackEntry(select(n0.w + 1u, n0.w, leftFirst), nearT);
      descend = true;
    }
  }
  return best;
}

// Fraction of the light that survives the proxies along o + t*d (unit d) within tMax: 0 as soon as an opaque primitive is hit, otherwise the
// Beer-Lambert product over every leaf-canopy crown crossed (their optical depths add). Visits at most \`cap\` nodes; the remainder counts as clear.
fn traceBvhTransmit(o : vec3f, d : vec3f, tMax : f32, cap : u32) -> f32 {
  let inv = 1.0 / select(d, vec3f(1e-8), abs(d) < vec3f(1e-8));
  var stack : array<u32, 32>;
  var sp = 0u;
  if (rp.scene.y != NO_NODE) { stack[sp] = rp.scene.y; sp++; }
  if (rp.scene.x != NO_NODE) { stack[sp] = rp.scene.x; sp++; }
  var tau = 0.0;
  var visits = 0u;
  var descend = false;
  var n = 0u;
  while ((sp > 0u || descend) && visits < cap) {
    if (!descend) {
      sp--;
      n = stack[sp];
    }
    descend = false;
    visits++;
    let n0 = bvhNodes[n * 2u];
    let count = bvhNodes[n * 2u + 1u].w;
    if (count > 0u) {
      for (var k = 0u; k < count; k++) {
        let i = n0.w + k;
        if (primIsCanopy(i)) {
#ifndef CANOPY_SHADOW_MAP
          tau += canopyOpticalDepth(i, o, d, tMax);
#endif
        } else if (intersectPrim(i, o, d, tMax) <= tMax) {
          return 0.0;
        }
      }
      if (tau > CANOPY_OPAQUE_TAU) { return 0.0; }
      continue;
    }
    if (sp + 2u > STACK_SIZE) { continue; }
    let tl = nodeEntry(n0.w, o, inv, tMax);
    let tr = nodeEntry(n0.w + 1u, o, inv, tMax);
    let leftFirst = tl <= tr;
    if (select(tl, tr, leftFirst) < NO_HIT) {
      stack[sp] = select(n0.w, n0.w + 1u, leftFirst);
      sp++;
    }
    if (select(tr, tl, leftFirst) < NO_HIT) {
      n = select(n0.w + 1u, n0.w, leftFirst);
      descend = true;
    }
  }
  return exp(-tau);
}
`,"./shaders/rt/rt_canopy.wgsl":`// Leaf-canopy transmittance of the crown proxy spheres (flagged in word 15 of the packed primitive, see src/render/rt/canopy.ts which this mirrors).
// Light crossing a crown is attenuated by Beer-Lambert extinction integrated along the chord, with a fluffy rim and clump noise, so a crown
// casts a soft, dappled, partially transparent shadow. Included by rt_bvh.wgsl (needs primWord from rt_prims.wgsl).

const CANOPY_EXTINCTION : f32 = 0.19;
const CANOPY_CORE : f32 = 0.6;
const CANOPY_RIM_NOISE : f32 = 0.3;
const CANOPY_LOBE : f32 = 0.15;
const CANOPY_GAP_BASE : f32 = 0.4;
const CANOPY_GAP_SPAN : f32 = 1.2;
const CANOPY_INV_CLUMP : f32 = 1.1111111;
const CANOPY_SAMPLES : u32 = 4u;
const CANOPY_OPAQUE_TAU : f32 = 4.0;
const PRIM_FLAG_CANOPY : u32 = 1u;

fn primIsCanopy(i : u32) -> bool { return (primWord(i, 3u).w & PRIM_FLAG_CANOPY) != 0u; }

fn latticeNoise(c : vec3i) -> f32 { return hash31(bitcast<vec3u>(c)); }

fn valueNoise3(p : vec3f) -> f32 {
  let fl = floor(p);
  let f = p - fl;
  let u = f * f * (3.0 - 2.0 * f);
  let b = vec3i(fl);
  let x00 = mix(latticeNoise(b), latticeNoise(b + vec3i(1, 0, 0)), u.x);
  let x10 = mix(latticeNoise(b + vec3i(0, 1, 0)), latticeNoise(b + vec3i(1, 1, 0)), u.x);
  let x01 = mix(latticeNoise(b + vec3i(0, 0, 1)), latticeNoise(b + vec3i(1, 0, 1)), u.x);
  let x11 = mix(latticeNoise(b + vec3i(0, 1, 1)), latticeNoise(b + vec3i(1, 1, 1)), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

fn canopyLobe(u : vec3f, c : vec3f) -> f32 {
  let ph = c.x * 0.73 + c.z * 1.31;
  return sin(3.3 * u.x + ph) * sin(2.6 * u.z + 1.7 * u.y + ph * 1.3);
}

// Per-ray random in [0, 1) (origin, direction and frame): the chord samples are dithered with it, the temporal / a-trous passes average it out.
fn canopyJitter(o : vec3f, d : vec3f) -> f32 {
  return hash31(bitcast<vec3u>(o * 97.0 + d * 1013.0 + vec3f(f32(frameIndex() & 1023u) * 0.7548776662)));
}

// A ray that starts inside crown sphere \`i\` (a GI ray leaving a leaf of that crown) meets the crown where it leaves it: the distance to the
// sphere's far side, or NO_HIT for a ray from outside (the plain sphere test finds its entry). Without this the ray would pass through its
// own crown as if it were open sky, and every leaf inside a crown would be lit by the whole sky (rt_scene.wgsl hitRadianceChord then blends
// the crown's scattered light with the sky by the chord's transmittance from the leaf out).
fn canopyInsideExit(i : u32, o : vec3f, d : vec3f, tMax : f32) -> f32 {
  let c = bitcast<vec4f>(primWord(i, 0u)).xyz;
  let r = bitcast<vec4f>(primWord(i, 1u)).w;
  let oc = o - c;
  let inside = r * r - dot(oc, oc);
  if (inside <= 0.0) { return NO_HIT; }
  let b = dot(oc, d);
  let t = -b + sqrt(b * b + inside);
  return select(NO_HIT, t, t > T_EPS && t <= tMax);
}

// Optical depth of crown sphere \`i\` along o + t*d (unit d) within [0, tMax].
fn canopyOpticalDepth(i : u32, o : vec3f, d : vec3f, tMax : f32) -> f32 {
  let c = bitcast<vec4f>(primWord(i, 0u)).xyz;
  let r = bitcast<vec4f>(primWord(i, 1u)).w;
  let oc = o - c;
  let b = dot(oc, d);
  let h = b * b - (dot(oc, oc) - r * r);
  if (h <= 0.0) { return 0.0; }
  let s = sqrt(h);
  let t0 = max(-b - s, 0.0);
  let t1 = min(-b + s, tMax);
  if (t1 <= t0) { return 0.0; }
  let ds = (t1 - t0) / f32(CANOPY_SAMPLES);
  let jitter = canopyJitter(o, d);
  var tau = 0.0;
  for (var k = 0u; k < CANOPY_SAMPLES; k++) {
    let p = o + d * (t0 + ds * (f32(k) + jitter));
    let n = valueNoise3(p * CANOPY_INV_CLUMP);
    let u = (p - c) / r;
    let rho = length(u) * (1.0 - CANOPY_RIM_NOISE * (2.0 * n - 1.0) + CANOPY_LOBE * canopyLobe(u, c));
    let leaf = 1.0 - smoothstep(CANOPY_CORE, 1.0, rho);
    tau += leaf * (CANOPY_GAP_BASE + CANOPY_GAP_SPAN * n);
  }
  return tau * ds * CANOPY_EXTINCTION;
}
`,"./shaders/rt/rt_common.wgsl":`// Shared by every RT pass. Include with GRP = the bind group index that holds the RtParams uniform (binding 0).
// Packed on the CPU by src/render/rt/params.ts (keep the two in sync).
#include "common/math.wgsl"
#include "common/frame.wgsl"
#include "rt/rt_map.wgsl"

struct RtParams {
  dims : vec4u,       // x,y = RT width,height; z,w = full render width,height
  cfg : vec4u,        // x = divisor, y = max steps, z = GI rays per pixel, w = flags (bit0 specular, bit1 terrain present)
  scene : vec4u,      // x = static BVH root, y = dynamic BVH root (0xffffffff = none), z = BVH node visit cap, w = frame index
  dbg : vec4u,        // x = debug view, y = random seed, z = probe update stride K, w = probe update phase
  probeLo : vec4i,    // xyz = lattice coordinate of the window's first probe, w = probe rays per probe per update
  probePrev : vec4i,  // xyz = same for the previous frame's window, w = 1 -> every probe is new
  probeDim : vec4u,   // xyz = probe grid dimensions
  f : vec4f,          // x = sun cone scale, y = probe spacing (m), z = probe hysteresis, w = GI/specular ray range (m)
  cloud : vec4f,      // x,y = cloud shadow map centre (world xz), z = its side length (m), w = cloud sky-light gain (>= 1)
};

@group(\${GRP}) @binding(0) var<uniform> rp : RtParams;

const NO_NODE : u32 = 0xffffffffu;
const FLAG_SPEC : u32 = 1u;
const FLAG_TERRAIN : u32 = 2u;

fn rtDivisor() -> i32 { return i32(rp.cfg.x); }
fn rtSize() -> vec2i { return vec2i(rp.dims.xy); }
fn fullSize() -> vec2i { return vec2i(rp.dims.zw); }
fn frameIndex() -> u32 { return rp.scene.w; }

// Full-resolution pixel and its pixel-centre uv that RT texel \`px\` represents this frame.
fn rtSrc(px : vec2i) -> vec2i { return rtSourcePixel(px, rtDivisor(), fullSize(), frameIndex()); }
fn pixelUv(src : vec2i) -> vec2f { return (vec2f(src) + 0.5) * frame.screen.zw; }

// Aux textures store linear view depth in metres (0 = sky).
fn linearDepth(reverseZ : f32) -> f32 { return select(0.0, frame.params.z / reverseZ, reverseZ > 0.0); }
fn worldFromLinear(uv : vec2f, z : f32) -> vec3f { return worldFromDepth(uv, frame.params.z / z); }

// fp16 storage guard (max 65504): clamps into the finite range and turns NaN into 0 (abs(NaN) <= x is false, so the select picks 0).
const FP16_SAFE : f32 = 6.0e4;
fn fp16Safe(v : vec4f) -> vec4f {
  let c = clamp(v, vec4f(-FP16_SAFE), vec4f(FP16_SAFE));
  return select(vec4f(0.0), c, abs(c) <= vec4f(FP16_SAFE));
}

fn keyDir() -> vec4f { return select(frame.sunDir, frame.moonDir, frame.misc.w == 1u); }
`,"./shaders/rt/rt_map.wgsl":`// Which full-resolution pixel an RT-resolution texel samples this frame. Pure (no bindings): shared by the RT passes and by the
// bilateral upsample in lighting/deferred.wgsl, which must agree on it.
//   div 1: identity.  div 2: one of the 2x2 block by frame parity (0,0) (1,1) (1,0) (0,1).
//   div 4: Bayer-ordered pick inside the 4x4 block; nibble k of BAYER_LO / BAYER_HI is the (x | y << 2) offset for frame k & 15.
const BAYER_LO : u32 = 0xD75F82A0u;
const BAYER_HI : u32 = 0xC6E493B1u;

fn rtSourcePixel(rtPx : vec2i, div : i32, fullDims : vec2i, frameIdx : u32) -> vec2i {
  var off = vec2i(0);
  if (div == 2) {
    let k = frameIdx & 3u;
    off = vec2i(select(0, 1, k == 1u || k == 2u), select(0, 1, k == 1u || k == 3u));
  } else if (div == 4) {
    let k = frameIdx & 15u;
    let w = select(BAYER_LO, BAYER_HI, k >= 8u);
    let nib = (w >> ((k & 7u) * 4u)) & 15u;
    off = vec2i(i32(nib & 3u), i32(nib >> 2u));
  }
  return min(rtPx * div + off, fullDims - vec2i(1));
}
`,"./shaders/rt/rt_prims.wgsl":`// Ray vs analytic proxy primitives (packed by src/render/rt/prims.ts, 64-byte records read as 4 x vec4u). Keep in sync with\r
// src/render/rt/cpuReference.ts, which the dev page compares against. Only ENTRY hits count: a ray starting inside a primitive misses it.\r
#ifndef GRP\r
@group(2) @binding(9) var<storage, read> bvhNodes : array<vec4u>;\r
@group(2) @binding(10) var<storage, read> bvhPrims : array<vec4u>;\r
#else\r
#include "rt/rt_common.wgsl"\r
@group(\${GRP}) @binding(1) var<storage, read> bvhNodes : array<vec4u>;\r
@group(\${GRP}) @binding(2) var<storage, read> bvhPrims : array<vec4u>;\r
#endif\r
\r
const NO_HIT : f32 = 1e30;\r
const T_EPS : f32 = 1e-4;\r
const TORUS_STEPS : u32 = 32u;\r
const KIND_OBB : u32 = 0u;\r
const KIND_CAPSULE : u32 = 1u;\r
const KIND_SPHERE : u32 = 2u;\r
const KIND_CYLINDER : u32 = 4u;\r
const KIND_ELLIPSOID : u32 = 5u;\r
const KIND_CONE : u32 = 6u;\r
const KIND_GABLE : u32 = 7u;\r
const GABLE_PLANES = array<vec3f, 5>(vec3f(0.0,-1.0,0.0),vec3f(2.0,1.0,0.0),vec3f(-2.0,1.0,0.0),vec3f(0.0,0.0,1.0),vec3f(0.0,0.0,-1.0));\r
\r
fn qrot(q : vec4f, v : vec3f) -> vec3f {\r
  let t = 2.0 * cross(q.xyz, v);\r
  return v + q.w * t + cross(q.xyz, t);\r
}\r
fn qrotInv(q : vec4f, v : vec3f) -> vec3f { return qrot(vec4f(-q.xyz, q.w), v); }\r
\r
fn primWord(i : u32, k : u32) -> vec4u { return bvhPrims[i * 4u + k]; }\r
\r
fn hitSphere(c : vec3f, r : f32, o : vec3f, d : vec3f, tMax : f32) -> f32 {\r
  let oc = o - c;\r
  let b = dot(oc, d);\r
  let q = oc - b * d;\r
  let h = r * r - dot(q, q);\r
  if (h < 0.0) { return NO_HIT; }\r
  let t = -b - sqrt(h);\r
  return select(NO_HIT, t, t > T_EPS && t <= tMax);\r
}\r
\r
// Project into the plane perpendicular to the segment before solving the radial entry.\r
// The unscaled capsule quadratic subtracts O(distance^4) terms and loses thin distant branches.\r
fn hitCapsule(pa : vec3f, pb : vec3f, r : f32, o : vec3f, d : vec3f, tMax : f32) -> f32 {\r
  let ba = pb - pa; let oa = o - pa; let lengthSq = dot(ba, ba);\r
  if (lengthSq < 1e-12) { return hitSphere(pa, r, o, d, tMax); }\r
  let segmentLength = sqrt(lengthSq); let axis = ba / segmentLength;\r
  let axialOrigin = dot(oa, axis); let axialDirection = dot(d, axis);\r
  let insideOffset = oa - axis * clamp(axialOrigin, 0.0, segmentLength);\r
  if (dot(insideOffset, insideOffset) < r * r) { return NO_HIT; }\r
  let radialOrigin = oa - axis * axialOrigin; let radialDirection = d - axis * axialDirection;\r
  let qa = dot(radialDirection, radialDirection);\r
  if (qa > 0.0) {\r
    let closestT = -dot(radialOrigin, radialDirection) / qa;\r
    let closest = radialOrigin + closestT * radialDirection;\r
    let discriminant = r * r - dot(closest, closest);\r
    if (discriminant < 0.0) { return NO_HIT; }\r
    let t = closestT - sqrt(discriminant / qa); let y = axialOrigin + t * axialDirection;\r
    if (y >= 0.0 && y <= segmentLength) { return select(NO_HIT, t, t > T_EPS && t <= tMax); }\r
    return hitSphere(select(pb, pa, y < 0.0), r, o, d, tMax);\r
  }\r
  // Both caps matter for an axial ray: its approaching end may be either segment endpoint.\r
  return min(hitSphere(pa, r, o, d, tMax), hitSphere(pb, r, o, d, tMax));\r
}\r
\r
fn hitObb(c : vec3f, half : vec3f, q : vec4f, o : vec3f, d : vec3f, tMax : f32) -> f32 {\r
  let lo = qrotInv(q, o - c);\r
  let ld = qrotInv(q, d);\r
  let par = abs(ld) < vec3f(1e-12);\r
  if (any(par & (abs(lo) > half))) { return NO_HIT; }\r
  let inv = 1.0 / select(ld, vec3f(1.0), par);\r
  let a = (-half - lo) * inv;\r
  let b = (half - lo) * inv;\r
  let n0 = select(min(a, b), vec3f(-NO_HIT), par);\r
  let n1 = select(max(a, b), vec3f(NO_HIT), par);\r
  let t0 = max(max(n0.x, n0.y), n0.z);\r
  let t1 = min(min(n1.x, n1.y), n1.z);\r
  return select(NO_HIT, t0, t0 <= t1 && t0 > T_EPS && t0 <= tMax);\r
}\r
\r
fn torusSdf(p : vec3f, major : f32, minor : f32) -> f32 {\r
  return length(vec2f(length(p.xz) - major, p.y)) - minor;\r
}\r
\r
// Sphere tracing of the torus SDF from the bounding-sphere entry; the ring lies in the local XZ plane.\r
fn hitTorus(c : vec3f, major : f32, minor : f32, q : vec4f, o : vec3f, d : vec3f, tMax : f32) -> f32 {\r
  let lo = qrotInv(q, o - c);\r
  let ld = qrotInv(q, d);\r
  let rad = major + minor;\r
  let b = dot(lo, ld);\r
  let qq = lo - b * ld;\r
  let h = rad * rad - dot(qq, qq);\r
  if (h < 0.0) { return NO_HIT; }\r
  let sh = sqrt(h);\r
  var t = max(-b - sh, T_EPS);\r
  let tEnd = min(-b + sh, tMax);\r
  if (torusSdf(lo + ld * t, major, minor) < 0.0) { return NO_HIT; }\r
  for (var i = 0u; i < TORUS_STEPS; i++) {\r
    let s = torusSdf(lo + ld * t, major, minor);\r
    if (s < 1e-4 + 1e-5 * t) { return t; }\r
    t += s;\r
    if (t > tEnd) { return NO_HIT; }\r
  }\r
  return NO_HIT;\r
}\r
\r
fn hitCone(c : vec3f, half : vec3f, q : vec4f, o : vec3f, d : vec3f, tMax : f32) -> f32 {\r
  let lp = qrotInv(q, o - c); let ld = qrotInv(q, d);\r
  let p = vec3f(lp.x / half.x, (half.y - lp.y) / (2.0 * half.y), lp.z / half.z);\r
  let v = vec3f(ld.x / half.x, -ld.y / (2.0 * half.y), ld.z / half.z);\r
  if (p.y > 0.0 && p.y < 1.0 && dot(p.xz, p.xz) < p.y * p.y) { return NO_HIT; }\r
  let a = dot(v.xz, v.xz) - v.y * v.y;\r
  let b = dot(p.xz, v.xz) - p.y * v.y;\r
  let cc = dot(p.xz, p.xz) - p.y * p.y;\r
  var best = NO_HIT; var roots = vec2f(NO_HIT);\r
  if (abs(a) < 1e-12) { if (abs(b) > 1e-12) { roots.x = -cc / (2.0 * b); } }\r
  else {\r
    let disc = b * b - a * cc;\r
    if (disc >= 0.0) {\r
      let r = -b - select(1.0, -1.0, b < 0.0) * sqrt(disc);\r
      roots.x = r / a;\r
      if (abs(r) > 1e-20) { roots.y = cc / r; }\r
    }\r
  }\r
  for (var k = 0u; k < 2u; k++) {\r
    let t = roots[k]; let y = p.y + t * v.y;\r
    if (t > T_EPS && t <= tMax && t < best && y >= 0.0 && y <= 1.0) { best = t; }\r
  }\r
  if (abs(v.y) > 1e-12) {\r
    let t = (1.0 - p.y) / v.y; let at = p.xz + t * v.xz;\r
    if (t > T_EPS && t <= tMax && t < best && dot(at, at) <= 1.0) { best = t; }\r
  }\r
  return best;\r
}\r
\r
fn hitGable(c : vec3f, half : vec3f, q : vec4f, o : vec3f, d : vec3f, tMax : f32) -> f32 {\r
  let lo = qrotInv(q, o-c)/half; let ld = qrotInv(q,d)/half;\r
  var enter = -NO_HIT; var leave = NO_HIT;\r
  for (var k=0u; k<5u; k++) {\r
    let n=GABLE_PLANES[k]; let numerator=1.0-dot(n,lo); let denominator=dot(n,ld);\r
    if (abs(denominator)<1e-12) { if (numerator<0.0) { return NO_HIT; } }\r
    else { let t=numerator/denominator; if (denominator<0.0) { enter=max(enter,t); } else { leave=min(leave,t); } }\r
  }\r
  return select(NO_HIT,enter,enter<=leave && enter>T_EPS && enter<=tMax);\r
}\r
\r
fn intersectPrim(i : u32, o : vec3f, d : vec3f, tMax : f32) -> f32 {\r
  let head = primWord(i, 0u);\r
  let a = bitcast<vec4f>(head);\r
  let b = bitcast<vec4f>(primWord(i, 1u));\r
  switch (head.w) {\r
    case KIND_SPHERE: { return hitSphere(a.xyz, b.w, o, d, tMax); }\r
    case KIND_CAPSULE: { return hitCapsule(a.xyz, b.xyz, b.w, o, d, tMax); }\r
    case KIND_OBB: { return hitObb(a.xyz, b.xyz, bitcast<vec4f>(primWord(i, 2u)), o, d, tMax); }\r
    case KIND_CONE: { return hitCone(a.xyz, b.xyz, bitcast<vec4f>(primWord(i, 2u)), o, d, tMax); }\r
    case KIND_GABLE: { return hitGable(a.xyz, b.xyz, bitcast<vec4f>(primWord(i, 2u)), o, d, tMax); }\r
    case KIND_CYLINDER, KIND_ELLIPSOID: {\r
      let q = bitcast<vec4f>(primWord(i, 2u)); let lo = qrotInv(q, o - a.xyz); let ld = qrotInv(q, d);\r
      let mask = select(vec3f(1.0), vec3f(1.0, 0.0, 1.0), head.w == KIND_CYLINDER);\r
      let oo = lo / b.xyz; let dd = ld / b.xyz;\r
      let qa = dot(dd * mask, dd); let qb = dot(oo * mask, dd); let qc = dot(oo * mask, oo) - 1.0;\r
      if (qc < 0.0 && (head.w == KIND_ELLIPSOID || abs(lo.y) < b.y)) { return NO_HIT; }\r
      // Closest-point form avoids subtracting two huge, nearly equal squared distances on thin distant rails.\r
      var best = NO_HIT; let closestT = -qb / max(qa, 1e-20); let closest = oo + dd * closestT;\r
      let disc = 1.0 - dot(closest * mask, closest);\r
      if (qa > 1e-14 && disc >= 0.0) { let t = closestT - sqrt(disc / qa);\r
        if (t > T_EPS && t <= tMax && (head.w == KIND_ELLIPSOID || abs(lo.y + t * ld.y) <= b.y)) { best = t; }\r
      }\r
      if (head.w == KIND_CYLINDER && abs(ld.y) > 1e-12) {\r
        for (var side = -1.0; side <= 1.0; side += 2.0) { let t = (side * b.y - lo.y) / ld.y; let p = (lo.xz + t * ld.xz) / b.xz;\r
          if (t > T_EPS && t <= tMax && t < best && dot(p, p) <= 1.0) { best = t; }\r
        }\r
      }\r
      return best;\r
    }\r
    default: { return hitTorus(a.xyz, b.x, b.w, bitcast<vec4f>(primWord(i, 2u)), o, d, tMax); }\r
  }\r
}\r
\r
// Outward geometric normal at a point on the surface of primitive i.\r
fn primNormal(i : u32, p : vec3f) -> vec3f {\r
  let head = primWord(i, 0u);\r
  let a = bitcast<vec4f>(head).xyz;\r
  let b = bitcast<vec4f>(primWord(i, 1u));\r
  switch (head.w) {\r
    case KIND_SPHERE: { return normalize(p - a); }\r
    case KIND_CAPSULE: {\r
      let ba = b.xyz - a;\r
      let h = clamp(dot(p - a, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);\r
      return normalize(p - (a + ba * h));\r
    }\r
    case KIND_OBB: {\r
      let q = bitcast<vec4f>(primWord(i, 2u));\r
      let lp = qrotInv(q, p - a) / b.xyz;\r
      let al = abs(lp);\r
      var n = vec3f(0.0);\r
      if (al.x >= al.y && al.x >= al.z) { n.x = select(-1.0, 1.0, lp.x >= 0.0); }\r
      else if (al.y >= al.z) { n.y = select(-1.0, 1.0, lp.y >= 0.0); }\r
      else { n.z = select(-1.0, 1.0, lp.z >= 0.0); }\r
      return qrot(q, n);\r
    }\r
    case KIND_GABLE: {\r
      let q=bitcast<vec4f>(primWord(i,2u)); let lp=qrotInv(q,p-a); var normal=vec3f(0.0,-1.0,0.0); var nearest=NO_HIT;\r
      for (var k=0u; k<5u; k++) { let n=GABLE_PLANES[k]/b.xyz; let len=length(n); let distance=abs(dot(n,lp)-1.0)/len;\r
        if (distance<nearest) { nearest=distance; normal=n/len; }\r
      }\r
      return qrot(q,normal);\r
    }\r
    case KIND_CONE: {\r
      let q = bitcast<vec4f>(primWord(i, 2u)); let lp = qrotInv(q, p - a);\r
      if (abs(lp.y + b.y) < 0.0005) { return qrot(q, vec3f(0.0, -1.0, 0.0)); }\r
      let n = vec3f(lp.x / (b.x * b.x), (b.y - lp.y) / (4.0 * b.y * b.y), lp.z / (b.z * b.z));\r
      if (dot(n, n) < 1e-20) { return qrot(q, vec3f(0.0, 1.0, 0.0)); }\r
      return qrot(q, normalize(n));\r
    }\r
    case KIND_CYLINDER, KIND_ELLIPSOID: {\r
      let q = bitcast<vec4f>(primWord(i, 2u)); let lp = qrotInv(q, p - a); var n = lp / (b.xyz * b.xyz);\r
      if (head.w == KIND_CYLINDER) { n.y = 0.0; if (abs(abs(lp.y) - b.y) < 0.0005) { n = vec3f(0.0, sign(lp.y), 0.0); } }\r
      return qrot(q, normalize(n));\r
    }\r
    default: {\r
      let q = bitcast<vec4f>(primWord(i, 2u));\r
      let lp = qrotInv(q, p - a);\r
      let f = 1.0 - b.x / max(length(lp.xz), 1e-6);\r
      return qrot(q, normalize(vec3f(f * lp.x, lp.y, f * lp.z)));\r
    }\r
  }\r
}\r
\r
struct PrimMaterial { albedo : vec3f, roughness : f32, emissive : vec3f, metalness : f32 }\r
\r
fn primMaterial(i : u32) -> PrimMaterial {\r
  let m = primWord(i, 3u);\r
  let ab = unpack4x8unorm(m.x);\r
  let e01 = unpack2x16float(m.y);\r
  let e2m = unpack2x16float(m.z);\r
  return PrimMaterial(ab.rgb, ab.a, vec3f(e01.x, e01.y, e2m.x), e2m.y);\r
}\r
`,"./shaders/rt/rt_scene.wgsl":`// Combined scene trace (BVH proxies + terrain heightfield), hit shading, environment and the radiance-probe lookup. Included by every
// pass that traces rays for lighting (shadow, gi, spec, probe_update). Group GRP layout: see src/render/rt/layouts.ts.
#include "common/world_bindings.wgsl"
#include "lighting/sky_safe.wgsl"
#include "rt/rt_terrain.wgsl"
#include "rt/rt_bvh.wgsl"
#include "terrain/ground_palette.wgsl"
#include "park/lights.wgsl"

@group(\${GRP}) @binding(3) var probeR : texture_3d<f32>;
@group(\${GRP}) @binding(4) var probeG : texture_3d<f32>;
@group(\${GRP}) @binding(5) var probeB : texture_3d<f32>;
@group(\${GRP}) @binding(10) var probeSampler : sampler;
@group(\${GRP}) @binding(11) var cloudShadowTex : texture_2d<f32>;

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

// The sky-view LUT is a clear sky; the clouds' own light (bright cumulus sides, the diffuse glow under a deck) is put back on the dome as a
// gain from the cloud cover (rp.cloud.w, atmosphere cloudAmbientScale: 1 when clear, about 1.18 at the default cover, 1.8 overcast).
fn envRadiance(dir : vec3f, e : Env) -> vec3f {
  return mix(skyNits(dir) * max(rp.cloud.w, 1.0), e.ground, 1.0 - smoothstep(-0.08, 0.0, dir.y));
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
  // Interpolating outdoor probes through an opaque roof would inject the daylight sky into a dark ride.
  if (parkRoom(p) >= 0) { return vec3f(0.0); }
  let dim = vec3f(rp.probeDim.xyz);
  let c = p / rp.f.y;
  let rel = c - vec3f(rp.probeLo.xyz);
  let m = min(rel, dim - 1.0 - rel);
  let w = smoothstep(0.0, 2.0, min(m.x, min(m.y, m.z)));
  let fallback = mix(e.ground, e.zenith, saturate1(n.y * 0.5 + 0.5)) * frame.params.y;
  // Probes starting afresh (rp.probePrev.w: a new scene or a lighting cut) hold the old light, rescaled to the new exposure: after a jump from
  // noon to midnight that is a million times the night's light, and fed back through the bounce it lit the crowns for seconds. That frame's
  // bounce comes from the sky and ground of the current light instead.
  if (w <= 0.0 || rp.probePrev.w == 1) { return fallback; }
  let uv = (c + 0.5) / dim;
  let r = textureSampleLevel(probeR, probeSampler, uv, 0.0);
  let g = textureSampleLevel(probeG, probeSampler, uv, 0.0);
  let b = textureSampleLevel(probeB, probeSampler, uv, 0.0);
  let irr = clamp(vec3f(shIrradiance(r, n), shIrradiance(g, n), shIrradiance(b, n)) * probeGain, vec3f(0.0), vec3f(MAX_RADIANCE));
  return mix(fallback, irr, w);
}

struct Surface { n : vec3f, albedo : vec3f, metal : f32, emissive : vec3f, ao : f32, trans : f32 }

// Mean albedo of the ground a ray lands on, so the bounce has the colour of the ground the raster draws: olive sward on deep soil,
// brown soil in gullies and thin patches, gravel in stream beds, grey rock on steep and bare ground, snow up high. It is the layer mix of
// terrainLayerWeights in terrain/ground_color.wgsl taken at its noise means, with the palette's own colours; the FBM patches are left out
// because they would cost more than the rest of the hit shading and the GI only ever sees their average. The forest-floor cover map is not
// bound in the RT passes, so litter under trees bounces as the sward or soil it replaces.
fn terrainGroundAlbedo(y : f32, ny : f32, maps : vec4f) -> vec3f {
  let soil = maps.x;
  let flow = maps.y;
  let slope = 1.0 - ny;
  let hRel = (y - frame.terrain.z) / max(frame.terrain.w - frame.terrain.z, 1.0);
  let steep = smoothstep(0.16, 0.30, slope);
  let gentle = 1.0 - smoothstep(0.10, 0.26, slope);
  let bare = 1.0 - smoothstep(0.02, 0.24, soil);
  let rock = saturate1(steep + 0.9 * bare + 0.5 * smoothstep(0.62, 0.92, hRel));
  let gully = smoothstep(0.35, 0.70, flow) * smoothstep(0.01, 0.05, slope);
  let thinSoil = 1.0 - smoothstep(0.30, 0.70, soil);
  let sparse = smoothstep(0.60, 0.86, 0.5 + 0.30 * smoothstep(0.03, 0.15, slope) + 0.25 * thinSoil);
  let cover = smoothstep(0.22, 0.65, soil) * gentle * (1.0 - 0.85 * gully);
  let sward = cover * (1.0 - 0.9 * sparse);
  let channel = smoothstep(0.5, 0.9, flow);
  let gravel = 0.7 * channel * (0.4 + 0.6 * maps.z);
  let dirt = 0.10 + 0.9 * smoothstep(0.05, 0.35, soil) * (1.0 - smoothstep(0.35, 0.7, soil)) + 0.7 * channel + 0.9 * cover * sparse + 0.9 * gully;
  let snow = smoothstep(0.78, 0.86, hRel) * gentle;
  let bareGround = (sward * glBaseColor(GL_GRASS) + dirt * glBaseColor(GL_DIRT) + gravel * glBaseColor(GL_GRAVEL) + rock * glBaseColor(GL_ROCK))
    / (sward + dirt + gravel + rock);
  return mix(bareGround, glBaseColor(GL_SNOW), snow);
}

fn terrainSurface(p : vec3f) -> Surface {
  let uv = (terrainTexel(p.xz) + 0.5) / frame.terrain.x;
  let nrm = textureSampleLevel(terrainNormalTex, linearClamp, uv, 0.0);
  let maps = textureSampleLevel(terrainMapsTex, linearClamp, uv, 0.0);
  let n = normalize(nrm.xyz * 2.0 - 1.0);
  let alb = terrainGroundAlbedo(p.y, n.y, maps) * mix(1.0, 0.6, saturate1(maps.w));
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
  let indoor = parkRoom(p) >= 0;
  let cosK = lightCosine(s, key.xyz);
  var vis = 1.0;
  if (!indoor && cosK > 0.0 && key.y > -0.03) {
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
  var direct = (keyIrradiance(e) * (cosK * vis) + fillIrradiance(e) * lightCosine(s, fillDir())) * (pre * INV_PI);
  if (indoor) { direct = vec3f(0.0); }
  let range = parkLightRange(p);
  // One light sampled in proportion to its unoccluded irradiance. PDF compensation preserves the full
  // lighting integral, while the temporal GI/probe histories integrate the samples without N shadow rays per hit.
  var totalWeight = 0.0; var chosenWeight = 0.0; var chosenE = vec4f(0.0); var chosenL = vec3f(0.0); var chosenCosine = 0.0;
  for (var i = 0u; i < range.y; i++) {
    let index = parkLightIndex(range.x + i); let eLocal = parkIrradiance(p, index);
    if (eLocal.w < 0.05 || max(eLocal.x, max(eLocal.y, eLocal.z)) < 0.001) { continue; }
    let l = normalize(park.data[index * 2u].xyz - p); let cosine = max(dot(s.n, l), 0.0);
    let weight = dot(eLocal.rgb, vec3f(0.2126, 0.7152, 0.0722)) * cosine;
    totalWeight += weight;
    let random = hash21(vec2u(bitcast<u32>(p.x) + frameIndex() * 713u, bitcast<u32>(p.z) ^ (i * 979u)));
    if (weight > 0.0 && random * totalWeight < weight) { chosenWeight = weight; chosenE = eLocal; chosenL = l; chosenCosine = cosine; }
  }
  if (chosenWeight > 0.0) {
    let hit = traceBvh(p + s.n * 0.035, chosenL, max(0.0, chosenE.w - 0.35), 512u);
    if (hit.prim == NO_NODE) { direct += chosenE.rgb * (chosenCosine * pre * INV_PI * totalWeight / chosenWeight); }
  }
  let diffuse = s.albedo * (1.0 - 0.7 * s.metal);
  let emission = min(s.emissive * (EMISSIVE_MAX_NITS * pre), vec3f(MAX_RADIANCE));
  return min(diffuse * (direct + probeIrradiance(p + s.n * 0.5, s.n, e)) + emission, vec3f(MAX_RADIANCE));
}

// Transmittance of the leaf chord that a hit \`h\` ends inside: 1 for a plain surface, the crown's Beer-Lambert share otherwise. A pass that
// needs it for more than one output term integrates the chord once (via this) and passes it on, so a crown costs one optical-depth
// integration per ray instead of one per consumer.
fn hitChordT(h : SceneHit, o : vec3f, d : vec3f) -> f32 {
  if (h.kind != KIND_PRIM || !primIsCanopy(h.prim)) { return 1.0; }
  return exp(-CANOPY_DIFFUSE_TAU_SCALE * canopyOpticalDepth(h.prim, o, d, rp.f.w));
}

// Radiance (pre-exposed) arriving along a ray o + t*d that hit \`h\`, with the chord's transmittance already integrated by the caller
// (\`hitChordT(h, o, d)\`). A ray entering a leaf crown mostly sees light that crossed the leaves, so the crown's own shading is blended
// with the environment behind it by that transmittance.
fn hitRadianceChord(h : SceneHit, o : vec3f, d : vec3f, e : Env, steps : u32, chord : f32) -> vec3f {
  let p = o + d * h.t;
  var s = surfaceAt(h, p, d);
  if (s.trans <= 0.0) { return shadeSurface(s, p, h.t, h.kind, e, steps); }
  s.albedo = CANOPY_SCATTER_ALBEDO;
  let lit = canopyScatter(s, h, o, d, e, steps, chord);
  return mix(lit, skyRadiance(d, e), chord);
}

// Below this chord transmittance a crown hit traces its own shadow ray; above it the leaves' scattered light is under a fifth of what the ray
// returns, and the crown's own transmittance toward the key light stands in for the ray.
const CANOPY_SHADOW_CHORD : f32 = 0.8;

// Light the leaves along a chord through crown \`h\` scatter toward the ray's origin. They see less of the key light the deeper they lie, so
// they are shaded at the chord's middle rather than at the sunlit rim where the ray leaves the crown, and with the crown's own leaves
// between them and the light. A short chord (most rays from the outer leaves) skips the shadow ray: no BVH walk, only the crown's own
// transmittance; the park's local lights are left to the probe term.
fn canopyScatter(s : Surface, h : SceneHit, o : vec3f, d : vec3f, e : Env, steps : u32, chord : f32) -> vec3f {
  let pre = frame.params.y;
  let mid = o + d * (0.5 * h.t);
  let key = keyDir();
  let cosK = lightCosine(s, key.xyz);
  var vis = 0.0;
  if (cosK > 0.0 && key.y > -0.03 && parkRoom(mid) < 0) {
    vis = exp(-canopyOpticalDepth(h.prim, mid, key.xyz, rp.f.w));
#ifdef SHADE_VISIBILITY
    // The recorded visibility was taken where the ray left the crown (gi.wgsl VISIBILITY_ONLY): the other trees and the terrain.
    vis *= giVisibilityValue;
#else
    if (chord < CANOPY_SHADOW_CHORD && h.t < NEAR_SHADOW_RANGE) {
      // From inside the crown the shadow ray's transmittance takes in the crown's own leaves as well as everything beyond.
      vis = keyVisibility(mid, key.xyz, SHADOW_RAY_RANGE, max(16u, steps / 3u));
    }
    vis *= cloudTransmittance(mid);
#endif
  }
  let direct = (keyIrradiance(e) * (cosK * vis) + fillIrradiance(e) * lightCosine(s, fillDir())) * (pre * INV_PI);
  return min(s.albedo * (direct + probeIrradiance(mid, s.n, e)), vec3f(MAX_RADIANCE));
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

// Blue-noise + R2 sample in [0,1)^2; \`salt\` decorrelates independent uses at the same pixel.
fn noise2(px : vec2i, salt : u32) -> vec2f {
  let seed = rp.dbg.y;
  let shift = vec2i(i32((salt * 37u + seed) & 127u), i32((salt * 91u + (seed >> 7u)) & 127u));
  let bn = textureLoad(blueNoise, (px + shift) & vec2i(127), 0).rg;
  let idx = f32((frameIndex() + salt * 7u) & 1023u);
  return fract(bn + idx * vec2f(0.7548776662, 0.5698402910));
}
`,"./shaders/rt/rt_terrain.wgsl":`// Analytic heightfield tracer over terrainHeight + the max mip pyramid (Tevs et al., "Maximum Mipmaps for Fast, Accurate, and
// Scalable Dynamic Height Field Rendering"), a hierarchical 2D DDA that ascends over empty nodes and descends toward potential hits.
// At the finest level the exact crossing of the ray with the triangulated cells is solved (piecewise-linear gap, closed-form root),
// which replaces bisection and matches TerrainSampler.raycast in src/world/terrain/sampler.ts. Assumes N is a power of two.
// Semantics: the terrain is a solid slab under its footprint (a ray that starts under the surface hits at the start).
#include "common/world_bindings.wgsl"

const TERRAIN_START_LEVEL : u32 = 2u;
const NODE_EPS : f32 = 1e-3;

// Bound on the height of every cell inside node c at \`lvl\` (cells [c*2^lvl, (c+1)*2^lvl]): the 2x2 mip texels cover the closed span.
fn nodeMax(c : vec2i, lvl : u32) -> f32 {
  let hi = vec2i((i32(frame.terrain.x) >> lvl) - 1);
  return textureLoad(terrainMaxPyr, min(c, hi), i32(lvl)).x;
}

// One planar piece of the cell surface: first s in [s0, s1] where the ray (local cell coords l + dg*s, height y + dy*s) is under it.
fn piecewiseHit(h00 : f32, h10 : f32, h01 : f32, h11 : f32, l : vec2f, dg : vec2f, y : f32, dy : f32, s0 : f32, s1 : f32) -> f32 {
  let mid = 0.5 * (s0 + s1);
  let m = l + dg * mid;
  let upper = m.x >= m.y;
  let cx = select(h11 - h01, h10 - h00, upper);
  let cz = select(h01 - h00, h11 - h10, upper);
  let c0 = y - h00 - cx * l.x - cz * l.y;
  let slope = dy - cx * dg.x - cz * dg.y;
  let g0 = c0 + slope * s0;
  let g1 = c0 + slope * s1;
  if (g0 <= 0.0) { return s0; }
  if (g1 < 0.0) { return s0 + (s1 - s0) * g0 / (g0 - g1); }
  return -1.0;
}

// l = ray position in cell-local coordinates at s = 0, segment [0, len]. Returns the hit s or -1.
fn cellCrossing(c : vec2i, l : vec2f, dg : vec2f, y : f32, dy : f32, len : f32) -> f32 {
  let h00 = terrainLoad(c);
  let h10 = terrainLoad(c + vec2i(1, 0));
  let h01 = terrainLoad(c + vec2i(0, 1));
  let h11 = terrainLoad(c + vec2i(1, 1));
  let dd = dg.x - dg.y;
  var tm = len;
  if (abs(dd) > 1e-12) {
    let tk = (l.y - l.x) / dd;
    if (tk > 0.0 && tk < len) { tm = tk; }
  }
  let first = piecewiseHit(h00, h10, h01, h11, l, dg, y, dy, 0.0, tm);
  if (first >= 0.0 || tm >= len) { return first; }
  return piecewiseHit(h00, h10, h01, h11, l, dg, y, dy, tm, len);
}

// Distance t (0 <= t <= tMax) along o + t*d (unit d) to the first terrain hit, or -1. \`steps\` bounds the node visits.
fn traceTerrain(o : vec3f, d : vec3f, tMax : f32, steps : u32) -> f32 {
  let n = i32(frame.terrain.x);
  let last = frame.terrain.x - 1.0;
  let inv = 1.0 / frame.terrain.y;
  let go = (o.xz - frame.terrainOrigin.xy) * inv;
  let dg = d.xz * inv;
  var tEnter = 0.0;
  var tExit = tMax;
  if (abs(dg.x) > 1e-9) {
    let a = -go.x / dg.x;
    let b = (last - go.x) / dg.x;
    tEnter = max(tEnter, min(a, b));
    tExit = min(tExit, max(a, b));
  } else if (go.x < 0.0 || go.x > last) { return -1.0; }
  if (abs(dg.y) > 1e-9) {
    let a = -go.y / dg.y;
    let b = (last - go.y) / dg.y;
    tEnter = max(tEnter, min(a, b));
    tExit = min(tExit, max(a, b));
  } else if (go.y < 0.0 || go.y > last) { return -1.0; }
  let top = frame.terrain.w;
  if (o.y > top) {
    if (d.y >= 0.0) { return -1.0; }
    tEnter = max(tEnter, (top - o.y) / d.y);
  }
  if (d.y > 0.0) {
    tExit = min(tExit, (top - o.y) / d.y);
  } else if (d.y < 0.0) {
    let tFloor = (frame.terrain.z - 1e-4 - o.y) / d.y;
    if (tFloor > tEnter) { tExit = min(tExit, tFloor); }
  }
  if (!(tEnter <= tExit)) { return -1.0; }

  let maxLevel = firstLeadingBit(u32(n));
  let fwd = dg >= vec2f(0.0);
  let sgn = select(vec2f(-1.0), vec2f(1.0), fwd);
  let valid = abs(dg) > vec2f(1e-9);
  let safeDg = select(vec2f(1.0), dg, valid);
  var t = tEnter;
  var lvl = min(TERRAIN_START_LEVEL, maxLevel);
  for (var it = 0u; it < steps; it++) {
    if (t >= tExit) { return -1.0; }
    let g = go + dg * t;
    let size = f32(1u << lvl);
    let cellMax = select(vec2i((n >> lvl) - 1), vec2i(n - 2), lvl == 0u);
    let c = clamp(vec2i(floor((g + sgn * NODE_EPS) / size)), vec2i(0), cellMax);
    let bnd = (vec2f(c) + select(vec2f(0.0), vec2f(1.0), fwd)) * size;
    let tAxis = select(vec2f(1e30), (bnd - go) / safeDg, valid);
    let tNode = max(min(min(tAxis.x, tAxis.y), tExit), t);
    let yA = o.y + d.y * t;
    let yB = o.y + d.y * tNode;
    if (min(yA, yB) > nodeMax(c, lvl)) {
      t = tNode;
      lvl = min(lvl + 1u, maxLevel);
      continue;
    }
    if (lvl > 0u) {
      lvl -= 1u;
      continue;
    }
    let s = cellCrossing(c, g - vec2f(c), dg, yA, d.y, tNode - t);
    if (s >= 0.0) { return t + s; }
    t = tNode;
  }
  return -1.0;
}
`,"./shaders/rt/rt_trace_io.wgsl":`// Bindings shared by the per-pixel trace passes (shadow, gi, spec): RT-domain aux inputs and two raw outputs.
#include "rt/rt_scene.wgsl"

@group(\${GRP}) @binding(6) var auxDepth : texture_2d<f32>;
@group(\${GRP}) @binding(7) var auxNormal : texture_2d<f32>;
#ifdef VISIBILITY_ONLY
@group(\${GRP}) @binding(8) var out0 : texture_storage_2d<r32float, write>;
@group(\${GRP}) @binding(9) var out1 : texture_storage_2d<r32float, write>;
#else
#ifdef TRACE_ONLY
@group(\${GRP}) @binding(8) var out0 : texture_storage_2d<rg32float, write>;
@group(\${GRP}) @binding(9) var out1 : texture_storage_2d<rg32float, write>;
#else
@group(\${GRP}) @binding(8) var out0 : texture_storage_2d<rgba16float, write>;
@group(\${GRP}) @binding(9) var out1 : texture_storage_2d<rgba16float, write>;
#endif
#endif

struct PixelInfo { ok : bool, z : f32, n : vec3f, rough : f32, metal : f32, pos : vec3f, leaf : bool }

// Surface seen by RT texel \`px\` this frame (from the aux pass): world position, normal, effective roughness, metalness, and whether it is a
// leaf (aux_pass.wgsl puts AUX_FOLIAGE, 2, in the metalness of foliage).
fn loadPixel(px : vec2i) -> PixelInfo {
  let z = textureLoad(auxDepth, px, 0).x;
  if (z <= 0.0) { return PixelInfo(false, 0.0, vec3f(0.0, 1.0, 0.0), 1.0, 0.0, vec3f(0.0), false); }
  let a = textureLoad(auxNormal, px, 0);
  return PixelInfo(true, z, octDecode(a.xy), a.z, min(a.w, 1.0), worldFromLinear(pixelUv(rtSrc(px)), z), a.w > 1.5);
}

fn inRt(gid : vec2u) -> bool { return all(gid < rp.dims.xy); }
`,"./shaders/rt/shadow.wgsl":`// Key-light (sun or moon) soft shadow: one binary visibility ray per RT texel, aimed at a random point inside the light's angular disc
// (blue noise + R2 per frame), so the penumbra width follows the occluder distance. The temporal + a-trous passes turn it into a soft value.
// Foliage comes from the canopy shadow map of every placed tree (src/render/terrain/canopyShadow.ts) rather than from the crown spheres
// (pipelines.ts sets CANOPY_SHADOW_MAP, which makes traceBvhTransmit skip them): only a few hundred trees near the scene focus have spheres,
// and their thin extinction let most of the sun through a crown. Trunks and limbs still cast from their capsules.
#include "rt/rt_trace_io.wgsl"

const SHADOW_RANGE : f32 = 6000.0;

@group(\${GRP}) @binding(17) var canopyShadowTex : texture_2d<f32>;

// The ray is sampled every CANOPY_STEP_M of height up to CANOPY_STEPS steps above its start, so crowns up to about 30 m above the point
// shade it; a lower sun stretches the same steps over a longer slant path (more foliage), as it does in a real stand.
const CANOPY_STEP_M : f32 = 1.5;
const CANOPY_STEPS : i32 = 20;
const CANOPY_MIN_SUN_Y : f32 = 0.12;
const CANOPY_OPAQUE : f32 = 6.0;

fn canopyAt(xz : vec2f) -> vec4f {
  let uv = (terrainTexel(xz) + 0.5) / frame.terrain.x;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec4f(0.0); }
  return textureSampleLevel(canopyShadowTex, linearClamp, uv, 0.0);
}

// Leaf clumps and the gaps between them, in world space so the sunflecks stay put on the ground and in the crown as the camera moves. The
// field is stretched about 10x vertically: a gap runs down through the crown as a shaft, so a high sun keeps meeting the same gap or clump
// all the way through and a lone tree's shadow is holed and lobed, not a solid ellipse; a low sun crosses many columns and finds fewer
// gaps, as it does through a real crown. Mean about 1; zero in the gaps.
fn canopyClump(p : vec3f) -> f32 {
  let n = 0.6 * valueNoise3(p * vec3f(0.75, 0.08, 0.75)) + 0.4 * valueNoise3(p * vec3f(2.4, 0.25, 2.4) + vec3f(17.0, 3.0, 9.0));
  return 3.0 * smoothstep(0.46, 0.72, n);
}

// Fraction of the key light the crowns let through to p along d. A leaf (\`leaf\`) is not shaded through its own crown here: the map merges
// every crown into one column, so a leaf on the sun side of its crown would count the whole crown's depth as if it lay deep inside, and
// backlit outer leaves came out 1.5-2 stops darker than in photos. Its own crown's shading comes from the shoot's sunfleck instead (tree.wgsl,
// the exact depth through the crown toward the sun). The own crown is taken as the samples within its horizontal radius (the map's alpha:
// the widest crown over the leaf) of the leaf across the ground; crowns beyond, and everything over trunks and ground, still shade as before.
fn canopyTransmittance(p : vec3f, d : vec3f, leaf : bool) -> f32 {
  let dy = max(d.y, CANOPY_MIN_SUN_Y);
  let slant = CANOPY_STEP_M / dy;
  var own = 0.0;
  if (leaf) {
    let c0 = canopyAt(p.xz);
    if (c0.x > 0.0 && p.y > c0.y - 1.0 && p.y < c0.z + 1.0) { own = c0.w; }
  }
  var tau = 0.0;
  for (var k = 0; k < CANOPY_STEPS; k++) {
    let h = CANOPY_STEP_M * (f32(k) + 0.5);
    let q = p + d * (h / dy);
    if (length(q.xz - p.xz) < own) { continue; }
    let c = canopyAt(q.xz);
    if (c.x <= 0.0 || q.y < c.y || q.y > c.z) { continue; }
    tau += c.x / max(c.z - c.y, 1.0) * slant * canopyClump(q);
    if (tau > CANOPY_OPAQUE) { return 0.0; }
  }
  return exp(-tau);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (!inRt(gid.xy)) { return; }
  let px = vec2i(gid.xy);
  let pix = loadPixel(px);
  let key = keyDir();
  var vis = 1.0;
  if (pix.ok && key.y > -0.03) {
    let ndl = dot(pix.n, key.xyz);
    let bias = min((0.04 + 0.006 * pix.z) / max(abs(ndl), 0.15), 1.5);
    let o = pix.pos + pix.n * select(-bias, bias, ndl >= 0.0);
    let u = noise2(px, 0u);
    let basis = basisFromNormal(key.xyz);
    let r = sqrt(u.x);
    let phi = TAU * u.y;
    let tanA = tan(min(key.w, 0.2)) * rp.f.x;
    let dir = normalize(key.xyz + tanA * (r * cos(phi) * basis[0] + r * sin(phi) * basis[1]));
    vis = keyVisibility(o, dir, SHADOW_RANGE, rp.cfg.y) * cloudTransmittance(pix.pos);
    if (vis > 0.0) { vis *= canopyTransmittance(o, dir, pix.leaf); }
  }
  textureStore(out0, px, vec4f(vis, 0.0, 0.0, 0.0));
}
`,"./shaders/rt/spec.wgsl":`// Specular reflection: one GGX-distributed ray per RT texel for surfaces with roughness < 0.6 (rougher ones use the deferred pass's own
// environment lookup). out0 = (radiance * confidence, confidence): the a-trous filter averages premultiplied values and divides at the end.
#include "rt/rt_trace_io.wgsl"

const SPEC_ROUGH_MAX : f32 = 0.6;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (!inRt(gid.xy)) { return; }
  let px = vec2i(gid.xy);
  let pix = loadPixel(px);
  var res = vec4f(0.0);
  if (pix.ok && (rp.cfg.w & FLAG_SPEC) != 0u && pix.rough < SPEC_ROUGH_MAX) {
    let v = normalize(frame.camPos.xyz - pix.pos);
    let a = max(pix.rough * pix.rough, 0.004);
    let u = noise2(px, 11u);
    let cosT = sqrt((1.0 - u.x) / (1.0 + (a * a - 1.0) * u.x));
    let sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
    let phi = TAU * u.y;
    let h = basisFromNormal(pix.n) * vec3f(sinT * cos(phi), sinT * sin(phi), cosT);
    let d = reflect(-v, h);
    let conf = 1.0 - smoothstep(0.4, SPEC_ROUGH_MAX, pix.rough);
    if (dot(d, pix.n) > 0.02) {
      let e = envAt(pix.pos.y);
      let origin = pix.pos + pix.n * (0.04 + 0.004 * pix.z);
      let steps = rp.cfg.y;
      let hit = traceScene(origin, d, rp.f.w, steps);
      var radiance : vec3f;
      if (hit.kind == KIND_MISS) {
        radiance = skyRadiance(d, e);
      } else {
        radiance = hitRadiance(hit, origin, d, e, steps);
      }
      res = vec4f(radiance * conf, conf);
    }
  }
  textureStore(out0, px, fp16Safe(res));
}
`,"./shaders/rt/temporal.wgsl":`// Temporal accumulation of one raw trace signal (SVGF-lite). Defines: SHADOW | GI | SPEC (signal), CAP (history length cap, float literal).
// Reprojects the previous accumulated value with the motion vector, validates it against the previous frame's depth and normal, blends
// with alpha = max(1/(len+1), 1/CAP), and writes the moments (m1, m2, history length, variance) that steer the a-trous filter.
#include "rt/rt_common.wgsl"

@group(\${GRP}) @binding(1) var auxDepth : texture_2d<f32>;
@group(\${GRP}) @binding(2) var auxNormal : texture_2d<f32>;
@group(\${GRP}) @binding(3) var prevDepth : texture_2d<f32>;
@group(\${GRP}) @binding(4) var prevNormal : texture_2d<f32>;
@group(\${GRP}) @binding(5) var gMotion : texture_2d<f32>;
@group(\${GRP}) @binding(6) var rawTex : texture_2d<f32>;
@group(\${GRP}) @binding(7) var raw2Tex : texture_2d<f32>;
@group(\${GRP}) @binding(8) var histPrev : texture_2d<f32>;
@group(\${GRP}) @binding(9) var momPrev : texture_2d<f32>;
@group(\${GRP}) @binding(10) var<storage, read> prevPre : array<f32>;
@group(\${GRP}) @binding(11) var histCur : texture_storage_2d<rgba16float, write>;
@group(\${GRP}) @binding(12) var momCur : texture_storage_2d<rgba16float, write>;

const HIST_CAP : f32 = \${CAP};
const MAX_LEN : f32 = 64.0;
const MIN_WEIGHT : f32 = 0.05;
const MIN_INCIDENCE : f32 = 0.01;
const SLOPE_SLACK_PX : f32 = 0.35;
// Luminance is capped before it enters the moments: m2 = l^2 is stored in fp16, which overflows from l = 255 (an Inf there becomes NaN in the a-trous weights).
const LUMA_CAP : f32 = 100.0;

// Depth (m) that the surface plane through posW with normal n gains per full-resolution pixel step in x and y. The history texel sampled a
// different pixel of its block (and TAA jitter moved the grid), and at grazing angles one pixel is metres of depth: the depth test must
// compare against the plane extrapolated to that texel's sample position, not against the depth at the reprojected point.
fn planeDepthSlope(posW : vec3f, n : vec3f, z : f32) -> vec2f {
  let right = vec3f(frame.view[0][0], frame.view[1][0], frame.view[2][0]);
  let up = vec3f(frame.view[0][1], frame.view[1][1], frame.view[2][1]);
  let nd = dot(n, posW - frame.camPos.xyz) / z;
  let k = -z / (select(-1.0, 1.0, nd >= 0.0) * max(abs(nd), MIN_INCIDENCE));
  return vec2f(k * dot(n, right) * 2.0 * frame.screen.z / frame.proj[0][0], -k * dot(n, up) * 2.0 * frame.screen.w / frame.proj[1][1]);
}

fn signalLuma(v : vec4f) -> f32 {
#ifdef SHADOW
  return v.x;
#else
  return luminance(v.rgb);
#endif
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (any(gid.xy >= rp.dims.xy)) { return; }
  let px = vec2i(gid.xy);
  let dims = rtSize();
  let raw = fp16Safe(textureLoad(rawTex, px, 0));
  let z = textureLoad(auxDepth, px, 0).x;
  if (z <= 0.0) {
    textureStore(histCur, px, raw);
    textureStore(momCur, px, vec4f(0.0, 0.0, 1.0, 0.0));
    return;
  }

  var mean = 0.0;
  var sq = 0.0;
  var nCnt = 0.0;
  var nLuma = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let q = clamp(px + vec2i(i, j), vec2i(0), dims - vec2i(1));
      let s = fp16Safe(textureLoad(rawTex, q, 0));
      let l = min(signalLuma(s), LUMA_CAP);
      mean += l;
      sq += l * l;
      if ((i != 0 || j != 0) && s.a > 0.0) {
        nLuma += l;
        nCnt += 1.0;
      }
    }
  }
  mean = mean / 9.0;
  let spatialVar = max(sq / 9.0 - mean * mean, 0.0);

  var cur = raw;
#ifndef SHADOW
  if (nCnt > 0.0) {
    let lim = 3.0 * (nLuma / nCnt) + 0.02;
    let l = luminance(cur.rgb);
    if (l > lim) { cur = vec4f(cur.rgb * (lim / l), cur.a); }
  }
#endif

  let src = rtSrc(px);
  let uv = pixelUv(src);
  let n = octDecode(textureLoad(auxNormal, px, 0).xy);
  // From the texel centre rather than this frame's sample pixel, so a still camera reads its own history texel exactly (no bilinear blur).
  let motion = textureLoad(gMotion, src, 0).xy;
  let prevUv = (vec2f(px) + 0.5) / vec2f(dims) + motion;
  let posW = worldFromLinear(uv, z);
  let zPrev = (frame.prevViewProj * vec4f(posW, 1.0)).w;
  let slope = planeDepthSlope(posW, n, z);
  let fullPx = vec2f(fullSize());
  // Where the previous sample pixel sits relative to the reprojected point, in full-res pixels (jitter shifts the sampled position by -jitter).
  let gridShift = (frame.jitter.xy - frame.jitter.zw) * vec2f(0.5, -0.5) * fullPx - motion * fullPx;
  let prevFrame = frameIndex() - 1u;
  let tol = 0.03 * zPrev + 0.05 + SLOPE_SLACK_PX * (abs(slope.x) + abs(slope.y));
  let p = prevUv * vec2f(dims) - 0.5;
  let base = vec2i(floor(p));
  let f = p - floor(p);
  var hist = vec4f(0.0);
  var mom = vec4f(0.0);
  var wSum = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let q = base + o;
    if (any(q < vec2i(0)) || any(q >= dims)) { continue; }
    let pz = textureLoad(prevDepth, q, 0).x;
    let sp = rtSourcePixel(q, rtDivisor(), fullSize(), prevFrame);
    if (pz <= 0.0 || abs(pz - (zPrev + dot(slope, vec2f(sp - src) + gridShift))) > tol) { continue; }
    let pn = octDecode(textureLoad(prevNormal, q, 0).xy);
    let bil = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
    let w = bil * saturate1((dot(n, pn) - 0.7) / 0.25);
    let hq = textureLoad(histPrev, q, 0);
    let mq = textureLoad(momPrev, q, 0);
    // A non-finite history texel (NaN * 0 is still NaN) must never be blended in, or it spreads through every reprojection.
    if (!(all(abs(hq) <= vec4f(FP16_SAFE)) && all(abs(mq) <= vec4f(FP16_SAFE)))) { continue; }
    hist += hq * w;
    mom += mq * w;
    wSum += w;
  }

  let l = min(signalLuma(cur), LUMA_CAP);
  var res = cur;
  var len = 1.0;
  var m1 = l;
  var m2 = l * l;
  // rp.probePrev.w: the probes start afresh (new scene, or a lighting cut); the accumulated history is of the old light, so it goes too.
  if (wSum > MIN_WEIGHT && rp.probePrev.w != 1) {
    hist = hist / wSum;
    mom = mom / wSum;
#ifndef SHADOW
    let pp = prevPre[0];
    let ratio = select(1.0, frame.params.y / pp, pp > 0.0);
    hist = vec4f(hist.rgb * ratio, hist.a);
    mom = vec4f(min(mom.x * ratio, LUMA_CAP), min(mom.y * ratio * ratio, LUMA_CAP * LUMA_CAP), mom.z, min(mom.w, LUMA_CAP * LUMA_CAP));
#else
    let sigma = max(sqrt(spatialVar), 0.05);
    let clamped = clamp(hist.x, mean - 2.0 * sigma, mean + 2.0 * sigma);
    // A history the neighbourhood rejects outright is a shadow edge that moved: restart its length and moments so the variance does not stay inflated.
    let keep = 1.0 - saturate1((abs(clamped - hist.x) - 0.1) * 4.0);
    hist.x = clamped;
    mom = vec4f(mix(vec2f(l, l * l), mom.xy, keep), mom.z * keep, mom.w);
#endif
    let alpha = max(1.0 / (mom.z + 1.0), 1.0 / HIST_CAP);
    res = mix(hist, cur, alpha);
    len = min(mom.z + 1.0, MAX_LEN);
    m1 = mix(mom.x, l, alpha);
    m2 = mix(mom.y, l * l, alpha);
  }
  else {
#ifdef GI
    res = vec4f(mix(cur.rgb, textureLoad(raw2Tex, px, 0).rgb, 0.5), cur.a);
#endif
  }
  let temporalVar = max(m2 - m1 * m1, 0.0);
  let variance = mix(spatialVar, temporalVar, saturate1(len / 4.0));
  textureStore(histCur, px, fp16Safe(res));
  textureStore(momCur, px, fp16Safe(vec4f(m1, m2, len, min(variance, LUMA_CAP * LUMA_CAP))));
}
`,"./shaders/rt/test.wgsl":`// Self-test kernel: traces caller-supplied rays through the heightfield or the proxy BVH and writes (t, primitive slot) per ray, so the
// CPU can compare against TerrainSampler.raycast and a brute-force intersection loop. Rays: [2i] = (origin, tMax), [2i+1] = (dir, 0 terrain | 1 bvh).
#include "rt/rt_terrain.wgsl"
#include "rt/rt_bvh.wgsl"

@group(\${GRP}) @binding(3) var<storage, read> rays : array<vec4f>;
@group(\${GRP}) @binding(4) var<storage, read_write> results : array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= rp.dims.x) { return; }
  let a = rays[2u * i];
  let b = rays[2u * i + 1u];
  if (b.w == 0.0) {
    results[i] = vec4f(traceTerrain(a.xyz, b.xyz, a.w, rp.cfg.y), -1.0, 0.0, 0.0);
    return;
  }
  let h = traceBvh(a.xyz, b.xyz, a.w, rp.scene.z);
  let hit = h.prim != NO_NODE;
  results[i] = vec4f(select(-1.0, h.t, hit), select(-1.0, f32(h.prim), hit), 0.0, 0.0);
}
`,"./shaders/sky/aerial.wgsl":`// Aerial-perspective froxels (32x32x32). UNIT CHAIN: lux * sum(T * sigma_s[1/km] * phase[1/sr] * T_light * ds[km]) = nits (not pre-exposed);
// distances along the pixel ray are metres (apSliceToDistance) and are converted to km for the medium. One thread per (x, y) column
// walks the 32 slices front to back, integrating sun and moonlight over [previous slice, this slice] and writing the running
// in-scatter (rgb) and the mean RGB transmittance (a) from the camera to the slice centre. Composite is colour * a + rgb.
#include "sky/lut_common.wgsl"
#include "sky/atmos_uniforms.wgsl"

@group(1) @binding(3) var outTex : texture_storage_3d<rgba16float, write>;
@group(1) @binding(5) var<uniform> ap : AtmosParams;

const SUBSTEPS : u32 = 2u;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (gid.x >= 32u || gid.y >= 32u) { return; }
  let uv = (vec2f(gid.xy) + 0.5) / 32.0;
  let dir = viewRayDir(uv);
  let p0 = vec3f(0.0, frame.sky.x + frame.sky.z, 0.0);
  let moonOn = ap.flags.x > 0.5;
  var lum = vec3f(0.0);
  var thr = vec3f(1.0);
  var dPrev = 0.0;
  for (var k = 0u; k < 32u; k++) {
    let d = apSliceToDistance((f32(k) + 0.5) / AP_SLICES);
    let segKm = (d - dPrev) * 0.001;
    let dt = segKm / f32(SUBSTEPS);
    for (var s = 0u; s < SUBSTEPS; s++) {
      let t = (dPrev * 0.001) + (f32(s) + 0.5) * dt;
      let p = p0 + dir * t;
      let sun = scatterStep(p, dir, dt, frame.sunDir.xyz, frame.sunIrradiance.rgb);
      var dL = sun.dL;
      if (moonOn) { dL += scatterStep(p, dir, dt, frame.moonDir.xyz, frame.moonIrradiance.rgb * MOON_SCATTER_TINT).dL; }
      lum += thr * dL;
      thr *= sun.trans;
    }
    textureStore(outTex, vec3i(i32(gid.x), i32(gid.y), i32(k)), vec4f(min(lum, vec3f(FP16_STORE_MAX)), (thr.x + thr.y + thr.z) * (1.0 / 3.0)));
    dPrev = d;
  }
}
`,"./shaders/sky/atmos_params.wgsl":`// Atmosphere medium, phase functions and single-scattering step (Hillaire 2020). Include after common/math.wgsl + common/frame.wgsl
// and after common/atmosphere_sample.wgsl (needs sampleTransmittance, multiScatterLUT, unitToSubUv). Mirrors src/render/atmosphere/physics.ts.
//
// UNIT CHAIN: coefficients are per km, positions and step lengths in km, lights are illuminance in lux (top of atmosphere), phase
// functions are per steradian, so   radiance [nits] = lux * sum( T * sigma_s[1/km] * phase[1/sr] * T_light * ds[km] ).
// Planet-centred coordinates: the camera is at (0, Rb + frame.sky.z, 0); +Y is local up at the camera.

const RAYLEIGH_SCATTER : vec3f = vec3f(5.802e-3, 13.558e-3, 33.1e-3);
const RAYLEIGH_H : f32 = 8.0;
const MIE_SCATTER : f32 = 0.092;
const MIE_EXTINCTION : f32 = 0.1;
const MIE_H : f32 = 1.4;
// Boundary-layer haze: the aerosol of the mixed layer over the land, its density falling from the land datum (the observer's altitude, where
// the terrain stands) with a short scale height. The MIE layer above runs from sea level, so at an upland site it left the valley air nearly
// clean (about 70 km visibility) and mountains 5-10 km away as crisp as the foreground; with this layer the air near the ground sees about
// 34 km, as on a clear summer day, while a vertical path gains only about 0.03 optical depth and the zenith keeps its blue. Mirrors physics.ts.
const HAZE_SCATTER : f32 = 0.055;
const HAZE_EXTINCTION : f32 = 0.06;
const HAZE_H : f32 = 0.5;
const MIE_G : f32 = 0.6;
const MIE_NARROW_G : f32 = 0.96;
const MIE_NARROW_WEIGHT : f32 = 0.12;
const MIE_SIDE_G : f32 = 0.3;
const MIE_SIDE_WEIGHT : f32 = 0.22;
const MIE_BACK_G : f32 = -0.3;
const MIE_BACK_WEIGHT : f32 = 0.16;
const OZONE_ABSORB : vec3f = vec3f(1.5e-3, 1.65e-3, 0.09e-3);
const OZONE_CENTER : f32 = 25.0;
const OZONE_HALF : f32 = 15.0;
const GROUND_ALBEDO : f32 = 0.3;
const MOON_SCATTER_TINT : vec3f = vec3f(0.92, 1.0, 1.1);
const MS_DIPOLE : f32 = 0.8;
const MS_DIPOLE_MU_LO : f32 = -0.1;
const MS_DIPOLE_MU_HI : f32 = 0.03;

struct Medium {
  scatterR : vec3f,
  scatterM : f32,
  extinction : vec3f,
};

// Height of the land datum above sea level (km): the camera's height above sea level less its height in the world.
fn hazeDatumKm() -> f32 { return max(frame.sky.z - frame.camPos.y * 0.001, 0.0); }

fn mediumAt(heightKm : f32) -> Medium {
  let h = max(heightKm, 0.0);
  let dR = exp(-h / RAYLEIGH_H);
  let dM = exp(-h / MIE_H);
  let dH = exp(-max(h - hazeDatumKm(), 0.0) / HAZE_H);
  let dO = max(0.0, 1.0 - abs(h - OZONE_CENTER) / OZONE_HALF);
  var m : Medium;
  m.scatterR = RAYLEIGH_SCATTER * dR;
  m.scatterM = MIE_SCATTER * dM + HAZE_SCATTER * dH;
  m.extinction = m.scatterR + vec3f(MIE_EXTINCTION * dM + HAZE_EXTINCTION * dH) + OZONE_ABSORB * dO;
  return m;
}

fn rayleighPhase(c : f32) -> f32 { return (3.0 / (16.0 * PI)) * (1.0 + c * c); }

fn cornetteShanksPhase(c : f32, g : f32) -> f32 {
  let g2 = g * g;
  return (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

fn hgPhase(c : f32, g : f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

// Narrow glare peak, broad forward lobe, side lobe and weak back lobe; mirrors miePhase() in physics.ts.
fn miePhase(c : f32) -> f32 {
  let broad = 1.0 - MIE_NARROW_WEIGHT - MIE_SIDE_WEIGHT - MIE_BACK_WEIGHT;
  return broad * cornetteShanksPhase(c, MIE_G) + MIE_NARROW_WEIGHT * hgPhase(c, MIE_NARROW_G)
    + MIE_SIDE_WEIGHT * hgPhase(c, MIE_SIDE_G) + MIE_BACK_WEIGHT * hgPhase(c, MIE_BACK_G);
}

// Near and far distances of the ray o + t d against a sphere of radius R centred at the origin; x > y means no hit.
fn raySphere(o : vec3f, d : vec3f, radius : f32) -> vec2f {
  let b = dot(o, d);
  let c = dot(o, o) - radius * radius;
  let disc = b * b - c;
  if (disc < 0.0) { return vec2f(1.0, -1.0); }
  let s = sqrt(disc);
  return vec2f(-b - s, -b + s);
}

// 1 if the ray from p toward lightDir clears the planet, 0 if the planet blocks it (Earth's shadow).
fn planetVisibility(p : vec3f, lightDir : vec3f) -> f32 {
  let b = dot(p, lightDir);
  let c = dot(p, p) - frame.sky.x * frame.sky.x;
  return select(1.0, 0.0, b < 0.0 && b * b - c > 0.0);
}

// Twilight anisotropy of the multiple-scattering term (see multiScatterDipole() in physics.ts); dir . horizontal light direction at the zenith is 0.
fn multiScatterDipole(muL : f32, lightDir : vec3f, dir : vec3f) -> f32 {
  let hl = length(lightDir.xz);
  if (hl < 1e-4) { return 1.0; }
  return 1.0 + MS_DIPOLE * (1.0 - smoothstep(MS_DIPOLE_MU_LO, MS_DIPOLE_MU_HI, muL)) * (dot(dir.xz, lightDir.xz) / hl);
}

fn sampleMultiScatter(r : f32, muLight : f32) -> vec3f {
  let uv = vec2f(unitToSubUv(muLight * 0.5 + 0.5, 32.0), unitToSubUv(saturate1((r - frame.sky.x) / (frame.sky.y - frame.sky.x)), 32.0));
  return textureSampleLevel(multiScatterLUT, linearClamp, uv, 0.0).rgb;
}

struct StepResult {
  dL : vec3f,
  trans : vec3f,
};

// One segment [p, p + dir*dt] lit by a collimated light of illuminance lightE. dL is the radiance gathered over the segment
// (to be weighted by the throughput at its start), trans the segment transmittance. Analytic integration of S*T over the step.
fn scatterStep(p : vec3f, dir : vec3f, dt : f32, lightDir : vec3f, lightE : vec3f) -> StepResult {
  let r = length(p);
  let med = mediumAt(r - frame.sky.x);
  let up = p / r;
  let muL = dot(up, lightDir);
  let c = dot(dir, lightDir);
  let direct = sampleTransmittance(r, muL) * planetVisibility(p, lightDir) * (med.scatterR * rayleighPhase(c) + vec3f(med.scatterM * miePhase(c)));
  let multi = sampleMultiScatter(r, muL) * (med.scatterR + vec3f(med.scatterM)) * multiScatterDipole(muL, lightDir, dir);
  let s = lightE * (direct + multi);
  let stepT = exp(-med.extinction * dt);
  var res : StepResult;
  res.dL = (s - s * stepT) / max(med.extinction, vec3f(1e-9));
  res.trans = stepT;
  return res;
}

// Albedo of the land seen past the terrain: the mean of meadow, forest and bare ground from the air (0.06-0.12, green-tinted).
const LANDSCAPE_ALBEDO : vec3f = vec3f(0.075, 0.095, 0.055);

// Radius (km) of the land surface round the camera. The planet's sphere is sea level, but the terrain stands at the observer's altitude
// (its datum) plus its own heights: rays that pass under the land's horizon but over the sea-level one used to graze 1-2 km of dense air
// and showed as a bright band (beige by day, orange at dawn, dark at night) between the last terrain ring and the sky. They hit the land.
fn landRadius(r : f32) -> f32 {
  let farH = frame.terrain.z + 0.35 * (frame.terrain.w - frame.terrain.z);
  return clamp(r - (frame.camPos.y - farH) * 0.001, frame.sky.x, r - 1e-4);
}

// Radiance leaving the ground point pg toward the camera when lit by lightE (Lambert, albedo GROUND_ALBEDO), before path attenuation.
fn groundRadianceAt(pg : vec3f, lightDir : vec3f, lightE : vec3f) -> vec3f {
  let r = length(pg);
  let muG = dot(pg / r, lightDir);
  return lightE * sampleTransmittance(r, muG) * max(muG, 0.0) * (GROUND_ALBEDO * INV_PI);
}

// Sky-view uv from a zenith cosine and the cosine of the azimuth to the light (same map as skyViewUv() in common/atmosphere_sample.wgsl).
fn skyViewUvCos(cosZenith : f32, cosAz : f32, r : f32) -> vec2f {
  let rb = frame.sky.x;
  let beta = acos(sqrt(max(r * r - rb * rb, 0.0)) / r);
  let zenithHorizon = PI - beta;
  let zenith = acos(clamp(cosZenith, -1.0, 1.0));
  var v : f32;
  if (zenith < zenithHorizon) {
    v = (1.0 - sqrt(1.0 - zenith / zenithHorizon)) * 0.5;
  } else {
    v = sqrt(saturate1((zenith - zenithHorizon) / beta)) * 0.5 + 0.5;
  }
  let u = sqrt(saturate1(0.5 - 0.5 * cosAz));
  return vec2f(unitToSubUv(u, 192.0), unitToSubUv(v, 108.0));
}
`,"./shaders/sky/atmos_uniforms.wgsl":`// AtmosParams: the atmosphere module's own uniform block (no binding declared here; each shader declares it). Mirrors packAtmosParams()
// in src/render/atmosphere/uniforms.ts row for row. Define MARIA_ROWS (2 rows per lunar mare) before including.

// The cloud target stores rgb / CLOUD_STORE_SCALE: rgba16float tops out at 65504 and sunlit cloud edges seen near the sun scatter
// several 1e5 nits toward the eye.
const CLOUD_STORE_SCALE : f32 = 32.0;

// rgba16float holds finite values up to 65504 and overflows to Inf, which then poisons every bilinear tap, blend and history that touches it
// (Inf * 0 = NaN). Every LUT or target that can see the aureole beside the sun is clamped to this before the store.
const FP16_STORE_MAX : f32 = 65000.0;

// The sun-pass sky-view LUT (skySun, read only by sky.wgsl) stores nits / skySunStoreScale(): the aureole peaks near 4e5 nits at the sun (sun
// at 12 degrees), above fp16's range, and the sky pass keeps the physical value by multiplying back. The world sky-view LUT keeps plain nits for
// its many consumers and is clamped instead. A night sky sits at fp16's smallest normal value (6.1e-5) already, so the scale applies only
// while the sun is above SKY_SUN_SCALE_MIN_MU (about -5.7 degrees), where no aureole is left and the whole sky is brighter than a nit.
const SKY_SUN_STORE_SCALE : f32 = 16.0;
const SKY_SUN_SCALE_MIN_MU : f32 = -0.1;

fn skySunStoreScale() -> f32 { return select(1.0, SKY_SUN_STORE_SCALE, frame.sunDir.y > SKY_SUN_SCALE_MIN_MU); }

// The cloud target's store scale: CLOUD_STORE_SCALE by day; at night a cloud's radiance (around 1e-4 nits) divided by it would fall below
// fp16's normal range and flush to zero, leaving black cut-outs, so the scale slides smoothly down to CLOUD_NIGHT_STORE_SCALE as the sun
// sets (smoothly, so the temporal history stored at last frame's scale stays within a fraction of a percent).
const CLOUD_NIGHT_STORE_SCALE : f32 = 1.0 / 1024.0;

fn cloudStoreScale() -> f32 {
  return exp2(mix(log2(CLOUD_NIGHT_STORE_SCALE), log2(CLOUD_STORE_SCALE), smoothstep(-0.2, 0.05, frame.sunDir.y)));
}

struct AtmosParams {
  flags : vec4f,     // x = moonlight scattering active (0/1), y = night-sky scale, z = star brightness, w = twinkle amount 0..1
  sky2 : vec4f,      // x = Milky Way brightness, y = stars enabled, z = clouds enabled, w = star magnitude limit
  cloudA : vec4f,    // x = cumulus coverage, y = cirrus coverage, z = density scale, w = seed (0..1000)
  cloudB : vec4f,    // x = cumulus base km, y = cumulus top km, z = cirrus base km, w = cirrus top km
  wind : vec4f,      // xy = cumulus drift (m, world x/z), zw = cirrus drift (m)
  cloudC : vec4f,    // x = march steps, y = frame/jitter index, z,w = shadow-map centre (world x, z in m)
  cloudD : vec4f,    // x = history blend, y = 1 when history is valid, z = light march steps, w = shadow-map side length (m)
  eclNorth : vec4f,  // xyz = world-space ecliptic north pole, w = cirrus streak bearing (rad, compass, the upper wind's direction)
  gal0 : vec4f,      // xyz = J2000 equatorial coordinates of the galactic axis l=0 b=0 (galactic centre), w = night-dome radiance red (nits)
  gal1 : vec4f,      // ... l=90 b=0, w = night-dome green
  gal2 : vec4f,      // ... north galactic pole, w = night-dome blue
  cloudE : vec4f,    // x = cloud edge detail 0..1 (1 at the extreme tier: a second, finer erosion octave and wisps), y,z,w unused
  maria : array<vec4f, \${MARIA_ROWS}>, // row 2k: lon, lat, radius lon, radius lat (rad); row 2k+1: darkness, edge softness, rotation, 0
};
`,"./shaders/sky/cloud_density.wgsl":`// Cloud geometry and density, shared by the march and the shadow-map passes. Mirrors the macro model in src/render/atmosphere/cloudModel.ts
// (hash, value noise, presence, height gradient), which the CPU uses for cloudSunVisibility().
//
// UNIT CHAIN: positions are planet-centred KILOMETRES (camera at (0, Rb + frame.sky.z, 0), +Y local up; horizontal offsets from the camera
// are world x / z offsets in km). Heights are above the world datum (world y = 0), so a layer's shell radius is
// Rb + frame.sky.z - frame.camPos.y / 1000 + height. Density is unit-less 0..1; extinction sigma_e [1/km] = CUMULUS_SIGMA_KM * density *
// cloudDensity, and a segment of length ds [km] has optical depth sigma_e * ds.
//
// Cumulus: a 2D weather map (convective cells on a 2.6 km grid, a 1.6 km and a 0.7 km value-noise octave; fair-weather cumulus 0.5-2 km
// across) picks where clouds stand and, through the local presence L, how
// tall they grow; the vertical profile is Schneider's height gradient; the 128^3 Perlin-Worley / Worley volume carves the billows
// (density = saturate(shape * gradient - 1 + L), which is his remap-by-coverage in closed form) and the 32^3 volume erodes the edges.
// Cirrus: a thin slab of the same volume stretched along the wind into 24 x 4 km streaks.
//
// Group 1 (each stage adds its own outputs): 0 linearClamp, 1 transmittanceLUT, 2 multiScatterLUT, 5 AtmosParams, 6 shape volume,
// 7 detail volume, 8 repeating sampler, 40 world sky-view LUT, 41 world aerial-perspective froxels.
#include "sky/lut_common.wgsl"
#include "sky/atmos_uniforms.wgsl"

@group(1) @binding(5) var<uniform> ap : AtmosParams;
@group(1) @binding(6) var shapeNoise : texture_3d<f32>;
@group(1) @binding(7) var detailNoise : texture_3d<f32>;
@group(1) @binding(8) var noiseSampler : sampler;

const CUMULUS_SIGMA_KM : f32 = 40.0;
const NIGHT_CUMULUS_SCALE : f32 = 0.35;
const NIGHT_CUMULUS_SIN_LO : f32 = -0.2;
const NIGHT_CUMULUS_SIN_HI : f32 = 0.05;
// Night clearing: weather taken off where the broad mask is above NIGHT_CLEAR_LO (about 1 - NIGHT_CUMULUS_SCALE of the sky clears), the
// mask's scale (km), and how much flatter the remaining clouds are.
const NIGHT_CLEAR_DEPTH : f32 = 0.6;
const NIGHT_CLEAR_LO : f32 = 0.3;
const NIGHT_CLEAR_KM : f32 = 12.0;
const NIGHT_CUMULUS_TALL : f32 = 0.7;
const CIRRUS_SIGMA_KM : f32 = 0.9;
const SHAPE_TILE_KM : f32 = 1.6;
const DETAIL_TILE_KM : f32 = 0.45;
// Extreme tier (ap.cloudE.x): a second erosion octave this much finer, the shape lookup pushed around by the detail volume by up to
// WISP_KM so edges tear into wisps and curls, and the erosion this much stronger.
const FINE_DETAIL_TILE_KM : f32 = 0.13;
const FINEST_DETAIL_TILE_KM : f32 = 0.04;
const WISP_KM : f32 = 0.05;
const FINE_EROSION : f32 = 1.6;
const EDGE_SHARPEN : f32 = 3.0;
const BASE_RAG : f32 = 0.12;
const TOP_LUMPS : f32 = 0.6;
const CIRRUS_STREAK_KM : vec3f = vec3f(24.0, 4.0, 4.0);

fn datumRadius() -> f32 { return frame.sky.x + frame.sky.z - frame.camPos.y * 0.001; }

// Fair-weather cumulus is convective and dissipates after sunset: the night keeps about NIGHT_CUMULUS_SCALE of the day's cover. It is taken
// away region by region (a broad mask clears whole areas, NIGHT_CLEAR_KM across) while the clouds left keep their daytime shapes, a little
// flattened (NIGHT_CUMULUS_TALL). Raising the cover threshold instead left only the cells' weather maxima: rows of identical domes, the
// full layer tall, which read as bullets and mushrooms at night.
fn cumulusCoverage() -> f32 { return ap.cloudA.x; }
fn cumulusDay() -> f32 { return smoothstep(NIGHT_CUMULUS_SIN_LO, NIGHT_CUMULUS_SIN_HI, frame.sunDir.y); }
fn nightClearing(xz : vec2f, day : f32) -> f32 {
  // By day nothing is cleared: skip the mask's noise (it ran on every density sample and cost 0.5 ms at ultra). \`day\` comes from the sun
  // direction, a frame uniform, so the branch is coherent.
  if (day >= 1.0) { return 0.0; }
  return (1.0 - day) * NIGHT_CLEAR_DEPTH * smoothstep(NIGHT_CLEAR_LO, NIGHT_CLEAR_LO + 0.15, vnoise2(xz / NIGHT_CLEAR_KM + vec2f(71.3, 19.7)));
}

fn seedOffset() -> vec2f { return vec2f(ap.cloudA.w * 13.37, ap.cloudA.w * 7.13 + 100.0); }

// World-plane position (km) of a planet-centred point, with the layer's wind drift (m) and the seed applied.
fn layerPlane(p : vec3f, driftM : vec2f) -> vec2f {
  return (frame.camPos.xz + p.xz * 1000.0 - driftM) * 0.001 + seedOffset();
}

fn vnoise2(p : vec2f) -> f32 {
  let b = floor(p);
  let f = p - b;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let i = bitcast<vec2u>(vec2i(b));
  let a = hash21(i);
  let c = hash21(i + vec2u(1u, 0u));
  let d = hash21(i + vec2u(0u, 1u));
  let e = hash21(i + vec2u(1u, 1u));
  return mix(mix(a, c, u.x), mix(d, e, u.x), u.y);
}

// Convective cells 0..1: one rounded dome per CELL_KM cell, jittered, of its own radius (0.3-0.65 of a cell) and strength, so the cover
// breaks up into separate clouds with blue sky between them instead of the meandering worms a thresholded smooth noise draws.
// Mirrors cumulusCells in cloudModel.ts (the hashes are the same integer lattice hashes).
const CELL_KM : f32 = 2.6;
// Share of the cells that hold no cloud at all, so the clouds stand in an irregular scatter rather than one per grid square.
const CELL_EMPTY : f32 = 0.5;

fn cellHash(x : i32, y : i32) -> f32 { return hash21(bitcast<vec2u>(vec2i(x, y))); }

fn cumulusCells(xz : vec2f) -> f32 {
  let g = xz / CELL_KM;
  let b = vec2i(floor(g));
  // A cell's dome reaches at most 0.65 of a cell from a centre that keeps 0.15 from its edges, so only the cells on the near side of
  // each axis can reach this point: a 2 x 2 block, not 3 x 3.
  let side = select(vec2i(1), vec2i(-1), g - vec2f(b) < vec2f(0.5));
  var best = 0.0;
  for (var j = 0; j <= 1; j++) {
    for (var i = 0; i <= 1; i++) {
      let c = b + vec2i(i, j) * side;
      let p = vec2f(c) + vec2f(0.15 + 0.7 * cellHash(c.x, c.y + 7919), 0.15 + 0.7 * cellHash(c.x + 7919, c.y));
      let r = 0.3 + 0.35 * cellHash(c.x + 104729, c.y);
      let s = cellHash(c.x, c.y + 104729);
      if (s < CELL_EMPTY) { continue; }
      let d = length(g - p) / r;
      if (d < 1.0) { best = max(best, (1.0 - smoothstep(0.0, 1.0, d)) * (0.55 + 0.45 * (s - CELL_EMPTY) / (1.0 - CELL_EMPTY))); }
    }
  }
  return best;
}

// The cells, with a 1.6 km and a 0.7 km noise octave that break their outlines into lobes, then remapped (a log curve fitted to the
// field's quantiles) so the clouds, whose soft rims reach a little below presence()'s threshold, cover about the requested fraction.
fn cumulusWeather(xz : vec2f) -> f32 {
  let raw = 0.45 * cumulusCells(xz) + 0.35 * vnoise2(xz / 1.6 + vec2f(17.3, 9.1)) + 0.2 * vnoise2(xz / 0.7 + vec2f(3.7, 41.9));
  return saturate(1.156 + 0.583 * log(max(raw, 1e-4)));
}

fn cirrusWeather(xz : vec2f) -> f32 {
  return 0.6 * vnoise2(xz / 30.0 + vec2f(5.1, 2.3)) + 0.4 * vnoise2(xz / 11.0 + vec2f(29.7, 13.9));
}

// Local cloud presence 0..1 for a weather value and a sky-cover setting (about \`coverage\` of the plane is above 0.5).
fn presence(n : f32, coverage : f32) -> f32 {
  let t = 0.80 - 0.62 * coverage;
  return smoothstep(t - 0.09, t + 0.09, n);
}

// How tall the cloud grows at a weather value: unlike presence, which switches over a narrow band so outlines stay crisp, this climbs
// slowly to the weather maxima, so each cloud's top is a dome peaking over its core instead of a flat lid at the layer ceiling.
fn cumulusTallness(n : f32, coverage : f32) -> f32 {
  let t = 0.80 - 0.62 * coverage;
  return smoothstep(t - 0.09, t + 0.3, n);
}

// The base is the condensation level: density climbs within the lowest 4% of the layer (about 50 m), a flat, sharp base.
fn cumulusGradient(hs : f32) -> f32 {
  return smoothstep(0.0, 0.04, hs) * (1.0 - smoothstep(0.62, 1.0, hs));
}

// Cumulus density 0..1 at a plane position (km) and height above the datum (km). detail 0..1 blends the erosion volume in (0 = mean erosion).
fn cumulusDensity(xz : vec2f, hKm : f32, detail : f32) -> f32 {
  let hf = (hKm - ap.cloudB.x) / (ap.cloudB.y - ap.cloudB.x);
  if (hf <= 0.0 || hf >= 1.0) { return 0.0; }
  let day = cumulusDay();
  let n = cumulusWeather(xz) - nightClearing(xz, day);
  let l = presence(n, cumulusCoverage());
  if (l <= 0.0) { return 0.0; }
  let fine = ap.cloudE.x * detail;
  var q = vec3f(xz.x, hKm, xz.y);
  var v = vec4f(0.5);
  var hg = hf;
  if (detail > 0.0) {
    v = textureSampleLevel(detailNoise, noiseSampler, q / DETAIL_TILE_KM, 0.0);
    // Wisps: the billows are looked up a little off their place, by an amount that itself varies, so their outlines curl and tear.
    if (fine > 0.0) { q += (v.rgb - 0.5) * (2.0 * WISP_KM * fine); }
    // The base is level overall but sags and lifts by tens of metres in rolls and lumps, which is what the low sun picks out from below.
    hg += BASE_RAG * detail * (v.r - 0.5) * (1.0 - smoothstep(0.05, 0.25, hf));
  }
  let hs = hg / (mix(0.25, 1.0, cumulusTallness(n, cumulusCoverage())) * mix(NIGHT_CUMULUS_TALL, 1.0, day));
  if (hs >= 1.0 + 0.5 * TOP_LUMPS) { return 0.0; }
  let s = textureSampleLevel(shapeNoise, noiseSampler, q / SHAPE_TILE_KM, 0.0);
  // Cauliflower tops: the top of the cloud rises over the low-frequency Worley blobs (s.g, 400 m) and sinks between them, so the upper
  // half is a cluster of turrets rather than one smooth dome.
  let grad = cumulusGradient(hs - TOP_LUMPS * (s.g - 0.5) * smoothstep(0.2, 0.6, hs));
  if (grad <= 0.0) { return 0.0; }
  let low = s.g * 0.625 + s.b * 0.25 + s.a * 0.125;
  let shape = saturate((s.r - low + 1.0) / (2.0 - low));
  let d = saturate(shape * grad - 1.0 + l);
  if (d <= 0.0) { return 0.0; }
  var erosion = 0.5;
  if (detail > 0.0) {
    var f = v.r * 0.625 + v.g * 0.25 + v.b * 0.125;
    if (fine > 0.0) {
      let w = textureSampleLevel(detailNoise, noiseSampler, q / FINE_DETAIL_TILE_KM + vec3f(0.37, 0.71, 0.13), 0.0);
      var fw = w.r * 0.5 + w.g * 0.3 + w.b * 0.2;
      // Extreme only (cloudDetail 1): a third octave of tens of metres, the small cauliflower bumps on the billows of a near cloud.
      let finest = saturate((ap.cloudE.x - 0.8) * 5.0) * detail;
      if (finest > 0.0) {
        let u = textureSampleLevel(detailNoise, noiseSampler, q / FINEST_DETAIL_TILE_KM + vec3f(0.11, 0.53, 0.29), 0.0);
        fw = mix(fw, 0.65 * fw + 0.35 * (u.r * 0.5 + u.g * 0.3 + u.b * 0.2), finest);
      }
      f = mix(f, 0.6 * f + 0.4 * fw, fine);
    }
    erosion = mix(0.5, mix(f, 1.0 - f, saturate(hf * 10.0)), detail);
  }
  let e = 0.35 * exp(-l * 0.75) * erosion * 2.0 * mix(1.0, FINE_EROSION, fine);
  // A cumulus has a sharp skin: droplets evaporate within metres of its edge, so density climbs from nothing to the core's within a few
  // tens of metres rather than over the whole billow. With the detail in, the ramp above the erosion threshold is steepened (the
  // threshold itself, and so the cloud's outline and cover, stays put); without it (shadow map, light march, CPU model) it is unchanged.
  return saturate((d - e) / (1.0 - e) * (1.0 + EDGE_SHARPEN * detail));
}

// Cirrus density 0..1: fibrous streaks along the wind bearing (ap.eclNorth.w, radians clockwise from north).
fn cirrusDensity(xz : vec2f, hKm : f32) -> f32 {
  let hf = (hKm - ap.cloudB.z) / (ap.cloudB.w - ap.cloudB.z);
  if (hf <= 0.0 || hf >= 1.0) { return 0.0; }
  let l = presence(cirrusWeather(xz), ap.cloudA.y);
  if (l <= 0.0) { return 0.0; }
  let a = ap.eclNorth.w;
  let along = dot(xz, vec2f(sin(a), -cos(a)));
  let across = dot(xz, vec2f(cos(a), sin(a)));
  let s = textureSampleLevel(shapeNoise, noiseSampler, vec3f(along / CIRRUS_STREAK_KM.x, across / CIRRUS_STREAK_KM.y, hKm / CIRRUS_STREAK_KM.z), 0.0);
  let fibre = 0.55 * s.r + 0.45 * s.b;
  return saturate((fibre - (1.0 - l) * 0.9) / 0.5) * sin(PI * hf);
}

// Interval [t0, t1] (km along o + t d) of the ray inside the spherical shell rBot..rTop; x >= y means the ray misses it.
fn shellInterval(o : vec3f, d : vec3f, rBot : f32, rTop : f32) -> vec2f {
  let top = raySphere(o, d, rTop);
  if (top.x > top.y) { return vec2f(1.0, -1.0); }
  var t0 = max(top.x, 0.0);
  var t1 = top.y;
  let bot = raySphere(o, d, rBot);
  if (bot.x <= bot.y) {
    if (bot.x > t0) { t1 = min(t1, bot.x); } else if (bot.y > t0) { t0 = bot.y; }
  }
  return vec2f(t0, t1);
}
`,"./shaders/sky/cloud_frame.wgsl":`// Frame-invariant cloud lighting. Kept in f32 storage (96 bytes, including struct padding),
// never rounded to fp16. Recomputed after the atmosphere LUTs for every encoded cloud frame.
#include "sky/cloud_light.wgsl"

struct CloudFrame {
  lights : CloudLights,
  ambient : Ambient,
};
`,"./shaders/sky/cloud_light.wgsl":`// Cloud lighting shared by the march and the shadow passes: which lights matter, phase functions, the multiple-scattering octave sum,
// the light march through the cumulus, and the ambient from the sky-view LUT.
//
// UNIT CHAIN: light illuminance E [lux, top of atmosphere, frame.sunIrradiance / frame.moonIrradiance] times the atmosphere transmittance
// to the sample and the planet's shadow gives the lux reaching it. In-scattered radiance per km of path is
//   sigma_s [1/km] * ( E_eff [lux] * phase [1/sr] * exp(-tau_light) + L_ambient [nits] )
// with sigma_s = sigma_e (cloud droplets do not absorb). Integrated analytically over a step of optical depth tau_s = sigma_e * ds [km]:
//   dL [nits] = T * (E_eff * msPhase + L_ambient) * (1 - exp(-tau_s)) ; T *= exp(-tau_s)
// so sigma_e cancels and the radiance stays in nits (never pre-exposed).
#include "sky/cloud_density.wgsl"

const PHASE_G_FORWARD : f32 = 0.8;
const PHASE_G_BACK : f32 = -0.3;
const PHASE_FORWARD_WEIGHT : f32 = 0.7;
const MS_ENERGY : f32 = 0.5;
const MS_EXTINCTION : f32 = 0.5;
const MS_ANISOTROPY : f32 = 0.5;
const LIGHT_STEP_KM : f32 = 0.06;
const LIGHT_DETAIL_STEPS : i32 = 2;
const AMBIENT_FLOOR : f32 = 0.75;
// Share of the sky light falling on a cloud's top that multiple scattering carries down through it to its base. Without it a base is lit
// only by the ground's bounce, which at night (no direct light, a dark ground) leaves the clouds as black cut-outs against the airglow and
// starlight; real clouds pass a good part of the light down (a thick cumulus deck still lets through a fifth to a half).
const DIFFUSE_THROUGH : f32 = 0.6;

struct CloudLight {
  dir : vec3f,
  toa : vec3f,
  w : f32,
};

struct CloudLights {
  sun : CloudLight,
  moon : CloudLight,
};

struct Ambient {
  top : vec3f,
  bottom : vec3f,
};

// Sun and moon as cloud lights. A light is marched (w = 1) only if its illuminance at the layer is within 50x of the brighter one:
// at night the sun is off, by day the moon is, and both run only in the twilight overlap.
fn cloudLights(rMid : f32) -> CloudLights {
  let p = vec3f(0.0, rMid, 0.0);
  var res : CloudLights;
  res.sun.dir = frame.sunDir.xyz;
  res.sun.toa = frame.sunIrradiance.rgb;
  res.moon.dir = frame.moonDir.xyz;
  res.moon.toa = frame.moonIrradiance.rgb * select(0.0, 1.0, ap.flags.x > 0.5);
  let ls = luminance(res.sun.toa * sampleTransmittance(rMid, res.sun.dir.y)) * planetVisibility(p, res.sun.dir);
  let lm = luminance(res.moon.toa * sampleTransmittance(rMid, res.moon.dir.y)) * planetVisibility(p, res.moon.dir);
  let top = max(ls, lm);
  res.sun.w = select(0.0, 1.0, ls > 0.02 * top && ls > 0.0);
  res.moon.w = select(0.0, 1.0, lm > 0.02 * top && lm > 0.0);
  return res;
}

// Light reaching the point p (planet-centred km, radius r) from a light: TOA illuminance x transmittance x planet shadow.
fn lightAt(l : CloudLight, p : vec3f, r : f32) -> vec3f {
  return l.toa * sampleTransmittance(r, dot(p, l.dir) / r) * planetVisibility(p, l.dir);
}

// Dual-lobe Henyey-Greenstein; ecc scales both lobes' anisotropy (the multiple-scattering octaves use it to widen the phase).
fn cloudPhase(c : f32, ecc : f32) -> f32 {
  return mix(hgPhase(c, PHASE_G_BACK * ecc), hgPhase(c, PHASE_G_FORWARD * ecc), PHASE_FORWARD_WEIGHT);
}

// Multiple-scattering octave sum (Wrenninge 2015, Hillaire 2016): octave i carries energy MS_ENERGY^i, sees the optical depth to the
// light shrunk by MS_EXTINCTION^i (multiply-scattered light reaches deeper) and a phase that is MS_ANISOTROPY^i as directional.
fn cloudInscatter(c : f32, tauLight : f32) -> f32 {
  var sum = 0.0;
  var a = 1.0;
  var b = 1.0;
  var e = 1.0;
  for (var i = 0; i < 3; i++) {
    sum += a * exp(-tauLight * b) * cloudPhase(c, e);
    a *= MS_ENERGY;
    b *= MS_EXTINCTION;
    e *= MS_ANISOTROPY;
  }
  return sum;
}

// Beer-Powder (Schneider 2015): thin cloud edges scatter less than Beer's law alone suggests when seen away from the light.
fn powderTerm(sigmaE : f32, c : f32) -> f32 {
  return mix(1.0, 1.0 - exp(-2.0 * sigmaE * 0.1), 0.5 * (1.0 - c));
}

// Diffuse transmission of the light through the cloud: light that has scattered many times on its way in arrives from every direction,
// and a thick cloud passes a good share of it (two-stream, conservative scattering: T = 1 / (1 + 0.75 tau (1 - g)), a fifth through
// tau 30). It is what makes a cumulus base grey-white instead of sky-blue and its shaded flanks soft grey instead of black, while the
// single-scattering octaves keep the bright, crisp sunlit billows.
const DIFFUSE_SHARE : f32 = 0.18;
const DIFFUSE_G : f32 = 0.85;

// The slab formula holds for a cloud wider than it is deep; a cumulus loses diffuse light out of its sides, so it also fades with the
// depth to the light (DIFFUSE_LEAK per unit of optical depth), which keeps the far side of a low-sun cloud in shade.
const DIFFUSE_LEAK : f32 = 0.07;

fn cloudDiffuse(tauLight : f32) -> f32 {
  return DIFFUSE_SHARE * INV_PI * exp(-DIFFUSE_LEAK * tauLight) / (1.0 + 0.75 * (1.0 - DIFFUSE_G) * tauLight);
}

// Optical depth from p toward l through the cumulus: \`steps\` samples at exponentially growing spacing (60 m doubling), ending once
// the ray has left the layer. \`nearDetail\` puts the erosion detail into the first LIGHT_DETAIL_STEPS steps (60 + 120 m), so the small
// billows shade each other (sunlit cauliflower tops over darker crevices, a mottled base from below); the rest of the path is far
// enough that the mean erosion stands in for it.
fn cumulusLightTau(p : vec3f, l : vec3f, steps : i32, datumR : f32, nearDetail : f32) -> f32 {
  var tau = 0.0;
  var t = 0.0;
  var ds = LIGHT_STEP_KM;
  for (var i = 0; i < steps; i++) {
    let q = p + l * (t + 0.5 * ds);
    let rq = length(q);
    let h = rq - datumR;
    let rising = dot(q, l) > 0.0;
    if ((h > ap.cloudB.y && rising) || (h < ap.cloudB.x && !rising)) { break; }
    tau += CUMULUS_SIGMA_KM * ap.cloudA.z * cumulusDensity(layerPlane(q, ap.wind.xy), h, select(0.0, nearDetail, i < LIGHT_DETAIL_STEPS)) * ds;
    t += ds;
    ds *= 2.0;
  }
  return tau;
}

// Ambient radiance (nits) around the cloud layer: the sky hemisphere from the world sky-view LUT, and the ground's bounce (Lambert
// albedo LANDSCAPE_ALBEDO, lit by the direct light and the sky, dimmed by the cloud cover's own shadow on the ground).
fn cloudAmbient(lights : CloudLights, rGround : f32) -> Ambient {
  let s = 0.70710678;
  var res : Ambient;
  res.top = 0.4 * sampleSkyView(vec3f(0.0, 1.0, 0.0))
    + 0.15 * (sampleSkyView(vec3f(s, s, 0.0)) + sampleSkyView(vec3f(-s, s, 0.0)) + sampleSkyView(vec3f(0.0, s, s)) + sampleSkyView(vec3f(0.0, s, -s)));
  // The sky near the horizon lights a cloud's sides: by day it is about as bright as the zenith, but at night the airglow is several times
  // brighter there (the slant path through its shell), and it is what keeps distant clouds grey instead of black.
  let horizon = sampleSkyView(vec3f(0.98, 0.2, 0.0)) + sampleSkyView(vec3f(-0.98, 0.2, 0.0)) + sampleSkyView(vec3f(0.0, 0.2, 0.98)) + sampleSkyView(vec3f(0.0, 0.2, -0.98));
  res.top = 0.8 * res.top + 0.05 * horizon;
  let p = vec3f(0.0, rGround, 0.0);
  let direct = lights.sun.toa * sampleTransmittance(rGround, lights.sun.dir.y) * (max(lights.sun.dir.y, 0.0) * planetVisibility(p, lights.sun.dir) * lights.sun.w)
    + lights.moon.toa * sampleTransmittance(rGround, lights.moon.dir.y) * (max(lights.moon.dir.y, 0.0) * planetVisibility(p, lights.moon.dir) * lights.moon.w);
  // The land under the clouds (meadow, forest, fields) reflects about 0.1, not the grey 0.3 of the atmosphere's multiple-scattering ground:
  // a sunlit 0.3 lit a cumulus base from below brighter than the sky beside it, so the bases read flat cream instead of grey.
  res.bottom = LANDSCAPE_ALBEDO * (direct * INV_PI + res.top) * (1.0 - 0.6 * ap.cloudA.x) + DIFFUSE_THROUGH * res.top;
  return res;
}

// Ambient radiance inside the cumulus at height fraction hf: ground bounce at the base, sky at the top, never fully dark.
fn ambientAt(a : Ambient, hf : f32) -> vec3f {
  return mix(a.bottom, a.top, smoothstep(0.0, 1.0, hf)) * (AMBIENT_FLOOR + (1.0 - AMBIENT_FLOOR) * smoothstep(0.0, 0.6, hf));
}

// Share of the light on a cloud's top that diffuses down to a point tauLight (optical depth toward the light) inside it: the slab
// transmission with side leak of cloudDiffuse, without its share.
fn cloudThrough(tauLight : f32) -> f32 {
  return exp(-DIFFUSE_LEAK * tauLight) / (1.0 + 0.75 * (1.0 - DIFFUSE_G) * tauLight);
}

// ambientAt for a sample whose optical depth toward the key light is tauUp (negative when no light is marched). The sky light passed
// down through the cloud (DIFFUSE_THROUGH in a.bottom) is scaled by how much cloud stands above the sample, so a base under a deep
// tower is dark grey and one under a thin cap is pale: the mottled, dark-centred base of a cumulus seen from below, instead of an
// evenly lit underside.
fn ambientThroughAt(a : Ambient, hf : f32, tauUp : f32) -> vec3f {
  if (tauUp < 0.0) { return ambientAt(a, hf); }
  let lost = DIFFUSE_THROUGH * a.top * (1.0 - cloudThrough(tauUp)) * (1.0 - smoothstep(0.0, 1.0, hf)) * AMBIENT_FLOOR;
  return max(ambientAt(a, hf) - lost, vec3f(0.0));
}
`,"./shaders/sky/cloud_march.wgsl":`// Cloud march (compute, one thread per texel of the reduced-resolution cloud target). Ray-marches the cumulus shell and the cirrus
// slab from the camera, lights every sample (sky/cloud_light.wgsl) and writes  rgb = in-scattered radiance [nits], a = transmittance
// for the sky pass, which composites  colour * a + rgb  (the same convention as the aerial-perspective froxels).
//
// UNIT CHAIN: radiance in nits, not pre-exposed (sky.wgsl applies frame.params.y once). The texture stores nits / cloudStoreScale() so
// a cloud lit by the sun head-on (~4e5 nits) stays inside rgba16float; sky.wgsl multiplies it back. Lengths in km, planet-centred; the
// camera is at (0, Rb + frame.sky.z, 0). Aerial perspective: a cloud whose transmittance-weighted mean distance is D metres shows
//   rgb = L_cloud * T_ap(D) + In_ap(D) * (1 - a)
// with (In_ap, T_ap) from the froxels up to 12 km and, beyond that, blended toward the sky-view LUT (haze to the horizon colour,
// e-folding 25 km) with the transmittance fading out. The result is also faded to nothing between 60 and 100 km.
//
// Group 1: 3 output (rgba16float), plus everything sky/cloud_density.wgsl declares.
#include "sky/cloud_frame.wgsl"

@group(1) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;
@group(1) @binding(11) var<storage, read> cloudFrame : CloudFrame;

const CLOUD_MAX_KM : f32 = 100.0;
const CLOUD_FADE_KM : f32 = 60.0;
const CIRRUS_MAX_KM : f32 = 200.0;
const FAR_HAZE_KM : f32 = 25.0;
const EARLY_OUT_T : f32 = 0.02;
// Longest cumulus sub-step (km) and the most sub-steps one march step is split into.
const SUB_STEP_KM : f32 = 0.12;
const MAX_SUB_STEPS : i32 = 3;
// At night a cloud is lit almost evenly from all round by airglow and starlight, and multiple scattering carries that light right through it,
// so it shows about as bright as the sky behind it (a little darker, with a dark ground below). The two-term ambient underestimates this
// even light, so once the sun is down a cloud's in-scattering is kept at no less than this share of the sky radiance in its direction.
const NIGHT_SKY_FLOOR : f32 = 0.8;

struct Layer {
  lum : vec3f,
  a : f32,
  dist : f32,
};

fn emptyLayer() -> Layer {
  var l : Layer;
  l.lum = vec3f(0.0);
  l.a = 1.0;
  l.dist = 0.0;
  return l;
}

fn interleavedGradientNoise(p : vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

fn halton(index : u32, base : u32) -> f32 {
  var f = 1.0;
  var r = 0.0;
  var n = index;
  while (n > 0u) {
    f = f / f32(base);
    r = r + f * f32(n % base);
    n = n / base;
  }
  return r;
}

// Radiance factor of one light at a cumulus sample: light reaching it, multiple-scattering phase sum and the powder term.
// Returns rgb = the light's radiance factor, a = the optical depth toward it (-1 when it does not reach p).
fn cumulusLightTerm(l : CloudLight, p : vec3f, r : f32, viewDir : vec3f, sigmaE : f32, lightSteps : i32, datumR : f32, detail : f32) -> vec4f {
  let e = lightAt(l, p, r);
  if (max(e.r, max(e.g, e.b)) < 1e-9) { return vec4f(0.0, 0.0, 0.0, -1.0); }
  let c = dot(viewDir, l.dir);
  let tau = cumulusLightTau(p, l.dir, lightSteps, datumR, detail);
  return vec4f(e * (cloudInscatter(c, tau) * powderTerm(sigmaE, c) + cloudDiffuse(tau)), tau);
}

fn marchCumulus(o : vec3f, d : vec3f, jitter : f32, lights : CloudLights, amb : Ambient, skyFloor : vec3f) -> Layer {
  var res = emptyLayer();
  let datumR = datumRadius();
  var iv = shellInterval(o, d, datumR + ap.cloudB.x, datumR + ap.cloudB.y);
  iv.y = min(iv.y, CLOUD_MAX_KM);
  if (iv.x >= iv.y) { return res; }
  let steps = i32(ap.cloudC.x);
  let lightSteps = i32(ap.cloudD.z);
  let len = iv.y - iv.x;
  let curve = saturate((len - 8.0) / 40.0);
  let invSteps = 1.0 / f32(steps);
  var trans = 1.0;
  var lum = vec3f(0.0);
  var distSum = 0.0;
  var weightSum = 0.0;
  var prevF = 0.0;
  // Edge detail fades out with distance where it would only shimmer; the extreme tier keeps it out to 60 km.
  let detailFar = mix(25.0, 60.0, ap.cloudE.x);
  for (var i = 0; i < steps; i++) {
    let s1 = f32(i + 1) * invSteps;
    let f1 = mix(s1, s1 * s1, curve);
    let t0 = iv.x + len * prevF;
    let ds = len * (f1 - prevF);
    prevF = f1;
    // A long step (a grazing ray toward the horizon) is split so no single sample swallows a whole cloud edge: one opaque sample per
    // step drew the cloud as a stack of horizontal slices. The density and transmittance are taken at every sub-step; the lighting, the
    // costly part, once per step at its first cloudy sub-step.
    let n = clamp(i32(ceil(ds / SUB_STEP_KM)), 1, MAX_SUB_STEPS);
    let sds = ds / f32(n);
    var lit = false;
    var scatter = vec3f(0.0);
    for (var k = 0; k < n; k++) {
      let t = t0 + sds * (f32(k) + jitter);
      let p = o + d * t;
      let r = length(p);
      let h = r - datumR;
      let detail = 1.0 - smoothstep(0.25 * detailFar, detailFar, t);
      let dens = cumulusDensity(layerPlane(p, ap.wind.xy), h, detail);
      if (dens <= 0.0) { continue; }
      let sigma = CUMULUS_SIGMA_KM * ap.cloudA.z * dens;
      if (!lit) {
        lit = true;
        var tauUp = -1.0;
        if (lights.sun.w > 0.0) { let sl = cumulusLightTerm(lights.sun, p, r, d, sigma, lightSteps, datumR, detail); scatter += sl.rgb; tauUp = sl.a; }
        if (lights.moon.w > 0.0) {
          let m = cumulusLightTerm(lights.moon, p, r, d, sigma, lightSteps, datumR, detail);
          scatter += m.rgb;
          if (tauUp < 0.0) { tauUp = m.a; }
        }
        scatter += ambientThroughAt(amb, (h - ap.cloudB.x) / (ap.cloudB.y - ap.cloudB.x), tauUp);
        scatter = max(scatter, skyFloor);
      }
      let stepT = exp(-sigma * sds);
      let w = trans * (1.0 - stepT);
      lum += w * scatter;
      distSum += w * t;
      weightSum += w;
      trans *= stepT;
    }
    if (trans < EARLY_OUT_T) { break; }
  }
  res.lum = lum;
  res.a = trans;
  res.dist = select(iv.x, distSum / weightSum, weightSum > 1e-5);
  return res;
}

fn marchCirrus(o : vec3f, d : vec3f, jitter : f32, lights : CloudLights, amb : Ambient) -> Layer {
  var res = emptyLayer();
  let datumR = datumRadius();
  var iv = shellInterval(o, d, datumR + ap.cloudB.z, datumR + ap.cloudB.w);
  iv.y = min(iv.y, CIRRUS_MAX_KM);
  if (iv.x >= iv.y) { return res; }
  let steps = clamp(i32(ap.cloudC.x) / 3, 6, 16);
  let len = iv.y - iv.x;
  let curve = saturate((len - 8.0) / 60.0);
  let invSteps = 1.0 / f32(steps);
  let ambient = 0.5 * (amb.top + amb.bottom);
  var trans = 1.0;
  var lum = vec3f(0.0);
  var distSum = 0.0;
  var weightSum = 0.0;
  var prevF = 0.0;
  for (var i = 0; i < steps; i++) {
    let s1 = f32(i + 1) * invSteps;
    let f1 = mix(s1, s1 * s1, curve);
    let t = iv.x + len * mix(prevF, f1, jitter);
    let ds = len * (f1 - prevF);
    prevF = f1;
    let p = o + d * t;
    let r = length(p);
    let dens = cirrusDensity(layerPlane(p, ap.wind.zw), r - datumR);
    if (dens <= 0.0) { continue; }
    let stepT = exp(-CIRRUS_SIGMA_KM * ap.cloudA.z * dens * ds);
    var scatter = ambient;
    if (lights.sun.w > 0.0) { scatter += lightAt(lights.sun, p, r) * cloudPhase(dot(d, lights.sun.dir), 1.0); }
    if (lights.moon.w > 0.0) { scatter += lightAt(lights.moon, p, r) * cloudPhase(dot(d, lights.moon.dir), 1.0); }
    let w = trans * (1.0 - stepT);
    lum += w * scatter;
    distSum += w * t;
    weightSum += w;
    trans *= stepT;
  }
  res.lum = lum;
  res.a = trans;
  res.dist = select(iv.x, distSum / weightSum, weightSum > 1e-5);
  return res;
}

// Applies the aerial perspective of the layer's mean distance and the far fade; returns (rgb, a) ready for  colour * a + rgb.
fn withAerial(layer : Layer, uv : vec2f, dir : vec3f) -> vec4f {
  if (layer.a >= 1.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let metres = layer.dist * 1000.0;
  let near = sampleAerialPerspective(uv, min(metres, AP_MAX_DISTANCE_M));
  let far = 1.0 - exp(-max(metres - AP_MAX_DISTANCE_M, 0.0) / (FAR_HAZE_KM * 1000.0));
  var haze = near.rgb;
  if (far > 0.0) { haze = mix(near.rgb, sampleSkyView(dir), far); }
  let fade = 1.0 - smoothstep(CLOUD_FADE_KM, CLOUD_MAX_KM, layer.dist);
  let a = mix(1.0, layer.a, fade);
  return vec4f((layer.lum * (near.a * (1.0 - far)) + haze * (1.0 - layer.a)) * fade, a);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let texel = vec2i(gid.xy);
  let o = vec3f(0.0, frame.sky.x + frame.sky.z, 0.0);
  let index = u32(ap.cloudC.y);
  let sub = vec2f(halton(index % 16u + 1u, 2u), halton(index % 16u + 1u, 3u));
  let uv = (vec2f(gid.xy) + sub) / vec2f(dims);
  let dir = viewRayDir(uv);
  if (ap.sky2.z < 0.5 || raySphere(o, dir, frame.sky.x).x > 0.0) {
    textureStore(outTex, texel, vec4f(0.0, 0.0, 0.0, 1.0));
    return;
  }
  let lights = cloudFrame.lights;
  let amb = cloudFrame.ambient;
  let jitter = interleavedGradientNoise(vec2f(gid.xy) + 5.588238 * f32(index % 64u));
  var cum = emptyLayer();
  let night = 1.0 - smoothstep(-0.12, 0.02, frame.sunDir.y);
  let skyFloor = select(vec3f(0.0), NIGHT_SKY_FLOOR * night * sampleSkyView(dir), night > 0.0);
  if (ap.cloudA.x > 0.0) { cum = marchCumulus(o, dir, jitter, lights, amb, skyFloor); }
  var cir = emptyLayer();
  if (ap.cloudA.y > 0.0) { cir = marchCirrus(o, dir, fract(jitter + 0.61803), lights, amb); }
  let c = withAerial(cum, uv, dir);
  let i = withAerial(cir, uv, dir);
  textureStore(outTex, texel, vec4f(min((c.rgb + c.a * i.rgb) / cloudStoreScale(), vec3f(FP16_STORE_MAX)), c.a * i.a));
}
`,"./shaders/sky/cloud_noise.wgsl":`// Cloud noise bake, run once at init into rgba8unorm 3D textures (Schneider, "The Real-Time Volumetric Cloudscapes of Horizon Zero
// Dawn", 2015). Every lattice wraps at its period, so both textures tile seamlessly and are sampled with a repeating sampler.
//   SHAPE  (128^3): r = Perlin-Worley (Perlin fbm pushed up by Worley so its bulges read as puffs), g, b, a = inverted Worley at
//                   4, 8 and 16 cells across (the low-frequency fbm the density shader weighs 0.625 / 0.25 / 0.125).
//   DETAIL (32^3) : r, g, b = inverted Worley at 4, 8 and 16 cells across (the erosion fbm), a = 1.
// No units: the values are unit-range noise; the density shader gives them meaning. Group 1 binding 0 is the output texture; group 0
// is the frame block that common/math.wgsl names (bound but not read here).
#include "common/math.wgsl"
#include "common/frame.wgsl"

@group(1) @binding(0) var outTex : texture_storage_3d<rgba8unorm, write>;

fn wrapCell(c : vec3i, period : i32) -> vec3u {
  return vec3u(((c % vec3i(period)) + vec3i(period)) % vec3i(period));
}

fn cellHash(c : vec3i, period : i32) -> vec3u {
  return pcg3(wrapCell(c, period) + vec3u(0x9e3779b9u, 0x85ebca6bu, 0xc2b2ae35u));
}

fn fade(f : vec3f) -> vec3f { return f * f * f * (f * (f * 6.0 - 15.0) + 10.0); }

fn gradientDot(c : vec3i, period : i32, d : vec3f) -> f32 {
  let h = cellHash(c, period);
  let g = vec3f(u01(h.x), u01(h.y), u01(h.z)) * 2.0 - 1.0;
  return dot(g / max(length(g), 1e-3), d);
}

// Gradient noise with a lattice of \`period\` cells; result in about [-1, 1].
fn perlin(p : vec3f, period : i32) -> f32 {
  let b = floor(p);
  let i = vec3i(b);
  let f = p - b;
  let u = fade(f);
  let x00 = mix(gradientDot(i, period, f), gradientDot(i + vec3i(1, 0, 0), period, f - vec3f(1.0, 0.0, 0.0)), u.x);
  let x10 = mix(gradientDot(i + vec3i(0, 1, 0), period, f - vec3f(0.0, 1.0, 0.0)), gradientDot(i + vec3i(1, 1, 0), period, f - vec3f(1.0, 1.0, 0.0)), u.x);
  let x01 = mix(gradientDot(i + vec3i(0, 0, 1), period, f - vec3f(0.0, 0.0, 1.0)), gradientDot(i + vec3i(1, 0, 1), period, f - vec3f(1.0, 0.0, 1.0)), u.x);
  let x11 = mix(gradientDot(i + vec3i(0, 1, 1), period, f - vec3f(0.0, 1.0, 1.0)), gradientDot(i + vec3i(1, 1, 1), period, f - vec3f(1.0, 1.0, 1.0)), u.x);
  return 1.15 * mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

// 1 - F1 of a jittered lattice (bright blobs at the feature points), 0..1.
fn worley(p : vec3f, period : i32) -> f32 {
  let b = floor(p);
  let i = vec3i(b);
  let f = p - b;
  var d2 = 4.0;
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let o = vec3i(x, y, z);
        let h = cellHash(i + o, period);
        let q = vec3f(o) + vec3f(u01(h.x), u01(h.y), u01(h.z)) - f;
        d2 = min(d2, dot(q, q));
      }
    }
  }
  return 1.0 - saturate1(sqrt(d2));
}

fn perlinFbm(p : vec3f, period : i32) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var norm = 0.0;
  var freq = 1.0;
  for (var o = 0; o < 3; o++) {
    sum += amp * perlin(p * freq, period * i32(freq));
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return saturate1(0.5 + 0.5 * sum / norm);
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let size = textureDimensions(outTex);
  if (any(gid >= size)) { return; }
  let u = (vec3f(gid) + 0.5) / vec3f(size);
#ifdef SHAPE
  let w4 = worley(u * 4.0, 4);
  let pw = mix(w4, 1.0, perlinFbm(u * 4.0, 4));
  textureStore(outTex, vec3i(gid), vec4f(pw, w4, worley(u * 8.0, 8), worley(u * 16.0, 16)));
#else
  textureStore(outTex, vec3i(gid), vec4f(worley(u * 4.0, 4), worley(u * 8.0, 8), worley(u * 16.0, 16), 1.0));
#endif
}
`,"./shaders/sky/cloud_precompute.wgsl":`#include "sky/cloud_frame.wgsl"

@group(1) @binding(11) var<storage, read_write> cloudFrame : CloudFrame;

@compute @workgroup_size(1)
fn main() {
  let datumR = datumRadius();
  let lights = cloudLights(datumR + 0.5 * (ap.cloudB.x + ap.cloudB.y));
  let amb = cloudAmbient(lights, datumR);
  cloudFrame.lights = lights;
  cloudFrame.ambient = amb;
}
`,"./shaders/sky/cloud_resolve.wgsl":`// Cloud temporal resolve (compute): blends this frame's jittered march with the reprojected history, clamped to the current 3x3
// neighbourhood (Karis 2014) so a moving cloud edge or a camera turn never smears. Clouds are km away, so the history is reprojected by
// DIRECTION: a direction (w = 0) carries no camera translation through frame.prevViewProj (previous frame, unjittered).
//
// UNIT CHAIN: texels are (rgb = in-scattered radiance [nits] / cloudStoreScale(), a = transmittance), linear and never pre-exposed;
// this pass only averages them. AtmosParams.cloudD.x = history weight (0.9), cloudD.y = 1 when the history holds the previous frame.
//
// Group 1: 0 linearClamp, 3 output (rgba16float), 5 AtmosParams, 9 this frame's march, 10 history.
#include "common/math.wgsl"
#include "common/frame.wgsl"
#include "sky/atmos_uniforms.wgsl"

@group(1) @binding(0) var linearClamp : sampler;
@group(1) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;
@group(1) @binding(5) var<uniform> ap : AtmosParams;
@group(1) @binding(9) var currentTex : texture_2d<f32>;
@group(1) @binding(10) var historyTex : texture_2d<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let texel = vec2i(gid.xy);
  let hi = vec2i(dims) - vec2i(1);
  var lo4 = vec4f(1e9);
  var hi4 = vec4f(-1e9);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let v = textureLoad(currentTex, clamp(texel + vec2i(x, y), vec2i(0), hi), 0);
      lo4 = min(lo4, v);
      hi4 = max(hi4, v);
    }
  }
  let cur = textureLoad(currentTex, texel, 0);

  let uv = (vec2f(gid.xy) + 0.5) / vec2f(dims);
  let q = frame.prevViewProj * vec4f(viewRayDir(uv), 0.0);
  var blend = ap.cloudD.x * ap.cloudD.y;
  var prevUv = vec2f(-1.0);
  if (q.w > 1e-6) {
    let ndc = q.xy / q.w;
    prevUv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  }
  if (any(prevUv < vec2f(0.0)) || any(prevUv > vec2f(1.0))) { blend = 0.0; }
  let history = clamp(textureSampleLevel(historyTex, linearClamp, prevUv, 0.0), lo4, hi4);
  textureStore(outTex, texel, mix(cur, history, blend));
}
`,"./shaders/sky/cloud_shadow.wgsl":`// Cloud shadow map (compute, 128x128): for every ground column around the camera, the transmittance of the cloud layers along the
// sun's and the moon's rays, marched through the same density functions the sky pass renders (sky/cloud_density.wgsl), so a shadow on
// the terrain lies under the cloud that casts it.
//
// UNIT CHAIN: unit-less transmittances exp(-tau) with tau = sigma_e [1/km] * density * ds [km], for a ground point at the datum
// (world y = 0). Texel (i, j) covers world x = cx + ((i + 0.5) / N - 0.5) * E, z = cz + ((j + 0.5) / N - 0.5) * E, with the map centre
// (cx, cz) = AtmosParams.cloudC.zw and side E = AtmosParams.cloudD.w, both in metres.
// Output: r = sun transmittance to the ground (direct plus the diffuse share the cloud passes on, see groundTransmittance), g = the same for
// the moon (1 for a light below the horizon), b = zenith transmittance exp(-tau) of both layers (how
// much sky light the cloud above lets through), a = 1.
//
// Group 1: 3 output (rgba16float), plus everything sky/cloud_density.wgsl declares.
#include "sky/cloud_light.wgsl"

@group(1) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;

const CUMULUS_STEPS : i32 = 16;
const CIRRUS_STEPS : i32 = 8;
const ZENITH_STEPS : i32 = 6;

fn layerTau(o : vec3f, l : vec3f, cirrus : bool, steps : i32, datumR : f32, jitter : f32) -> f32 {
  let iv = shellInterval(o, l, datumR + select(ap.cloudB.x, ap.cloudB.z, cirrus), datumR + select(ap.cloudB.y, ap.cloudB.w, cirrus));
  if (iv.x >= iv.y) { return 0.0; }
  let ds = (iv.y - iv.x) / f32(steps);
  var tau = 0.0;
  for (var i = 0; i < steps; i++) {
    let p = o + l * (iv.x + ds * (f32(i) + jitter));
    let h = length(p) - datumR;
    if (cirrus) {
      tau += CIRRUS_SIGMA_KM * ap.cloudA.z * cirrusDensity(layerPlane(p, ap.wind.zw), h) * ds;
    } else {
      tau += CUMULUS_SIGMA_KM * ap.cloudA.z * cumulusDensity(layerPlane(p, ap.wind.xy), h, 0.0) * ds;
    }
  }
  return tau;
}

fn columnTau(o : vec3f, l : vec3f, steps : i32, datumR : f32, jitter : f32) -> f32 {
  if (l.y <= 0.0) { return 0.0; }
  var tau = 0.0;
  if (ap.cloudA.x > 0.0) { tau += layerTau(o, l, false, steps, datumR, jitter); }
  if (ap.cloudA.y > 0.0) { tau += layerTau(o, l, true, max(steps / 2, 4), datumR, jitter); }
  return tau;
}

// A cloud scatters the sunlight it stops rather than absorbing it, mostly forward (g about 0.85), so the ground under it still gets a share
// as diffuse light through its body and out of its base. Two-stream theory for a non-absorbing slab puts the total (direct plus diffuse)
// transmission at 1 / (1 + 0.75 (1 - g) tau): about 0.25 under a small cumulus of tau 30, where exp(-tau) is nothing. That is why the shadow
// of a fair-weather cloud is a soft dimming to a third of full sun, not a black patch. Moon and sun light take the same share.
const CLOUD_DIFFUSE_K : f32 = 0.11;

fn groundTransmittance(tau : f32) -> f32 {
  return max(exp(-tau), 1.0 / (1.0 + CLOUD_DIFFUSE_K * tau));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let texel = vec2i(gid.xy);
  if (ap.sky2.z < 0.5) {
    textureStore(outTex, texel, vec4f(1.0));
    return;
  }
  let datumR = datumRadius();
  let world = vec2f(ap.cloudC.z, ap.cloudC.w) + ((vec2f(gid.xy) + 0.5) / vec2f(dims) - 0.5) * ap.cloudD.w;
  let o = vec3f((world.x - frame.camPos.x) * 0.001, datumR, (world.y - frame.camPos.z) * 0.001);
  // This map has no temporal resolve. Rotating jitter every frame modulates sunlight even in a frozen scene.
  // Anchor the sample pattern to world columns so recentering the map also keeps overlapping shadows unchanged.
  let column = vec2i(floor(world / (ap.cloudD.w / f32(dims.x))));
  let jitter = hash21(bitcast<vec2u>(column)) * 0.999;
  let sun = groundTransmittance(columnTau(o, frame.sunDir.xyz, CUMULUS_STEPS, datumR, jitter));
  // select evaluates both values; skip the entire moon column when moonlight is disabled.
  var moon = 1.0;
  if (ap.flags.x > 0.5) {
    moon = groundTransmittance(columnTau(o, frame.moonDir.xyz, CUMULUS_STEPS, datumR, jitter));
  }
  let zenith = exp(-columnTau(o, vec3f(0.0, 1.0, 0.0), ZENITH_STEPS, datumR, jitter));
  textureStore(outTex, texel, vec4f(sun, moon, zenith, 1.0));
}
`,"./shaders/sky/lut_common.wgsl":`// Shared prologue of the atmosphere LUT compute passes. The passes bind their OWN group 1 (never rc.world.group: the LUTs they write
// are also part of it, and one texture may not be sampled and written in the same dispatch), so the world bindings of
// common/atmosphere_sample.wgsl are re-declared here at the pass's own slots. skyViewLUT / aerialPerspective are unused stand-ins
// (declared only so the shared sampling code compiles); a binding that no entry point uses needs no layout entry.
//
// UNIT CHAIN: see sky/atmos_params.wgsl. All LUT contents are nits (cd/m2) per the lights' illuminance in lux; never pre-exposed.
#include "common/math.wgsl"
#include "common/frame.wgsl"

@group(1) @binding(0) var linearClamp : sampler;
@group(1) @binding(1) var transmittanceLUT : texture_2d<f32>;
@group(1) @binding(2) var multiScatterLUT : texture_2d<f32>;
@group(1) @binding(40) var skyViewLUT : texture_2d<f32>;
@group(1) @binding(41) var aerialPerspective : texture_3d<f32>;

#include "common/atmosphere_sample.wgsl"
#include "sky/atmos_params.wgsl"
`,"./shaders/sky/moon.wgsl":`// Procedural Moon. Include after sky/atmos_uniforms.wgsl and the \`ap : AtmosParams\` binding (needs frame, ap, math.wgsl).
//
// UNIT CHAIN: albedo [-] * E_sun [lux at the moon, frame.sunIrradiance.rgb] / pi = radiance [nits] of a Lambertian patch facing the sun.
// Lommel-Seeliger (2 mu0 / (mu0 + mu), equal to 1 at full phase) times an opposition surge is the lunar phase function, so a full moon is
// ~4-5e3 nits at the disc centre, which integrates over the disc (pi R^2 sr) to the ~0.3 lux of frame.moonIrradiance. The result is
// multiplied by the atmospheric transmittance toward the moon by the caller (sky.wgsl).
//
// Disc frame: x = right, y = lunar north (the ecliptic pole projected on the sky), z = toward the observer. The near side faces Earth
// (libration ignored), so the selenographic longitude/latitude of a disc point (x,y,z) are atan2(x,z), asin(y): Mare Crisium (+59 deg)
// sits on the right, Tycho (-43 deg) at the bottom.

const MOON_HIGHLAND : vec3f = vec3f(0.128, 0.120, 0.106);
const MOON_MARE : vec3f = vec3f(0.064, 0.063, 0.062);
const EARTHSHINE_TINT : vec3f = vec3f(0.85, 0.97, 1.15);
const EARTHSHINE_FRACTION : f32 = 1.5e-3;
const SURGE_AMPLITUDE : f32 = 0.35;
const SURGE_WIDTH : f32 = 0.07;
const MARIA_COUNT : u32 = \${MARIA_ROWS}u / 2u;

fn vnoise3(p : vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let b = vec3u(vec3i(i));
  let a0 = mix(hash31(b), hash31(b + vec3u(1u, 0u, 0u)), u.x);
  let a1 = mix(hash31(b + vec3u(0u, 1u, 0u)), hash31(b + vec3u(1u, 1u, 0u)), u.x);
  let a2 = mix(hash31(b + vec3u(0u, 0u, 1u)), hash31(b + vec3u(1u, 0u, 1u)), u.x);
  let a3 = mix(hash31(b + vec3u(0u, 1u, 1u)), hash31(b + vec3u(1u, 1u, 1u)), u.x);
  return mix(mix(a0, a1, u.y), mix(a2, a3, u.y), u.z);
}

fn fbm3(p : vec3f) -> f32 {
  return 0.5 * vnoise3(p) + 0.25 * vnoise3(p * 2.03 + 11.7) + 0.125 * vnoise3(p * 4.11 + 23.1) + 0.0625 * vnoise3(p * 8.3 + 37.9);
}

// Smooth 1D value noise that repeats every \`period\` cells (rays around a crater close seamlessly at azimuth 2 pi).
fn periodicNoise1(x : f32, period : u32, salt : u32) -> f32 {
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  let n = i32(period);
  let i0 = u32(((i32(floor(x)) % n) + n) % n);
  let i1 = (i0 + 1u) % period;
  return mix(hash11(i0 + salt), hash11(i1 + salt), u);
}

// Dark maria: the strongest of the elliptical patches around the tabulated selenographic centres, with a noise-eroded edge.
fn mareMask(lon : f32, lat : f32, edgeNoise : f32) -> f32 {
  var m = 0.0;
  for (var k = 0u; k < MARIA_COUNT; k++) {
    let a = ap.maria[2u * k];
    let b = ap.maria[2u * k + 1u];
    if (b.w > 0.5) { continue; }
    let dx = (lon - a.x) * cos(0.5 * (lat + a.y));
    let dy = lat - a.y;
    let c = cos(b.z);
    let s = sin(b.z);
    let x = (dx * c + dy * s) / a.z;
    let y = (dy * c - dx * s) / a.w;
    let d = sqrt(x * x + y * y) * (1.0 + 0.35 * (edgeNoise - 0.5));
    m = max(m, b.x * (1.0 - smoothstep(1.0 - b.y, 1.0, d)));
  }
  return m;
}

// Bright ejecta blankets and radial rays of the young craters (Tycho, Copernicus, Kepler, Aristarchus, Proclus).
fn crater_rays(lon : f32, lat : f32, p : vec3f) -> f32 {
  var bright = 0.0;
  for (var k = 0u; k < MARIA_COUNT; k++) {
    let a = ap.maria[2u * k];
    let b = ap.maria[2u * k + 1u];
    if (b.w < 0.5) { continue; }
    let cl = cos(a.y);
    let c = vec3f(cl * sin(a.x), sin(a.y), cl * cos(a.x));
    let east = vec3f(cos(a.x), 0.0, -sin(a.x));
    let north = vec3f(-sin(a.y) * sin(a.x), cos(a.y), -sin(a.y) * cos(a.x));
    let t = p - c * dot(p, c);
    let arc = acos(clamp(dot(p, c), -1.0, 1.0));
    let az = atan2(dot(t, north), dot(t, east)) * (1.0 / TAU) + 0.5;
    let salt = 977u + 131u * k;
    let streak = periodicNoise1(az * 36.0, 36u, salt) * periodicNoise1(az * 13.0, 13u, salt + 61u);
    let ray = pow(streak, 1.5) * 2.4 * exp(-arc / (a.z * 26.0)) * smoothstep(a.z * 0.6, a.z * 1.8, arc);
    let halo = exp(-sq(arc / (a.z * 1.15)));
    bright = max(bright, b.x * (0.75 * halo + 0.55 * ray));
  }
  return bright;
}

struct CraterSample {
  albedo : f32,
  slope : vec3f,
};

// Hashed craters on three scales: 3D cells whose centres are jittered balls cut by the sphere, so the visible craters are circles.
fn craterLayer(p : vec3f, freq : f32, seed : u32, amount : f32, cs : ptr<function, CraterSample>) {
  let q = p * freq;
  let base = floor(q - 0.5);
  for (var i = 0u; i < 8u; i++) {
    let o = vec3f(f32(i & 1u), f32((i >> 1u) & 1u), f32((i >> 2u) & 1u));
    let cell = base + o;
    let h = pcg3(vec3u(vec3i(cell)) + vec3u(seed));
    if (u01(h.z) > 0.72) { continue; }
    let centre = cell + 0.3 + 0.4 * vec3f(u01(h.x), u01(h.y), u01(pcg(h.x + h.y)));
    let radius = 0.09 + 0.22 * pow(u01(pcg(h.z + 3u)), 2.0);
    let d = q - centre;
    let dl = length(d);
    let x = dl / radius;
    if (x > 2.2) { continue; }
    let fresh = select(0.0, 1.0, u01(pcg(h.y + 7u)) > 0.86);
    var dh = 0.0;
    if (x < 1.0) { dh = 2.0 * x; } else { dh = -3.2 * (x - 1.0) * exp(-sq((x - 1.0) / 0.35)) * 2.0; }
    let g = d / max(dl, 1e-5);
    let tangent = g - p * dot(g, p);
    (*cs).slope += tangent * dh * 0.34 * amount;
    (*cs).albedo *= 1.0 - 0.12 * amount * (1.0 - smoothstep(0.0, 1.0, x)) + 0.07 * amount * exp(-sq((x - 1.0) / 0.25)) + 0.38 * fresh * amount * exp(-sq(x / 1.6));
  }
}

// Radiance of the moon in the direction dir (rgb, nits, before atmospheric extinction) and the disc's antialiased pixel coverage (a).
fn moonRadiance(dir : vec3f, pixelAngle : f32) -> vec4f {
  let m = frame.moonDir.xyz;
  let radius = frame.moonDir.w;
  let c = dot(dir, m);
  if (c <= 0.0) { return vec4f(0.0); }
  let theta = atan2(length(cross(dir, m)), c);
  let coverage = saturate((radius - theta) / pixelAngle + 0.5);
  if (coverage <= 0.0) { return vec4f(0.0); }

  let nUp = normalize(ap.eclNorth.xyz - m * dot(ap.eclNorth.xyz, m));
  let right = cross(m, nUp);
  var xy = vec2f(dot(dir, right), dot(dir, nUp)) / sin(radius);
  let len = length(xy);
  xy = xy / max(len, 1.0);
  let p = vec3f(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
  let lon = atan2(p.x, p.z);
  let lat = asin(clamp(p.y, -1.0, 1.0));

  var cs : CraterSample;
  cs.albedo = 1.0;
  cs.slope = vec3f(0.0);
  craterLayer(p, 5.0, 11u, 1.0, &cs);
  craterLayer(p, 12.0, 23u, 0.8, &cs);
  craterLayer(p, 30.0, 47u, 0.6, &cs);

  let mott = fbm3(p * 5.5 + 3.1);
  let edgeNoise = fbm3(p * 9.0 + 17.0);
  let mare = mareMask(lon, lat, edgeNoise);
  let rays = crater_rays(lon, lat, p);
  var albedo = mix(MOON_HIGHLAND, MOON_MARE, mare * 0.92) * (0.82 + 0.36 * mott);
  albedo = albedo * cs.albedo * (1.0 + 0.9 * rays * (1.0 - mare));

  let sunWorld = frame.sunDir.xyz;
  let sunDisc = normalize(vec3f(dot(sunWorld, right), dot(sunWorld, nUp), -dot(sunWorld, m)));
  let n = normalize(p - cs.slope);
  let mu = max(n.z, 1e-3);
  let mu0 = max(dot(n, sunDisc), 0.0);
  let geometric = select(0.0, 1.0, dot(p, sunDisc) > -0.02);
  let phaseAngle = acos(clamp(sunDisc.z, -1.0, 1.0));
  let surge = 1.0 + SURGE_AMPLITUDE * exp(-phaseAngle / SURGE_WIDTH);
  let sunTerm = (2.0 * mu0 / (mu0 + mu)) * surge * geometric;
  let earthshine = EARTHSHINE_FRACTION * (1.0 - frame.moonIrradiance.w) * mu;
  let e = frame.sunIrradiance.rgb * INV_PI;
  return vec4f(albedo * (e * sunTerm + e * EARTHSHINE_TINT * earthshine), coverage);
}
`,"./shaders/sky/multiscatter.wgsl":`// Multiple-scattering LUT (32x32), Hillaire 2020 section 5.5: one workgroup per texel (x = sun zenith cosine, y = height above the ground),
// 64 threads = 64 Fibonacci directions. Per unit of light illuminance (lux -> nits, so the unit is nits/lux = 1/sr):
//   L2  = mean over the sphere of the second-order in-scattered radiance (isotropic phase 1/4pi, sun single scattering plus the ground bounce)
//   fms = mean over the sphere of the scattering transfer function (fraction of light scattered again)
//   texel = L2 / (1 - fms)      (geometric series over all higher orders)
// The users multiply it by the local scattering coefficient [1/km] and the light illuminance [lux] (see scatterStep in atmos_params.wgsl).
#include "sky/lut_common.wgsl"

@group(1) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;

const DIRS : u32 = 64u;
const STEPS : u32 = 20u;
const GOLDEN_ANGLE : f32 = 2.39996323;

var<workgroup> sharedL : array<vec3f, 64>;
var<workgroup> sharedF : array<vec3f, 64>;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg : vec3u, @builtin(local_invocation_index) li : u32) {
  let uv = (vec2f(wg.xy) + 0.5) / 32.0;
  let muS = clamp(subUvToUnit(uv.x, 32.0) * 2.0 - 1.0, -1.0, 1.0);
  let rb = frame.sky.x;
  let rt = frame.sky.y;
  let r = max(rb + saturate1(subUvToUnit(uv.y, 32.0)) * (rt - rb), rb + 5e-4);
  let sunDir = vec3f(sqrt(max(1.0 - muS * muS, 0.0)), muS, 0.0);
  let p0 = vec3f(0.0, r, 0.0);

  // Fibonacci sphere, equal solid angle 4 pi / 64 per direction.
  let cz = 1.0 - 2.0 * (f32(li) + 0.5) / f32(DIRS);
  let sz = sqrt(max(1.0 - cz * cz, 0.0));
  let az = f32(li) * GOLDEN_ANGLE;
  let dir = vec3f(sz * cos(az), cz, sz * sin(az));

  let hitG = raySphere(p0, dir, rb);
  let hitsGround = hitG.x > 0.0;
  let hitT = raySphere(p0, dir, rt);
  let tMax = select(hitT.y, hitG.x, hitsGround);

  var lum = vec3f(0.0);
  var transfer = vec3f(0.0);
  var thr = vec3f(1.0);
  var t0 = 0.0;
  for (var i = 0u; i < STEPS; i++) {
    let f = f32(i + 1u) / f32(STEPS);
    let t1 = tMax * f * f;
    let dt = t1 - t0;
    let p = p0 + dir * (0.5 * (t0 + t1));
    let rp = length(p);
    let med = mediumAt(rp - rb);
    let scat = med.scatterR + vec3f(med.scatterM);
    let sunT = sampleTransmittance(rp, dot(p / rp, sunDir)) * planetVisibility(p, sunDir) * (0.25 * INV_PI);
    let stepT = exp(-med.extinction * dt);
    let inv = 1.0 / max(med.extinction, vec3f(1e-9));
    lum += thr * (scat * sunT - scat * sunT * stepT) * inv;
    transfer += thr * (scat - scat * stepT) * inv;
    thr *= stepT;
    t0 = t1;
  }
  if (hitsGround) {
    let pg = p0 + dir * tMax;
    lum += thr * groundRadianceAt(pg, sunDir, vec3f(1.0));
  }
  let w = 1.0 / f32(DIRS);
  sharedL[li] = lum * w;
  sharedF[li] = transfer * w;
  workgroupBarrier();
  var stride = 32u;
  loop {
    if (li < stride) {
      sharedL[li] += sharedL[li + stride];
      sharedF[li] += sharedF[li + stride];
    }
    workgroupBarrier();
    if (stride == 1u) { break; }
    stride = stride >> 1u;
  }
  if (li == 0u) {
    let l2 = sharedL[0];
    let fms = sharedF[0];
    textureStore(outTex, vec2i(wg.xy), vec4f(l2 / max(vec3f(1.0) - fms, vec3f(1e-3)), 1.0));
  }
}
`,"./shaders/sky/night_light.wgsl":`// Night light that is not scattered sunlight: airglow (Van Rhijn shell), the unresolved starlight floor and zodiacal light. Radiance in
// nits at a night-scale of 1, BEFORE extinction (callers multiply by the LUT transmittance). Mirrors the night section of
// src/render/atmosphere/physics.ts. Include after common/math.wgsl (PI).

const AIRGLOW_HEIGHT : f32 = 90.0;
const AIRGLOW_ZENITH : vec3f = vec3f(3.1e-4, 3.2e-4, 3.4e-4);
const AIRGLOW_SLANT_TINT : vec3f = vec3f(-1.5e-5, 4.0e-5, -1.0e-5);
const STARLIGHT_FLOOR : vec3f = vec3f(3.5e-5, 3.5e-5, 3.8e-5);
const NITS_PER_S10 : f32 = 8.3e-7;
const ZODIACAL_COLOR : vec3f = vec3f(1.0, 0.98, 0.93);
const ZODIACAL_POLE_S10 : f32 = 77.0;
const ZODIACAL_FAR_S10 : f32 = 140.0;
const ZODIACAL_NEAR_S10 : f32 = 1360.0;
const GEGENSCHEIN_S10 : f32 = 45.0;

fn vanRhijn(cosZ : f32, groundRadiusKm : f32) -> f32 {
  let s = (groundRadiusKm / (groundRadiusKm + AIRGLOW_HEIGHT)) * sqrt(max(1.0 - cosZ * cosZ, 0.0));
  return 1.0 / sqrt(1.0 - s * s);
}

fn nightSkyNits(cosZ : f32, groundRadiusKm : f32) -> vec3f {
  let vr = vanRhijn(cosZ, groundRadiusKm);
  return AIRGLOW_ZENITH * vr + AIRGLOW_SLANT_TINT * (vr - 1.0) + STARLIGHT_FLOOR;
}

// Zodiacal light in S10 from the cosine of the sun elongation and the sine of the ecliptic latitude of the view direction.
fn zodiacalS10(cosElong : f32, sinLat : f32) -> f32 {
  let eps = max(degrees(acos(clamp(cosElong, -1.0, 1.0))), 15.0);
  let g = (180.0 - eps) / 8.0;
  let gegen = GEGENSCHEIN_S10 * exp(-g * g);
  let onEcliptic = ZODIACAL_FAR_S10 + ZODIACAL_NEAR_S10 * pow(30.0 / eps, 2.5) + gegen;
  let cosLat = sqrt(max(1.0 - sinLat * sinLat, 0.0));
  let steepness = 5.0 + 25.0 * exp(-eps / 35.0);
  return ZODIACAL_POLE_S10 + (onEcliptic - ZODIACAL_POLE_S10) * pow(cosLat, steepness);
}

fn zodiacalNits(dir : vec3f, sunDir : vec3f, eclNorth : vec3f) -> vec3f {
  return ZODIACAL_COLOR * (zodiacalS10(dot(dir, sunDir), dot(dir, eclNorth)) * NITS_PER_S10);
}

// Total exposure (scene-linear value per nit of scene radiance) the camera settles on, from the CPU pre-exposure alone. It is the night branch
// of targetTotalEv in src/render/post/exposure.ts (night weight 1: the key falls only NIGHT_SLOPE per EV below NIGHT_KNEE_NITS, and the sensor
// gain ends at MAX_GAIN_EV over the daylight reference), used to keep the moon's exposed peak under the white point whatever the gain is.
const EXPOSURE_LOG2_KEY : f32 = -1.7369655941662063;
const EXPOSURE_KEY_KNEE_EV : f32 = 6.643856189774724;
const EXPOSURE_KEY_SLOPE : f32 = 0.3;
const EXPOSURE_NIGHT_KNEE_EV : f32 = -0.35845397091247633;
const EXPOSURE_NIGHT_SLOPE : f32 = 0.05;
const EXPOSURE_MAX_TOTAL_EV : f32 = 7.7123;
const EXPOSURE_CPU_KEY_EV : f32 = -2.0;

fn nightExposure(preExposure : f32) -> f32 {
  let lumEv = EXPOSURE_CPU_KEY_EV - log2(preExposure);
  let keyEv = EXPOSURE_LOG2_KEY + EXPOSURE_KEY_SLOPE * min(lumEv - EXPOSURE_KEY_KNEE_EV, 0.0)
            + (EXPOSURE_NIGHT_SLOPE - EXPOSURE_KEY_SLOPE) * min(lumEv - EXPOSURE_NIGHT_KNEE_EV, 0.0);
  return exp2(min(keyEv - lumEv, EXPOSURE_MAX_TOTAL_EV));
}
`,"./shaders/sky/sky.wgsl":`// Sky pass: fullscreen triangle at reverse-Z depth 0 (the depth test 'equal' keeps it to pixels no geometry covered), replacing the
// zero the lighting pass left in the HDR target.
//
// UNIT CHAIN: everything below is radiance in nits (cd/m2) until the very last line, where it is multiplied by frame.params.y
// (pre-exposure) exactly once. Sky = sky-view LUT (sun + moon scattering + airglow, lux -> nits, see sky/skyview.wgsl); sun disc =
// E_sun[lux] / (pi R^2 [sr]) * limb darkening * T; moon = albedo * E_sun / pi * Lommel-Seeliger * T (sky/moon.wgsl); Milky Way = baked
// map [nits] * T; zodiacal light = S10 model (sky/night_light.wgsl) * T; clouds = (inscatter [nits] / cloudStoreScale(), transmittance)
// composited as  colour * a + rgb * cloudStoreScale(). T is the LUT transmittance from the camera to the top of the atmosphere along
// the pixel's own direction, so discs redden and dim toward the horizon. Stars are drawn afterwards by sky/stars.wgsl. The total is
// scaled (hue kept) so no channel exceeds SUN_MAX_EXPOSED = 58976 (the fp16 value just under 59000; fp16 holds 65504).
// The one exception to "pre-exposure exactly once" is the moon disc: when the camera is opened up for a night landscape (total exposure ~50
// per nit, see nightExposure) a quarter moon would be 1e5 and clip to a flat white disc, so its exposure is capped so that a
// MOON_REFERENCE_NITS highland patch ends at MOON_SCENE_PEAK in scene-linear units (a local-adaptation stand-in; all ratios inside the
// disc, and so the maria, are preserved).
//
// Group 2: 0 AtmosParams, 1 sky-view (sun + night, nits / skySunStoreScale()), 2 sky-view (moon only), 3 Milky Way map, 4 clouds (rgb nits / cloudStoreScale(), a transmittance).
#include "common/world_bindings.wgsl"
#include "common/atmosphere_sample.wgsl"
#include "sky/atmos_params.wgsl"
#include "sky/atmos_uniforms.wgsl"
#include "sky/night_light.wgsl"

@group(2) @binding(0) var<uniform> ap : AtmosParams;
@group(2) @binding(1) var skySunTex : texture_2d<f32>;
@group(2) @binding(2) var skyMoonTex : texture_2d<f32>;
@group(2) @binding(3) var milkyWayTex : texture_2d<f32>;
@group(2) @binding(4) var cloudTex : texture_2d<f32>;

#include "sky/moon.wgsl"

const SUN_MAX_EXPOSED : f32 = 58976.0;
const SUN_LIMB_U : vec3f = vec3f(0.55, 0.66, 0.80);
const MOON_REFERENCE_NITS : f32 = 5000.0;
const MOON_SCENE_PEAK : f32 = 4.0;

// Land under the land's horizon (see landRadius), past the terrain's last ring: flat land of LANDSCAPE_ALBEDO lit by the sun, moon and sky,
// hazed by the aerial-perspective table at its far end, the same treatment the terrain's farthest rings get, so the two meet without a
// step. The sky-view march hazes it less than that table does.
fn farLand(uv : vec2f, r : f32) -> vec3f {
  let sunE = frame.sunIrradiance.rgb * frame.sunIrradiance.w * sampleTransmittance(r, frame.sunDir.y) * max(frame.sunDir.y, 0.0);
  let moonE = frame.moonIrradiance.rgb * sampleTransmittance(r, frame.moonDir.y) * max(frame.moonDir.y, 0.0);
  let land = LANDSCAPE_ALBEDO * ((sunE + moonE) * INV_PI + 0.6 * skyLuts(vec3f(0.0, 1.0, 0.0), r));
  let haze = sampleAerialPerspective(uv, AP_MAX_DISTANCE_M);
  return land * select(1.0, haze.a, haze.a >= 0.0 && haze.a <= 1.0) + haze.rgb;
}

struct VsOut {
  @builtin(position) pos : vec4f,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VsOut {
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  var o : VsOut;
  o.pos = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  return o;
}

fn azimuthCosTo(dir : vec3f, light : vec3f) -> f32 {
  let s = light.xz;
  let v = dir.xz;
  let sl = length(s);
  let vl = length(v);
  if (sl < 1e-5 || vl < 1e-5) { return 1.0; }
  return dot(s, v) / (sl * vl);
}

// Sun and moon scattering plus airglow from the LUTs. The moon's LUT is folded around the moon's own azimuth.
fn skyLuts(dir : vec3f, r : f32) -> vec3f {
  var c = textureSampleLevel(skySunTex, linearClamp, skyViewUv(dir, r), 0.0).rgb * skySunStoreScale();
  if (ap.flags.x > 0.5) {
    let uv = skyViewUvCos(dir.y, azimuthCosTo(dir, frame.moonDir.xyz), r);
    c += textureSampleLevel(skyMoonTex, linearClamp, uv, 0.0).rgb;
  }
  return c;
}

// Radiance of the sun's disc along dir (antialiased over one pixel), before atmospheric extinction.
fn sunDisc(dir : vec3f, pixelAngle : f32) -> vec3f {
  let s = frame.sunDir.xyz;
  let radius = frame.sunDir.w;
  let c = dot(dir, s);
  if (c <= 0.0) { return vec3f(0.0); }
  let theta = atan2(length(cross(dir, s)), c);
  let coverage = saturate((radius - theta) / pixelAngle + 0.5);
  if (coverage <= 0.0) { return vec3f(0.0); }
  let mu = sqrt(max(1.0 - sq(min(theta / radius, 1.0)), 0.0));
  let limb = (vec3f(1.0) - SUN_LIMB_U * (1.0 - mu)) / (vec3f(1.0) - SUN_LIMB_U / 3.0);
  return frame.sunIrradiance.rgb * (limb * coverage / (PI * radius * radius));
}

// Milky Way radiance (nits) toward a world direction: rotate into J2000 equatorial axes (celestial is orthonormal, so its transpose is
// its inverse), then into galactic axes, and read the map by longitude/latitude.
fn milkyWay(dir : vec3f) -> vec3f {
  let m = mat3x3f(frame.celestial[0].xyz, frame.celestial[1].xyz, frame.celestial[2].xyz);
  let eq = dir * m;
  let g = vec3f(dot(eq, ap.gal0.xyz), dot(eq, ap.gal1.xyz), dot(eq, ap.gal2.xyz));
  let uv = vec2f(atan2(g.y, g.x) / TAU + 0.5, 0.5 - asin(clamp(g.z, -1.0, 1.0)) / PI);
  return textureSampleLevel(milkyWayTex, linearRepeat, uv, 0.0).rgb * ap.sky2.x;
}

@fragment
fn fs(in : VsOut) -> @location(0) vec4f {
  let uv = in.pos.xy * frame.screen.zw;
  let dir = viewRayDir(uv);
  let r = frame.sky.x + frame.sky.z;
  let camera = vec3f(0.0, r, 0.0);
  let pixelAngle = 2.0 / (frame.proj[1][1] * frame.screen.y);
  let aboveHorizon = planetVisibility(camera, dir);
  let trans = sampleTransmittance(r, dir.y);

  var col = skyLuts(dir, r);
  if (raySphere(camera, dir, landRadius(r)).x > 0.0) { col = farLand(uv, r); }
  if (aboveHorizon > 0.5) {
    let moon = moonRadiance(dir, pixelAngle);
    let moonGain = min(1.0, MOON_SCENE_PEAK / (MOON_REFERENCE_NITS * nightExposure(frame.params.y)));
    let zodiacal = zodiacalNits(dir, frame.sunDir.xyz, ap.eclNorth.xyz) * (frame.sky.w * ap.flags.y);
    col += trans * ((milkyWay(dir) + zodiacal) * (1.0 - moon.a) + moon.rgb * (moon.a * moonGain));
    col += trans * sunDisc(dir, pixelAngle);
  }

  let cloud = textureSampleLevel(cloudTex, linearClamp, uv, 0.0);
  col = col * cloud.a + cloud.rgb * cloudStoreScale();

  col = col * frame.params.y;
  let peak = max(col.r, max(col.g, col.b));
  if (peak > SUN_MAX_EXPOSED) { col = col * (SUN_MAX_EXPOSED / peak); }
  return vec4f(col, 1.0);
}
`,"./shaders/sky/skyview.wgsl":`// Sky-view LUT (192x108), rebuilt every frame from the camera's radius. UNIT CHAIN: light illuminance [lux] * sum(T * sigma_s[1/km] *
// phase[1/sr] * T_light * ds[km]) = radiance in nits, NOT pre-exposed (pre-exposure is applied only when writing the HDR target).
// The map folds the view azimuth around the SUN (common/atmosphere_sample.wgsl), so two passes build it:
//   MOON_PASS defined : moonlight scattering, folded around the MOON, into skyMoon (exact for the moon; the sky pass samples it directly).
//   otherwise         : sun scattering + night airglow + starlight floor into skySun (stored as nits / skySunStoreScale()), and world.skyView
//                       (plain nits, clamped to FP16_STORE_MAX) = that + the night dome (zodiacal light, Milky Way, stars) + the moon's map
//                       symmetrised over the two possible view sides (accurate for the low-frequency consumers: ambient and reflections).
#include "sky/lut_common.wgsl"
#include "sky/atmos_uniforms.wgsl"
#include "sky/night_light.wgsl"

@group(1) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;
@group(1) @binding(5) var<uniform> ap : AtmosParams;
#ifndef MOON_PASS
@group(1) @binding(4) var outWorld : texture_storage_2d<rgba16float, write>;
@group(1) @binding(6) var skyMoon : texture_2d<f32>;
#endif

const STEPS : u32 = 32u;

// Radiance seen along dir from the camera at radius r, lit by one collimated light (single scattering + LUT multiple scattering + ground).
fn marchSky(dir : vec3f, r : f32, lightDir : vec3f, lightE : vec3f) -> vec3f {
  let p0 = vec3f(0.0, r, 0.0);
  let hitG = raySphere(p0, dir, landRadius(r));
  let hitsGround = hitG.x > 0.0;
  let tTop = raySphere(p0, dir, frame.sky.y).y;
  let tMax = select(tTop, hitG.x, hitsGround);
  var lum = vec3f(0.0);
  var thr = vec3f(1.0);
  var t0 = 0.0;
  for (var i = 0u; i < STEPS; i++) {
    let f = f32(i + 1u) / f32(STEPS);
    let t1 = tMax * f * f;
    let s = scatterStep(p0 + dir * (0.5 * (t0 + t1)), dir, t1 - t0, lightDir, lightE);
    lum += thr * s.dL;
    thr *= s.trans;
    t0 = t1;
  }
  if (hitsGround) { lum += thr * groundRadianceAt(p0 + dir * tMax, lightDir, lightE) * (LANDSCAPE_ALBEDO / GROUND_ALBEDO); }
  return lum;
}

// Airglow and the starlight floor (sky/night_light.wgsl), attenuated by the atmosphere above.
fn nightSky(cosZ : f32, r : f32) -> vec3f {
  if (cosZ <= 0.0) { return vec3f(0.0); }
  let horizon = smoothstep(0.0, 0.04, cosZ);
  return nightSkyNits(cosZ, frame.sky.x) * sampleTransmittance(r, cosZ) * (frame.sky.w * ap.flags.y * horizon);
}

// Zodiacal light, Milky Way and bright stars as one dome radiance (CPU-integrated, src/render/atmosphere/nightDome.ts), for the ambient only: the
// sky pass draws them from their own maps. Same extinction and horizon taper as the airglow above.
fn nightDome(cosZ : f32, r : f32) -> vec3f {
  if (cosZ <= 0.0) { return vec3f(0.0); }
  let horizon = smoothstep(0.0, 0.04, cosZ);
  return vec3f(ap.gal0.w, ap.gal1.w, ap.gal2.w) * sampleTransmittance(r, cosZ) * (frame.sky.w * ap.flags.y * horizon);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(dims);
  let r = frame.sky.x + frame.sky.z;
  let cp = skyViewParams(uv, r);
  let cosZ = cp.x;
  let sinZ = sqrt(max(1.0 - cosZ * cosZ, 0.0));
  let sinAz = sqrt(max(1.0 - cp.y * cp.y, 0.0));
  let dir = vec3f(sinZ * cp.y, cosZ, sinZ * sinAz);
#ifdef MOON_PASS
  let mu = clamp(frame.moonDir.y, -1.0, 1.0);
  let light = vec3f(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0);
  textureStore(outTex, vec2i(gid.xy), vec4f(marchSky(dir, r, light, frame.moonIrradiance.rgb * MOON_SCATTER_TINT), 1.0));
#else
  let mu = clamp(frame.sunDir.y, -1.0, 1.0);
  let light = vec3f(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0);
  let sky = marchSky(dir, r, light, frame.sunIrradiance.rgb) + nightSky(cosZ, r);
  textureStore(outTex, vec2i(gid.xy), vec4f(min(sky / skySunStoreScale(), vec3f(FP16_STORE_MAX)), 1.0));

  var world = sky + nightDome(cosZ, r);
  if (ap.flags.x > 0.5) {
    let sxz = vec2f(frame.sunDir.x, frame.sunDir.z);
    let mxz = vec2f(frame.moonDir.x, frame.moonDir.z);
    let denom = length(sxz) * length(mxz);
    let cosD = select(1.0, clamp(dot(sxz, mxz) / max(denom, 1e-9), -1.0, 1.0), denom > 1e-8);
    let sinD = sqrt(max(1.0 - cosD * cosD, 0.0));
    let cosA = cosD * cp.y - sinD * sinAz;
    let cosB = cosD * cp.y + sinD * sinAz;
    let a = textureSampleLevel(skyMoon, linearClamp, skyViewUvCos(cosZ, cosA, r), 0.0).rgb;
    let b = textureSampleLevel(skyMoon, linearClamp, skyViewUvCos(cosZ, cosB, r), 0.0).rgb;
    world += 0.5 * (a + b);
  }
  textureStore(outWorld, vec2i(gid.xy), vec4f(min(world, vec3f(FP16_STORE_MAX)), 1.0));
#endif
}
`,"./shaders/sky/stars.wgsl":`// Stars and planets: one instanced quad each, added (one, one) onto the sky already in the HDR target. Depth test 'equal' against the
// cleared depth 0: a direction has clip z = 0 exactly, so the quad only lands on pixels no geometry covered.
//
// UNIT CHAIN: a star of apparent magnitude m gives an illuminance E = 10^(-0.4 (m + 14.18)) lux at the observer (src/world/astro/stars.ts
// magToIlluminance). The point-spread function spreads E over pixels; a pixel that receives the fraction f of it shows the radiance
// L = f E / Omega_pixel [lux / sr = nits], Omega_pixel = (2 / (proj[1][1] height))^2 cos^3(theta): the pixel's solid angle at the screen
// centre, shrunk by the rectilinear projection at theta off the view axis (cos theta = clip.w of a unit direction). Colour is the B-V colour with
// luminance 1 (starData.ts), times the LUT transmittance along the star's direction (extinction and reddening through the air mass),
// times the sky's cloud transmittance, times frame.params.y (pre-exposure) once. f is the Gaussian PSF (sigma STAR_SIGMA_REF * psfScale px, see below) integrated
// over the pixel box with erf, so the flux stays 1 whatever the sub-pixel position and TAA jitter. Stars of magnitude <= 2 also get a
// wider halo and a four-point diffraction cross, both carrying part of the flux so the total is unchanged.
// The PSF is an ANGLE, not a pixel count: its sigma is STAR_SIGMA_REF pixels at a REF_HEIGHT_PX-line image and scales with the real
// render height (halo and spikes too), so a star keeps its angular size and peak radiance at any resolution or dynamic render scale; only
// below the PSF_SCALE_MIN floor (an unresolved PSF would alias) does the pixel footprint stop shrinking.
//
// Instance data: (direction xyz, magnitude), (colour rgb, id). Stars: direction is J2000 equatorial and is rotated by frame.celestial;
// planets (id >= 1000): the direction is already a world direction.
#include "common/world_bindings.wgsl"
#include "common/atmosphere_sample.wgsl"
#include "sky/atmos_params.wgsl"
#include "sky/atmos_uniforms.wgsl"

@group(2) @binding(0) var<uniform> ap : AtmosParams;
@group(2) @binding(4) var cloudTex : texture_2d<f32>;

const STAR_SIGMA_REF : f32 = 0.6;
const REF_HEIGHT_PX : f32 = 1080.0;
const PSF_SCALE_MIN : f32 = 0.6;
const HALO_FRACTION_MAX : f32 = 0.12;
const SPIKE_FRACTION_MAX : f32 = 0.10;
const SPIKE_SIGMA : f32 = 0.8;
const CULL_EXPOSED : f32 = 1.0 / 1024.0;
const STAR_LUX_ZERO_MAG : f32 = 14.18;
const MIN_COS_OFF_AXIS : f32 = 0.1;
const PEAK_LIMIT : f32 = 30000.0;

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) local : vec2f,
  @location(1) @interpolate(flat) radiance : vec3f,
  @location(2) @interpolate(flat) shape : vec4f,
  @location(3) @interpolate(flat) psf : vec2f,
};

fn erf1(x : f32) -> f32 {
  let x2 = x * x;
  let t = x2 * (4.0 / PI + 0.147 * x2) / (1.0 + 0.147 * x2);
  return sign(x) * sqrt(1.0 - exp(-t));
}

// Fraction of a unit Gaussian (sigma in px) landing inside the pixel box centred x pixels from the star, along one axis.
fn boxGauss(x : f32, sigma : f32) -> f32 {
  let k = 1.0 / (sigma * 1.41421356);
  return 0.5 * (erf1((x + 0.5) * k) - erf1((x - 0.5) * k));
}

fn kastenYoungAirMass(cosZ : f32) -> f32 {
  let c = max(cosZ, 0.0);
  let zDeg = acos(c) * (180.0 / PI);
  return 1.0 / (c + 0.50572 * pow(96.07995 - zDeg, -1.6364));
}

// Scintillation: smooth multiplicative flicker whose amplitude grows with the air mass, plus a little chromatic flashing near the horizon.
fn twinkle(id : f32, airMass : f32, planet : bool) -> vec3f {
  let amp = ap.flags.w * min(0.7, 0.02 + 0.03 * pow(airMass, 1.75)) * select(1.0, 0.25, planet);
  let t = frame.camPos.w;
  let h = hash11(u32(id));
  let a = sin(t * (9.0 + 5.0 * h) + h * 61.0);
  let b = sin(t * (23.0 + 7.0 * fract(h * 7.3)) + h * 113.0);
  let c = sin(t * (14.0 + 6.0 * fract(h * 3.1)) + h * 37.0);
  let n = 0.6 * a + 0.4 * b;
  return max(vec3f(0.0), vec3f(1.0 + amp * n) + vec3f(c, -c, 0.5 * c) * (0.3 * amp * saturate1((airMass - 1.5) / 4.0)));
}

@vertex
fn vs(@builtin(vertex_index) vi : u32, @location(0) dirMag : vec4f, @location(1) colorId : vec4f) -> VsOut {
  var o : VsOut;
  o.pos = vec4f(0.0, 0.0, 2.0, 1.0);
  o.local = vec2f(0.0);
  o.radiance = vec3f(0.0);
  o.shape = vec4f(0.0);
  o.psf = vec2f(1.0);

  let planet = colorId.w >= 1000.0;
  let m = mat3x3f(frame.celestial[0].xyz, frame.celestial[1].xyz, frame.celestial[2].xyz);
  let dir = normalize(select(m * dirMag.xyz, dirMag.xyz, planet));
  let mag = dirMag.w;
  let r = frame.sky.x + frame.sky.z;
  if (ap.sky2.y < 0.5 || (!planet && mag > ap.sky2.w) || planetVisibility(vec3f(0.0, r, 0.0), dir) < 0.5) { return o; }
  if (dot(dir, frame.moonDir.xyz) > cos(frame.moonDir.w) || dot(dir, frame.sunDir.xyz) > cos(frame.sunDir.w)) { return o; }

  let bright = saturate1((2.0 - mag) / 3.5);
  let haloFrac = HALO_FRACTION_MAX * bright;
  let spikeFrac = SPIKE_FRACTION_MAX * bright;
  let psfScale = max(frame.screen.y / REF_HEIGHT_PX, PSF_SCALE_MIN);
  let sigma = STAR_SIGMA_REF * psfScale;
  let haloSigma = (1.6 + 1.6 * bright) * psfScale;
  let spikeLen = (6.0 + 14.0 * bright) * psfScale;
  let extent = select(max(2.5, 4.2 * sigma), max(3.5 * spikeLen, 4.5 * haloSigma), bright > 0.0);

  let clip = frame.viewProj * vec4f(dir, 0.0);
  if (clip.w <= 1e-6) { return o; }
  let ndc = clip.xy / clip.w;
  let perPx = 2.0 * frame.screen.zw;
  if (any(abs(ndc) > vec2f(1.0) + perPx * (extent + 1.0))) { return o; }

  let pixelAngle = 2.0 / (frame.proj[1][1] * frame.screen.y);
  let cosOff = max(clip.w, MIN_COS_OFF_AXIS);
  let pixelOmega = pixelAngle * pixelAngle * cosOff * cosOff * cosOff;
  let lux = pow(10.0, -0.4 * (mag + STAR_LUX_ZERO_MAG)) * ap.flags.z;
  let air = kastenYoungAirMass(dir.y);
  let trans = sampleTransmittance(r, max(dir.y, 0.0));
  let uv = clamp(vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5), vec2f(0.0), vec2f(1.0));
  let cloud = textureSampleLevel(cloudTex, linearClamp, uv, 0.0).a;
  var radiance = colorId.rgb * trans * twinkle(colorId.w, air, planet) * (lux * cloud * frame.params.y / pixelOmega);
  let peak = max(radiance.r, max(radiance.g, radiance.b)) * sq(boxGauss(0.0, sigma));
  if (peak < CULL_EXPOSED) { return o; }
  // The additive blend must not push the half-float target to infinity, whatever the exposure and the off-axis gain.
  radiance *= min(1.0, PEAK_LIMIT / peak);

  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let corner = corners[vi];
  o.pos = vec4f(ndc + vec2f(corner.x, -corner.y) * perPx * extent, 0.0, 1.0);
  o.local = corner * extent;
  o.radiance = radiance;
  o.shape = vec4f(haloFrac, haloSigma, spikeFrac, spikeLen);
  o.psf = vec2f(sigma, SPIKE_SIGMA * psfScale);
  return o;
}

@fragment
fn fs(in : VsOut) -> @location(0) vec4f {
  let d = in.local;
  let haloFrac = in.shape.x;
  let haloSigma = in.shape.y;
  let spikeFrac = in.shape.z;
  let spikeLen = in.shape.w;
  var f = boxGauss(d.x, in.psf.x) * boxGauss(d.y, in.psf.x) * (1.0 - haloFrac - spikeFrac);
  if (haloFrac > 0.0) {
    f += haloFrac * exp(-dot(d, d) / (2.0 * haloSigma * haloSigma)) / (TAU * haloSigma * haloSigma);
    let fall = vec2f(1.0 / sq(1.0 + abs(d.x) / spikeLen), 1.0 / sq(1.0 + abs(d.y) / spikeLen));
    f += (spikeFrac / (4.0 * spikeLen)) * (boxGauss(d.y, in.psf.y) * fall.x + boxGauss(d.x, in.psf.y) * fall.y);
  }
  return vec4f(in.radiance * f, 0.0);
}
`,"./shaders/sky/transmittance.wgsl":`// Transmittance LUT (256x64): T(r, mu) = exp(-integral of extinction[1/km] ds[km]) from radius r along zenith cosine mu to the top of the
// atmosphere, planet ignored (occlusion by the planet is applied by the users). Dimensionless, rgb. Computed once.
// The integral is a midpoint rule over segments whose edges grow quadratically so the dense low atmosphere is resolved on long slants.
#include "sky/lut_common.wgsl"

@group(1) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;

const STEPS : u32 = 128u;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(dims);
  let rm = transmittanceParams(uv);
  let r = rm.x;
  let mu = rm.y;
  let rt = frame.sky.y;
  let d = max(0.0, -r * mu + sqrt(max(r * r * (mu * mu - 1.0) + rt * rt, 0.0)));
  var tau = vec3f(0.0);
  var t0 = 0.0;
  for (var i = 0u; i < STEPS; i++) {
    let f = f32(i + 1u) / f32(STEPS);
    let t1 = d * f * f;
    let tm = 0.5 * (t0 + t1);
    let rp = sqrt(max(r * r + 2.0 * r * mu * tm + tm * tm, 0.0));
    tau += mediumAt(rp - frame.sky.x).extinction * (t1 - t0);
    t0 = t1;
  }
  textureStore(outTex, vec2i(gid.xy), vec4f(exp(-tau), 1.0));
}
`,"./shaders/terrain/bindings.wgsl":`// Group 2 shared by the terrain and water pipelines (created in src/render/terrain/index.ts).
struct Tile {
  grid : vec4f,  // x, y = first vertex in level grid units from the map origin; z, w = quads across (<= 16)
  info : vec4f,  // x = vertex spacing (m), y = clipmap level
};

struct TerrainParams {
  waterLevel : f32,  // metres; -1e9 when the scene has no water
  time : f32,
  debugMode : u32,   // 0 shaded, 1 lod, 2 slope, 3 layer weights, 4 wetness, 5 forest-floor cover, 6 flow
  octaves : u32,     // micro-relief octaves (quality)
  flags : u32,       // bit 0: biplanar detail mapping, bit 1: parallax relief (extreme tier)
  parkRadius : f32,  // metres around the origin kept as mown lawn (the park clears its grass blades there); 0 without a park
  ringHalf : f32,    // half-width of a clipmap level in its own quads (32; 64 at the extreme tier)
  pad2 : u32,
};

@group(2) @binding(0) var<storage, read> tiles : array<Tile>;
@group(2) @binding(1) var<uniform> tp : TerrainParams;
@group(2) @binding(2) var detailA : texture_2d_array<f32>;
@group(2) @binding(3) var detailB : texture_2d_array<f32>;
@group(2) @binding(4) var detailSampler : sampler;
// Forest-floor cover over the terrain maps' uv (src/render/terrain/groundCover.ts): r = canopy cover, g = conifer share.
@group(2) @binding(5) var groundCoverTex : texture_2d<f32>;
// Trunk grid over the same uv (src/render/terrain/trunkGrid.ts): rg = axis inside the cell, b = radius / 2 m, a = 0 empty, 0.5 broadleaf, 1 conifer.
@group(2) @binding(6) var trunkGridTex : texture_2d<f32>;
`,"./shaders/terrain/clipmap.wgsl":`// Clipmap vertex placement. Tiles (see clipmap.ts) index a shared 17x17 vertex grid; vertices beyond the tile's w x h quads collapse
// onto its border. Level l has spacing s and covers +-ringHalf s around the camera (32, or 64 at the extreme tier); in its outer 20%
// vertices morph onto level l+1's grid.
#include "terrain/bindings.wgsl"
#include "terrain/terrain_height.wgsl"

const TILE_VERTS : u32 = 17u;

struct GridVertex {
  xz : vec2f,
  ij : vec2i,     // absolute grid coordinates in level units from the map origin
  spacing : f32,
  level : f32,
  morph : f32,    // 0 = own grid, 1 = fully on the coarser grid
};

fn gridVertex(t : Tile, vid : u32) -> GridVertex {
  let i = min(vid % TILE_VERTS, u32(t.grid.z));
  let j = min(vid / TILE_VERTS, u32(t.grid.w));
  var g : GridVertex;
  g.ij = vec2i(i32(t.grid.x) + i32(i), i32(t.grid.y) + i32(j));
  g.spacing = t.info.x;
  g.level = t.info.y;
  g.xz = frame.terrainOrigin.xy + vec2f(g.ij) * g.spacing;
  let d = max(abs(g.xz.x - frame.camPos.x), abs(g.xz.y - frame.camPos.z));
  let ring = tp.ringHalf * g.spacing;
  g.morph = smoothstep(0.8 * ring, ring - g.spacing, d);
  return g;
}

// Height this vertex would have on level l+1's triangulation (diagonal (0,0)-(1,1) per quad, like the index buffer and the height map).
fn coarseHeight(g : GridVertex) -> f32 {
  let odd = g.ij & vec2i(1);
  if (odd.x == 0 && odd.y == 0) { return terrainHeightMirrored(g.xz); }
  let s = g.spacing;
  var a = vec2f(0.0, -s);
  var b = vec2f(0.0, s);
  if (odd.x == 1 && odd.y == 1) {
    a = vec2f(-s, -s);
    b = vec2f(s, s);
  } else if (odd.x == 1) {
    a = vec2f(-s, 0.0);
    b = vec2f(s, 0.0);
  }
  return 0.5 * (terrainHeightMirrored(g.xz + a) + terrainHeightMirrored(g.xz + b));
}
`,"./shaders/terrain/detail_gen.wgsl":`// One-off generator of the tileable 512x512 ground detail arrays (8 layers, see ground_palette.wgsl for the layer ids).
//   outA: rgb = sRGB-encoded albedo (the pipeline samples it through an rgba8unorm-srgb view), a = height 0..1 (mean about 0.5)
//   outB: rg = tangent-space normal xy (slope, x = +u, y = +v) * 0.5 + 0.5, b = roughness, a = cavity AO
// Every noise is periodic in uv (integer lattice periods), so the arrays tile seamlessly. Self-contained on purpose: math.wgsl needs Frame.
#include "terrain/ground_palette.wgsl"
#include "terrain/detail_noise.wgsl"

@group(0) @binding(0) var outA : texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(1) var outB : texture_storage_2d_array<rgba8unorm, write>;
// x = 1: the reach of the neighbour-cell loops, read at run time so the compiler keeps them as loops (unrolled, they took ~10 s to compile).
@group(0) @binding(2) var<uniform> bounds : vec4i;

const SIZE : f32 = 512.0;

struct Surf {
  h : f32,
  tone : vec3f,   // multiplies the layer's mean albedo; about 1 on average
  rough : f32,    // added to the layer's mean roughness
  ao : f32,
};

// Per-layer relief: tangent-space slope per unit of height change across two texels.
fn relief(layer : i32) -> f32 {
  switch (layer) {
    case 0: { return 5.0; }
    case 1: { return 5.0; }
    case 2: { return 6.0; }
    case 3: { return 7.0; }
    case 4: { return 10.0; }
    case 5: { return 3.0; }
    case 6: { return 2.5; }
    case 7: { return 6.0; }
    case 8: { return 6.0; }
    case 9: { return 7.0; }
    case 10: { return 6.0; }
    case 11: { return 4.0; }
    case 12: { return 7.0; }
    default: { return 11.0; }
  }
}

// A blade lying on the ground seen from above: a tapered, bent lens from its root along \`dir\`.
struct Stroke {
  z : f32,       // depth order; -1 when no blade covers the texel
  t : f32,       // 0 at the root, 1 at the tip
  id : f32,      // random 0..1 per blade (colour pick)
  across : f32,  // 0 on the midrib, 1 at the edge
};

// The topmost of \`per\` jittered blades per cell of an n x n grid that covers uv. The 3x3 cells around the texel are searched, so blades
// must stay shorter than one cell. \`field\` leans the whole pass toward a coherent direction, \`spread\` (radians) scatters it.
fn strokeAt(uv : vec2f, n : i32, per : i32, seed : u32, len : vec2f, wid : vec2f, curve : f32, spread : f32) -> Stroke {
  let p = uv * f32(n);
  let c0 = vec2i(floor(p));
  let field = pNoise(uv, vec2i(3), seed + 77u) * 1.6;
  var best = Stroke(-1.0, 0.0, 0.0, 0.0);
  for (var j = -bounds.x; j <= bounds.x; j++) {
    for (var i = -bounds.x; i <= bounds.x; i++) {
      let c = c0 + vec2i(i, j);
      let hc = hash2(wrapLattice(c, vec2i(n)), seed);
      for (var k = 0; k < per * bounds.x; k++) {
        let h1 = pcgh(hc + u32(k) * 2654435769u);
        let h2 = pcgh(h1);
        let d = p - (vec2f(c) + vec2f(f01(h1), f01(h2)));
        if (dot(d, d) > len.y * len.y) { continue; }
        let h3 = pcgh(h2);
        let h4 = pcgh(h3);
        let h5 = pcgh(h4);
        let a = field + (f01(h3) * 2.0 - 1.0) * spread;
        let dir = vec2f(cos(a), sin(a));
        let l = mix(len.x, len.y, f32(h4 & 255u) / 255.0);
        let t = dot(d, dir) / l;
        if (t < 0.0 || t > 1.0) { continue; }
        let bend = curve * (f32((h4 >> 16u) & 255u) / 127.5 - 1.0) * l * t * t;
        let across = dot(d, vec2f(-dir.y, dir.x)) - bend;
        let hw = mix(wid.x, wid.y, f32((h4 >> 8u) & 255u) / 255.0) * pow(1.0 - t, 0.7);
        let z = f01(h5);
        if (abs(across) < hw && z > best.z) { best = Stroke(z, t, f32(h5 & 255u) / 255.0, abs(across) / hw); }
      }
    }
  }
  return best;
}

// Blade colour relative to the layer mean: dark, mid, yellow-green, blue-green and the odd dry blade; dark root to light tip.
fn bladeTone(id : f32, t : f32) -> vec3f {
  var c = vec3f(1.0);
  if (id < 0.16) { c = vec3f(0.62, 0.74, 0.62); }
  else if (id < 0.36) { c = vec3f(1.42, 1.14, 0.80); }
  else if (id < 0.42) { c = vec3f(1.85, 1.30, 1.55); }
  else if (id < 0.58) { c = vec3f(0.88, 1.05, 0.95); }
  return c * mix(0.6, 1.5, t);
}

fn strawTone(id : f32, t : f32) -> vec3f {
  var c = vec3f(1.0);
  if (id < 0.2) { c = vec3f(0.78, 0.74, 0.68); }
  else if (id < 0.55) { c = vec3f(1.0); }
  else if (id < 0.8) { c = vec3f(1.12, 1.07, 1.0); }
  else { c = vec3f(1.28, 1.24, 1.15); }
  return c * mix(0.78, 1.22, t);
}

// Two passes of blades over a dark thatch. z (a height for the blend with the other layers) rises with each pass and toward the tips.
fn surfGrass(uv : vec2f) -> Surf {
  var s : Surf;
  s.h = 0.08;
  s.tone = vec3f(0.55, 0.50, 0.60);
  s.ao = 0.30;
  let rip = pNoise(uv, vec2i(140), 3u) * 0.5 + 0.5;
  let a = strokeAt(uv, 18, 8, 31u, vec2f(0.55, 0.95), vec2f(0.035, 0.06), 0.35, 3.1);
  if (a.z >= 0.0) {
    s.h = 0.25 + 0.2 * a.z + 0.12 * a.t;
    s.tone = bladeTone(a.id, a.t) * 0.85;
    s.ao = mix(0.30, 0.85, a.t);
  }
  let b = strokeAt(uv, 30, 8, 47u, vec2f(0.5, 0.92), vec2f(0.04, 0.07), 0.45, 3.1);
  if (b.z >= 0.0) {
    s.h = 0.5 + 0.22 * b.z + 0.14 * b.t;
    s.tone = bladeTone(b.id, b.t) * (1.0 - 0.25 * b.across * b.across);
    s.ao = mix(0.4, 1.0, b.t);
  }
  s.rough = 0.05 * (b.t - 0.5) * step(0.0, b.z) + 0.02 * (rip - 0.5);
  return s;
}

// Matted dry grass: longer, thinner, more aligned and more bent blades.
fn surfHay(uv : vec2f) -> Surf {
  var s : Surf;
  s.h = 0.10;
  s.tone = vec3f(0.48, 0.44, 0.40);
  s.ao = 0.32;
  let a = strokeAt(uv, 14, 9, 51u, vec2f(0.7, 0.98), vec2f(0.022, 0.04), 0.6, 1.8);
  if (a.z >= 0.0) {
    s.h = 0.28 + 0.2 * a.z + 0.1 * a.t;
    s.tone = strawTone(a.id, a.t) * 0.9;
    s.ao = mix(0.35, 0.85, a.t);
  }
  let b = strokeAt(uv, 24, 9, 67u, vec2f(0.65, 0.95), vec2f(0.028, 0.048), 0.7, 2.0);
  if (b.z >= 0.0) {
    s.h = 0.5 + 0.22 * b.z + 0.14 * b.t;
    s.tone = strawTone(b.id, b.t) * (1.0 - 0.2 * b.across * b.across);
    s.ao = mix(0.4, 1.0, b.t);
  }
  s.rough = 0.05 * (b.id - 0.5) * step(0.0, b.z);
  return s;
}

// Colour of one stone relative to the layer mean: tan, grey, dark basalt-like, rust and the odd pale quartz.
fn stoneTone(id : f32) -> vec3f {
  if (id < 0.30) { return vec3f(1.12, 1.0, 0.82); }
  if (id < 0.58) { return vec3f(0.92, 0.94, 0.98); }
  if (id < 0.80) { return vec3f(0.55, 0.55, 0.58); }
  if (id < 0.89) { return vec3f(1.12, 0.86, 0.72); }
  return vec3f(1.15, 1.13, 1.1);
}

// Bare soil: fine grain and crumbly clods in two sizes, scattered pebbles of every colour pressed into it and a few hairline drying cracks.
fn surfDirt(uv : vec2f) -> Surf {
  var s : Surf;
  let n1 = pFbm(uv, 6, 4, 9u);
  let n2 = pFbm(uv, 26, 3, 10u);
  let grain = pNoise(uv, vec2i(180), 11u) * 0.5 + 0.5;
  let clod = pStones(uv, 12, 12u, 0.38, 0.70, 0.7, 0.95);
  let crumb = pStones(uv, 33, 71u, 0.34, 0.66, 0.75, 0.95);
  let peb = pStones(uv, 11, 72u, 0.10, 0.30, 0.7, 0.55);
  let peb2 = pStones(uv, 29, 73u, 0.18, 0.42, 0.75, 0.30);
  let w = pCell(uv + 0.02 * vec2f(pNoise(uv, vec2i(7), 74u), pNoise(uv, vec2i(7), 75u)), 6, 76u);
  let crack = (1.0 - smoothstep(0.0, 0.04, w.f2 - w.f1)) * smoothstep(0.55, 0.75, pFbm(uv, 5, 3, 77u));
  let soilH = 0.30 * contrast(n1, 1.7) + 0.16 * contrast(n2, 1.6) + 0.10 * grain + 0.20 * max(clod.h, 0.0) + 0.12 * max(crumb.h, 0.0);
  let pebH = max(0.25 + 0.55 * peb.h, 0.20 + 0.45 * peb2.h);
  let onPebble = max(peb.h, peb2.h) > 0.0;
  s.h = saturate(select(soilH, max(soilH, pebH), onPebble) - 0.25 * crack);
  let soil = mix(vec3f(0.60, 0.58, 0.56), vec3f(1.28, 1.20, 1.10), saturate(soilH * 1.5)) * (0.90 + 0.20 * clod.id) * (0.9 + 0.2 * grain);
  let pid = select(peb2.id, peb.id, peb.h >= peb2.h);
  let pt = stoneTone(pid) * (0.6 + 0.6 * sqrt(max(1.0 - select(peb2.rr, peb.rr, peb.h >= peb2.h), 0.0)));
  s.tone = select(soil, pt, onPebble && pebH >= soilH) * (1.0 - 0.45 * crack);
  s.rough = 0.02 * (grain - 0.5) - select(0.0, 0.08, onPebble);
  s.ao = cavity(s.h) * (1.0 - 0.5 * crack);
  return s;
}

// Gravel: stones of three sizes stacked over a dirty sand fill, with different shapes, colours and heights, so no two neighbours match
// and the gaps stay dark. Every stone is a rounded dome; the largest ones stand proud.
fn surfGravel(uv : vec2f) -> Surf {
  var s : Surf;
  let big = pStones(uv, 7, 13u, 0.34, 0.60, 0.62, 0.9);
  let mid = pStones(uv, 17, 41u, 0.32, 0.60, 0.65, 0.95);
  let fine = pStones(uv, 43, 43u, 0.32, 0.62, 0.7, 1.0);
  let grain = pNoise(uv, vec2i(200), 44u) * 0.5 + 0.5;
  let sandN = pFbm(uv, 12, 3, 45u);
  var h = 0.10 + 0.08 * sandN;
  var tone = vec3f(0.62, 0.56, 0.48) * (0.8 + 0.4 * grain);
  var ao = 0.35;
  var rough = 0.06;
  let hf = 0.14 + 0.26 * fine.h;
  if (fine.h > 0.0 && hf > h) {
    h = hf;
    tone = stoneTone(fine.id) * (0.55 + 0.55 * sqrt(max(1.0 - fine.rr, 0.0)));
    ao = 0.45 + 0.55 * sqrt(max(1.0 - fine.rr, 0.0));
    rough = -0.04;
  }
  let hm = 0.22 + 0.42 * mid.h;
  if (mid.h > 0.0 && hm > h) {
    h = hm;
    tone = stoneTone(mid.id) * (0.55 + 0.55 * sqrt(max(1.0 - mid.rr, 0.0)));
    ao = 0.45 + 0.55 * sqrt(max(1.0 - mid.rr, 0.0));
    rough = -0.05;
  }
  let hb = 0.30 + 0.70 * big.h;
  if (big.h > 0.0 && hb > h) {
    h = hb;
    tone = stoneTone(big.id) * (0.55 + 0.55 * sqrt(max(1.0 - big.rr, 0.0)));
    ao = 0.45 + 0.55 * sqrt(max(1.0 - big.rr, 0.0));
    rough = -0.05;
  }
  s.h = saturate(h);
  s.tone = tone;
  s.rough = rough;
  s.ao = ao;
  return s;
}

// Weathered outcrop rock. The face is a terraced fbm (flat facets broken by short steep steps, the way rock spalls), cut by meandering
// fractures: a bedding-parallel set elongated along u (the steep-face projections put world up on v, so it lies level), a cross set along
// v and a fine irregular set, each fading in and out along its length. On top: crystalline grain, pits, iron staining, dark rain streaks
// running down v and small, sparse crustose lichen.
fn rockCrack(n : f32, width : f32) -> f32 { return 1.0 - smoothstep(0.0, width, abs(n)); }

fn surfRock(uv : vec2f) -> Surf {
  var s : Surf;
  let q = uv + 0.03 * vec2f(pNoise(uv, vec2i(4), 61u), pNoise(uv, vec2i(4), 62u)) + 0.006 * vec2f(pNoise(uv, vec2i(17), 63u), pNoise(uv, vec2i(17), 64u));
  let f = pFbm(q, 3, 4, 14u);
  let steps = 6.0;
  let ft = f * steps;
  let level = floor(ft);
  // Half terraced, half smooth: full terraces close into contour rings that read as crazy paving from a few metres off.
  let terr = mix(f, (level + smoothstep(0.7, 1.0, ft - level)) / steps, 0.5);
  let facetId = f01(pcgh(u32(level + 16.0) * 7919u + 3u));
  // Noise stretched 5 to 6 times along a set's strike gives long, gently curving fractures rather than closed loops.
  let bedSet = rockCrack(pNoise(q, vec2i(2, 11), 15u), 0.03) * smoothstep(0.35, 0.6, pFbm(uv, 3, 2, 65u));
  let crossSet = rockCrack(pNoise(q + 0.31, vec2i(11, 2), 16u), 0.025) * smoothstep(0.45, 0.68, pFbm(uv + 0.5, 4, 2, 66u));
  let fineSet = rockCrack(pNoise(q * vec2f(1.0, 1.0) + 0.17, vec2i(5, 26), 19u), 0.015) * smoothstep(0.5, 0.75, pFbm(uv, 6, 2, 20u)) * 0.6;
  let crack = max(max(bedSet, crossSet), fineSet);
  let grain = pFbm(uv, 48, 4, 17u);
  let pits = smoothstep(0.6, 0.9, pNoise(uv, vec2i(170), 67u) * 0.5 + 0.5);
  let crystals = pNoise(uv, vec2i(240), 69u) * 0.5 + 0.5;
  s.h = saturate(0.5 + 0.9 * (terr - 0.5) + 0.18 * (grain - 0.5) - 0.06 * pits - 0.4 * crack);
  let stain = smoothstep(0.58, 0.82, pFbm(uv, 4, 3, 70u));
  let streak = smoothstep(0.55, 0.85, pNoise(uv, vec2i(36, 2), 68u) * 0.5 + 0.5) * smoothstep(0.3, 0.7, pFbm(uv, 3, 2, 72u));
  var tone = mix(vec3f(0.74, 0.74, 0.76), vec3f(1.20, 1.15, 1.07), smoothstep(0.15, 0.85, s.h)) * (0.95 + 0.1 * facetId);
  tone *= mix(0.88, 1.12, crystals) * (0.92 + 0.16 * grain);
  tone = mix(tone, tone * vec3f(1.22, 1.0, 0.78), 0.45 * stain);
  tone *= 1.0 - 0.22 * streak;
  let lich = pStones(uv, 23, 71u, 0.2, 0.45, 0.8, 0.12);
  let onLich = lich.h > 0.0 && crack < 0.2;
  let lichTone = select(vec3f(1.22, 1.28, 1.08), vec3f(1.45, 1.15, 0.75), fract(lich.id * 3.7) < 0.12);
  tone = select(tone, mix(tone, lichTone, 0.55), onLich);
  s.tone = tone * (1.0 - 0.6 * crack);
  s.rough = 0.05 * (grain - 0.5) + 0.06 * crack + select(0.0, 0.06, onLich);
  s.ao = cavity(s.h) * (1.0 - 0.6 * crack);
  return s;
}

// A leaf lying on the ground: an almond outline from stalk to tip with a midrib, so litter reads as leaves and not as blades.
struct Leaf {
  z : f32,       // depth order; -1 when no leaf covers the texel
  t : f32,       // 0 at the stalk, 1 at the tip
  id : f32,      // random 0..1 per leaf (colour pick)
  across : f32,  // 0 on the midrib, 1 at the edge
};

fn leafAt(uv : vec2f, n : i32, per : i32, seed : u32, len : vec2f, wid : f32) -> Leaf {
  let p = uv * f32(n);
  let c0 = vec2i(floor(p));
  var best = Leaf(-1.0, 0.0, 0.0, 0.0);
  for (var j = -bounds.x; j <= bounds.x; j++) {
    for (var i = -bounds.x; i <= bounds.x; i++) {
      let c = c0 + vec2i(i, j);
      let hc = hash2(wrapLattice(c, vec2i(n)), seed);
      for (var k = 0; k < per * bounds.x; k++) {
        let h1 = pcgh(hc + u32(k) * 2654435769u);
        let h2 = pcgh(h1);
        let h3 = pcgh(h2);
        let h4 = pcgh(h3);
        let d = p - (vec2f(c) + vec2f(f01(h1), f01(h2)));
        let l = mix(len.x, len.y, f01(h4));
        if (dot(d, d) > l * l) { continue; }
        let a = f01(h3) * TAU_D;
        let dir = vec2f(cos(a), sin(a));
        let t = dot(d, dir) / l;
        if (t < 0.0 || t > 1.0) { continue; }
        let curl = (f01(pcgh(h4)) - 0.5) * 0.3 * l * t * t;
        let across = dot(d, vec2f(-dir.y, dir.x)) - curl;
        let hw = wid * l * pow(sin(3.14159265 * t), 0.75) * (0.8 + 0.4 * f01(pcgh(h4 ^ 7u)));
        let z = f01(pcgh(h4 ^ 2654435769u));
        if (abs(across) < hw && z > best.z) { best = Leaf(z, t, f01(pcgh(h3 ^ 40503u)), abs(across) / max(hw, 1e-4)); }
      }
    }
  }
  return best;
}

// Broadleaf litter: three generations of fallen leaves (fresh ochre and tan on top, browner and darker below, skeletal and black in the
// mould), a few twigs, over dark humus that shows in the gaps.
fn litterTone(id : f32) -> vec3f {
  if (id < 0.14) { return vec3f(1.22, 1.06, 0.80); }
  if (id < 0.36) { return vec3f(1.05, 0.95, 0.84); }
  if (id < 0.58) { return vec3f(0.84, 0.78, 0.74); }
  if (id < 0.70) { return vec3f(1.12, 0.90, 0.72); }
  if (id < 0.86) { return vec3f(0.66, 0.60, 0.56); }
  return vec3f(0.46, 0.43, 0.42);
}

fn surfLitter(uv : vec2f) -> Surf {
  var s : Surf;
  let humus = pFbm(uv, 14, 3, 81u);
  s.h = 0.08 + 0.10 * humus;
  s.tone = vec3f(0.36, 0.33, 0.32) * (0.8 + 0.4 * humus);
  s.ao = 0.3;
  s.rough = 0.04;
  // Bottom layer: small, broken, dark leaf fragments.
  let a = leafAt(uv, 22, 3, 82u, vec2f(0.45, 0.9), 0.34);
  if (a.z >= 0.0) {
    s.h = 0.26 + 0.15 * a.z;
    s.tone = litterTone(0.55 + 0.45 * fract(a.id * 3.1)) * (0.6 + 0.3 * a.t);
    s.ao = 0.45;
    s.rough = 0.02;
  }
  // Top layer: whole leaves of mixed age and size, each its own brightness, with a midrib and veins.
  let b = leafAt(uv, 15, 3, 83u, vec2f(0.5, 0.95), 0.36);
  if (b.z >= 0.0) {
    let rib = 1.0 - smoothstep(0.0, 0.12, b.across);
    let vein = smoothstep(0.85, 1.0, abs(sin(TAU_D * (b.t * 5.0 + b.across * 1.5))));
    s.h = 0.5 + 0.25 * b.z + 0.08 * (1.0 - b.across * b.across);
    s.tone = litterTone(b.id) * (0.7 + 0.5 * fract(b.id * 7.3)) * (1.0 - 0.18 * rib - 0.08 * vein) * (0.9 + 0.15 * b.t);
    s.ao = mix(0.6, 1.0, 1.0 - b.across);
    s.rough = -0.06 + 0.04 * b.id;
  }
  let tw = strokeAt(uv, 4, 2, 84u, vec2f(0.6, 0.95), vec2f(0.012, 0.02), 0.1, 3.1);
  if (tw.z >= 0.0 && tw.z > 0.4) {
    s.h = max(s.h, 0.62 + 0.1 * tw.t);
    s.tone = vec3f(0.55, 0.48, 0.44) * (1.0 - 0.3 * tw.across);
    s.ao = 0.8;
  }
  return s;
}

// Conifer duff: a felt of needles in every direction, rusty below and greyer on top, cone scales and the odd small cone or twig.
fn surfNeedles(uv : vec2f) -> Surf {
  var s : Surf;
  let duff = pFbm(uv, 10, 3, 91u);
  s.h = 0.12 + 0.12 * duff;
  s.tone = vec3f(0.62, 0.50, 0.44) * (0.8 + 0.4 * duff);
  s.ao = 0.35;
  s.rough = 0.03;
  let a = strokeAt(uv, 40, 5, 92u, vec2f(0.6, 0.95), vec2f(0.03, 0.05), 0.15, 3.1);
  if (a.z >= 0.0) {
    s.h = 0.32 + 0.2 * a.z;
    s.tone = mix(vec3f(1.15, 0.95, 0.78), vec3f(0.88, 0.70, 0.55), fract(a.id * 2.3)) * 0.85;
    s.ao = 0.6;
  }
  let b = strokeAt(uv, 28, 5, 93u, vec2f(0.6, 0.95), vec2f(0.035, 0.05), 0.2, 3.1);
  if (b.z >= 0.0) {
    s.h = 0.55 + 0.22 * b.z;
    s.tone = select(vec3f(1.22, 1.00, 0.80), vec3f(1.05, 1.02, 0.95), b.id < 0.25) * (1.0 - 0.2 * b.across);
    s.ao = 0.9;
    s.rough = -0.04;
  }
  let cone = pStones(uv, 5, 94u, 0.12, 0.2, 0.45, 0.25);
  if (cone.h > 0.0) {
    let scales = 0.5 + 0.5 * sin(TAU_D * 9.0 * (cone.d.x + cone.d.y)) * sin(TAU_D * 9.0 * (cone.d.x - cone.d.y));
    s.h = max(s.h, 0.55 + 0.4 * cone.h);
    s.tone = vec3f(0.95, 0.70, 0.50) * (0.6 + 0.5 * scales);
    s.ao = 0.55 + 0.45 * cone.h;
  }
  return s;
}

// Moss cushions: domed tufts of two sizes packed together, a fine fuzzy grain, yellow-green tips and dark hollows between them.
fn surfMoss(uv : vec2f) -> Surf {
  var s : Surf;
  let big = pStones(uv, 9, 101u, 0.5, 0.85, 0.75, 1.0);
  let small = pStones(uv, 23, 102u, 0.45, 0.8, 0.8, 1.0);
  let fuzz = pNoise(uv, vec2i(260), 103u) * 0.5 + 0.5;
  let fuzz2 = pNoise(uv, vec2i(130), 104u) * 0.5 + 0.5;
  let h = max(0.55 * max(big.h, 0.0), 0.35 * max(small.h, 0.0) + 0.1);
  s.h = saturate(0.15 + h + 0.12 * (fuzz - 0.5) + 0.08 * (fuzz2 - 0.5));
  let id = select(small.id, big.id, big.h * 0.55 >= small.h * 0.35);
  let hue = mix(vec3f(0.85, 1.0, 0.9), vec3f(1.35, 1.25, 0.75), fract(id * 2.7));
  s.tone = hue * mix(0.45, 1.2, smoothstep(0.1, 0.7, s.h)) * (0.85 + 0.3 * fuzz);
  s.rough = 0.04 * (fuzz - 0.5);
  s.ao = mix(0.35, 1.0, smoothstep(0.1, 0.6, s.h));
  return s;
}

// Mud: a smooth slurry with shallow ripples and boot-sized dents that hold water (gloss), sunken pebbles and a few drying edges.
fn surfMud(uv : vec2f) -> Surf {
  var s : Surf;
  let base = pFbm(uv, 4, 4, 111u);
  let ripple = sin(TAU_D * (9.0 * uv.x + 3.0 * uv.y + 1.2 * pFbm(uv, 3, 2, 112u)));
  let dent = pStones(uv, 6, 113u, 0.25, 0.45, 0.6, 0.6);
  let peb = pStones(uv, 21, 114u, 0.15, 0.35, 0.7, 0.35);
  var h = 0.45 + 0.30 * (base - 0.5) + 0.03 * ripple - 0.18 * max(dent.h, 0.0);
  let pool = smoothstep(0.42, 0.30, h);
  var tone = mix(vec3f(0.80, 0.80, 0.82), vec3f(1.18, 1.12, 1.02), smoothstep(0.25, 0.65, h)) * (1.0 - 0.25 * pool);
  if (peb.h > 0.0) {
    h = max(h, 0.42 + 0.25 * peb.h);
    tone = stoneTone(peb.id) * 0.9;
  }
  s.h = saturate(h);
  s.tone = tone;
  s.rough = -0.30 * pool + 0.05 * smoothstep(0.55, 0.7, h);
  s.ao = 0.6 + 0.4 * smoothstep(0.2, 0.6, h);
  return s;
}

// Dry crusted earth: polygon plates whose edges curl up, wide dark cracks between them and a second, finer crack order inside the
// bigger plates; the crust is paler than the soil beneath.
fn surfCracked(uv : vec2f) -> Surf {
  var s : Surf;
  let w = 0.02 * vec2f(pNoise(uv, vec2i(9), 121u), pNoise(uv, vec2i(9), 122u));
  let big = pCell(uv + w, 7, 123u);
  let fine = pCell(uv + w * 1.7, 19, 124u);
  let e1 = big.f2 - big.f1;
  let e2 = fine.f2 - fine.f1;
  let crack1 = 1.0 - smoothstep(0.02, 0.07, e1);
  let crack2 = (1.0 - smoothstep(0.01, 0.04, e2)) * 0.7;
  let crack = max(crack1, crack2);
  let curl = smoothstep(0.25, 0.04, e1) * (1.0 - crack1);
  let grain = pNoise(uv, vec2i(220), 125u) * 0.5 + 0.5;
  s.h = saturate(0.55 + 0.12 * curl + 0.06 * (grain - 0.5) + 0.06 * (big.id - 0.5) - 0.5 * crack);
  s.tone = mix(vec3f(1.05, 1.02, 0.98), vec3f(0.85, 0.82, 0.80), big.id * 0.6) * (0.92 + 0.16 * grain) * (1.0 - 0.6 * crack) * (1.0 + 0.08 * curl);
  s.rough = 0.02 * (grain - 0.5);
  s.ao = cavity(s.h) * (1.0 - 0.5 * crack);
  return s;
}

// Talus: angular frost-split stones, larger and sharper than gravel, piled with dark voids between them; each stone has its own facet
// tilt, tone and the odd lichen spot.
fn surfScree(uv : vec2f) -> Surf {
  var s : Surf;
  let a = pCell(uv, 6, 131u);
  let b = pCell(uv + 0.5, 13, 132u);
  let gapA = smoothstep(0.02, 0.09, a.f2 - a.f1);
  let gapB = smoothstep(0.02, 0.07, b.f2 - b.f1);
  let angA = TAU_D * fract(a.id * 7.3);
  let angB = TAU_D * fract(b.id * 5.9);
  let faceA = 0.45 + 0.30 * a.id + dot(a.d, vec2f(cos(angA), sin(angA))) * 0.5;
  let faceB = 0.30 + 0.25 * b.id + dot(b.d, vec2f(cos(angB), sin(angB))) * 0.5;
  let grain = pFbm(uv, 50, 3, 133u);
  let useA = faceA * gapA > faceB * gapB;
  let h = select(faceB * gapB, faceA * gapA, useA);
  let id = select(b.id, a.id, useA);
  s.h = saturate(h + 0.12 * (grain - 0.5));
  let lich = smoothstep(0.78, 0.86, pNoise(uv, vec2i(40), 134u) * 0.5 + 0.5);
  s.tone = stoneTone(fract(id * 1.7)) * mix(0.35, 1.05, smoothstep(0.05, 0.5, h)) * (0.9 + 0.2 * grain);
  s.tone = mix(s.tone, vec3f(1.45, 1.5, 1.2), 0.6 * lich * step(0.2, h));
  s.rough = 0.04 * (grain - 0.5);
  s.ao = mix(0.2, 1.0, smoothstep(0.05, 0.45, h));
  return s;
}

fn surfSand(uv : vec2f) -> Surf {
  var s : Surf;
  let ripple = sin(TAU_D * (7.0 * uv.x + 4.0 * uv.y + 1.4 * pFbm(uv, 3, 2, 18u)));
  let grain = pNoise(uv, vec2i(200), 19u) * 0.5 + 0.5;
  let dune = pFbm(uv, 4, 3, 20u);
  s.h = saturate(0.5 + 0.10 * ripple + 0.16 * (grain - 0.5) + 0.20 * (dune - 0.5));
  s.tone = mix(vec3f(0.85, 0.83, 0.80), vec3f(1.12, 1.08, 1.00), grain) * (0.95 + 0.10 * ripple);
  s.rough = 0.02 * (grain - 0.5);
  s.ao = 0.7 + 0.3 * s.h;
  return s;
}

fn surfSnow(uv : vec2f) -> Surf {
  var s : Surf;
  let drift = pFbm(uv, 5, 3, 21u);
  let grain = pNoise(uv, vec2i(220), 22u) * 0.5 + 0.5;
  s.h = saturate(0.5 + 0.55 * (drift - 0.5) + 0.10 * (grain - 0.5));
  s.tone = vec3f(0.97 + 0.06 * grain) * vec3f(0.98, 1.0, 1.03);
  s.rough = 0.05 * (grain - 0.5);
  s.ao = 0.75 + 0.25 * s.h;
  return s;
}

// Moist crumbly loam: irregular clods of two sizes, dark organic specks and damp patches.
fn surfLoam(uv : vec2f) -> Surf {
  var s : Surf;
  let clod = pStones(uv, 10, 23u, 0.40, 0.72, 0.65, 0.95);
  let crumb = pStones(uv, 27, 78u, 0.34, 0.66, 0.7, 0.95);
  let fbm = pFbm(uv, 9, 4, 24u);
  let speck = smoothstep(0.72, 0.9, pNoise(uv, vec2i(120), 79u) * 0.5 + 0.5);
  let damp = smoothstep(0.35, 0.70, pFbm(uv, 4, 3, 80u));
  s.h = saturate(0.34 * contrast(fbm, 1.6) + 0.30 * max(clod.h, 0.0) + 0.22 * max(crumb.h, 0.0) + 0.1);
  s.tone = mix(vec3f(0.58, 0.58, 0.60), vec3f(1.32, 1.26, 1.16), s.h) * (0.88 + 0.24 * clod.id) * mix(1.0, 0.72, damp) * (1.0 - 0.45 * speck);
  s.rough = -0.06 * damp;
  s.ao = cavity(s.h);
  return s;
}

fn surf(layer : i32, uv : vec2f) -> Surf {
  switch (layer) {
    case 0: { return surfGrass(uv); }
    case 1: { return surfHay(uv); }
    case 2: { return surfDirt(uv); }
    case 3: { return surfGravel(uv); }
    case 4: { return surfRock(uv); }
    case 5: { return surfSand(uv); }
    case 6: { return surfSnow(uv); }
    case 7: { return surfLoam(uv); }
    case 8: { return surfMoss(uv); }
    case 9: { return surfLitter(uv); }
    case 10: { return surfNeedles(uv); }
    case 11: { return surfMud(uv); }
    case 12: { return surfCracked(uv); }
    default: { return surfScree(uv); }
  }
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let layer = i32(gid.z);
  let px = vec2i(gid.xy);
  let uv = (vec2f(px) + 0.5) / SIZE;
  let e = 1.0 / SIZE;
  // The centre and its four neighbours (for the slope) come from one call site in a loop the compiler cannot unroll (its count is read
  // at run time): five inlined copies of surf(), each holding all fourteen generators, made the pipeline take about 10 s to compile.
  var offs = array<vec2f, 5>(vec2f(0.0), vec2f(e, 0.0), vec2f(-e, 0.0), vec2f(0.0, e), vec2f(0.0, -e));
  var hs = array<f32, 5>(0.0, 0.0, 0.0, 0.0, 0.0);
  var c : Surf;
  for (var k = 0; k < 5 * bounds.x; k++) {
    let sk = surf(layer, uv + offs[k]);
    hs[k] = sk.h;
    if (k == 0) { c = sk; }
  }
  let dx = hs[1] - hs[2];
  let dy = hs[3] - hs[4];
  let slope = clamp(-vec2f(dx, dy) * relief(layer), vec2f(-0.95), vec2f(0.95));
  let albedo = srgbEncode(clamp(glBaseColor(layer) * c.tone, vec3f(0.0), vec3f(1.0)));
  textureStore(outA, px, layer, vec4f(albedo, c.h));
  textureStore(outB, px, layer, vec4f(slope * 0.5 + 0.5, saturate(glRoughness(layer) + c.rough), c.ao));
}
`,"./shaders/terrain/detail_mips.wgsl":`// Box downsample of one mip level of the detail arrays. Albedo is averaged in linear light; normal slopes average (flattening with
// distance) and their variance is folded into roughness so specular does not shimmer.
@group(0) @binding(0) var srcA : texture_2d_array<f32>;
@group(0) @binding(1) var srcB : texture_2d_array<f32>;
@group(0) @binding(2) var dstA : texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(3) var dstB : texture_storage_2d_array<rgba8unorm, write>;

fn srgbDecode(c : vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}
fn srgbEncode(c : vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(dstA);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let layer = i32(gid.z);
  let base = vec2i(gid.xy) * 2;
  var a = vec4f(0.0);
  var slope = vec2f(0.0);
  var slope2 = 0.0;
  var rough2 = 0.0;
  var ao = 0.0;
  for (var i = 0; i < 4; i++) {
    let p = base + vec2i(i & 1, i >> 1);
    let ta = textureLoad(srcA, p, layer, 0);
    let tb = textureLoad(srcB, p, layer, 0);
    a += vec4f(srgbDecode(ta.rgb), ta.a);
    let s = tb.xy * 2.0 - 1.0;
    slope += s;
    slope2 += dot(s, s);
    rough2 += tb.z * tb.z;
    ao += tb.w;
  }
  a *= 0.25;
  slope *= 0.25;
  let variance = max(0.25 * slope2 - dot(slope, slope), 0.0);
  let rough = sqrt(min(0.25 * rough2 + 0.25 * variance, 1.0));
  textureStore(dstA, vec2i(gid.xy), layer, vec4f(srgbEncode(a.rgb), a.a));
  textureStore(dstB, vec2i(gid.xy), layer, vec4f(slope * 0.5 + 0.5, rough, ao * 0.25));
}
`,"./shaders/terrain/detail_noise.wgsl":`// Periodic noise and cell patterns for the ground detail generator (detail_gen.wgsl). Every function wraps its lattice at an integer
// period of uv, so what it returns tiles seamlessly. No bindings: safe to include from compute shaders.

const TAU_D : f32 = 6.28318530718;

fn pcgh(v : u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn hash2(ip : vec2i, seed : u32) -> u32 { return pcgh(u32(ip.x) + pcgh(u32(ip.y) + pcgh(seed))); }
fn f01(h : u32) -> f32 { return f32(h >> 8u) * (1.0 / 16777216.0); }
fn wrapLattice(ip : vec2i, per : vec2i) -> vec2i { return ((ip % per) + per) % per; }

fn pGrad(ip : vec2i, per : vec2i, seed : u32) -> vec2f {
  let a = f01(hash2(wrapLattice(ip, per), seed)) * TAU_D;
  return vec2f(cos(a), sin(a));
}

// Periodic Perlin noise, about [-1, 1]; \`per\` lattice cells across the tile on each axis.
fn pNoise(uv : vec2f, per : vec2i, seed : u32) -> f32 {
  let p = uv * vec2f(per);
  let i = floor(p);
  let f = p - i;
  let ip = vec2i(i);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = dot(pGrad(ip, per, seed), f);
  let b = dot(pGrad(ip + vec2i(1, 0), per, seed), f - vec2f(1.0, 0.0));
  let c = dot(pGrad(ip + vec2i(0, 1), per, seed), f - vec2f(0.0, 1.0));
  let d = dot(pGrad(ip + vec2i(1, 1), per, seed), f - vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4142;
}

// Periodic fbm remapped to about [0, 1]; the frequency doubles per octave.
fn pFbm(uv : vec2f, freq : i32, octaves : i32, seed : u32) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var norm = 0.0;
  var fr = freq;
  for (var o = 0; o < octaves; o++) {
    sum += amp * pNoise(uv, vec2i(fr), seed + u32(o) * 101u);
    norm += amp;
    amp *= 0.5;
    fr *= 2;
  }
  return 0.5 + 0.5 * sum / norm;
}

fn contrast(x : f32, k : f32) -> f32 { return saturate(0.5 + (x - 0.5) * k); }
fn cavity(h : f32) -> f32 { return 0.4 + 0.6 * smoothstep(0.1, 0.7, h); }

fn srgbEncode(c : vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308));
}

// Periodic cellular noise that also returns the offset to the nearest feature point (cell units) for per-block facet tilt.
struct Cell {
  f1 : f32,
  f2 : f32,
  id : f32,
  d : vec2f,
};

fn pCell(uv : vec2f, freq : i32, seed : u32) -> Cell {
  let p = uv * f32(freq);
  let base = floor(p);
  let f = p - base;
  let i = vec2i(base);
  var c = Cell(8.0, 8.0, 0.0, vec2f(0.0));
  for (var y = -bounds.x; y <= bounds.x; y++) {
    for (var x = -bounds.x; x <= bounds.x; x++) {
      let cell = vec2i(x, y);
      let h = hash2(wrapLattice(i + cell, vec2i(freq)), seed);
      let pt = vec2f(cell) + vec2f(f01(h), f01(pcgh(h))) - f;
      let d = dot(pt, pt);
      if (d < c.f1) { c.f2 = c.f1; c.f1 = d; c.id = f01(pcgh(h ^ 2654435769u)); c.d = pt; } else if (d < c.f2) { c.f2 = d; }
    }
  }
  c.f1 = sqrt(c.f1);
  c.f2 = sqrt(c.f2);
  return c;
}

// Jointed, weathered rock: irregular blocks at two scales whose joints fade in and out along their length, each block with its own height

// The topmost of randomly sized, rotated, elongated domes, one jittered candidate per cell of a freq x freq periodic grid (3x3 cells
// searched, so a radius must stay below one cell). \`occupy\` is the share of cells that hold a stone, \`elong\` the minor/major axis ratio
// limit. h is 0..1 (negative where no stone covers the texel), rr the squared normalised radius (1 at the rim) and d the offset to the
// stone centre in cell units.
struct Stone {
  h : f32,
  id : f32,
  rr : f32,
  d : vec2f,
};

fn pStones(uv : vec2f, freq : i32, seed : u32, rLo : f32, rHi : f32, elong : f32, occupy : f32) -> Stone {
  let p = uv * f32(freq);
  let base = floor(p);
  let f = p - base;
  let i = vec2i(base);
  var best = Stone(-1.0, 0.0, 1.0, vec2f(0.0));
  for (var y = -bounds.x; y <= bounds.x; y++) {
    for (var x = -bounds.x; x <= bounds.x; x++) {
      let cell = vec2i(x, y);
      let h0 = hash2(wrapLattice(i + cell, vec2i(freq)), seed);
      let h1 = pcgh(h0);
      let h2 = pcgh(h1);
      let h3 = pcgh(h2);
      let h4 = pcgh(h3);
      if (f01(h4) > occupy) { continue; }
      let pt = vec2f(cell) + vec2f(f01(h0), f01(h1)) - f;
      let r = mix(rLo, rHi, f01(h2));
      let a = f01(h3) * 3.14159265;
      let e = mix(1.0, elong, f01(pcgh(h4)));
      let c = cos(a);
      let s = sin(a);
      let q = vec2f(c * pt.x + s * pt.y, (-s * pt.x + c * pt.y) / e);
      let rr = dot(q, q) / (r * r);
      if (rr >= 1.0) { continue; }
      let hh = sqrt(1.0 - rr) * (0.55 + 0.45 * f01(pcgh(h4 ^ 2654435769u)));
      if (hh > best.h) { best = Stone(hh, f01(pcgh(h3 ^ 40503u)), rr, pt); }
    }
  }
  return best;
}
`,"./shaders/terrain/detail_sample.wgsl":`// Ground detail sampling for the 8 layers of detail_gen.wgsl. Fine scale is hex-tiled (no visible repetition), the macro scale is a
// plain 7x larger lookup, and steep surfaces use up to three axis-aligned projections instead of stretching the top-down one.
// Only textureSampleGrad is used, with derivatives supplied by the caller in uniform control flow, so any of this may sit in branches.
#include "common/world_bindings.wgsl"
#include "terrain/bindings.wgsl"
#include "terrain/ground_palette.wgsl"

const DS_SIZE : f32 = 512.0;
const DS_MEAN_LEVEL : f32 = 9.0;
const DS_MACRO : f32 = 7.13;
const DS_HEX_MAX_TPP : f32 = 12.0;
const DS_NORMAL_STRENGTH : f32 = 0.8;

struct DsTex {
  a : vec4f,  // albedo (linear) and height
  b : vec4f,  // slope xy, roughness, cavity AO
};

struct DsCtx {
  p : vec3f,
  dx : vec3f,
  dy : vec3f,
  n : vec3f,
  footprint : f32,  // metres per pixel on the surface
  planes : bool,    // allow the steep-surface projections
};

struct DsLayer {
  tone : vec3f,  // multiplies the layer's macro colour
  height : f32,
  dn : vec3f,    // world-space normal perturbation
  rough : f32,
  ao : f32,
};

struct DsHex {
  w : vec3f,
  v0 : vec2i,
  v1 : vec2i,
  v2 : vec2i,
};

fn dsLayerTile(layer : i32) -> f32 {
  switch (layer) {
    case 0: { return 1.2; }
    case 1: { return 1.5; }
    case 2: { return 2.3; }
    case 3: { return 1.4; }
    case 4: { return 3.0; }
    case 5: { return 3.0; }
    case 6: { return 4.0; }
    case 7: { return 1.6; }
    case 8: { return 1.1; }
    case 9: { return 1.5; }
    case 10: { return 1.1; }
    case 11: { return 2.6; }
    case 12: { return 2.2; }
    default: { return 2.6; }
  }
}

// Triangle grid of Mikkelsen's hex tiling: barycentric weights and the three surrounding lattice vertices.
fn dsHexGrid(uv : vec2f) -> DsHex {
  let p = uv * 3.4641016;
  let sk = vec2f(p.x, -0.57735027 * p.x + 1.15470054 * p.y);
  let base = floor(sk);
  let f = sk - base;
  let z = 1.0 - f.x - f.y;
  let s = select(0.0, 1.0, z <= 0.0);
  let s2 = 2.0 * s - 1.0;
  let b = vec2i(base);
  let si = i32(s);
  var h : DsHex;
  h.w = vec3f(-z * s2, s - f.y * s2, s - f.x * s2);
  h.v0 = b + vec2i(si, si);
  h.v1 = b + vec2i(si, 1 - si);
  h.v2 = b + vec2i(1 - si, si);
  return h;
}

fn dsHexOffset(v : vec2i) -> vec2f {
  let h = pcg3(vec3u(bitcast<vec2u>(v), 77u));
  return vec2f(u01(h.x), u01(h.y));
}

fn dsPlain(layer : i32, uv : vec2f, gx : vec2f, gy : vec2f) -> DsTex {
  let a = textureSampleGrad(detailA, detailSampler, uv, layer, gx, gy);
  let b = textureSampleGrad(detailB, detailSampler, uv, layer, gx, gy);
  var t : DsTex;
  t.a = a;
  t.b = vec4f(b.xy * 2.0 - 1.0, b.zw);
  return t;
}

fn dsAddTap(acc : ptr<function, DsTex>, layer : i32, uv : vec2f, gx : vec2f, gy : vec2f, v : vec2i, w : f32) {
  if (w > 0.0) { dsAccumulate(acc, dsPlain(layer, uv + dsHexOffset(v), gx, gy), w); }
}

// Three offset lookups blended by squared barycentric weights; offsets only, so the gradients pass through unchanged. Blending averages
// the taps toward the layer mean and flattens the blade structure, so the contrast around the mean is restored (Heitz and Neyret).
fn dsHex(layer : i32, uv : vec2f, gx : vec2f, gy : vec2f) -> DsTex {
  let g = dsHexGrid(uv);
  var w = max(g.w * g.w - vec3f(0.03), vec3f(0.0));
  w = w / (w.x + w.y + w.z);
  var t : DsTex;
  t.a = vec4f(0.0);
  t.b = vec4f(0.0);
  dsAddTap(&t, layer, uv, gx, gy, g.v0, w.x);
  dsAddTap(&t, layer, uv, gx, gy, g.v1, w.y);
  dsAddTap(&t, layer, uv, gx, gy, g.v2, w.z);
  let k = inverseSqrt(dot(w, w));
  let ma = textureSampleLevel(detailA, detailSampler, vec2f(0.5), layer, DS_MEAN_LEVEL);
  let mb = textureSampleLevel(detailB, detailSampler, vec2f(0.5), layer, DS_MEAN_LEVEL);
  let mbs = vec4f(mb.xy * 2.0 - 1.0, mb.zw);
  t.a = max(ma + (t.a - ma) * k, vec4f(0.0));
  t.b = mbs + (t.b - mbs) * k;
  return t;
}

// One projection plane: fine (hex or plain) and macro scale combined. Albedo keeps the layer mean colour.
fn dsPlane(layer : i32, uv : vec2f, gx : vec2f, gy : vec2f, hex : bool) -> DsTex {
  var f : DsTex;
  if (hex) { f = dsHex(layer, uv, gx, gy); } else { f = dsPlain(layer, uv, gx, gy); }
  let m = dsPlain(layer, uv / DS_MACRO + vec2f(0.37, 0.61), gx / DS_MACRO, gy / DS_MACRO);
  var t : DsTex;
  // Layers made of discrete pieces (stones, talus, crust plates, rock fractures) scaled up seven times turn into giant cobbles and a
  // crazy-paving net of 1 to 10 m cells, so their macro scale stays faint (rock's jointing at that scale comes from rockFace in
  // terrain.wgsl).
  let pieces = layer == GL_GRAVEL || layer == GL_ROCK || layer == GL_CRACKED || layer == GL_SCREE;
  let mk = select(1.0, 0.35, pieces);
  t.a = vec4f(f.a.rgb * mix(vec3f(1.0), m.a.rgb / glBaseColor(layer), 0.6 * mk), mix(f.a.a, m.a.a, 0.35 * mk));
  t.b = vec4f(f.b.xy + 0.18 * mk * m.b.xy, mix(f.b.z, m.b.z, 0.3), f.b.w * mix(1.0, m.b.w, 0.4 * mk));
  return t;
}

fn dsAccumulate(acc : ptr<function, DsTex>, t : DsTex, w : f32) {
  (*acc).a += w * t.a;
  (*acc).b += w * t.b;
}

// How the three projection planes share a pixel's detail weight, from the surface normal alone. It does not
// depend on the layer, and a pixel blends up to three layers, so the caller evaluates it once per pixel
// (dsProjectionWeights) and hands it in rather than recomputing the same pow and two normalisations per layer.
fn dsProjectionWeights(c : DsCtx) -> vec3f {
  if (!c.planes) { return vec3f(0.0, 1.0, 0.0); }
  var w = pow(abs(c.n), vec3f(6.0));
  w = w / (w.x + w.y + w.z);
  w = max(w - vec3f(0.1), vec3f(0.0));
  return w / (w.x + w.y + w.z);
}

fn dsLayerDetail(layer : i32, c : DsCtx, w : vec3f) -> DsLayer {
  let inv = 1.0 / dsLayerTile(layer);
  let tpp = c.footprint * inv * DS_SIZE;
  // Far ground: a pixel spans the whole macro tile (or more), the detail faded out long before and both scales' mip chains have reached
  // the layer mean, so one lookup of the mean level stands in for the up to 24 filtered taps of the planes.
  if (tpp > DS_SIZE * DS_MACRO) {
    let ma = textureSampleLevel(detailA, detailSampler, vec2f(0.5), layer, DS_MEAN_LEVEL);
    let mb = textureSampleLevel(detailB, detailSampler, vec2f(0.5), layer, DS_MEAN_LEVEL);
    var far : DsLayer;
    far.tone = ma.rgb / glBaseColor(layer);
    far.height = 0.5;
    far.dn = vec3f(0.0);
    far.rough = mb.z;
    far.ao = 1.0;
    return far;
  }
  let hex = tpp < DS_HEX_MAX_TPP;
  var acc : DsTex;
  acc.a = vec4f(0.0);
  acc.b = vec4f(0.0);
  var dn = vec3f(0.0);
  if (w.y > 0.0) {
    let t = dsPlane(layer, c.p.xz * inv, c.dx.xz * inv, c.dy.xz * inv, hex);
    dsAccumulate(&acc, t, w.y);
    dn += w.y * vec3f(t.b.x, 0.0, t.b.y);
  }
  if (w.x > 0.0) {
    let t = dsPlane(layer, c.p.zy * inv, c.dx.zy * inv, c.dy.zy * inv, hex);
    dsAccumulate(&acc, t, w.x);
    dn += w.x * vec3f(0.0, t.b.y, t.b.x);
  }
  if (w.z > 0.0) {
    let t = dsPlane(layer, c.p.xy * inv, c.dx.xy * inv, c.dy.xy * inv, hex);
    dsAccumulate(&acc, t, w.z);
    dn += w.z * vec3f(t.b.x, t.b.y, 0.0);
  }
  let fade = 1.0 - smoothstep(8.0, 40.0, tpp);
  var d : DsLayer;
  d.tone = acc.a.rgb / glBaseColor(layer);
  d.height = mix(0.5, acc.a.a, fade);
  d.dn = dn * (DS_NORMAL_STRENGTH * fade);
  d.rough = acc.b.z;
  d.ao = mix(1.0, saturate(acc.b.w * 1.25), fade);
  return d;
}
`,"./shaders/terrain/gbuffer.wgsl":`// G-buffer outputs shared by the terrain and water fragment shaders (targets match GBUFFER_TARGETS).
#include "common/world_bindings.wgsl"

struct FsOut {
  @location(0) albedo : vec4f,
  @location(1) normal : vec4f,
  @location(2) misc : vec4f,
  @location(3) motion : vec2f,
};

fn ndcToUv(c : vec4f) -> vec2f { return vec2f(c.x / c.w * 0.5 + 0.5, 0.5 - c.y / c.w * 0.5); }

// prevUV - currUV of a surface point that was at \`wPrev\` last frame and is at \`w\` now (animated vegetation); a static point passes both equal.
fn motionVectorPrev(w : vec3f, wPrev : vec3f) -> vec2f {
  var p = frame.prevViewProj * vec4f(wPrev, 1.0);
  p.w = max(p.w, 1.0e-3);
  return ndcToUv(p) - ndcToUv(frame.viewProjUnjittered * vec4f(w, 1.0));
}

fn motionVector(w : vec3f) -> vec2f { return motionVectorPrev(w, w); }
`,"./shaders/terrain/grass_tone.wgsl":`// World-anchored tone of the sward, shared by the grass blades (grass.wgsl samples it at each blade root) and the turf layer of the
// terrain (terrain.wgsl evaluates it per pixel, band-limited by the pixel footprint), so both read one field and the colour does not step
// where the blades end. Needs only common/math.wgsl and has no bindings: safe to include from any stage.
//   grassClumpTone(xz, fp)             multiplier (about 1) of the 45 cm tuft and 1.8 m swath tone; fp = pixel extent in metres, 0 for a blade
//   grassStreak(xz, fx, fy)            zero-mean blade-streak field in about [-1, 1] for the turf under and beyond the blades (fx, fy: the
//                                      pixel's world-xz derivatives); every band fades to 0 as the pixel nears its width, so it cannot shimmer
#include "common/math.wgsl"

const GT_STREAK_AMP : f32 = 0.2;
const GT_DIR_A : vec2f = vec2f(0.9781, 0.2079);
const GT_DIR_B : vec2f = vec2f(0.5446, 0.8387);
const GT_DIR_C : vec2f = vec2f(-0.2079, 0.9781);
const GT_DIR_D : vec2f = vec2f(-0.8387, 0.5446);

// Smooth value noise in [0, 1]; the lattice values are hash21 of the corner, with the inner hash shared by the two corners of a row.
fn gtValue(p : vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let b = bitcast<vec2u>(vec2i(i));
  let r0 = pcg(b.y);
  let r1 = pcg(b.y + 1u);
  return mix(mix(u01(pcg(b.x + r0)), u01(pcg(b.x + 1u + r0)), u.x), mix(u01(pcg(b.x + r1)), u01(pcg(b.x + 1u + r1)), u.x), u.y);
}

// 1 while a pixel extent covers under a third of the feature, 0 once it covers most of it.
fn gtVisible(extent : f32, size : f32) -> f32 {
  return 1.0 - smoothstep(0.3, 0.8, extent / size);
}

fn grassClumpTone(xz : vec2f, fp : f32) -> vec3f {
  let tuft = mix(0.5, gtValue(xz * 2.2), gtVisible(fp, 0.45));
  let swath = mix(0.5, gtValue(xz * 0.55 + vec2f(17.0, 5.0)), gtVisible(fp, 1.8));
  return (0.7 + 0.6 * tuft) * mix(vec3f(0.97, 1.0, 0.98), vec3f(1.04, 1.01, 0.88), swath);
}

// One band of streaks: value noise stretched along e2 (\`sv\` metres) and narrow across it (\`su\` metres). The band is resolved only when the
// pixel's extent along each of its two axes (the footprint parallelogram projected on it) is small against that axis' feature size, so a
// view along the streaks keeps them and a view across them averages them out.
fn gtStreakBand(xz : vec2f, e1 : vec2f, su : f32, sv : f32, fx : vec2f, fy : vec2f, seed : f32) -> f32 {
  let e2 = vec2f(-e1.y, e1.x);
  let wu = abs(dot(fx, e1)) + abs(dot(fy, e1));
  let wv = abs(dot(fx, e2)) + abs(dot(fy, e2));
  let vis = gtVisible(wu, su) * gtVisible(wv, sv);
  if (vis < 0.01) { return 0.0; }
  return vis * (2.0 * gtValue(vec2f(dot(xz, e1) / su, dot(xz, e2) / sv) + vec2f(seed, 1.7 * seed)) - 1.0);
}

// Four bands 7, 16, 36 and 80 cm across and about 2.4 times as long, each at its own orientation so no single combing direction shows.
fn grassStreak(xz : vec2f, fx : vec2f, fy : vec2f) -> f32 {
  return 0.5 * gtStreakBand(xz, GT_DIR_A, 0.07, 0.17, fx, fy, 3.0)
    + 0.65 * gtStreakBand(xz, GT_DIR_B, 0.16, 0.38, fx, fy, 11.0)
    + 0.6 * gtStreakBand(xz, GT_DIR_C, 0.36, 0.85, fx, fy, 27.0)
    + 0.45 * gtStreakBand(xz, GT_DIR_D, 0.8, 1.9, fx, fy, 41.0);
}
`,"./shaders/terrain/ground_color.wgsl":`// Shared ground colour field. The terrain fragment shader and the vegetation module both evaluate it, so grass blades and the turf
// under them agree. Public entry points (all take world xz in metres; height, normal and maps are fetched from group 1):
//   grassTint(xz)                     mean turf albedo (linear) incl. dry/lush patches, without per-blade variation
//   grassTintFromMaps(xz, maps)       same when the caller already sampled terrainMapsAt (x soil, y flow, z deposit, w wetness)
//   groundBaseColor(xz)               macro albedo of the layered ground (no detail texture), any xz including outside the map
//   groundBaseColorAt(xz, y, ny, maps, waterLevel)   same with caller-supplied height, normal.y and maps
//   terrainLayerWeights(xz, y, ny, maps, waterLevel) affinity of the 8 ground layers (see GL_* in ground_palette.wgsl)
// grass_tone.wgsl (included here) holds the blade tuft/swath tone and the streak field both the blades and the turf layer read.
#include "common/world_bindings.wgsl"
#include "terrain/noise.wgsl"
#include "terrain/grass_tone.wgsl"
#include "terrain/ground_palette.wgsl"
#include "terrain/terrain_height.wgsl"

struct LayerWeights {
  lo : vec4f,  // grass, hay, dirt, gravel
  hi : vec4f,  // rock, sand, snow, loam
};

// Straw-coloured stretches a few tens of metres across whose edges are mottled at 5 m scale, so they never end on a clean contour.
fn glDryness(xz : vec2f, wet : f32) -> f32 {
  let n = tnFbm(xz * 0.012 + vec2f(3.1, 7.7), 3);
  let m = tnFbm(xz * 0.17 + vec2f(61.0, 13.0), 3);
  return saturate1(0.85 * smoothstep(0.58, 0.82, n + 0.2 * (m - 0.5)) - 0.6 * smoothstep(0.35, 0.8, wet));
}

// Living turf: lush green with yellow-green and clover patches at 10 m and 1-2 m scale, bleached toward straw where it is dry.
// \`dry\` is the caller's glDryness(xz, maps.w) so a point that also evaluates terrainLayerWeights reuses it instead of recomputing the FBM.
fn grassTintFromMapsDry(xz : vec2f, maps : vec4f, dry : f32) -> vec3f {
  let tuft = tnFbm(xz * 0.31 + vec2f(41.0, 5.0), 2);
  let hue = tnFbm(xz * 0.09 + vec2f(7.0, 63.0), 2);
  let clover = smoothstep(0.55, 0.72, tnFbm(xz * 0.9 + vec2f(19.0, 3.0), 2));
  var c = mix(GL_GRASS_LUSH, GL_GRASS_YELLOW, smoothstep(0.42, 0.66, hue));
  c = mix(c, GL_GRASS_CLOVER, 0.7 * clover);
  // A meadow is not one green: drifts of sorrel and seed heads give it russet and olive casts a few metres across, so from a distance it
  // reads as a muted mix of hues rather than a saturated lawn.
  let russet = smoothstep(0.55, 0.78, tnFbm(xz * 0.21 + vec2f(77.0, 31.0), 2));
  c = mix(c, GL_GRASS_RUSSET, 0.45 * russet);
  return mix(c, GL_GRASS_DRY, dry) * (0.82 + 0.4 * tuft) * groundVigour(xz);
}

// Field-scale vigour of the sward, a few hundred metres across: richer, bluer green on one pasture, paler and yellower on the next, as
// soil and grazing differ. It is what keeps a valley from reading as one flat green from the air.
fn groundVigour(xz : vec2f) -> vec3f {
  let v = 0.5 + 0.5 * tnGradient(xz * 0.0042 + vec2f(71.0, 29.0));
  return mix(vec3f(1.10, 1.02, 0.78), vec3f(0.92, 1.0, 0.86), smoothstep(0.3, 0.7, v)) * (0.88 + 0.24 * v);
}

// The regional bedrock: grey granite, warm sandstone and dark slate, in districts a few hundred metres across. Outcrops, scree and
// boulders all take their colour from it, so loose rock matches the face it fell from.
fn bedrockTone(xz : vec2f) -> vec3f {
  let r = 0.5 + 0.5 * tnGradient(xz * 0.0028 + vec2f(13.0, 57.0));
  let granite = vec3f(0.98, 0.99, 1.02);
  let sandstone = vec3f(1.12, 1.00, 0.86);
  let slate = vec3f(0.72, 0.76, 0.82);
  return mix(mix(slate, granite, smoothstep(0.3, 0.45, r)), sandstone, smoothstep(0.58, 0.72, r));
}

fn grassTintFromMaps(xz : vec2f, maps : vec4f) -> vec3f {
  return grassTintFromMapsDry(xz, maps, glDryness(xz, maps.w));
}

fn grassTint(xz : vec2f) -> vec3f {
  return grassTintFromMaps(xz, terrainMapsAt(terrainMirrorXz(xz)));
}

// As terrainLayerWeights, with the caller's glDryness(xz, maps.w) passed in rather than recomputed (see grassTintFromMapsDry).
fn terrainLayerWeightsDry(xz : vec2f, y : f32, ny : f32, maps : vec4f, waterLevel : f32, dry : f32) -> LayerWeights {
  let soil = maps.x;
  let flow = maps.y;
  let dep = maps.z;
  let wet = maps.w;
  let q = xz + 14.0 * tnWarp2(xz * 0.02);
  let jitter = tnFbm(q * 0.045 + vec2f(9.7, 2.3), 3) - 0.5;
  let slope = 1.0 - ny + 0.06 * jitter;
  let soilJ = soil + 0.22 * jitter;
  let hRel = (y - frame.terrain.z) / max(frame.terrain.w - frame.terrain.z, 1.0);

  let steep = smoothstep(0.16, 0.30, slope);
  let gentle = 1.0 - smoothstep(0.10, 0.26, slope);
  let bare = 1.0 - smoothstep(0.02, 0.24, soilJ);
  let alpine = smoothstep(0.62, 0.92, hRel + 0.08 * jitter);
  let rock = saturate1(steep + 0.9 * bare + 0.5 * alpine);

  // Erosion features: gullies follow the drainage map, rills are thin winding scars on slopes, fans are deposited gravel.
  let gully = smoothstep(0.35, 0.70, flow) * smoothstep(0.01, 0.05, slope);
  let ridged = 1.0 - abs(2.0 * tnFbm(q * 0.24 + vec2f(5.0, 77.0), 2) - 1.0);
  // Rills cut only where a slope is grazed or trampled bare, in some districts, not on every hillside.
  let rill = smoothstep(0.955, 0.99, ridged) * smoothstep(0.04, 0.10, slope) * (1.0 - steep) * smoothstep(0.5, 0.7, tnFbm(q * 0.012 + vec2f(61.0, 3.0), 2));
  let fan = smoothstep(0.30, 0.65, dep) * (1.0 - smoothstep(0.05, 0.14, slope));
  let scree = smoothstep(0.10, 0.20, slope) * (1.0 - steep) * smoothstep(0.40, 0.70, tnFbm(q * 0.35 + vec2f(2.0, 19.0), 2));

  // Waterline: wet sand, pebbles and mud below about a metre of the water surface, no sward on it; the seabed seen through the water
  // is the same sediment (everything below the surface counts as fully shore).
  var shore = 0.0;
  if (waterLevel > -1.0e8) { shore = 1.0 - smoothstep(0.1, 1.0, y - waterLevel); }

  // The sward thins in metre-scale patches, more on slopes, dry ground and thin soil; soil shows through the gaps.
  let patchN = tnFbm(q * 0.55 + vec2f(23.0, 51.0), 3);
  let thinSoil = 1.0 - smoothstep(0.30, 0.70, soilJ);
  let sparse = smoothstep(0.60, 0.86, patchN + 0.30 * smoothstep(0.03, 0.15, slope) + 0.18 * dry + 0.25 * thinSoil);
  let cover = smoothstep(0.22, 0.65, soilJ) * gentle * (1.0 - 0.85 * gully) * (1.0 - 0.8 * rill) * (1.0 - 0.95 * shore);
  let sward = cover * (1.0 - 0.9 * sparse);
  let grass = sward * (1.0 - dry);
  let hay = sward * dry;

  let channel = smoothstep(0.5, 0.9, flow);
  let dirt = 0.10 + 0.9 * smoothstep(0.05, 0.35, soilJ) * (1.0 - smoothstep(0.35, 0.7, soilJ)) + 0.7 * channel
    + 0.9 * cover * sparse + 0.9 * gully + 0.8 * rill;
  let gravel = 0.7 * scree + 0.7 * channel * (0.4 + 0.6 * dep) + 0.6 * fan * (0.3 + 0.7 * smoothstep(0.3, 0.7, flow)) + 0.4 * gully * dep
    + 0.55 * shore * smoothstep(0.35, 0.65, tnFbm(q * 0.2 + vec2f(44.0, 12.0), 2));

  let sand = max(0.9 * shore, 0.3 * smoothstep(0.5, 0.85, dep) * gentle);

  let pat = smoothstep(0.42, 0.70, tnFbm(q * 0.08 + vec2f(31.0, 17.0), 2));
  let bank = smoothstep(0.7, 0.95, wet) * (1.0 - smoothstep(0.05, 0.14, slope));
  let loam = (0.3 * wet * smoothstep(0.35, 0.8, soilJ) * pat + 0.8 * bank * (0.3 + 0.7 * pat) + 0.6 * shore * (0.3 + 0.7 * pat)) * (1.0 - smoothstep(0.06, 0.16, slope));

  let snow = smoothstep(0.78, 0.86, hRel + 0.05 * jitter) * gentle;
  let keep = 1.0 - snow;
  var w : LayerWeights;
  w.lo = vec4f(grass, hay, dirt, gravel) * keep;
  w.hi = vec4f(rock * keep, sand * keep * (1.0 - 0.6 * rock), snow, loam * keep);
  return w;
}

fn terrainLayerWeights(xz : vec2f, y : f32, ny : f32, maps : vec4f, waterLevel : f32) -> LayerWeights {
  return terrainLayerWeightsDry(xz, y, ny, maps, waterLevel, glDryness(xz, maps.w));
}

// How much of xz is washed stream bed. A narrow drainage line is bed across its width; where the flow map saturates over a broad
// valley floor (a floodplain tens of metres wide) the bed is a few braided channels meandering through wet meadow instead.
fn streamBed(xz : vec2f, flow : f32) -> f32 {
  let bed = smoothstep(0.72, 0.92, flow);
  let broad = smoothstep(0.86, 0.97, flow);
  if (broad <= 0.0 || bed <= 0.0) { return bed; }
  let m = tnFbm(xz * 0.022 + vec2f(91.0, 37.0), 2);
  let n = tnFbm(xz * 0.05 + vec2f(13.0, 71.0), 2);
  let channels = max(1.0 - smoothstep(0.015, 0.05, abs(m - 0.5)), 0.7 * (1.0 - smoothstep(0.01, 0.035, abs(n - 0.5))));
  return bed * mix(1.0, channels, broad);
}

// The terrain shader's full material set: the eight layers of terrainLayerWeightsDry (which grass placement also reads, so it stays as
// it is), refined into forest floor, moss, mud, cracked earth, scree and stream beds. \`cover\` is the forest-floor cover at xz
// (r = canopy, g = conifer share). Weights are on the scale of the base weights' total.
fn terrainMaterialWeights(xz : vec2f, y : f32, ny : f32, maps : vec4f, waterLevel : f32, dry : f32, cover : vec2f) -> array<f32, 14> {
  let lw = terrainLayerWeightsDry(xz, y, ny, maps, waterLevel, dry);
  var w = array<f32, 14>(lw.lo.x, lw.lo.y, lw.lo.z, lw.lo.w, lw.hi.x, lw.hi.y, lw.hi.z, lw.hi.w, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  let total = max(dot(lw.lo, vec4f(1.0)) + dot(lw.hi, vec4f(1.0)), 1e-4);
  let soil = maps.x;
  let flow = maps.y;
  let dep = maps.z;
  let wet = maps.w;
  let slope = 1.0 - ny;
  let snowFree = 1.0 - lw.hi.z / total;
  // Two patch fields serve every refinement below (an octave pair at metre scale, one octave at field scale), unwarped to keep the
  // pixel cost down.
  let patchM = tnFbm(xz * 0.45 + vec2f(61.0, 7.0), 2);
  let patchL = 0.5 + 0.5 * tnGradient(xz * 0.06 + vec2f(17.0, 83.0));
  var shore = 0.0;
  if (waterLevel > -1.0e8) { shore = 1.0 - smoothstep(0.1, 1.0, y - waterLevel); }
  let gentle = 1.0 - smoothstep(0.12, 0.30, slope);

  // Stream beds: the strongest drainage is a channel of washed gravel and sand with mud along its edges, not turf.
  let bed = streamBed(xz, flow) * (1.0 - smoothstep(0.25, 0.4, slope)) * snowFree;
  w[0] *= 1.0 - 0.95 * bed;
  w[1] *= 1.0 - 0.95 * bed;
  w[5] *= 1.0 - 0.7 * bed;
  // Mostly cobbles and gravel, in patches of coarser and finer stone; sand settles in bars where the current slackens and fine silt
  // drapes the hollows, so a dry bed is a patchwork along its length rather than one even strip of stones.
  let drape = smoothstep(0.55, 0.75, tnFbm(xz * 0.21 + vec2f(37.0, 15.0), 2));
  w[3] += bed * total * (0.7 + 0.5 * dep) * (0.45 + 1.0 * patchM) * (1.0 - 0.5 * drape);
  w[5] += bed * total * 0.6 * smoothstep(0.5, 0.75, patchL) * (1.0 - patchM);
  w[5] += bed * total * 0.45 * drape;
  w[GL_MUD] += bed * total * 0.35 * smoothstep(0.4, 0.8, wet) * smoothstep(0.86, 0.74, flow + 0.1 * patchM);

  // Alluvial sand away from the waterline is a patchwork of sand, fine gravel and damp sward, not a beach.
  let alluvial = w[5] * (1.0 - shore);
  w[3] += 0.5 * alluvial * smoothstep(0.35, 0.65, patchM);
  w[0] += 0.5 * alluvial * smoothstep(0.3, 0.7, wet) * (1.0 - bed);
  w[5] -= 0.55 * alluvial;

  // Forest floor where the crowns close: leaf litter or needle duff replaces most of the sward (light gaps keep some), moss in the
  // damp. A lone tree in a meadow keeps grass to its trunk, so one crown alone (cover about 0.45) gives only a thin ring of litter.
  let canopy = cover.x * (1.0 - shore) * (1.0 - bed) * snowFree;
  let floorAmt = smoothstep(0.4, 0.75, canopy) * (1.0 - smoothstep(0.32, 0.5, slope));
  let gap = smoothstep(0.55, 0.8, patchM) * (1.0 - smoothstep(0.6, 0.95, canopy));
  let litter = floorAmt * (1.0 - gap);
  w[0] *= 1.0 - 0.92 * litter;
  w[1] *= 1.0 - 0.92 * litter;
  w[2] *= 1.0 - 0.6 * litter;
  w[7] *= 1.0 - 0.6 * litter;
  w[GL_LITTER] = 1.3 * litter * total * (1.0 - cover.y);
  w[GL_NEEDLES] = 1.3 * litter * total * cover.y;
  // A woodland floor is not one sheet of litter: patches of low green plants (wood sorrel, ivy, anemone, seedlings) a few metres to
  // tens of metres across where light gets through, more of them under broadleaves than under conifers, and dark bare humus where the
  // litter has rotted or been scuffed away.
  if (litter > 0.01) {
    let herbField = tnFbm(xz * 0.075 + vec2f(43.0, 21.0), 2) + 0.5 * (patchM - 0.5);
    let herbs = smoothstep(0.55, 0.7, herbField) * litter * (1.0 - 0.6 * cover.y);
    w[GL_MOSS] += 0.6 * herbs * total;
    w[GL_LITTER] *= 1.0 - 0.7 * herbs;
    w[GL_NEEDLES] *= 1.0 - 0.7 * herbs;
    let humus = smoothstep(0.6, 0.78, patchL + 0.3 * (patchM - 0.5)) * litter * (1.0 - herbs);
    w[7] += 0.9 * humus * total;
  }

  // Moss: cushions on damp, shaded ground, in forest hollows and on wet banks.
  let mossSite = (0.75 * smoothstep(0.4, 0.8, canopy) + 0.8 * smoothstep(0.55, 0.9, wet) * gentle) * (1.0 - bed) * (1.0 - shore) * snowFree;
  if (mossSite > 0.01) {
    let moss = smoothstep(0.5, 0.72, tnFbm(xz * 0.8 + vec2f(5.0, 41.0), 2)) * mossSite;
    w[GL_MOSS] += 0.9 * moss * total;
    w[0] *= 1.0 - 0.5 * moss;
  }

  // Mud where the ground stays wet: banks, damp hollows, the waterline.
  let mud = (smoothstep(0.66, 0.95, wet) * gentle * (0.25 + 0.75 * smoothstep(0.4, 0.75, patchL)) + 0.6 * shore * (1.0 - patchM)) * (1.0 - canopy * 0.5);
  w[GL_MUD] += mud * (w[2] + w[7] + 0.25 * total);
  w[7] *= 1.0 - 0.6 * mud;

  // Dry, bare clay crusts and cracks, only where it is really parched; a damp soil never cracks.
  let crack = smoothstep(0.4, 0.75, dry + 0.25 * (patchL - 0.5)) * (1.0 - smoothstep(0.15, 0.35, wet)) * gentle * (1.0 - bed);
  w[GL_CRACKED] = w[2] * crack;
  w[2] *= 1.0 - 0.8 * crack;

  // Talus below the outcrops: frost-split blocks on slopes near the angle of repose where the soil is thin, in aprons and tongues tens of
  // metres across with soil and rock between them, not over a whole hillside.
  let apron = smoothstep(0.45, 0.62, patchL + 0.25 * (tnFbm(xz * 0.018 + vec2f(29.0, 4.0), 2) - 0.5));
  let scree = smoothstep(0.10, 0.20, slope) * (1.0 - smoothstep(0.34, 0.46, slope)) * (1.0 - smoothstep(0.15, 0.45, soil))
    * smoothstep(0.3, 0.6, patchM + 0.3 * (1.0 - soil)) * apron * snowFree;
  w[GL_SCREE] = 1.2 * scree * total;
  w[3] *= 1.0 - 0.6 * scree;
  w[2] *= 1.0 - 0.5 * scree;
  return w;
}

// As layerMacroColor, with the caller's glDryness(xz, maps.w) supplied for the grass case (see grassTintFromMapsDry). Only layer 0 reads it.
fn layerMacroColorDry(layer : i32, xz : vec2f, y : f32, maps : vec4f, dry : f32) -> vec3f {
  switch (layer) {
    case 0: { return grassTintFromMapsDry(xz, maps, dry); }
    case 1: { return glBaseColor(GL_HAY) * (0.8 + 0.4 * tnFbm(xz * 0.07 + vec2f(2.0, 8.0), 2)); }
    case 2: {
      // Bare soil is a muted grey-brown that changes over metres: warmer subsoil where it is freshly cut, grey mineral soil, darker humus
      // patches and pale dried crusts. No single orange-tan.
      let t = tnFbm(xz * 0.05 + vec2f(13.0, 1.0), 3);
      let u = tnFbm(xz * 0.4 + vec2f(7.0, 29.0), 2);
      let tone = mix(vec3f(1.06, 0.98, 0.88), vec3f(0.92, 0.95, 1.0), t) * mix(0.82, 1.12, u);
      let humus = smoothstep(0.55, 0.8, tnFbm(xz * 0.13 + vec2f(41.0, 3.0), 2)) * smoothstep(0.3, 0.7, maps.x);
      return glBaseColor(GL_DIRT) * tone * mix(vec3f(1.0), vec3f(0.62, 0.6, 0.6), humus) * (1.0 - 0.3 * smoothstep(0.5, 0.9, maps.y))
        * mix(1.0, 0.8, smoothstep(0.25, 0.7, maps.x));
    }
    case 3: {
      // Dry channel gravel is a patchwork of warm and cool stones and darker damp patches, never one flat grey.
      let t = tnFbm(xz * 0.11 + vec2f(5.0, 27.0), 3);
      let u = tnFbm(xz * 0.6 + vec2f(15.0, 2.0), 2);
      return glBaseColor(GL_GRAVEL) * mix(vec3f(1.12, 1.0, 0.86), vec3f(0.92, 0.96, 1.02), u) * (0.7 + 0.6 * t);
    }
    case 4: {
      // Strata: beds of uneven thickness (a few tens of centimetres to a few metres), each with its own tone, warped and gently dipping, with
      // thin partings inside the thick ones; never a regular stripe.
      let warp = 2.2 * tnFbm(xz * 0.03 + vec2f(3.0, 44.0), 2);
      let s = y * 0.42 + warp * 2.5 + 0.02 * xz.x;
      let bedA = hash21(bitcast<vec2u>(vec2i(i32(floor(s)), 17)));
      let bedB = hash21(bitcast<vec2u>(vec2i(i32(floor(s * 2.7 + 0.3 * warp)), 41)));
      let tone = mix(vec3f(1.08, 1.0, 0.92), vec3f(0.90, 0.93, 0.98), bedA) * (0.9 + 0.2 * bedB);
      // Rain streaks: water running off the ledges stains the face in dark vertical streaks (any function of xz alone is constant down a
      // cliff), broken up along their length.
      let streakN = 1.0 - abs(2.0 * tnFbm(xz * vec2f(0.9, 0.9) + vec2f(31.0, 5.0), 2) - 1.0);
      let streak = smoothstep(0.82, 0.97, streakN) * smoothstep(0.35, 0.65, tnFbm(vec2f(xz.x + xz.y, y) * 0.08 + vec2f(2.0, 9.0), 2));
      let lichen = smoothstep(0.60, 0.72, tnFbm(xz * 0.21 + vec2f(71.0, 9.0), 2)) * smoothstep(0.38, 0.62, tnFbm(xz * 3.7 + vec2f(8.0, 33.0), 2)) * 0.45;
      let stone = glBaseColor(GL_ROCK) * tone * bedrockTone(xz) * (1.0 - 0.35 * streak);
      return mix(stone, vec3f(0.17, 0.19, 0.10), lichen);
    }
    case 5: { return glBaseColor(GL_SAND) * (0.9 + 0.2 * tnFbm(xz * 0.13 + vec2f(9.0, 3.0), 2)); }
    case 6: { return glBaseColor(GL_SNOW); }
    case 7: { return glBaseColor(GL_LOAM); }
    case 8: {
      // Moss is yellow-green in light, deep green in shade and damp.
      let t = tnFbm(xz * 0.35 + vec2f(3.0, 91.0), 2);
      return glBaseColor(GL_MOSS) * mix(vec3f(0.8, 0.9, 1.0), vec3f(1.08, 1.04, 0.82), t) * (1.0 - 0.25 * smoothstep(0.7, 1.0, maps.w));
    }
    case 9: {
      // Fresh litter is brighter and warmer, last year's is grey-brown, and it is darker where it lies wet. A metre-scale brightness
      // field (drifts, hollows, twig-strewn and bare patches) keeps the floor from turning into one even brown at ten metres.
      let t = tnFbm(xz * 0.12 + vec2f(51.0, 9.0), 2);
      let drift = 0.5 + 0.5 * tnGradient(xz * 0.55 + vec2f(3.0, 77.0));
      return glBaseColor(GL_LITTER) * mix(vec3f(0.86, 0.9, 0.98), vec3f(1.07, 1.01, 0.91), t) * (0.72 + 0.5 * drift)
        * (1.0 - 0.3 * smoothstep(0.55, 0.95, maps.w));
    }
    case 10: {
      let t = tnFbm(xz * 0.15 + vec2f(27.0, 3.0), 2);
      return glBaseColor(GL_NEEDLES) * mix(vec3f(0.85, 0.9, 0.95), vec3f(1.15, 1.0, 0.85), t);
    }
    case 11: { return glBaseColor(GL_MUD) * (0.85 + 0.3 * tnFbm(xz * 0.2 + vec2f(5.0, 66.0), 2)); }
    case 12: { return glBaseColor(GL_CRACKED) * mix(vec3f(1.04, 0.98, 0.9), vec3f(0.94, 0.96, 1.0), tnFbm(xz * 0.08 + vec2f(9.0, 12.0), 2)); }
    default: { return glBaseColor(GL_SCREE) * bedrockTone(xz) * (0.85 + 0.3 * tnFbm(xz * 0.1 + vec2f(44.0, 2.0), 2)); }
  }
}

fn layerMacroColor(layer : i32, xz : vec2f, y : f32, maps : vec4f) -> vec3f {
  // Only the grass case needs the dryness, so compute it for that case alone; the rest never reads it.
  if (layer == 0) { return grassTintFromMaps(xz, maps); }
  return layerMacroColorDry(layer, xz, y, maps, 0.0);
}

fn groundBaseColorAt(xz : vec2f, y : f32, ny : f32, maps : vec4f, waterLevel : f32) -> vec3f {
  let dryField = glDryness(xz, maps.w);
  let lw = terrainLayerWeightsDry(xz, y, ny, maps, waterLevel, dryField);
  var w = array<f32, 8>(lw.lo.x, lw.lo.y, lw.lo.z, lw.lo.w, lw.hi.x, lw.hi.y, lw.hi.z, lw.hi.w);
  var sum = 0.0;
  for (var i = 0; i < GL_BASE_COUNT; i++) { sum += w[i]; }
  var c = vec3f(0.0);
  for (var i = 0; i < GL_BASE_COUNT; i++) {
    if (w[i] > 0.02 * sum) { c += w[i] * layerMacroColorDry(i, xz, y, maps, dryField); }
  }
  return c / max(sum, 1e-4);
}

fn groundBaseColor(xz : vec2f) -> vec3f {
  let m = terrainMirrorXz(xz);
  return groundBaseColorAt(xz, terrainHeightMirrored(xz), terrainNormalAt(m).y, terrainMapsAt(m), -1.0e9);
}
`,"./shaders/terrain/ground_palette.wgsl":`// Ground layer ids and their mean linear albedo. Shared by the detail-texture generator (which bakes these colours into the
// texture array) and by ground_color.wgsl (macro colour, grass tint). No bindings: safe to include from compute shaders.
// Measured broadband reflectances: living grass 0.10-0.14 (luminance), dry grass 0.20-0.30, soil 0.10-0.18, gravel and rock 0.15-0.25,
// moss 0.05-0.10, dry leaf litter 0.10-0.15, conifer needle duff 0.07-0.10, wet mud 0.05-0.08, dry crusted clay 0.18-0.28.
// Hues follow photographs of each surface under daylight: topsoil a warm brown (sRGB about 110/90/70), beech and oak litter a grey-brown
// (photographs of woodland floors: sRGB about 95/85/75, saturation 0.3-0.4, warmer only where fresh), needle duff a dull rust, moss yellow-green.

const GL_GRASS : i32 = 0;
const GL_HAY : i32 = 1;
const GL_DIRT : i32 = 2;
const GL_GRAVEL : i32 = 3;
const GL_ROCK : i32 = 4;
const GL_SAND : i32 = 5;
const GL_SNOW : i32 = 6;
const GL_LOAM : i32 = 7;
// The layers below refine the eight above for the terrain shader alone (see terrainMaterialWeights in ground_color.wgsl); the grass
// placement and the macro colour of other callers only ever see the first eight.
const GL_MOSS : i32 = 8;
const GL_LITTER : i32 = 9;
const GL_NEEDLES : i32 = 10;
const GL_MUD : i32 = 11;
const GL_CRACKED : i32 = 12;
const GL_SCREE : i32 = 13;
const GL_BASE_COUNT : i32 = 8;
const GL_COUNT : i32 = 14;

// Living grass reflects about 0.06-0.09 / 0.11-0.12 / 0.03-0.05 (R / G / B), and a sward mixes in seed heads, dead leaves and sheen,
// so it reads as a muted yellow-green (photographs: hue 65-80 degrees, saturation 0.4-0.6), neither teal nor neon lime.
const GL_GRASS_LUSH : vec3f = vec3f(0.078, 0.106, 0.052);
const GL_GRASS_YELLOW : vec3f = vec3f(0.100, 0.112, 0.058);
const GL_GRASS_CLOVER : vec3f = vec3f(0.056, 0.098, 0.050);
const GL_GRASS_RUSSET : vec3f = vec3f(0.100, 0.090, 0.055);
const GL_GRASS_DRY : vec3f = vec3f(0.235, 0.200, 0.105);
// Light under a closed canopy is skylight that has passed through and bounced off leaves: a green cast, not sky blue (but not orange
// either: most of it still comes through the gaps, so blue is only partly cut). The ground and grass
// beneath crowns take this tint on their albedo (scaled by the forest-floor cover) to stand in for it, since only the trees near the scene
// focus have ray-traced canopies for the GI to see.
const GL_CANOPY_LIGHT : vec3f = vec3f(0.96, 1.0, 0.78);

fn glBaseColor(layer : i32) -> vec3f {
  switch (layer) {
    case 0: { return vec3f(0.088, 0.121, 0.043); }
    case 1: { return vec3f(0.290, 0.245, 0.140); }
    case 2: { return vec3f(0.135, 0.112, 0.088); }
    case 3: { return vec3f(0.180, 0.163, 0.140); }
    case 4: { return vec3f(0.185, 0.166, 0.148); }
    case 5: { return vec3f(0.315, 0.272, 0.205); }
    case 6: { return vec3f(0.800, 0.820, 0.860); }
    case 7: { return vec3f(0.085, 0.066, 0.050); }
    case 8: { return vec3f(0.046, 0.066, 0.030); }
    case 9: { return vec3f(0.122, 0.099, 0.078); }
    case 10: { return vec3f(0.102, 0.080, 0.064); }
    case 11: { return vec3f(0.088, 0.071, 0.055); }
    case 12: { return vec3f(0.235, 0.205, 0.165); }
    default: { return vec3f(0.200, 0.186, 0.168); }
  }
}

// Baseline microfacet roughness per layer (the lighting pass lowers it further with wetness).
fn glRoughness(layer : i32) -> f32 {
  switch (layer) {
    case 0: { return 0.80; }
    case 1: { return 0.88; }
    case 2: { return 0.95; }
    case 3: { return 0.82; }
    case 4: { return 0.80; }
    case 5: { return 0.90; }
    case 6: { return 0.60; }
    case 7: { return 0.88; }
    case 8: { return 0.92; }
    case 9: { return 0.86; }
    case 10: { return 0.84; }
    case 11: { return 0.50; }
    case 12: { return 0.95; }
    default: { return 0.78; }
  }
}
`,"./shaders/terrain/noise.wgsl":`// World-space noise for terrain shading. Include after common/math.wgsl (hash21, pcg3, u01).

fn tnLatticeHash(ip : vec2i) -> f32 { return hash21(bitcast<vec2u>(ip)); }

fn tnLatticeGradient(ip : vec2i) -> vec2f {
  let a = u01(pcg3(vec3u(bitcast<vec2u>(ip), 11u)).x) * TAU;
  return vec2f(cos(a), sin(a));
}

fn tnQuintic(f : vec2f) -> vec2f { return f * f * f * (f * (f * 6.0 - 15.0) + 10.0); }

// Value noise in [0, 1].
fn tnValue(p : vec2f) -> f32 {
  let i = floor(p);
  let u = tnQuintic(p - i);
  let ip = vec2i(i);
  let a = tnLatticeHash(ip);
  let b = tnLatticeHash(ip + vec2i(1, 0));
  let c = tnLatticeHash(ip + vec2i(0, 1));
  let d = tnLatticeHash(ip + vec2i(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Perlin gradient noise in about [-1, 1]; no axis-aligned grid look, unlike value noise.
fn tnGradient(p : vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = tnQuintic(f);
  let ip = vec2i(i);
  let a = dot(tnLatticeGradient(ip), f);
  let b = dot(tnLatticeGradient(ip + vec2i(1, 0)), f - vec2f(1.0, 0.0));
  let c = dot(tnLatticeGradient(ip + vec2i(0, 1)), f - vec2f(0.0, 1.0));
  let d = dot(tnLatticeGradient(ip + vec2i(1, 1)), f - vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4142;
}

const TN_ROT : mat2x2f = mat2x2f(0.8, 0.6, -0.6, 0.8);

// Fractal sum of gradient noise, remapped to about [0, 1]. Octaves are rotated against each other to hide the lattice.
fn tnFbm(p0 : vec2f, octaves : i32) -> f32 {
  var p = p0;
  var sum = 0.0;
  var amp = 0.5;
  var norm = 0.0;
  for (var o = 0; o < octaves; o++) {
    sum += amp * tnGradient(p);
    norm += amp;
    p = TN_ROT * p * 2.03 + vec2f(17.3, 9.1);
    amp *= 0.5;
  }
  return 0.5 + 0.5 * sum / norm;
}

// Two decorrelated tnFbm channels used to warp a lookup domain (about [-1, 1] each).
fn tnWarp2(p : vec2f) -> vec2f {
  return vec2f(tnFbm(p + vec2f(5.2, 1.3), 2), tnFbm(p + vec2f(1.7, 9.2), 2)) * 2.0 - 1.0;
}

// Gradient noise with its analytic derivative: (value, d/dx, d/dy), same scale as tnGradient.
fn tnGradientD(p : vec2f) -> vec3f {
  let i = floor(p);
  let f = p - i;
  let u = tnQuintic(f);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let ip = vec2i(i);
  let ga = tnLatticeGradient(ip);
  let gb = tnLatticeGradient(ip + vec2i(1, 0));
  let gc = tnLatticeGradient(ip + vec2i(0, 1));
  let gd = tnLatticeGradient(ip + vec2i(1, 1));
  let va = dot(ga, f);
  let vb = dot(gb, f - vec2f(1.0, 0.0));
  let vc = dot(gc, f - vec2f(0.0, 1.0));
  let vd = dot(gd, f - vec2f(1.0, 1.0));
  let k = va - vb - vc + vd;
  let value = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  let grad = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * k + vec2f(vb - va, vc - va));
  return vec3f(value, grad) * 1.4142;
}

// Fractal sum of tnGradientD: (value in about [-1, 1], d/dx, d/dy) with respect to p0. \`fp\` is the pixel footprint in p0 units; octaves
// whose lattice cell shrinks toward a pixel fade out, because every octave contributes the same slope and would alias.
fn tnFbmD(p0 : vec2f, octaves : i32, fp : f32) -> vec3f {
  var p = p0;
  var m = mat2x2f(1.0, 0.0, 0.0, 1.0);
  var sum = vec3f(0.0);
  var amp = 0.5;
  var norm = 0.0;
  var scale = 1.0;
  for (var o = 0; o < octaves; o++) {
    let n = tnGradientD(p);
    let vis = 1.0 - smoothstep(0.25, 0.6, fp * scale);
    sum += amp * vis * vec3f(n.x, transpose(m) * n.yz);
    norm += amp;
    m = TN_ROT * m * 2.03;
    p = TN_ROT * p * 2.03 + vec2f(17.3, 9.1);
    amp *= 0.5;
    scale *= 2.03;
  }
  return sum / norm;
}
`,"./shaders/terrain/terrain.wgsl":`// Terrain G-buffer pass: clipmap vertex placement plus the layered PBR material. Group 2 is declared in bindings.wgsl.
// Debug views (TerrainParams.debugMode): 1 lod level colour with grid lines, 2 slope, 3 layer weights, 4 wetness, 5 forest-floor cover
// (green = canopy, red leaves, blue needles), 6 flow.
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
    case 0, 1, 6, 8: { return 1.0; }
    case 3, 4, 13: { return 6.0; }
    default: { return 10.0; }
  }
}

// Share of xz that is the park's mown lawn: the park clears grass blades inside its radius, so the turf is the whole lawn there.
fn parkLawn(xz : vec2f) -> f32 {
  if (tp.parkRadius <= 0.0) { return 0.0; }
  return 1.0 - smoothstep(tp.parkRadius - 30.0, tp.parkRadius, length(xz));
}

// Mowing stripes: passes a couple of metres wide whose blades lean alternately toward and away from the viewer, so each band is
// lighter or darker depending on which way it is seen from (and swaps when you turn round).
fn lawnStripes(xz : vec2f, toCam : vec3f, fp : f32) -> f32 {
  let dir = vec2f(0.9285, 0.3714);
  let s = sin(TAU * dot(xz, dir) / 4.6);
  let band = smoothstep(-0.15, 0.15, s) * 2.0 - 1.0;
  let facing = dot(normalize(toCam.xz + vec2f(1e-4, 0.0)), dir);
  return 0.16 * band * facing * (1.0 - smoothstep(0.4, 1.2, fp));
}

// Forest-floor cover at xz (r = canopy, g = conifer share, b = forest-ness), zero off the map. The floor turns to litter where the local
// cover is high inside a stand (forest-ness), so a lone tree in a meadow keeps its grass.
fn groundCoverAt(xz : vec2f) -> vec2f {
  if (!terrainInside(xz)) { return vec2f(0.0); }
  let uv = (terrainTexel(xz) + 0.5) / frame.terrain.x;
  let c = textureSampleLevel(groundCoverTex, linearClamp, uv, 0.0).xyz;
  return vec2f(max(c.x, 0.0) * smoothstep(0.25, 0.6, c.z) * 1.6, c.y);
}

// Distance (m) from xz to the racing line, from the cover texture's alpha (groundCover.ts bakeTrackDistance); TRACK_WEAR_RANGE_M or more
// far from it, off the map and without a track.
const TRACK_WEAR_RANGE_M : f32 = 25.5;

fn trackDistAt(xz : vec2f) -> f32 {
  if (!terrainInside(xz)) { return TRACK_WEAR_RANGE_M; }
  let uv = (terrainTexel(xz) + 0.5) / frame.terrain.x;
  return textureSampleLevel(groundCoverTex, linearClamp, uv, 0.0).w * TRACK_WEAR_RANGE_M;
}

// The race course worn into the ground along the racing line, the way marshals, pilots and spectators wear one between the gates: a
// trodden path 1.5 to 3 m wide whose width wanders, compacted bare soil down the middle with two shallow rut lines where the feet go,
// puddled mud in its hollows, trampled thin sward and soil at its margins that grass reclaims a few metres out. Across a gravel bed the
// path is finer, compacted gravel and grit rather than loose stones. Rewrites the material weights in place; returns the rut shade
// (1 = none). Visual only: heights, placement and colliders are untouched.
fn trackWear(xz : vec2f, d : f32, slope : f32, wt : ptr<function, array<f32, 14>>) -> f32 {
  if (d >= 6.0) { return 1.0; }
  var total = 0.0;
  for (var i = 0; i < GL_COUNT; i++) { total += (*wt)[i]; }
  let along = tnFbm(xz * 0.045 + vec2f(13.0, 57.0), 2);
  let halfW = 0.75 + 0.8 * along;
  let grain = tnFbm(xz * 0.6 + vec2f(5.0, 3.0), 2) - 0.5;
  let dj = d + 0.35 * grain;
  // Steep ground is not walked straight up: the path fades out on slopes a person would avoid.
  let walk = 1.0 - smoothstep(0.25, 0.45, slope);
  let core = (1.0 - smoothstep(0.55 * halfW, halfW, dj)) * walk;
  let margin = (1.0 - smoothstep(halfW, halfW + 2.5 + 1.5 * along, dj)) * (1.0 - core) * walk;
  if (core + margin <= 0.0) { return 1.0; }
  let loose = ((*wt)[GL_GRAVEL] + (*wt)[GL_SCREE]) / max(total, 1e-4);
  // Turf: gone from the middle, thinned and trampled toward straw at the margin.
  let sward = 1.0 - 0.92 * core - 0.45 * margin;
  (*wt)[GL_GRASS] *= sward;
  (*wt)[GL_HAY] *= sward;
  (*wt)[GL_LITTER] *= 1.0 - 0.8 * core - 0.4 * margin;
  (*wt)[GL_NEEDLES] *= 1.0 - 0.8 * core - 0.4 * margin;
  (*wt)[GL_MOSS] *= 1.0 - core - 0.5 * margin;
  // Loose stones are trodden into a fine compacted grit in the middle.
  (*wt)[GL_GRAVEL] *= 1.0 - 0.45 * core;
  (*wt)[GL_SCREE] *= 1.0 - 0.7 * core;
  let soil = total * (1.1 * core + 0.45 * margin);
  (*wt)[GL_DIRT] += soil * (1.0 - 0.5 * loose);
  (*wt)[GL_SAND] += soil * 0.35 * loose;
  // Trodden soil is darker than a fresh scar: compacted, with humus worked into it, darkest down the middle.
  (*wt)[GL_LOAM] += total * core * (1.0 - loose) * (0.35 + 0.5 * smoothstep(0.4, 0.7, along));
  // Hollows a few metres long, every few tens of metres, where the trodden soil stays damp and dark. Damp, not puddled: a water film here
  // mirrored the low sky as a blue-white speckle along the whole course at golden hour.
  let hollow = smoothstep(0.62, 0.74, tnFbm(xz * 0.11 + vec2f(71.0, 9.0), 2)) * core * (1.0 - smoothstep(0.08, 0.2, slope));
  (*wt)[GL_LOAM] += total * 1.2 * hollow;
  // Two rut lines where the feet fall, a little either side of the middle.
  let rut = (1.0 - smoothstep(0.08, 0.22, abs(dj - 0.4 * halfW))) * core;
  return 1.0 - 0.25 * rut;
}

// The ground at the foot of the trees round xz (trunk grid, see bindings.wgsl): x = the share of the sky the nearest trunk leaves open
// (0.45 against the bark, back to 1 one and a half radii out), y = how much litter and moss has gathered round the foot (a ragged ring
// to about twice the radius, inside where the roots dive in), z = 1 when that tree is a conifer.
const TRUNK_GRID : i32 = 1024;
const TRUNK_FOOT_RANGE : f32 = 80.0;

fn trunkFoot(xz : vec2f) -> vec3f {
  let g = (terrainTexel(xz) + 0.5) / frame.terrain.x * f32(TRUNK_GRID);
  let cellM = frame.terrain.x * frame.terrain.y / f32(TRUNK_GRID);
  let base = vec2i(floor(g));
  let rag = 1.0 + 0.35 * (tnValue(xz * 2.3 + vec2f(17.0, 5.0)) - 0.5);
  var r = vec3f(1.0, 0.0, 0.0);
  for (var dj = -1; dj <= 1; dj++) {
    for (var di = -1; di <= 1; di++) {
      let c = base + vec2i(di, dj);
      if (any(c < vec2i(0)) || any(c >= vec2i(TRUNK_GRID))) { continue; }
      let t = textureLoad(trunkGridTex, c, 0);
      if (t.a <= 0.0) { continue; }
      let R = t.b * 2.0;
      let d = length((vec2f(c) + t.rg - g) * cellM);
      r.x = min(r.x, mix(0.45, 1.0, smoothstep(R, 2.5 * R, d)));
      let l = 1.0 - smoothstep(1.2 * R + 0.1, 2.0 * R + 0.35, d * rag);
      if (l > r.y) { r.y = l; r.z = step(0.75, t.a); }
    }
  }
  return r;
}

// Jointed bedrock, in world space so it stays coherent across the whole outcrop: beds 1.1 to 2.4 m thick (warped, gently dipping) cut by
// two regional sets of vertical joints, 2 to 9 m apart and staggered from one bed to the next, into blocks. Each block is a slightly
// tilted facet with its own tone, and on steep faces some stand proud as a ledge (a flatter tread over a near-vertical riser); the
// joints and bedding planes are dark open cracks. Shading only (the surface does not move). Cracks fade before they narrow below a
// pixel, ledges before they shrink to a few, block facets and tones last to a few hundred metres. \`steep\` (0..1) allows the ledges.
struct RockFace {
  n : vec3f,
  ao : f32,
  tone : f32,
};

// Relief of bare rock at 3 to 15 m, the scale between the terrain mesh (which is smooth there) and the detail texture: swells, hollows
// and spalled scars. A height field in world space, sampled on the three axis planes and blended by the normal (a field in the face's own
// tangent frame would slide as that frame turns across a dome); its gradient, projected into the surface, bends the normal. Shading only:
// returns the bent normal and the hollows' sky occlusion. Fades out as a feature nears a pixel.
const ROCK_RELIEF_FREQ : f32 = 0.09;
const ROCK_RELIEF_M : f32 = 2.6;

fn rockRelief(p : vec3f, n : vec3f, fp : f32) -> vec4f {
  var w = pow(abs(n), vec3f(4.0));
  w = w / (w.x + w.y + w.z);
  let f = ROCK_RELIEF_FREQ;
  var g = vec3f(0.0);
  var h = 0.0;
  if (w.y > 0.05) {
    let r = tnFbmD(p.xz * f + vec2f(37.0, 11.0), 2, fp * f);
    g += w.y * vec3f(r.y, 0.0, r.z);
    h += w.y * r.x;
  }
  if (w.x > 0.05) {
    let r = tnFbmD(p.zy * f + vec2f(5.0, 71.0), 2, fp * f);
    g += w.x * vec3f(0.0, r.z, r.y);
    h += w.x * r.x;
  }
  if (w.z > 0.05) {
    let r = tnFbmD(p.xy * f + vec2f(53.0, 29.0), 2, fp * f);
    g += w.z * vec3f(r.y, r.z, 0.0);
    h += w.z * r.x;
  }
  let gt = g - n * dot(g, n);
  let bent = normalize(n - ROCK_RELIEF_M * f * gt);
  return vec4f(bent, 1.0 - 0.45 * smoothstep(0.0, 0.5, -h));
}

fn rockHash(bed : i32, salt : i32) -> f32 { return hash21(bitcast<vec2u>(vec2i(bed, salt))); }

fn rockFace(p : vec3f, n : vec3f, fp : f32, steep : f32) -> RockFace {
  var r : RockFace;
  r.n = n;
  r.ao = 1.0;
  r.tone = 1.0;
  let facetFade = 1.0 - smoothstep(0.4, 2.0, fp);
  if (facetFade <= 0.0) { return r; }
  let spacing = 1.1 + 1.3 * tnFbm(p.xz * 0.004 + vec2f(8.0, 3.0), 2);
  let warp = 2.5 * tnFbm(p.xz * 0.025 + vec2f(4.0, 9.0), 2);
  let s = p.y / spacing + warp + 0.03 * p.x;
  let bed = floor(s);
  let fb = s - bed;
  let bi = i32(bed);
  // Joint planes wander a little with height and along their strike, so a crack is never a ruled line.
  let dirA = vec2f(0.37, 0.93);
  let dirB = vec2f(-0.93, 0.37);
  let lenA = 2.0 + 5.0 * rockHash(bi, 23);
  let lenB = 3.0 + 6.0 * rockHash(bi, 31);
  let wob = 0.35 * vec2f(tnGradient(vec2f(p.y * 0.6, dot(p.xz, dirB) * 0.25) + vec2f(3.0, 1.0)),
    tnGradient(vec2f(p.y * 0.6, dot(p.xz, dirA) * 0.25) + vec2f(11.0, 7.0)));
  let jA = (dot(p.xz, dirA) + wob.x) / lenA + rockHash(bi, 29);
  let jB = (dot(p.xz, dirB) + wob.y) / lenB + rockHash(bi, 37);
  let iA = floor(jA);
  let iB = floor(jB);
  let id = pcg3(vec3u(bitcast<u32>(bi), bitcast<u32>(i32(iA)), bitcast<u32>(i32(iB)) ^ 0x9e37u));
  let h0 = u01(id.x);
  let h1 = u01(id.y);
  let h2 = u01(id.z);

  // Distance in metres to the nearest crack: either joint or the bedding plane.
  let fA = jA - iA;
  let fB = jB - iB;
  let dCrack = min(min(min(fA, 1.0 - fA) * lenA, min(fB, 1.0 - fB) * lenB), min(fb, 1.0 - fb) * spacing);
  let width = 0.025 + 0.06 * h2;
  let lineFade = 1.0 - smoothstep(0.5 * width, 2.0 * width, fp);
  // Only some stretches of each joint are open; the rest are closed hairlines the eye does not pick out, so the face is not a ruled grid.
  let open = smoothstep(0.35, 0.6, tnValue(p.xz * 0.18 + vec2f(f32(bi) * 3.1, p.y * 0.2)));
  let crack = (1.0 - smoothstep(0.4 * width, width + 0.5 * fp, dCrack)) * lineFade * open;

  // Block facet: tilted about the face's horizontal and up-dip axes.
  let t1 = normalize(vec3f(-n.z, 0.0, n.x) + vec3f(1e-4, 0.0, 0.0));
  let t2 = cross(n, t1);
  var bent = normalize(n + facetFade * ((h0 - 0.5) * 0.16 * t1 + (h1 - 0.5) * 0.12 * t2));

  // Ledge: a block that stands proud has a flatter tread at the top of its bed over a riser; its own split, so no staircase repeats.
  let ledgeVis = steep * step(0.7, h2) * (1.0 - smoothstep(0.08, 0.3, fp / spacing));
  if (ledgeVis > 0.0) {
    let split = 0.2 + 0.55 * rockHash(bi, 91);
    let tread = smoothstep(split, split + 0.15, fb) * (1.0 - smoothstep(0.88, 1.0, fb));
    let out = normalize(vec3f(n.x, 0.0, n.z) + vec3f(0.0, 1e-3, 0.0));
    bent = normalize(bent + ledgeVis * (0.12 * tread * (vec3f(0.0, 1.0, 0.0) - n) + 0.1 * (1.0 - tread) * (out - n)));
    r.ao *= 1.0 - ledgeVis * 0.25 * (1.0 - smoothstep(0.0, 0.12, fb));
  }
  r.n = bent;
  r.ao *= 1.0 - 0.5 * crack;
  // Each bed its own shade (strata), each block a little off it.
  let bedTone = mix(1.0, 0.78 + 0.44 * rockHash(bi, 53), 1.0 - smoothstep(0.3, 0.8, fp / spacing));
  r.tone = bedTone * mix(1.0, (0.9 + 0.2 * h1) * (1.0 - 0.3 * crack), facetFade);
  return r;
}

// Runnels on steep rock: rain cuts shallow grooves straight down a face, a metre or two apart, so a cliff reads as eroded stone rather
// than a smooth moulded slope. A ridged noise across the face (along its horizontal tangent), stretched down the fall line, bends the
// normal sideways; it fades out as a groove nears a pixel. Shading only. Returns the bent normal and the grooves' shade.
fn rockRunnels(p : vec3f, n : vec3f, fp : f32) -> vec4f {
  let fade = 1.0 - smoothstep(0.08, 0.35, fp);
  if (fade <= 0.0) { return vec4f(n, 1.0); }
  let t = normalize(vec3f(-n.z, 0.0, n.x) + vec3f(1e-4, 0.0, 0.0));
  let u = dot(p.xz, t.xz);
  var slopeU = 0.0;
  var groove = 0.0;
  var amp = 0.35;
  var f = 0.55;
  for (var k = 0; k < 2; k++) {
    let g = tnGradientD(vec2f(u * f, p.y * f * 0.12) + vec2f(f32(k) * 17.0, 3.0));
    // Ridged: grooves where the noise crosses zero.
    let r = 1.0 - abs(g.x);
    slopeU += -sign(g.x) * g.y * f * amp;
    groove = max(groove, smoothstep(0.75, 1.0, r) * amp / 0.35);
    amp *= 0.5;
    f *= 2.3;
  }
  let bent = normalize(n - t * (slopeU * fade));
  return vec4f(bent, 1.0 - 0.18 * groove * fade);
}

// Extreme tier: parallax occlusion relief. The view ray is marched down through the leading layer's height field (its relief is
// PARALLAX_DEPTH metres deep) and the point where it first meets the surface is where every layer is then sampled, so pebbles, clods
// and leaves stand up and hide what is behind them. Top-down ground only and only within a few metres: it fades out as a pixel grows
// toward a centimetre. Shading only; the surface the drone hits does not move.
const PARALLAX_DEPTH : f32 = 0.035;
const PARALLAX_STEPS : i32 = 12;

fn parallaxXz(layer : i32, p : vec3f, dx : vec3f, dy : vec3f, fp : f32) -> vec2f {
  let fade = 1.0 - smoothstep(0.004, 0.012, fp);
  if (fade <= 0.0) { return p.xz; }
  let v = normalize(frame.camPos.xyz - p);
  let inv = 1.0 / dsLayerTile(layer);
  let stepXz = -v.xz / max(v.y, 0.2) * (PARALLAX_DEPTH * fade / f32(PARALLAX_STEPS));
  var xz = p.xz;
  var prevXz = xz;
  var ray = 1.0;
  var prevGap = 0.0;
  for (var i = 0; i < PARALLAX_STEPS; i++) {
    let h = dsHex(layer, xz * inv, dx.xz * inv, dy.xz * inv).a.a;
    let gap = ray - h;
    if (gap <= 0.0) {
      // Between the last step above the surface and this one below it.
      let t = prevGap / max(prevGap - gap, 1e-4);
      return mix(prevXz, xz, t);
    }
    prevXz = xz;
    prevGap = gap;
    xz += stepXz;
    ray -= 1.0 / f32(PARALLAX_STEPS);
  }
  return xz;
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
    case 4u: { return mix(vec3f(0.08), vec3f(0.1, 0.35, 1.0), wet); }
    case 5u: { let c = groundCoverAt(in.world.xz); return vec3f(c.x * (1.0 - c.y), c.x, c.x * c.y); }
    default: { return heatRamp(terrainMapsAt(terrainMirrorXz(in.world.xz)).y); }
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
  // One glDryness for the whole pixel: it feeds both the layer weights and the grass macro colour (see grassTintFromMapsDry).
  let dryField = glDryness(w.xz, maps.w);
  let coverHere = groundCoverAt(w.xz);
  var wt = terrainMaterialWeights(w.xz, w.y, ts.normal.y, maps, tp.waterLevel, dryField, coverHere);
  let rutShade = trackWear(w.xz, trackDistAt(w.xz), 1.0 - ts.normal.y, &wt);
  // The park's lawns are kept turf: no bare patches, ruts or hay, and a lush, even green.
  let lawn = parkLawn(w.xz) * smoothstep(0.7, 0.85, ts.normal.y);
  if (lawn > 0.0) {
    var sum = 0.0;
    for (var i = 0; i < GL_COUNT; i++) { sum += wt[i]; wt[i] *= 1.0 - lawn; }
    wt[GL_GRASS] += lawn * sum;
  }
  let lw = LayerWeights(vec4f(wt[0], wt[1], wt[2], wt[3]), vec4f(wt[4], wt[5], wt[6], wt[7]));
  var total = 0.0;
  for (var i = 0; i < GL_COUNT; i++) { total += wt[i]; }
  let mudShare = wt[GL_MUD] / max(total, 1e-4);
  let rockShare = wt[GL_ROCK] / max(total, 1e-4);
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
  if ((tp.flags & 2u) != 0u && !ctx.planes) {
    let pxz = parallaxXz(lid[0], w, dx, dy, ctx.footprint);
    ctx.p = vec3f(pxz.x, w.y, pxz.y);
  }

  // Turf: the blades' own tuft and swath tone plus a streak field, both world-anchored and filtered by the pixel footprint (fades to the
  // mean as a feature nears a pixel), so the sward keeps its tone and sheen past the last blade and cannot shimmer.
  let turfShade = smoothstep(0.3, 0.65, coverHere.x);
  var turfTone = vec3f(1.0);
  var streak = 0.0;
  if (lw.lo.x + lw.lo.y > 0.03 * total) {
    turfTone = grassClumpTone(w.xz, fpXZ);
    streak = grassStreak(w.xz, dx.xz, dy.xz);
  }

  var albedo = vec3f(0.0);
  var rough = 0.0;
  var cavity = 0.0;
  var dn = vec3f(0.0);
  var bsum = 0.0;
  var best = 0.0;
  var bestLayer = GL_DIRT;
  // Blend weights are raised to the sixth power, so a layer under 15% of the leading one adds next to nothing even where its relief
  // stands tallest: skip sampling it.
  let cutoff = max(0.03 * max(total, 1e-4), 0.15 * lwt[0]);
  // Same weights for every layer this pixel blends, so evaluate them once here.
  let planeW = dsProjectionWeights(ctx);
  for (var k = 0; k < 3; k++) {
    if (lwt[k] > cutoff) {
      let d = dsLayerDetail(lid[k], ctx, planeW);
      // Height blend: a layer's relief decides where it shows inside a transition (soil fills the cracks, stone tops and pebbles poke
      // through), and the sixth power keeps that boundary as crisp as it is on real ground instead of a wide cross-fade.
      let p = lwt[k] * (0.45 + 1.1 * d.height);
      let p3 = p * p * p;
      let b = p3 * p3;
      var tone = d.tone;
      var r = d.rough;
      if (lid[k] <= GL_HAY) {
        // Under crowns the turf is the blades' shade grass (grass_cull.wgsl): darker and bluer, not the lime of an open sward.
        tone *= turfTone * (1.0 + GT_STREAK_AMP * streak) * mix(vec3f(1.0), vec3f(0.72, 0.82, 0.7), turfShade);
        r -= 0.07 * streak;
      }
      albedo += b * layerMacroColorDry(lid[k], w.xz, w.y, maps, dryField * (1.0 - lawn)) * tone;
      rough += b * r;
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
  var n = normalize(ts.normal + dn - MICRO_SLOPE * vec3f(mr.y, 0.0, mr.z));
  var microAo = 1.0 - 0.3 * smoothstep(0.0, 0.7, -mr.x);
  var shapeN = ts.normal;
  // Bare bedrock, from slabs to cliffs: runnels on the steep part, swells and hollows, joints and blocks throughout, ledges only where
  // it is steep.
  if (rockShare > 0.3 && ts.normal.y < 0.95) {
    let rockK = smoothstep(0.3, 0.7, rockShare);
    let steep = 1.0 - smoothstep(0.5, 0.7, ts.normal.y);
    if (steep > 0.0) {
      let runnel = rockRunnels(w, n, ctx.footprint);
      n = normalize(mix(n, runnel.xyz, rockK * steep));
      microAo *= mix(1.0, runnel.w, rockK * steep);
    }
    let k = rockK * (1.0 - smoothstep(0.85, 0.95, ts.normal.y));
    // The relief bends the smooth surface normal (it is shape, not texture), and the fine detail rides on it.
    let relief = rockRelief(w, ts.normal, ctx.footprint);
    shapeN = normalize(mix(ts.normal, relief.xyz, k));
    n = normalize(n + shapeN - ts.normal);
    microAo *= mix(1.0, relief.w, k);
    let face = rockFace(w, n, ctx.footprint, steep);
    n = normalize(mix(n, face.n, k));
    microAo *= mix(1.0, face.ao, k);
    albedo *= mix(1.0, face.tone, k);
  }

  // Where the key light grazes a surface or falls behind it, detail normals that tip toward it light isolated specks: a lit/unlit mosaic
  // that a real face, which the same relief shadows, does not show. Ease them toward the smooth normal there; the blocks and ledges of
  // a cliff keep half their bend, so the face still reads as jointed in its own shade.
  let keyL = select(frame.sunDir.xyz, frame.moonDir.xyz, frame.misc.w == 1u);
  // Rock keeps its metre-scale relief (shapeN): that is shape, which a grazing light picks out on a real face too.
  let graze = 1.0 - smoothstep(0.05, 0.35, dot(ts.normal, keyL));
  n = normalize(mix(n, shapeN, mix(0.8, 0.5, rockShare) * graze));

  // Damp ground darkens and gains some gloss, but only the waterline is a film of water: a valley floor must not read as wet asphalt.
  var wet = 0.6 * smoothstep(0.35, 0.9, maps.w);
  if (tp.waterLevel > -1.0e8) { wet = max(wet, 1.0 - smoothstep(0.0, 1.2, w.y - tp.waterLevel)); }
  // Mud is a water-logged surface and the middle of a stream bed is wet stones.
  wet = max(wet, 0.9 * smoothstep(0.08, 0.45, mudShare));
  if (maps.y > 0.8) { wet = max(wet, 0.3 * smoothstep(0.6, 0.95, streamBed(w.xz, maps.y)) * smoothstep(0.8, 0.95, maps.y)); }
  let turfShare = (lw.lo.x + lw.lo.y) / max(total, 1e-4);
  if (lawn > 0.0) { albedo *= 1.0 + lawn * lawnStripes(w.xz, frame.camPos.xyz - w, fpXZ); }
  albedo *= mix(vec3f(1.0), GL_CANOPY_LIGHT, 0.6 * smoothstep(0.3, 0.8, coverHere.x));
  // Round each trunk's foot: the trunk hides part of the sky, and leaves, needles and moss gather against it.
  var footAo = 1.0;
  if (length(frame.camPos.xyz - w) < TRUNK_FOOT_RANGE && tp.debugMode == 0u) {
    let foot = trunkFoot(w.xz);
    footAo = foot.x;
    if (foot.y > 0.0) {
      let mossy = smoothstep(0.5, 0.7, tnValue(w.xz * 3.1 + vec2f(2.0, 11.0))) * (1.0 - foot.z);
      // Damp, half-rotted litter and humus collect against the trunk: darker than the open floor, never a pale ring.
      let litter = mix(glBaseColor(GL_LITTER), glBaseColor(GL_NEEDLES), foot.z) * (0.62 + 0.3 * tnValue(w.xz * 9.0));
      let k = 0.85 * foot.y;
      albedo = mix(albedo, mix(litter, glBaseColor(GL_MOSS), 0.6 * mossy), k);
      rough = mix(rough, 0.9, k);
      n = normalize(mix(n, ts.normal, 0.5 * k));
    }
  }
  // A wet sward is not a glossy film; blades shed water, so only bare soil, gravel and loam take the damp response in full.
  wet *= (1.0 - lw.hi.z / max(total, 1e-4)) * (1.0 - 0.8 * turfShare);
  // Damp stones drain: a gravel bed out of the water is darker when wet but holds no film, and a gloss on it mirrored the low sky as a
  // blue-white sheet along every dry bed at golden hour.
  wet *= 1.0 - 0.7 * smoothstep(0.2, 0.6, lw.lo.w / max(total, 1e-4)) * (1.0 - mudShare);
  // Ground under a canopy sees less sky: the same darkening the blade roots get, so turf and ground share one AO response.
  cavity *= 1.0 - 0.3 * turfShare;
  // Wet ground is a soft sheen, never glitter: the lighting pass scales roughness by mix(1, 0.4, wet), and below about 0.5 every pebble's
  // own detail normal throws a separate sharp sun glint that sparkles and crawls at speed. Hold the lit roughness at 0.62 or more (mud
  // with a real water film may go to 0.42), and let the detail normals lie flatter as the ground wets (water fills the gaps).
  let wetFloor = mix(0.62, 0.42, smoothstep(0.1, 0.4, mudShare));
  rough = max(rough, wetFloor / mix(1.0, 0.4, wet));
  n = normalize(mix(n, ts.normal, 0.5 * wet));

  // Past the map edge there are no trees, so the far country is dressed as seen from the air: stands of forest (dark, matt canopy)
  // between the fields, in patches a few hundred metres across.
  let outsideD = terrainOutsideDistance(w.xz);
  if (outsideD > 0.0) {
    let stand = smoothstep(0.44, 0.54, tnFbm(w.xz * 0.0035 + vec2f(33.0, 7.0), 3)) * smoothstep(0.0, 400.0, outsideD) * smoothstep(0.75, 0.9, ts.normal.y);
    let crowns = 0.75 + 0.5 * tnFbm(w.xz * 0.05 + vec2f(3.0, 9.0), 2);
    albedo = mix(albedo, vec3f(0.026, 0.044, 0.030) * crowns, stand);
    rough = mix(rough, 0.95, stand);
    cavity *= 1.0 - 0.3 * stand;
  }

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
  out.albedo = vec4f(clamp(albedo, vec3f(0.0), vec3f(1.0)), saturate1(ts.ao * mix(1.0, cavity * microAo, 0.6) * footAo * rutShade));
  out.normal = vec4f(octEncode(n), saturate1(rough), 0.0);
  // Near the camera, where the blades are drawn, the turf shows only between them, deep in the sward's shade: material 11 with the occlusion
  // of the blades above it (Beer-Lambert through about 20 cm of sward, broken into sunflecks), so the gaps of a sunlit meadow are dark.
  var mat = layerMaterial(bestLayer);
  var floorShade = 0.0;
  let near = 1.0 - smoothstep(25.0, 70.0, length(frame.camPos.xyz - w));
  // Wherever blades grow, whatever the ground layer under them (a sward over a gravel bed too), not only where turf leads: a bare-layer
  // pixel between blades kept its own sheen, and at a low sun those gaps mirrored the bright sky as a blue-white speckle.
  if ((bestLayer <= GL_HAY || turfShare > 0.15) && near > 0.0 && tp.debugMode == 0u) {
    let key = select(frame.sunDir.xyz, frame.moonDir.xyz, frame.misc.w == 1u);
    let fleck = smoothstep(0.35, 0.75, tnValue(w.xz * 3.3 + vec2f(5.0, 1.0)));
    let swardCover = smoothstep(0.15, 0.6, turfShare);
    floorShade = (1.0 - exp(-1.2 / max(key.y, 0.12))) * (1.0 - 0.6 * fleck) * near * swardCover;
    mat = 11.0;
    // Seen between the blades the floor is matt and sees little sky: the blades around the gap hide most of the sky its sheen would mirror.
    out.normal.z = mix(out.normal.z, 1.0, near * swardCover);
    out.albedo.a *= 1.0 - 0.35 * near * swardCover;
  }
  out.misc = vec4f(mat / 255.0, floorShade, wet, emissive);
  out.motion = motionVector(w);
  return out;
}
`,"./shaders/terrain/terrain_height.wgsl":`// Height, normal and material-map lookups that stay defined outside the finite terrain: the map is mirrored across its borders
// (continuous heights) and faded over TERRAIN_FAR_FADE_M toward the far country, low hills a few kilometres across around a far height,
// so the horizon never ends in a cliff or a dead-flat plain. Inside the map the heights are the map's own, unchanged; outside it there is
// no collision, only scenery.
#include "common/world_bindings.wgsl"
#include "terrain/noise.wgsl"

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

// Rolling far-country relief: 0 at the map edge, growing over the first few kilometres out, and kept between -0.15 and +0.4 of the
// relief around the far height, so it stays inside the map's own height range (the clipmap's culling bounds) and above its water.
fn terrainFarHills(xz : vec2f, outside : f32) -> f32 {
  let n = tnFbm(xz * 0.00045 + vec2f(5.1, 2.3), 3);
  let range = frame.terrain.w - frame.terrain.z;
  return clamp((n - 0.42) * 1.1, -0.15, 0.4) * range * smoothstep(0.0, 2500.0, outside);
}

fn terrainHeightMirrored(xz : vec2f) -> f32 {
  let h = terrainHeightAt(terrainMirrorXz(xz));
  let outside = terrainOutsideDistance(xz);
  if (outside <= 0.0) { return h; }
  return mix(h, terrainFarHeight() + terrainFarHills(xz, outside), smoothstep(0.0, TERRAIN_FAR_FADE_M, outside));
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

// Smooth normal, horizon AO and material maps at any world xz. \`footprint\` is the pixel size in metres: beyond the texel size the
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
`,"./shaders/terrain/water.wgsl":`// Water surface: a flat plane at TerrainParams.waterLevel drawn over the clipmap tiles whose terrain dips below it (see index.ts).
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
  // A calm shore has only a thin, broken wet edge where ripples lap the bank, not a bright foam line.
  let lap = (1.0 - smoothstep(0.0, 0.04, depth)) * (0.25 + 0.5 * foamNoise);
  let froth = (1.0 - smoothstep(0.02, 0.35, depth)) * smoothstep(0.55, 0.85, foamNoise) * 0.5;
  let foam = max(lap, froth);
  albedo = mix(albedo, vec3f(0.6), foam);
  let rough = mix(0.04 + 0.16 * smoothstep(0.3, 4.0, fp), 0.55, foam);

  var out : FsOut;
  out.albedo = vec4f(clamp(albedo, vec3f(0.0), vec3f(1.0)), 1.0);
  out.normal = vec4f(octEncode(n), rough, 0.0);
  out.misc = vec4f(WATER_MATERIAL / 255.0, 0.0, 0.0, 0.0);
  out.motion = motionVector(w);
  return out;
}
`,"./shaders/vegetation/grass.wgsl":`// Grass blades. One instance per blade record (grass_cull.wgsl); the vertices are a strip of rows, two vertices per row, plus a tip vertex
// when HAS_TIP. LOD0/1/2 only differ in NSEG/HAS_TIP. All animation is a bend of the blade axis: an arc whose tip is displaced by
// H * sin(tilt), where the tilt vector adds the blade's own curl, the wind lean and flutter, prop wash and trample.
#include "vegetation/veg_params.wgsl"
#include "vegetation/veg_wind.wgsl"
#include "vegetation/grass_blade.wgsl"
#include "terrain/gbuffer.wgsl"
#include "terrain/grass_tone.wgsl"

@group(2) @binding(1) var<storage, read> blades : array<Blade>;

const NSEG : u32 = \${NSEG}u;
const HAS_TIP : bool = \${HAS_TIP};
const MIN_HALF_PX : f32 = 0.5;
const MAX_TILT : f32 = 1.45;
const GRASS_ID : f32 = 2.0;
const TRANSLUCENCY : f32 = 0.42;
// Blades thinner than a pixel (true half width in px below THIN_PX) shade as the sward, not as a mirror: roughness, normals and translucency
// are pulled to the smooth values, because a sub-pixel blade samples one random normal per pixel and flickers under TAA.
const THIN_PX : f32 = 1.2;
const GRAZE_ROUGH : f32 = 1.0;

// Dead blades in a living sward are a dull grey-tan, well below the pale gold of a mown hay field.
// Blade area per volume of sward times the projection 0.5 (1/m): a 30 cm meadow of leaf area index about 3. The key light reaching a point on
// a blade crosses the sward standing above it, so the lower blades and the gaps are in the blades' own shade (see swardShade).
const SWARD_DENSITY : f32 = 6.0;
// A blade in the way passes on about an eighth of the sunlight it stops, diffused through its tissue (green leaf transmittance 0.1-0.15),
// so even the deepest blades keep that share.
const SWARD_OPACITY : f32 = 0.88;
const STRAW : vec3f = vec3f(0.215, 0.185, 0.115);
// Ripe grass heads (Yorkshire fog, bents, cocksfoot) are a pale buff that gives a June meadow its light, silvery top.
const SEED_HEAD : vec3f = vec3f(0.30, 0.27, 0.18);
// Woodland understorey (head codes 16 to 18, see floorPlant in grass_cull.wgsl). Fern and herb leaves are a darker, bluer green than a sunlit
// sward (shade leaves); last year's bracken is a dull rust; fallen sticks are grey-brown bark.
const FERN : vec3f = vec3f(0.032, 0.062, 0.020);
const FERN_DEAD : vec3f = vec3f(0.130, 0.085, 0.045);
const HERB : vec3f = vec3f(0.028, 0.056, 0.020);
const BARK : vec3f = vec3f(0.105, 0.090, 0.075);
// Head codes beyond the flowers (1-4) and seed heads (5): fern frond (pinnae cut in the fragment shader), herb leaf, fallen stick.
const CODE_FERN : u32 = 16u;
const CODE_HERB : u32 = 17u;
const CODE_STICK : u32 = 18u;
// Pairs of pinnae along a frond (bracken and male fern carry 10 to 20).
const FERN_PINNAE : f32 = 12.0;

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) world : vec3f,
  @location(1) nrm : vec3f,
  @location(2) terrainNrm : vec3f,
  @location(3) albedo : vec3f,
  @location(4) shade : vec2f,   // x = cavity, y = roughness
  @location(5) motion : vec2f,
  @location(6) cover : vec2f,   // x = share of the drawn width (or head area) that is real, the rest is the one-pixel floor, y = thinness 0..1
  @location(7) head : vec4f,    // xy = position on the flower head disc in head radii (|xy| < 1 inside the head, far outside on the stem), z = head radius in px
  @location(8) @interpolate(flat) hcode : u32,
  @location(9) keyShade : f32,  // sun (or moon) occlusion by the sward above this point, 0..1 (written to misc.b, read by deferred.wgsl)
};

// Occlusion of the key light at height depth below the sward's top: Beer-Lambert through the blades standing above along the light's
// slant, kept below 1 by a per-blade chance of a gap (some blades catch the sun all the way down, as in a real meadow).
fn swardShade(depth : f32, gap : f32) -> f32 {
  let key = select(frame.sunDir.xyz, frame.moonDir.xyz, frame.misc.w == 1u);
  let tau = SWARD_DENSITY * max(depth, 0.0) / max(key.y, 0.12);
  return (1.0 - exp(-tau)) * (0.55 + 0.45 * gap) * SWARD_OPACITY;
}

// Flower heads are small camera-facing discs on a thin stem: the top rows of the strip are laid out as a polygon on the head plane.
// Head radius in metres by colour code (ox-eye daisy 2.4-4 cm across, buttercup 1.8-3, self-heal or vetch 1.2-2.2, clover 1.6-2.8).
fn headRadius(code : u32, u : f32) -> f32 {
  switch (code) {
    case 1u: { return 0.011 + 0.006 * u; }
    case 2u: { return 0.011 + 0.006 * u; }
    case 3u: { return 0.010 + 0.006 * u; }
    default: { return 0.008 + 0.006 * u; }
  }
}

// Petal colours are muted reflectances (white petals about 0.6, not paper white); \`keep\` 0 cuts the gaps between petals once the head
// is several pixels across, so smaller heads shade as the mean of petals and gaps and do not shimmer.
fn headColour(code : u32, hp : vec2f, pxR : f32, seed : f32) -> vec4f {
  let r = length(hp);
  let a = atan2(hp.y, hp.x) + seed * TAU;
  let detail = smoothstep(2.0, 5.0, pxR);
  var col : vec3f;
  var keep = 1.0;
  switch (code) {
    case 1u: {
      let petal = abs(sin(a * 6.5));
      let eye = 1.0 - smoothstep(0.26, 0.34, r);
      let ray = (0.9 + 0.1 * petal) * (0.72 + 0.28 * smoothstep(0.3, 0.7, r));
      col = mix(vec3f(0.60, 0.585, 0.53) * ray, vec3f(0.44, 0.285, 0.02), eye);
      if (r > 0.4 && petal < 0.16 * detail) { keep = 0.0; }
    }
    case 2u: {
      let eye = 1.0 - smoothstep(0.18, 0.3, r);
      col = mix(vec3f(0.6, 0.48, 0.04) * (0.88 + 0.12 * smoothstep(0.1, 0.9, r)), vec3f(0.5, 0.33, 0.02), eye);
      if (r > 0.86 + 0.14 * cos(5.0 * a) && detail > 0.5) { keep = 0.0; }
    }
    case 3u: {
      // Knapweed: a ball of dark, scaly olive-brown bracts below with a ragged crown of magenta-purple florets bursting from its top.
      let scale = hash21(bitcast<vec2u>(vec2i(floor((hp + vec2f(2.0)) * vec2f(5.0, 4.0)))));
      let bract = vec3f(0.11, 0.10, 0.05) * (0.7 + 0.6 * scale);
      let floret = vec3f(0.33, 0.10, 0.34) * (0.75 + 0.35 * hash21(bitcast<vec2u>(vec2i(floor((hp + vec2f(2.0)) * 7.0)))));
      let crown = smoothstep(-0.25, 0.05, hp.y + 0.12 * sin(a * 7.0));
      col = mix(bract, floret, crown);
      if (hp.y > 0.2 && r > 0.75 + 0.25 * abs(cos(4.5 * a)) && detail > 0.5) { keep = 0.0; }
    }
    default: {
      let floret = hash21(bitcast<vec2u>(vec2i(floor((hp + vec2f(1.0)) * 4.0))));
      col = vec3f(0.42, 0.15, 0.25) * (0.8 + 0.4 * floret) * (0.8 + 0.2 * (1.0 - r));
    }
  }
  return vec4f(col, keep);
}

// Lean, flutter, wash and trample as one tilt vector (radians) plus the wash squash factor.
fn bladeTilt(root : vec3f, h : f32, time : f32, rnd : f32, stiff : f32) -> vec3f {
  let v = windAt(root, time);
  let sp = length(v);
  let dir = v / max(sp, 1.0e-3);
  // A meadow in a 4 m/s breeze stays mostly upright with its tips nodding; laying every blade over turns the sward into combed hair.
  // Each blade gives to the wind a little to one side or the other of it (the gust round it, its own set), not all exactly downwind.
  let across = vec2f(-dir.y, dir.x);
  let lean = (dir + across * (rnd - 0.5) * 0.8) * 0.45 * (1.0 - exp(-sp * (0.04 + 0.1 * h))) * stiff;
  let freq = TAU * 0.8 / pow(0.05 + h, 0.9);
  let phase = freq * time + dot(root.xz, vp.wind.xy) * 0.9 + rnd * 6.0;
  let flutter = (sin(phase) * 0.6 + sin(phase * 2.3 + 1.3) * 0.4) * 0.1 * saturate1(sp / 6.0) * stiff;
  var tilt = lean + (dir + 0.4 * across * sin(phase * 0.7)) * flutter;
  let wash = washAt(root, h, time, rnd);
  tilt += wash.xy + trampleAt(root);
  return vec3f(tilt, wash.z);
}

struct Arc {
  centre : vec3f,
  dir : vec2f,   // bend direction (x, z)
  A : f32,       // sin of the tip tilt
  height : f32,  // blade length after the wash squash
};

// Centre line of the blade at parameter t for the wind state of \`time\`; the previous-frame call only needs \`centre\`.
fn bladeArc(b : Blade, t : f32, dirY : vec2f, curl : f32, time : f32, rnd : f32, stiff : f32) -> Arc {
  let bt = bladeTilt(b.pos, b.height, time, rnd, stiff);
  let H = b.height * (1.0 - 0.35 * bt.z);
  let tilt = dirY * curl + bt.xy;
  let tiltLen = max(length(tilt), 1.0e-4);
  let ang = min(tiltLen, MAX_TILT);
  let dirB = tilt / tiltLen;
  let A = sin(ang);
  let hh = H * t;
  let off = H * A * t * t;
  let y = sqrt(max(hh * hh - off * off, 0.02 * hh * hh));
  var r : Arc;
  r.centre = b.pos + vec3f(dirB.x * off, y, dirB.y * off);
  r.dir = dirB;
  r.A = A;
  r.height = H;
  return r;
}

const NECK : u32 = NSEG / 2u;

@vertex
fn vs(@builtin(vertex_index) vid : u32, @builtin(instance_index) iid : u32) -> VsOut {
  let b = blades[iid];
  let row = vid >> 1u;
  let isTip = HAS_TIP && row == NSEG;
  let sv = select(select(-1.0, 1.0, (vid & 1u) == 1u), 0.0, isTip);
  var t = f32(row) / f32(NSEG);

  let yaw = f32(b.info & 4095u) * (TAU / 4095.0);
  let species = (b.info >> 12u) & 7u;
  let dry = f32((b.info >> 15u) & 255u) / 255.0;
  let rnd = f32(b.info >> 23u) / 511.0;
  let tintCode = unpack4x8unorm(b.tint);
  let code = u32(tintCode.a * 255.0 + 0.5);
  // The farthest LOD draws a flower as a plain stem: its head is far below a pixel there.
  let isFlower = code >= 1u && code <= 4u;
  let hasHead = isFlower && HAS_TIP;
  let isSeed = code == 5u;
  let turf = tintCode.rgb * tintCode.rgb * 0.5;
  let time = frame.camPos.w;

  let r2 = hash11(b.info * 747796405u + b.tint);
  let r3 = hash11((b.info ^ 0x9e3779b9u) * 2246822519u + b.tint * 3266489917u);
  // Leaves of a meadow sward point every way: most arch a little, a few stand straight and some bow far over. Stiffness varies as much, so a
  // breeze bends neighbours by different amounts instead of combing them all one way.
  var curl = 0.1 + 0.9 * pow(r3, 1.6);
  var stiff = 0.55 + 0.9 * fract(r3 * 3.17);
  switch (species) {
    case 1u: { curl = 0.15 + 1.05 * pow(r3, 1.6); }
    case 2u: { curl = 0.5 + 0.55 * rnd; }
    case 3u: { curl = 0.05 + 0.2 * rnd; stiff *= 0.7; }
    case 4u: { curl = 0.7 + 0.5 * rnd; stiff *= 0.5; }
    default: {}
  }
  if (isFlower) { curl *= 0.4; }
  // A stem is stiff and nearly straight, except the odd lodged one bent well over.
  if (isSeed) { curl = select(0.08 + 0.3 * rnd, 0.9 + 0.4 * rnd, rnd > 0.85); }
  let isFern = code == CODE_FERN;
  let isHerb = code == CODE_HERB;
  let isStick = code == CODE_STICK;
  // A frond rises from its crown at 20-40 degrees off vertical and arches outward at its tip (a flatter one is seen edge-on from eye height); a herb's leaves splay; a stick lies flat.
  if (isFern) { curl = 0.3 + 0.4 * rnd; stiff *= 0.9; }
  if (isHerb) { curl = 0.35 + 0.45 * rnd; }
  if (isStick) { curl = 0.0; stiff = 0.0; }
  // A flower's stem ends at the neck row; every row above it belongs to the head.
  let headRow = hasHead && row > NECK;
  if (hasHead) { t = f32(min(row, NECK)) / max(f32(NECK), 1.0); }

  let dirY = vec2f(cos(yaw), sin(yaw));
  let arc = bladeArc(b, t, dirY, curl, time, rnd, stiff);
  let A = arc.A;
  let dirB = arc.dir;
  let centre = arc.centre;
  let prevCentre = bladeArc(b, t, dirY, curl, time - frame.params.x, rnd, stiff).centre;

  let slope = (1.0 - 2.0 * A * A * t * t) / sqrt(max(1.0 - A * A * t * t, 0.01));
  let tang = normalize(vec3f(dirB.x * 2.0 * A * t, slope, dirB.y * 2.0 * A * t));
  let side0 = vec3f(-dirY.y, 0.0, dirY.x);
  var sideB = vec3f(-dirB.y, 0.0, dirB.x);
  if (dot(sideB, side0) < 0.0) { sideB = -sideB; }
  var side = normalize(mix(side0, sideB, smoothstep(0.0, 0.8, t)));
  // A grass leaf twists along its length (up to a quarter turn either way), so it shows its face at one height and its edge at another
  // and catches the light in bands. Some leaves are folded along the midrib (a V in section): narrower, with a sharp crease in the light.
  let leaf = !isFlower && !isSeed && species <= 3u;
  let twist = select(0.0, (fract(r3 * 11.3) - 0.5) * 3.2 * t, leaf);
  side = side * cos(twist) + cross(tang, side) * sin(twist);
  let folded = leaf && fract(r3 * 5.71) > 0.6;
  let nb = normalize(cross(side, tang));

  var wf = 1.0 - 0.85 * t * t;
  if (folded) { wf *= 0.6; }
  if (species == 4u) { wf = max(0.12, 6.75 * t * (1.0 - t) * (1.0 - t)); }
  // A frond: a bare stipe for its lowest fifth, then a lance of pinnae widest a third of the way up, tapering to a point.
  if (isFern) { wf = smoothstep(0.16, 0.28, t) * 2.6 * sqrt(t) * (1.0 - t); }
  if (isStick) { wf = 1.0 - 0.45 * t; }
  if (isFlower) { wf = 0.3; }
  // A seed head is a spike or closed panicle over the top fifth of the culm, several times the culm's width: widest just above its base, tapering
  // to the tip.
  if (isSeed) { wf = mix(1.0 - 0.3 * t, 4.5 * (1.0 - smoothstep(0.88, 1.0, t)) + 0.6, smoothstep(0.74, 0.84, t)); }
  if (isTip) { wf = 0.0; }

  let toCam = frame.camPos.xyz - centre;
  let vdir = normalize(toCam);
  let vr = normalize(cross(vdir, vec3f(0.0, 1.0, 0.0)) + vec3f(1.0e-5, 0.0, 0.0));
  let clip0 = frame.viewProj * vec4f(centre, 1.0);
  let pxPerM = frame.screen.y * 0.5 * frame.proj[1][1] / max(clip0.w, 0.05);
  let trueHw = b.halfWidth * wf;
  // A blade seen edge-on is held at a minimum apparent width so a thin far blade does not vanish and flicker; a near blade several pixels
  // wide may turn its edge to the camera, as real leaves do.
  let c = dot(side, vr);
  let minFacing = mix(0.55, 0.12, smoothstep(2.0, 8.0, trueHw * pxPerM));
  let sideEff = side + vr * (select(-1.0, 1.0, c >= 0.0) * max(abs(c), minFacing) - c);
  let hw = max(trueHw, select(MIN_HALF_PX / pxPerM, 0.0, isTip));
  var world = centre + sideEff * (sv * hw);
  // A stick lies along the ground in its yaw direction, a centimetre or two proud with a slight bow, drawn as a ribbon turned to the camera
  // round its own axis (a round stick looks the same from every side).
  if (isStick) {
    let axis = vec3f(dirY.x, 0.0, dirY.y);
    let along = b.pos + axis * (b.height * t) + vec3f(0.0, 0.012 + 0.012 * sin(PI * t), 0.0);
    let toCamS = normalize(frame.camPos.xyz - along);
    world = along + normalize(cross(axis, toCamS) + vec3f(0.0, 1.0e-4, 0.0)) * (sv * hw);
  }
  var cover = select(1.0, saturate1(trueHw / hw), !isTip);
  // A blade narrower than the one-pixel floor is kept whole with the chance of its true coverage at its base (the same choice for all of
  // its vertices, stable from frame to frame) and drawn solid; the rest are dropped. Dithering every pixel of every thin blade instead left a
  // per-pixel noise that TAA could only smear into a brushed carpet. Flower stems are never dropped: they are counted per square metre.
  let rootPx = frame.screen.y * 0.5 * frame.proj[1][1] / max((frame.viewProj * vec4f(b.pos, 1.0)).w, 0.05);
  let bladeCover = saturate1(b.halfWidth * rootPx / MIN_HALF_PX);
  let dropped = !isFlower && hash11(b.info * 2654435761u + b.tint * 40503u) >= bladeCover;
  cover = select(cover, min(1.0, cover / max(bladeCover, 1e-3)), !isFlower);
  var thinPx = trueHw * pxPerM;
  var headPos = vec2f(0.0, -9.0);
  var headPx = 0.0;
  var headN = nb + side * (select(0.45, 1.1, folded) * sv);

  if (hasHead && row >= NECK) {
    // Knapweed and clover heads are balls: a ball looks the same from every side, so it is drawn as a disc facing the camera and shaded
    // with the normals of a sphere. Daisies and buttercups are flat or cupped: they face up and a little toward the sun (heliotropic
    // tilt, own random lean), whatever the camera does, and are seen foreshortened from low down, as in a photograph.
    let globe = code == 3u || code == 4u;
    let sunH = vec3f(frame.sunDir.x, 0.0, frame.sunDir.z);
    let lean = vec3f(cos(rnd * TAU), 0.0, sin(rnd * TAU)) * 0.5;
    let nFlat = normalize(vec3f(0.0, 1.0, 0.0) + 0.7 * sunH + lean);
    let nH = select(nFlat, vdir, globe);
    var ha = normalize(cross(nH, vr));
    if (globe && ha.y < 0.0) { ha = -ha; }
    let sideH = normalize(cross(ha, nH));
    let R = headRadius(code, r2);
    let Rpx = R * pxPerM;
    // A head under half a pixel across is drawn at the floor on \`cover\` of its pixels, so its area stays the real one.
    let Rd = max(R, 0.5 / pxPerM);
    headN = nH;
    headPx = Rpx;
    thinPx = Rpx;
    if (headRow) {
      let L = NSEG - NECK;
      let s = -1.0 + 2.0 * f32(row - NECK) / f32(L);
      let w = sqrt(max(1.0 - s * s, 0.0));
      let x = sv * w;
      // A ball sits on its stem; a flat head is centred on the stem tip, a few millimetres above it.
      world = select(centre + vec3f(0.0, 0.003, 0.0) + ha * (Rd * s) + sideH * (Rd * x), centre + ha * (Rd * (1.0 + s)) + vr * (Rd * x), globe);
      headPos = vec2f(x, s);
      cover = sq(R / Rd);
      // Normals across the head: a sphere for a ball, a shallow cup (rim tilted inward) for a buttercup, a slight dome for a daisy.
      let rim = select(sideH, vr, globe) * x + ha * s;
      let bulge = select(select(0.3, -0.45, code == 2u), 1.0, globe);
      headN = normalize(nH * sqrt(max(1.0 - x * x - s * s, 0.05)) + rim * bulge);
    } else {
      headPos = vec2f(sv * 0.08, -0.98);
    }
  }

  // Patch colour (turf, already bleached where the ground is dry) times per-blade variation: luminance, a blue-green to yellow-green
  // hue pick and dead straw blades or dead tips, a little darker at the root and lighter and yellower at the tip.
  // Variation that is random per blade averages out below a pixel and then only shimmers, so it fades to the sward mean as blades thin;
  // the world-space clump tone below is correlated between neighbouring blades, survives the distance and is stable under TAA.
  let thinV = 1.0 - smoothstep(0.3 * THIN_PX, 1.6 * THIN_PX, trueHw * pxPerM);
  // Fully calm once a blade is well under a pixel: a far sward in photographs is an even tone (local contrast about half the near one).
  let calm = thinV;
  let gt = pow(t, 0.8);
  var base = turf * mix(0.72 + 0.56 * rnd, 1.0, calm);
  base *= mix(mix(vec3f(0.9, 1.03, 0.94), vec3f(1.15, 1.06, 0.72), smoothstep(0.62, 1.0, r2)), vec3f(1.0), calm);
  if (species == 3u) { base *= vec3f(0.9, 1.0, 0.9); }
  if (species == 4u) { base *= vec3f(0.82, 1.0, 0.78); }
  // The tuft tone is filtered by the blade's pixel size like the turf's, so a far sward does not keep a 45 cm mottle the eye cannot resolve.
  base *= grassClumpTone(b.pos.xz, 1.0 / pxPerM);
  // A little darker toward the root and only a little lighter and warmer at the tip (a strongly yellowed tip turns a lit meadow lime).
  // The sward's own shade is not in this albedo: keyShade takes the sun the blades above stop and the cavity the sky they hide.
  var col = base * mix(mix(0.6, 1.15, gt), 0.9, 0.5 * thinV) * mix(vec3f(0.97, 1.0, 0.95), vec3f(1.03, 1.02, 0.88), gt);
  var strawMix = 0.45 * smoothstep(0.6, 1.0, t) * smoothstep(0.3, 0.9, fract(r2 * 9.7));
  // Last year's dead leaves stand among the green ones in any uncut sward.
  if (r2 < 0.08 + 0.28 * dry) { strawMix = 0.8; }
  strawMix = mix(strawMix, 0.12 + 0.3 * dry, calm);
  col = mix(col, STRAW * (0.5 + 0.55 * rnd) * mix(vec3f(0.85, 0.88, 0.95), vec3f(1.05, 1.0, 0.92), fract(r2 * 5.3)) * mix(0.5, 1.0, gt), strawMix);
  // Heads ripen from the sward's own green through olive to straw: fresh ones are hardly lighter than the leaves round them.
  // The culm below a ripening head dries first, from straw-green to pale straw.
  if (isSeed) {
    let ripe = saturate1(0.25 + 0.5 * fract(r2 * 2.9) + 0.4 * dry);
    col = mix(col, STRAW * 1.3 * mix(0.6, 1.0, gt), 0.6 * ripe * smoothstep(0.2, 0.6, t));
    if (t > 0.76) { col = mix(base * vec3f(0.95, 0.9, 0.7), SEED_HEAD, 0.3 + 0.65 * ripe) * (0.85 + 0.3 * rnd); }
  }

  // Understorey colours replace the sward's: per plant brightness, some fronds dying back, mossy or pale sticks.
  if (isFern) {
    col = select(FERN, FERN_DEAD, fract(r2 * 7.3) > 0.88) * (0.75 + 0.5 * rnd) * mix(0.75, 1.1, gt);
  } else if (isHerb) {
    col = HERB * (0.7 + 0.6 * rnd) * mix(0.8, 1.05, gt);
  } else if (isStick) {
    col = mix(BARK * (0.65 + 0.7 * rnd), vec3f(0.05, 0.075, 0.025), 0.6 * step(0.75, fract(r2 * 3.1)));
  }

  let tn2 = unpack2x16snorm(b.nrm);
  let tn = vec3f(tn2.x, sqrt(max(1.0 - dot(tn2, tn2), 0.0)), tn2.y);

  var o : VsOut;
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.world = world;
  o.nrm = normalize(headN);
  o.terrainNrm = tn;
  o.albedo = col;
  // Cavity: the lower blade sits deep in the sward and sees little sky; photographs of a meadow are dark between the stems.
  o.shade = vec2f(mix(0.3, 1.0, saturate1(t * 1.6)), mix(0.64, 0.5, gt));
  o.motion = motionVectorPrev(world, world + (prevCentre - centre));
  o.cover = vec2f(cover, 1.0 - smoothstep(0.3 * THIN_PX, THIN_PX, thinPx));
  // A dropped blade collapses to a point outside the clip volume, so it rasterises nothing.
  if (dropped) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); }
  o.head = vec4f(headPos, headPx, 0.0);
  o.hcode = select(0u, code, hasHead);
  // Fern and herb leaves are matt (a hairy or waxless shade leaf); the sward's sheen made the wide ones read as plastic.
  if (isFern || isHerb) { o.shade.y = 0.85; }
  if (isFern) {
    // The gaps between pinnae are cut only where one pinna spans several pixels; smaller, the frond shades as their mean.
    o.head = vec4f(sv, t, b.height * pxPerM / FERN_PINNAE, 0.0);
    o.hcode = CODE_FERN;
  }
  if (isStick) {
    o.hcode = CODE_STICK;
    o.nrm = vec3f(0.0, 1.0, 0.0);
    o.shade = vec2f(0.75, 0.8);
  }
  // The blade's own height stands in for the local sward's: what is above this point on the blade is the sward above it. Heads sit on top.
  // Thin, far blades take less: a distant sward is seen over its sunlit tops, but still through gaps into its shaded depth (photographs of
  // a sunlit meadow at 50-100 m are no brighter than one at 10 m).
  var depthInSward = select(b.height * (1.0 - t) * 0.9, 0.0, hasHead && row >= NECK);
  // Fronds and herbs stand over bare litter, not in a sward: only their own leaves above shade them.
  if (code >= CODE_FERN) { depthInSward = select(0.2 * b.height * (1.0 - t), 0.0, isStick); }
  o.keyShade = swardShade(depthInSward, fract(r2 * 13.7)) * mix(1.0, 0.6, thinV);
  return o;
}

// Blue-noise threshold, rotated every frame (golden ratio) when TAA is on so the history converges on the true coverage.
fn coverThreshold(px : vec2u, seed : f32) -> f32 {
  var t = textureLoad(blueNoise, vec2i(px & vec2u(127u)), 0).x + seed;
  if ((frame.misc.y & 4u) != 0u) { t += f32(frame.misc.x & 255u) * 0.6180339887; }
  return fract(t);
}

@fragment
fn fs(in : VsOut) -> FsOut {
  // A blade narrower than the one-pixel floor is drawn at the floor but only on \`cover\` of its pixels, so the coverage stays the real one.
  if (in.cover.x < 1.0 && coverThreshold(vec2u(in.pos.xy), hash21(bitcast<vec2u>(vec2i(in.world.xz * 64.0)))) >= in.cover.x) { discard; }
  let toCam = frame.camPos.xyz - in.world;
  var n = normalize(in.nrm);
  if (dot(n, toCam) < 0.0) { n = -n; }
  let thin = in.cover.y;
  var albedo = in.albedo;
  var tr = TRANSLUCENCY * (1.0 - 0.3 * thin);
  var cavity = in.shade.x;
  var rough0 = in.shade.y;
  // Wide, near blades keep more of their own facing (each catches the sun its own way); thin ones lean on the ground normal.
  var pull = mix(0.35, 0.9, thin);
  if (in.hcode == CODE_FERN) {
    // Pinnae: paired leaflets angled toward the tip off a thin rachis, each narrowing to its own point.
    let across = abs(in.head.x);
    let ph = fract(in.head.y * FERN_PINNAE - 0.8 * across);
    let detail = smoothstep(4.0, 8.0, in.head.z);
    if (across > 0.08 && ph > 0.82 - 0.3 * across && detail > 0.5) { discard; }
    tr = 0.25;
    pull = mix(0.1, 0.9, thin);
  } else if (in.hcode == CODE_STICK) {
    tr = 0.0;
    pull = 0.5;
  } else if (in.hcode != 0u && length(in.head.xy) < 1.0) {
    let h = headColour(in.hcode, in.head.xy, in.head.z, f32(in.hcode) * 0.37);
    if (h.w < 0.5) { discard; }
    albedo = h.rgb;
    tr = 0.3 * (1.0 - 0.3 * thin);
    cavity = 1.0;
    // Buttercup petals are glossy (a waxy layer over a starch mirror); the rest are matt.
    rough0 = select(0.6, 0.3, in.hcode == 2u);
    pull = mix(0.05, 0.9, thin);
  }
  n = normalize(mix(n, normalize(in.terrainNrm), pull));
  let nv = saturate1(dot(n, normalize(toCam)));
  // Wider lobe at grazing view and for thin blades: a sunlit or sky-lit mirror reflection off random blade normals is what glitters.
  let graze = sq(1.0 - nv);
  let rough = mix(rough0, GRAZE_ROUGH, max(graze, thin));
  var o : FsOut;
  o.albedo = vec4f(albedo, cavity);
  o.normal = vec4f(octEncode(n), rough, 0.0);
  o.misc = vec4f(GRASS_ID / 255.0, tr, in.keyShade, 0.0);
  o.motion = in.motion;
  return o;
}
`,"./shaders/vegetation/grass_blade.wgsl":`// Per-blade instance record: written by grass_cull.wgsl, read by grass.wgsl.
struct Blade {
  pos : vec3f,
  height : f32,
  halfWidth : f32,
  nrm : u32,    // pack2x16snorm(terrain normal x, z)
  tint : u32,   // pack4x8unorm(sqrt(2 * turf albedo).rgb, head code / 255)
  info : u32,   // yaw 12 bits | species 3 | dryness 8 | random 9
};
`,"./shaders/vegetation/grass_cull.wgsl":`// Grass generation, all on the GPU with no readback. Two dispatches:
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
// an obstacle; herbs follow the green patches of the floor (terrainMaterialWeights); sticks lie everywhere under the crowns. \`forest\` is
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
  // Distance thinning keeps only a share \`keep\` of the blades (each drawn wider for the grass it stands for); flowers are counted per
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
`,"./shaders/vegetation/grass_finalize.wgsl":`// Single-thread kernels that turn the culling counters into indirect arguments, so nothing is ever read back to the CPU.
#include "vegetation/veg_params.wgsl"

// 0 chunk count, 1..3 instances per LOD, 4 visible patches
@group(2) @binding(1) var<storage, read_write> counters : array<u32, 8>;
@group(2) @binding(2) var<storage, read_write> dispatchArgs : array<u32, 4>;
@group(2) @binding(3) var<storage, read_write> drawArgs : array<u32, 12>;

const DISPATCH_ROW : u32 = 4096u;

// Strip vertex counts of the three blade LODs: 2 * (segments + 1) minus one when the last row collapses to a tip vertex.
const LOD_VERTICES = array<u32, 3>(15u, 7u, 4u);

@compute @workgroup_size(1)
fn fin_dispatch() {
  let n = min(counters[0], vp.caps.w);
  dispatchArgs[0] = min(n, DISPATCH_ROW);
  dispatchArgs[1] = (n + DISPATCH_ROW - 1u) / DISPATCH_ROW;
  dispatchArgs[2] = 1u;
}

@compute @workgroup_size(1)
fn fin_draw() {
  for (var lod = 0u; lod < 3u; lod++) {
    drawArgs[lod * 4u] = LOD_VERTICES[lod];
    drawArgs[lod * 4u + 1u] = min(counters[1u + lod], vp.caps[lod]);
    drawArgs[lod * 4u + 2u] = 0u;
    drawArgs[lod * 4u + 3u] = 0u;
  }
}
`,"./shaders/vegetation/rock.wgsl":`// Rocks and boulders: the tree draw layout and instance path with a static vertex shader (the instance is tilted toward the terrain normal,
// scaled by its radius and yawed) and a procedural weathered-stone material in the fragment shader: the regional bedrock colour (the
// same field the outcrops use, so a boulder matches the face it fell from), fracture grooves, crystalline grain, crustose lichen, moss on
// the tops and a soil-stained, shadowed foot where the stone meets the ground, so it reads as bedded in rather than set down.
#include "vegetation/veg_params.wgsl"
#include "vegetation/veg_instance.wgsl"
#include "terrain/gbuffer.wgsl"
#include "terrain/ground_color.wgsl"

@group(2) @binding(1) var<storage, read> instances : array<Instance>;
@group(2) @binding(2) var<storage, read> visible : array<u32>;
@group(2) @binding(3) var<storage, read> variants : array<Variant>;

const ROCK_ID : f32 = 6.0;
const ROCK_ROUGHNESS : f32 = 0.85;
// Share of the terrain tilt a rock follows: half-buried boulders sit on slopes without lying flat against them.
const TILT : f32 = 0.65;
// Relief of the grain in metres (it tilts the normal by its slope across the surface).
const BUMP : f32 = 0.05;
const MOSS : vec3f = vec3f(0.050, 0.080, 0.026);
const LICHEN_GREY : vec3f = vec3f(0.30, 0.32, 0.26);
const LICHEN_ORANGE : vec3f = vec3f(0.30, 0.18, 0.07);
const FOOT_SOIL : vec3f = vec3f(0.085, 0.068, 0.052);

struct VsIn {
  @builtin(instance_index) iid : u32,
  @location(0) pos : vec3f,
  @location(1) oct : vec2f,
  @location(2) uv : vec2f,
  @location(3) attr : vec4f,   // x = ambient occlusion
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) world : vec3f,
  @location(1) nrm : vec3f,
  @location(2) local : vec3f,
  @location(3) @interpolate(flat) ids : vec2u,   // x = variant, y = tint
  @location(4) ao : f32,
  @location(5) motion : vec2f,
  @location(6) @interpolate(flat) radius : f32,
};

// Rotation that takes +Y onto t (Rodrigues form with axis Y x t), applied to p.
fn tiltUp(p : vec3f, t : vec3f) -> vec3f {
  let k = vec3f(t.z, 0.0, -t.x);
  return p + cross(k, p) + cross(k, cross(k, p)) / (1.0 + t.y);
}

@vertex
fn vs(in : VsIn) -> VsOut {
  let inst = instances[visible[in.iid]];
  let tn2 = unpack2x16snorm(inst.nrm);
  let tn = vec3f(tn2.x, sqrt(max(1.0 - dot(tn2, tn2), 0.0)), tn2.y);
  let t = normalize(mix(vec3f(0.0, 1.0, 0.0), tn, TILT));
  let world = inst.pos + tiltUp(yawRotate(in.pos, inst.yaw), t) * inst.scale;

  var o : VsOut;
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.world = world;
  o.nrm = tiltUp(yawRotate(octDecode(in.oct), inst.yaw), t);
  o.local = in.pos * inst.scale;
  o.ids = vec2u(inst.variant, inst.tint);
  o.ao = in.attr.x;
  o.motion = motionVector(world);
  o.radius = inst.scale;
  return o;
}

fn vnoise3(p : vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let b = bitcast<vec3u>(vec3i(i));
  let x00 = mix(hash31(b), hash31(b + vec3u(1u, 0u, 0u)), u.x);
  let x10 = mix(hash31(b + vec3u(0u, 1u, 0u)), hash31(b + vec3u(1u, 1u, 0u)), u.x);
  let x01 = mix(hash31(b + vec3u(0u, 0u, 1u)), hash31(b + vec3u(1u, 0u, 1u)), u.x);
  let x11 = mix(hash31(b + vec3u(0u, 1u, 1u)), hash31(b + vec3u(1u, 1u, 1u)), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

fn rockGrain(p : vec3f) -> f32 {
  return 0.6 * vnoise3(p * 5.0) + 0.3 * vnoise3(p * 13.0 + 3.7) + 0.1 * vnoise3(p * 31.0 + 9.1);
}

// Fracture grooves: thin valleys where a stretched 3D noise crosses its mid value, fading in and out along their length.
fn rockFracture(p : vec3f) -> f32 {
  let a = 1.0 - smoothstep(0.0, 0.035, abs(vnoise3(p * vec3f(1.1, 3.2, 1.1) + 7.0) - 0.5));
  let b = 1.0 - smoothstep(0.0, 0.03, abs(vnoise3(p * vec3f(3.0, 1.2, 2.6) + 19.0) - 0.5));
  return max(a * smoothstep(0.45, 0.65, vnoise3(p * 0.9 + 3.0)), b * smoothstep(0.5, 0.7, vnoise3(p * 1.1 + 11.0)));
}

@fragment
fn fs(in : VsOut) -> FsOut {
  let tint = unpack4x8unorm(in.ids.y).rgb * 2.0;
  let lp = in.local;
  let warp = vnoise3(lp * 1.7 + 11.0);
  let strata = 0.5 + 0.5 * sin(lp.y * 9.0 + 3.0 * warp + lp.x * 1.3);
  let grain = rockGrain(lp);
  let crystals = vnoise3(lp * 90.0);
  let fracture = rockFracture(lp);
  let stain = smoothstep(0.58, 0.85, vnoise3(lp * 2.3 + 5.0));
  // Bedrock of the district, the stone's own tone, banding, grain and salt-and-pepper crystals.
  // Weathered, lichen-dulled stone sits below the bare outcrop's albedo.
  var col = 0.75 * glBaseColor(GL_ROCK) * bedrockTone(in.world.xz) * tint * (0.82 + 0.3 * strata) * (0.8 + 0.4 * grain) * (0.88 + 0.24 * crystals);
  col = mix(col, col * vec3f(1.25, 0.98, 0.72), 0.45 * stain);
  col *= 1.0 - 0.55 * fracture;

  // Bump from one evaluation: the relief height in metres, differentiated across the pixel quad (surface-gradient bump mapping).
  var n = normalize(in.nrm);
  let relief = BUMP * grain - 0.012 * fracture;
  let dpx = dpdx(in.world);
  let dpy = dpdy(in.world);
  let r1 = cross(dpy, n);
  let r2 = cross(n, dpx);
  let det = dot(dpx, r1);
  let surfGrad = sign(det) * (dpdx(relief) * r1 + dpdy(relief) * r2);
  n = normalize(abs(det) * n - surfGrad);

  // Height of this point above the ground under it: the foot is stained with soil, damp and in the stone's own shadow.
  let above = in.world.y - terrainHeightAt(in.world.xz);
  let footN = vnoise3(lp * 6.0 + 2.0);
  let foot = 1.0 - smoothstep(0.02, 0.10 + 0.12 * footN + 0.05 * in.radius, above);
  let footAo = mix(0.55, 1.0, smoothstep(0.0, 0.25 + 0.2 * in.radius, above));

  // Crustose lichen rosettes on exposed faces (pale grey-green, the odd orange one) and moss cushions on the tops and the shaded foot.
  // Rosettes a few centimetres across with ragged, lobed rims (a fine noise eats into the edge) and only a modest contrast with the stone.
  let lcell = vnoise3(lp * 16.0 + 31.0) + 0.18 * (vnoise3(lp * 55.0 + 7.0) - 0.5);
  let lichen = smoothstep(0.62, 0.74, lcell) * smoothstep(0.4, 0.65, vnoise3(lp * 1.5 + 17.0)) * (1.0 - foot);
  let lichenCol = select(LICHEN_GREY, LICHEN_ORANGE, vnoise3(lp * 0.8 + 51.0) > 0.8) * (0.8 + 0.4 * grain);
  col = mix(col, lichenCol, 0.55 * lichen);
  let mossTop = smoothstep(0.55, 0.9, n.y) * smoothstep(0.4, 0.65, vnoise3(lp * 3.1 + 2.0)) * smoothstep(0.0, 0.25, lp.y);
  let mossFoot = foot * smoothstep(0.45, 0.7, vnoise3(lp * 4.0 + 9.0)) * 0.7;
  let moss = max(mossTop, mossFoot);
  col = mix(col, MOSS * (0.7 + 0.6 * grain), 0.75 * moss);
  col = mix(col, FOOT_SOIL * (0.8 + 0.4 * footN), 0.7 * foot * (1.0 - moss));

  var o : FsOut;
  o.albedo = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), saturate1(in.ao * footAo * (0.75 + 0.25 * grain) * (1.0 - 0.4 * fracture)));
  o.normal = vec4f(octEncode(n), mix(mix(ROCK_ROUGHNESS, 0.92, lichen), 0.95, moss), 0.0);
  o.misc = vec4f(ROCK_ID / 255.0, 0.0, 0.35 * foot, 0.0);
  o.motion = in.motion;
  return o;
}
`,"./shaders/vegetation/tree.wgsl":`// Trees and bushes: one indirect instanced draw per (variant, LOD). The vertex shader fetches the instance through the visible list built
// by tree_cull.wgsl and animates trunk sway, branch and leaf flutter and prop wash (and reports last frame's position for TAA motion vectors);
// the fragment shader alpha-tests leaf cards against the procedural atlas, rounds their normals into the crown, and shades bark procedurally.
// Plants in a LOD hand-over band are dithered against the neighbouring LOD. Vertex kind bytes are mirrored in meshBuilder.ts (KIND).
// The bark's relief normal takes screen derivatives of its height inside the bark branch; a 2x2 pixel quad straddling bark and a leaf card is
// rare and only costs one pixel's bump, so the uniformity check on derivatives is switched off for this module.
diagnostic(off, derivative_uniformity);
#include "vegetation/veg_params.wgsl"
#include "vegetation/veg_wind.wgsl"
#include "vegetation/veg_instance.wgsl"
#include "vegetation/tree_bark.wgsl"
#include "terrain/gbuffer.wgsl"

@group(2) @binding(1) var<storage, read> instances : array<Instance>;
@group(2) @binding(2) var<storage, read> visible : array<u32>;
@group(2) @binding(3) var<storage, read> variants : array<Variant>;
@group(2) @binding(4) var atlas : texture_2d<f32>;
@group(2) @binding(5) var atlasData : texture_2d<f32>;
@group(2) @binding(7) var leafSampler : sampler;
// One bit per instance slot: the tree has GI proxies (vegetation/index.ts publishProxied).
@group(2) @binding(11) var<storage, read> proxied : array<u32>;

// Share of the crown-scale occlusion the bake keeps (treeGen.ts CROWN_AO_SHARE): the GI rays against a tree's canopy proxies supply the rest.
const CROWN_AO_SHARE : f32 = 0.3;

// Depth (m) at which a leaf starts and finishes taking its crown's whole occlusion (crownAo): the outer shell is open to the sky whatever lies
// behind it.
const CROWN_SHELL_OUT : f32 = 1.0;
const CROWN_SHELL_IN : f32 = 2.0;

// The crown occlusion a vertex's baked \`ao\` stands for on this tree. A tree with GI proxies takes it as baked. One without (beyond the
// proxy set, nothing for the GI rays from its leaves to hit) takes the whole crown term the bake scaled down, ao = 1 - share * (1 - full),
// once the point lies more than CROWN_SHELL_IN metres inside its crown, and keeps the bake on the outer CROWN_SHELL_OUT metres: those
// leaves, sunlit or backlit, are not shaded by their own crown. \`local\` is the point in the tree's frame at scale 1. The far LOD's cards
// keep the bake as it is, to match the far-field canopy (veg_far.wgsl).
fn crownAo(baked : f32, slot : u32, v : Variant, local : vec3f, scale : f32, leaf : bool) -> f32 {
  if (LOD >= 2u || (proxied[slot >> 5u] & (1u << (slot & 31u))) != 0u) { return baked; }
  let r = max(v.crown.yzw, vec3f(0.1));
  // Bark, under the crown or inside it, is shaded by the leaves above whatever its depth: only the bake decides there.
  let depth = select(CROWN_SHELL_IN, (1.0 - length((local - vec3f(0.0, v.crown.x, 0.0)) / r)) * min(r.x, min(r.y, r.z)) * scale, leaf);
  // The plan's crown is a padded ellipsoid round a lumpy crown, so depth alone puts some outer leaves deep inside it: the bake (high on an
  // exposed leaf) has to agree that the leaf is shaded.
  return mix(baked, saturate1(1.0 - (1.0 - baked) / CROWN_AO_SHARE), smoothstep(CROWN_SHELL_OUT, CROWN_SHELL_IN, depth) * smoothstep(0.92, 0.84, baked));
}

override LOD : u32 = 0u;

const FOLIAGE_ID : f32 = 5.0;
const ALPHA_CUT : f32 = 0.5;
// Cosine of the view angle to a leaf card below which its coverage thins out (fully gone at EDGE_ON_LO, untouched from EDGE_ON_HI).
const EDGE_ON_LO : f32 = 0.15;
const EDGE_ON_HI : f32 = 0.55;
// The same for needle sprays, which are brushes of needles all round their shoots, a few centimetres deep: seen edge-on a spray is still a band of
// needles, so it thins only at truly grazing angles (with the broadleaf range a level spray seen from eye height lost most of its needles).
const NEEDLE_EDGE_ON : vec2f = vec2f(0.04, 0.2);
const CLASS_FIRST_LEAF : u32 = 4u;
const CLASS_NEEDLE : u32 = 5u;
const CLASS_BLOB : u32 = 6u;
const CLASS_CONE : u32 = 7u;
const BARK_ROUGHNESS : f32 = 0.95;
// Bark relief is bump-mapped while a pixel spans less than this (m); beyond it the shader keeps the averaged colour and the smooth normal.
const BARK_BUMP_FOOTPRINT : f32 = 0.02;
// The waxy upper face of a broadleaf (oak, birch, beech) has a cuticle with a sheen: a leaf turned toward the sun shows a pale glint, which is
// much of what makes a sunlit crown sparkle. Smoother than this, the sky's reflection washes whole cards grey-white (F0 0.04 against an albedo
// of 0.1), so the lobe stays broad. Undersides are hairy and matte; a needle spray, a mid-distance cluster card and a billboard each stand for
// leaves at every angle, which averages to a fully rough surface.
const LEAF_ROUGHNESS : f32 = 0.75;
const LEAF_BACK_ROUGHNESS : f32 = 1.0;
const NEEDLE_ROUGHNESS : f32 = 1.0;
const BLOB_ROUGHNESS : f32 = 0.95;
const CONE_ROUGHNESS : f32 = 1.0;
// The underside of a leaf has no palisade layer under its skin: it reflects about a fifth more and is a little greyer (less chlorophyll, more hairs).
const LEAF_BACK_LIGHTEN : f32 = 1.15;
const LEAF_BACK_GREY : f32 = 0.0;
// The atlas stores the colour multiplier divided by this (COLOUR_RANGE in leafAtlas.ts).
const COLOUR_RANGE : f32 = 3.0;
// How far the painted per-leaf tilt bends the crown normal.
const LEAF_TILT : f32 = 0.9;
// How far wind turns the leaves of a card about their stalks (normal tilt per unit of the calm-scaled wind), so their sheen and translucency flicker.
const LEAF_FLICKER : f32 = 0.45;
// A thin leaf lamina passes about 0.8 of what it reflects, and common/pbr.wgsl already applies that 0.8 to the translucency written here, so a lamina
// texel (atlas translucency 1) of a broadleaf variant ends up at 1. The yellow-green colour of the light a leaf passes is applied by the lighting.
const LEAF_TRANSMIT : f32 = 2.2;
// The lowest ambient factor of a leaf deep in a crown: sky light scattered and transmitted by the neighbouring leaves keeps shade foliage coloured, never
// black. Photographs of oak, beech and birch crowns show the interior at a third or less of the outer leaves' brightness, so the floor is low.
const LEAF_AO_FLOOR : f32 = 0.3;
// Sunflecks (see their use): extinction (1/m) of the sun through a crown's leaves, and the soft edge of a shoot's lit/shaded draw. A real
// crown's is about 0.3 (leaf area density 0.6 m2/m3, projected share 0.5), but the canopy shadow map already darkens a crown by its mean
// (shadow.wgsl), so at 0.3 the crown's median fell by a third of a stop; half of it splits the light into flecks with less of that loss.
const LEAF_SELF_EXTINCTION : f32 = 0.15;
const LEAF_FLECK_EDGE : f32 = 0.08;
const BLOB_AO_FLOOR : f32 = 0.7;
const NEEDLE_SHADE : vec3f = vec3f(0.55, 0.6, 0.4);
const BARK_AO_FLOOR : f32 = 0.4;
// Leaf flutter frequency (Hz), and the wave vectors (radians per metre) of its two ripples through the crown: a ripple about a metre long, so
// neighbouring leaves move nearly together and its slope stays small.
const LEAF_FLAP_HZ : f32 = 2.6;
const FLUTTER_K1 : vec3f = vec3f(0.78, 0.58, 0.92);
const FLUTTER_K2 : vec3f = vec3f(-1.05, 0.48, 0.65);
// A leaf's own twist on its stalk: the most its tip moves (m per unit of tree scale) and how often (Hz). Each leaf at its own phase.
const PETIOLE_TWIST : f32 = 0.0015;
const PETIOLE_HZ : f32 = 3.3;
// Outer branches bob this many metres per m/s of wind (2 to 3 cm in a 4 m/s breeze, twice that in its gusts), on top of the whole crown's lean.
const BRANCH_SWAY : f32 = 0.006;
// Wave vector (radians per metre) of the branch sway across the crown: limbs several metres apart swing out of step, while across one shoot card
// it barely bends, so cards that are apart at rest stay apart.
const BRANCH_WAVE : vec3f = vec3f(0.45, 0.28, 0.65);
// Colour variation inside a crown: patches about a branch across (m) differ in brightness and hue, so a crown is never one flat green.
const BRANCH_PATCH : f32 = 0.7;
// Far-LOD canopy cards only show their sunlit faces, so they are painted a little darker to match the average of the full-detail crown.
const BLOB_DARKEN : f32 = 0.78;

struct VsIn {
  @builtin(instance_index) iid : u32,
  @location(0) pos : vec3f,
  @location(1) oct : vec2f,
  @location(2) uv : vec2f,
  @location(3) attr : vec4f,   // x = ambient occlusion, y = sway weight, z = kind / 255, w = phase
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) world : vec3f,
  @location(1) nrm : vec3f,
  @location(2) uv : vec2f,
  @location(3) @interpolate(flat) ids : vec4u,    // x = variant, y = tint, z = kind, w = instance slot
  @location(4) shade : vec3f,                      // x = ambient occlusion, y = mesh height (m), z = branch phase
  @location(5) motion : vec2f,
  @location(6) local : vec3f,                      // mesh-space position
  @location(7) @interpolate(flat) band : vec2f,    // dither interval [lo, hi) in which this LOD is drawn
};

// Displacement (m) of a vertex: crown lean and oscillation along the wind, branch sway, leaf flutter and prop wash.
fn treeSway(v : Variant, p : vec3f, local : vec3f, scale : f32, sway : f32, anchored : bool, idPhase : f32, time : f32) -> vec3f {
  let height = v.shape.x * scale;
  let w = windAt(p - local + vec3f(0.0, 0.6 * height, 0.0), time);
  let sp = length(w);
  let dir = w / max(sp, 1.0e-3);
  let across = vec2f(-dir.y, dir.x);
  // A continuous structural field gives a branch and its child the same displacement at their joint.
  // Park stems stay rigid with collision; their leaf-card roots therefore receive no crown displacement.
  let structural = select(min(pow(max(local.y, 0.0) / max(height, 0.1), 1.6), 1.0), 0.0, anchored);
  let amp = v.shape.z * height * structural;
  let a = TAU * v.shape.y * time + idPhase;
  var off = vec3f(0.0);
  let crown = w * amp + (dir * (0.35 * sin(a)) + across * (0.25 * sin(1.31 * a + 1.9))) * (sp * amp);
  off.x = crown.x;
  off.z = crown.y;
  off.y = -dot(crown, crown) / max(2.0 * (local.y + 0.5), 0.1);
  // Branch sway: a smooth field over the tree's own frame, so a branch and its child move together at their joint while limbs a few metres apart
  // swing out of step. It grows with distance from the trunk axis, so the trunk and the core of the crown stay put and the outer shoots bob most.
  let outer = smoothstep(0.15, 0.9, length(local.xz) / max(v.bound.y * scale, 0.1));
  if (!anchored) {
    let bs = TAU * 2.1 * v.shape.y * time + dot(local, BRANCH_WAVE) + idPhase;
    let swing = (sin(bs) + 0.5 * sin(1.73 * bs + 0.3 * local.y)) * (BRANCH_SWAY * sp * outer);
    off += vec3f(dir.x * swing, 0.45 * swing, dir.y * swing);
  }

  // Leaf flutter, the last level of the same hierarchy: ripples running through the outer crown at LEAF_FLAP_HZ, moving each leaf together with
  // its twig and its neighbours. Like every motion above it is a smooth function of position, and its slope (amplitude x FLUTTER_K) stays
  // well under one, so foliage that is apart at rest stays apart at every moment: no leaf can swing through another (foliageSpace.test.ts).
  // Park plants keep their wood rigid, so only their leaves flutter, by the sway weight (0 at the stalk).
  let calm = saturate1(0.25 + sp / 6.0);
  let fp = TAU * LEAF_FLAP_HZ * time + idPhase;
  let rise = sin(fp + dot(local, FLUTTER_K1));
  let side = sin(1.37 * fp + dot(local, FLUTTER_K2));
  off += vec3f(0.6 * across.x * side, rise, 0.6 * across.y * side) * (v.shape.w * calm * scale * select(outer, sway, anchored));

  let wash = washAt(p, local.y, time, fract(idPhase * 0.159));
  let bush = v.range.z == KIND_BUSH;
  let reach = select(select(0.03, 0.5 * local.y, bush) + 0.27 * scale * outer, 0.27 * sway * scale, anchored);
  off += vec3f(wash.x * reach, select(0.0, -0.25 * local.y * wash.z, bush && !anchored), wash.y * reach);
  return off;
}

// The foot of a plant follows the slope it stands on: below about 1.8 m the trunk, its root flare, roots and low foliage are sheared onto the
// plane of the ground under the plant, so the downhill side meets the soil instead of standing proud of it. Park plants stand on level ground.
fn footOnSlope(local : vec3f, inst : Instance) -> vec3f {
  if (inst.nrm == PARK_PLANT_NORMAL) { return local; }
  let g = unpack2x16snorm(inst.nrm);
  let ny = sqrt(max(1.0 - dot(g, g), 0.1));
  let w = 1.0 - smoothstep(0.3, 1.8, local.y);
  return vec3f(local.x, local.y - w * dot(g, local.xz) / ny, local.z);
}

// A broadleaf in a closed stand spreads its crown out to meet its neighbours' (placementRules.ts withCrownSpread, stored in the tint's alpha as
// value * 2): everything above about a third of the tree's height is pushed out from the axis, the trunk and its collider stay as they are.
// Largest share by which a crown differs from its variant in width (and 1.3 times that in height); tree_cull.wgsl grows the cull sphere by it.
const CROWN_JITTER : f32 = 0.12;
const TRUNK_JITTER : f32 = 0.16;
// Largest lean of a tree's top off its foot, as a share of its height; tree_cull.wgsl grows the cull sphere by it.
const TREE_LEAN : f32 = 0.03;

fn crownSpread(local : vec3f, v : Variant, inst : Instance, slot : u32) -> vec3f {
  let spread = max(unpack4x8unorm(inst.tint).a * 2.0, 1.0);
  let h = v.shape.x * inst.scale;
  let w = smoothstep(0.28 * h, 0.55 * h, local.y);
  // Every tree's crown is its own size: up to CROWN_JITTER wider or narrower and taller or shorter than its variant's, so a stand seen from
  // above is a rough canopy of crowns at different heights rather than a carpet of copies. The trunk and its collider are left as they are.
  let wide = spread * (1.0 + CROWN_JITTER * (2.0 * hash11(slot * 31u + 5u) - 1.0));
  let tall = 1.0 + CROWN_JITTER * 1.3 * (2.0 * hash11(slot * 17u + 11u) - 1.0);
  let y = local.y + w * (local.y - 0.4 * h) * (tall - 1.0);
  // The bole is up to TRUNK_JITTER slimmer than the variant's (never thicker, so it stays inside its collider box).
  let girth = 1.0 - TRUNK_JITTER * hash11(slot * 13u + 3u);
  let across = mix(girth, wide, w);
  var out = vec3f(local.x * across, y, local.z * across);
  // Every tree leans its own way, by up to TREE_LEAN of its height at the top: the stem bows with the square of the height, so the lower bole,
  // where a drone passes between the trunks, stays inside its collider box (4 % of the lean at a fifth of the height: 2 cm on a 20 m tree). Park plants and bushes
  // stand as built.
  if (inst.nrm != PARK_PLANT_NORMAL && v.range.z != KIND_BUSH) {
    let a = TAU * hash11(slot * 23u + 7u);
    let f = saturate1(local.y / max(h, 0.1));
    let lean = TREE_LEAN * h * hash11(slot * 29u + 19u) * f * f;
    out += vec3f(cos(a) * lean, 0.0, sin(a) * lean);
  }
  return out;
}

// Dither interval of this draw's LOD: the two LODs of a hand-over band split the pixels between them with no overlap and no gap.
fn lodBand(v : Variant, inst : Instance) -> vec2f {
  let c = inst.pos + vec3f(0.0, v.bound.x * inst.scale, 0.0);
  let d = distance(c, frame.camPos.xyz);
  let e = lodEdges(v, inst);
  let b = select(LOD_FADE_BAND, 0.0, v.range.z == 2u);
  let a01 = smoothstep(e.x * (1.0 - b), e.x * (1.0 + b) + 1.0e-3, d);
  let a12 = smoothstep(e.y * (1.0 - b), e.y * (1.0 + b) + 1.0e-3, d);
  var far = smoothstep(0.86 * vp.tree.y, vp.tree.y, d);
  if (inst.nrm == PARK_PLANT_NORMAL) { far = smoothstep(0.86 * PARK_PLANT_DISTANCE, PARK_PLANT_DISTANCE, d); }
  var lo = 0.0;
  var hi = 1.0 - far;
  if (LOD == 0u) { hi = 1.0 - a01; }
  if (LOD == 1u) { lo = 1.0 - a01; hi = 1.0 - a12; }
  if (LOD == 2u) { lo = 1.0 - a12; }
  return vec2f(lo, hi);
}

@vertex
fn vs(in : VsIn) -> VsOut {
  let slot = visible[in.iid];
  let inst = instances[slot];
  let v = variants[inst.variant];
  let kind = u32(in.attr.z * 255.0 + 0.5);
  let idPhase = hash11(slot) * TAU;
  // Extreme tier, near LOD: the finely cut trunks and heavy limbs take their bark relief as real geometry (tree_bark.wgsl barkDisplacement).
  var modelPos = in.pos;
  if (LOD == 0u && vp.tree.w > 0.5 && kind < 128u) {
    let radius = in.attr.w * in.attr.w * BARK_RADIUS_MAX * inst.scale;
    let sink = barkDisplacement(kind >> 3u, barkPoint(in.uv, radius, inst.scale), radius, in.pos.y * inst.scale, in.uv, inst.scale, hash11(slot * 7919u + 13u));
    modelPos += octDecode(in.oct) * (sink / inst.scale);
  }
  let local = crownSpread(footOnSlope(yawRotate(modelPos, inst.yaw) * inst.scale, inst), v, inst, slot);
  let pre = inst.pos + local;
  let time = frame.camPos.w;
  let leafKind = kind >= 128u;
  // Park's solid wood follows the same fixed skeleton used by collision and RT.
  // Flexible leaves retain wind/flutter and prop-wash response.
  let rigidWood = inst.nrm == PARK_PLANT_NORMAL && !leafKind;
  var world = pre;
  var prev = pre;
  if (!rigidWood) {
    world += treeSway(v, pre, local, inst.scale, in.attr.y, inst.nrm == PARK_PLANT_NORMAL, idPhase, time);
    prev += treeSway(v, pre, local, inst.scale, in.attr.y, inst.nrm == PARK_PLANT_NORMAL, idPhase, time - frame.params.x);
  }
  // Each leaf or spray also twists a little on its stalk, out of step with its neighbours: its tip (sway weight) swings along its normal by at
  // most PETIOLE_TWIST, under half the room the build leaves between neighbouring leaves (treeGen.ts), so two never meet.
  if (leafKind) {
    let n = yawRotate(octDecode(in.oct), inst.yaw) * (PETIOLE_TWIST * inst.scale * min(in.attr.y, 1.0));
    let tp = TAU * in.attr.w + idPhase;
    world += n * sin(TAU * PETIOLE_HZ * time + tp);
    prev += n * sin(TAU * PETIOLE_HZ * (time - frame.params.x) + tp);
  }

  var o : VsOut;
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.world = world;
  o.nrm = yawRotate(octDecode(in.oct), inst.yaw);
  o.uv = in.uv;
  o.ids = vec4u(inst.variant, inst.tint, kind, slot);
  o.shade = vec3f(in.attr.x, in.pos.y, in.attr.w);
  o.motion = motionVectorPrev(world, prev);
  o.local = in.pos;
  o.band = lodBand(v, inst);
  return o;
}

// Per-pixel threshold in [0, 1): blue noise, rotated every frame (golden ratio) when TAA is on so the history averages the two LODs.
fn ditherThreshold(px : vec2u, slot : u32) -> f32 {
  var t = textureLoad(blueNoise, vec2i(px & vec2u(127u)), 0).x + hash11(slot);
  if ((frame.misc.y & 4u) != 0u) { t += f32(frame.misc.x & 255u) * 0.6180339887; }
  return fract(t);
}

// Leaf alpha threshold: blue noise offset from the LOD dither's so the two do not correlate, rotated every frame (golden ratio) when TAA is on so
// the history averages an edge pixel to its coverage. The noise only resolves while TAA keeps a pixel's history, i.e. while the leaf moves
// less than about a pixel a frame; faster (an FPV pass at speed) it would stay as speckle, so it fades to the plain, stable 0.5 cut, as it is
// without TAA.
fn alphaThreshold(px : vec2u, motion : vec2f) -> f32 {
  if ((frame.misc.y & 4u) == 0u) { return 0.5; }
  let t = fract(textureLoad(blueNoise, vec2i((px + vec2u(67u, 29u)) & vec2u(127u)), 0).x + f32(frame.misc.x & 255u) * 0.6180339887);
  return mix(t, 0.5, saturate1(length(motion * frame.screen.xy) - 0.5));
}

// Unit tangent of increasing uv.x and uv.y from screen-space derivatives (zero vectors when the card is edge-on).
fn uvTangents(dpx : vec3f, dpy : vec3f, dux : vec2f, duy : vec2f) -> mat2x3f {
  let det = dux.x * duy.y - dux.y * duy.x;
  if (abs(det) < 1.0e-12) { return mat2x3f(vec3f(0.0), vec3f(0.0)); }
  let inv = 1.0 / det;
  let tu = (dpx * duy.y - dpy * dux.y) * inv;
  let tv = (dpy * dux.x - dpx * duy.x) * inv;
  return mat2x3f(tu / max(length(tu), 1.0e-6), tv / max(length(tv), 1.0e-6));
}

@fragment
fn fs(in : VsOut) -> FsOut {
  let dpx = dpdx(in.world);
  let dpy = dpdy(in.world);
  let dux = dpdx(in.uv);
  let duy = dpdy(in.uv);
  let dlx = dpdx(in.local);
  let dly = dpdy(in.local);
  let c = textureSample(atlas, leafSampler, in.uv);
  let d = textureSample(atlasData, leafSampler, in.uv);
  let alphaWidth = max(fwidth(c.a), 1.0e-3);

  if (in.band.x > 0.0 || in.band.y < 1.0) {
    let t = ditherThreshold(vec2u(in.pos.xy), in.ids.w);
    if (t < in.band.x || t >= in.band.y) { discard; }
  }
  let kind = in.ids.z;
  let cls = kind >> 5u;
  let leaf = cls >= CLASS_FIRST_LEAF;
  // The mask is sharpened to a one-pixel ramp across the leaf edge and kept where it beats a blue-noise threshold, so an edge pixel is covered
  // in proportion to how much leaf it holds and TAA resolves an anti-aliased, stable outline (a fixed 0.5 cut crawls and shimmers in motion).
  // A shoot card seen nearly edge-on would smear its leaves into long streaks; real leaves at that angle are thin slivers with sky between
  // them. The coverage thins out as the card turns edge-on (the cut rises), so grazing cards show gaps instead of streaks.
  let edgeOn = abs(dot(normalize(cross(dpx, dpy)), normalize(frame.camPos.xyz - in.world)));
  let band = select(vec2f(EDGE_ON_LO, EDGE_ON_HI), NEEDLE_EDGE_ON, cls == CLASS_NEEDLE);
  let cut = ALPHA_CUT + (1.0 - ALPHA_CUT) * (1.0 - smoothstep(band.x, band.y, edgeOn));
  if (leaf && saturate1((c.a - cut) / alphaWidth + 0.5) <= alphaThreshold(vec2u(in.pos.xy), in.motion)) { discard; }

  let v = variants[in.ids.x];
  let tint = unpack4x8unorm(in.ids.y).rgb * 2.0;
  var n = normalize(in.nrm);
  var col : vec3f;
  var rough = BARK_ROUGHNESS;
  var translucency = 0.0;
  let crownOpen = crownAo(in.shade.x, in.ids.w, v, in.local, instances[in.ids.w].scale, leaf);
  var ao = crownOpen;
  // Sunlight shadowed at this point by the bark's own relief (furrows) or, on a leaf, by the leaves between it and the sun (sunflecks), passed
  // to the lighting in misc.b (deferred.wgsl).
  var sunOcc = 0.0;
  if (leaf) {
    // Per-card colour drift (sun leaves vs shade leaves) from the branch phase, painted colour from the atlas.
    let drift = vec3f(1.0 + 0.22 * (in.shade.z - 0.5), 1.0 + 0.06 * (in.shade.z - 0.5), 1.0 - 0.25 * (in.shade.z - 0.5));
    // Patches of the crown about a branch across: brighter and yellower, or darker and bluer, the way one limb's leaves differ from the next.
    let q = in.local / BRANCH_PATCH + vec3f(hash11(in.ids.w) * 40.0);
    let limbPatch = 0.5 * sin(q.x + 1.7 * sin(q.y)) * sin(q.z + 1.3 * sin(q.x));
    let branch = vec3f(1.0 + 0.4 * limbPatch, 1.0 + 0.32 * limbPatch, 1.0 + 0.08 * limbPatch);
    col = v.leafTone.rgb * c.rgb * COLOUR_RANGE * tint * drift * branch;
    let tb = uvTangents(dpx, dpy, dux, duy);
    // Wind turns each leaf a little about its stalk: a slow noise over the card, advected along it, so neighbouring leaves flicker out of step.
    // Only the full-detail LOD flickers (every LOD at the extreme tier); beyond it a leaf is under a pixel and the flicker would mostly cost time.
    var tilt = d.rg * 2.0 - 1.0;
    if (LOD == 0u || vp.tree.w > 0.5) {
      let calm = saturate1(vp.wind.z / 6.0);
      let w = in.uv * 90.0 + vec2f(2.3, 1.9) * frame.camPos.w;
      tilt += 0.5 * vec2f(sin(w.x + 2.0 * sin(w.y)), sin(w.y + 2.0 * sin(w.x * 0.8))) * (LEAF_FLICKER * calm);
    }
    n = normalize(n + (tb[0] * tilt.x + tb[1] * tilt.y) * LEAF_TILT);
    // Leaves are thin and double sided: a normal facing away from the eye is mirrored about the view plane (continuous at the silhouette),
    // so the underside of a sunlit crown shows transmitted light and ground bounce instead of the sunlit top's reflection. The face whose crown
    // normal points away from the eye is the leaf's underside: paler, greyer and matte.
    let eye = normalize(frame.camPos.xyz - in.world);
    let underside = smoothstep(0.15, -0.15, dot(normalize(in.nrm), eye));
    n = normalize(n - 2.0 * min(dot(n, eye), 0.0) * eye);
    var front = LEAF_ROUGHNESS;
    if (cls == CLASS_NEEDLE) { front = NEEDLE_ROUGHNESS; }
    if (cls == CLASS_BLOB) { front = BLOB_ROUGHNESS; }
    if (cls == CLASS_CONE) { front = CONE_ROUGHNESS; }
    let broad = select(0.0, underside, cls == CLASS_FIRST_LEAF);
    rough = mix(front, LEAF_BACK_ROUGHNESS, broad);
    col = mix(col, vec3f(dot(col, vec3f(0.3, 0.59, 0.11))), LEAF_BACK_GREY * broad) * mix(1.0, LEAF_BACK_LIGHTEN, broad);
    translucency = min(v.leafTone.a * d.b * LEAF_TRANSMIT, 1.0);
    // Openness: the baked crown occlusion times the atlas's own cavity term. Leaves deep in a crown are shade leaves: darker and
    // lit mostly by what the outer leaves let through; outer sun leaves are a little yellower.
    let occ = saturate1(crownOpen * (0.55 + 0.45 * d.a));
    // The mid- and far-LOD cards keep the shallower shading the far-field canopy (veg_far.wgsl) is matched to, so the hand-over does not pop.
    let far = cls >= CLASS_BLOB;
    // Sunflecks: inside a crown a leaf is either in the sun, through a gap, or in the shade of the leaves between it and the sun; it is not lit
    // by the crown's average (which smooths a crown into a gradient with half the local contrast of a photograph). Its chance of sun is its own
    // crown's transmittance along the sun (Beer-Lambert over its depth to the crown ellipsoid's surface). Each shoot (its phase byte) of each
    // tree (slot) draws once, so a shoot is lit or shaded as a whole and stays so as it moves. Passed as sun occlusion in misc.b (deferred.wgsl).
    if (!far && v.crown.y > 0.0) {
      let inst = instances[in.ids.w];
      let r = v.crown.yzw;
      let q = (in.local - vec3f(0.0, v.crown.x, 0.0)) / r;
      let ds = yawRotate(frame.sunDir.xyz, -inst.yaw) / r;
      let a = dot(ds, ds);
      let b = dot(q, ds);
      let cq = dot(q, q) - 1.0;
      let depth = select(0.0, (-b + sqrt(max(b * b - a * cq, 0.0))) / a, cq < 0.0) * inst.scale;
      let draw = hash11(u32(in.shade.z * 255.0 + 0.5) * 7919u + in.ids.w * 104729u);
      sunOcc = 1.0 - smoothstep(draw - LEAF_FLECK_EDGE, draw + LEAF_FLECK_EDGE, exp(-LEAF_SELF_EXTINCTION * depth));
    }
    ao = mix(select(LEAF_AO_FLOOR, BLOB_AO_FLOOR, far), 1.0, occ);
    // Spruce, fir and pine needles are a darker, less blue green than the variant tone alone gives them under sky light (veg_far.wgsl matches).
    if (cls == CLASS_NEEDLE || cls == CLASS_CONE) { col *= NEEDLE_SHADE; }
    col *= select(mix(vec3f(0.84, 0.86, 0.84), vec3f(1.03, 1.02, 0.96), occ), vec3f(mix(0.85, 1.0, occ) * BLOB_DARKEN), far);
  } else {
    // Bark on the limb's cylinder in real metres (tree_bark.wgsl): angle round the limb, metres along it, and the limb's radius from the phase byte.
    let scale = instances[in.ids.w].scale;
    let barkKind = kind >> 3u;
    let radius = in.shade.z * in.shade.z * BARK_RADIUS_MAX * scale;
    let height = in.shade.y * scale;
    let footprint = max(length(dpx), length(dpy));
    let seed = hash11(in.ids.w * 7919u + 13u);
    let p = barkPoint(in.uv, radius, scale);
    let smoothN = n;
    // Photoscanned bark where it is loaded (tree_bark.wgsl scanBark).
    // A forest-grown oak or beech (its crown starting high up the tree) stands in damp shade (tree_bark.wgsl barkForest).
    let crownBase = (v.crown.x - v.crown.z) / max(v.shape.x, 1.0);
    barkForest = select(0.0, smoothstep(0.25, 0.45, crownBase), barkKind == BARK_OAK || barkKind == BARK_BEECH);
    var scanW = select(0.0, 1.0, barkScansReady() && scannedKind(barkKind));
    var bark : BarkSurface;
    if (scanW < 1.0) {
      let h = barkHeight(barkKind, p, radius, height, footprint);
      bark = barkSurface(barkKind, p, radius, h, height, n, footprint, seed);
      // Relief normal from the change of the bark height to the next pixel across and down (the height fades to flat where furrows are
      // narrower than a pixel, so far bark keeps its smooth normal).
      if (LOD < 2u && footprint < BARK_BUMP_FOOTPRINT) {
        let hx = dpdxFine(bark.h);
        let hy = dpdyFine(bark.h);
        let r1 = cross(dpy, n);
        let r2 = cross(n, dpx);
        let det = dot(dpx, r1);
        if (abs(det) > 1.0e-12) {
          let grad = (hx * r1 + hy * r2) / det;
          n = normalize(n - bark.depth * (grad - n * dot(n, grad)));
        }
      }
    }
    if (scanW > 0.0) {
      let toEye = normalize(frame.camPos.xyz - in.world);
      let sb = scanBark(barkKind, in.uv, radius, scale, height, seed, p, smoothN, dpx, dpy, footprint, toEye, frame.sunDir.xyz, LOD == 0u,
        select(10, 20, vp.tree.w > 0.5));
      if (scanW >= 1.0) { bark = sb.s; n = sb.n; } else {
        bark.col = mix(bark.col, sb.s.col, scanW);
        bark.rough = mix(bark.rough, sb.s.rough, scanW);
        bark.cavity = mix(bark.cavity, sb.s.cavity, scanW);
        n = normalize(mix(n, sb.n, scanW));
      }
      sunOcc = sb.sunOcc * scanW;
    }
    col = bark.col * mix(vec3f(1.0), tint, 0.35);
    rough = bark.rough;
    ao = mix(BARK_AO_FLOOR, 1.0, crownOpen) * bark.cavity;
  }

  var o : FsOut;
  o.albedo = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), ao);
  o.normal = vec4f(octEncode(n), rough, 0.0);
  o.misc = vec4f(FOLIAGE_ID / 255.0, translucency, sunOcc, 0.0);
  o.motion = in.motion;
  return o;
}
`,"./shaders/vegetation/tree_bark.wgsl":`// Procedural bark for the tree shader, one pattern per bark type. Bark is evaluated on the limb's own cylinder: the angle round the limb (uv.x),
// metres along it (uv.y) and the limb's radius at that ring (the vertex phase byte), all times the instance scale. The pattern is therefore in
// real metres on every tree, runs on unbroken along a trunk and round its seam, and the furrows of a thick trunk are as wide as on a real one.
// \`h\` is the bark surface height: 0 in the bottom of a furrow, 1 on the face of a plate or ridge.
//
// Reference (what each pattern copies): pedunculate oak, deep braided vertical furrows that break mature ridges into blocks; Scots pine, thick
// grey-brown plates in deep fissures low down and thin papery orange flakes on the upper trunk and limbs; Norway spruce, thin red-brown bark of
// small round scales; silver birch, chalk-white papery bark with horizontal dark lenticels and black diamond fissures at the foot of old stems;
// beech, smooth elephant-grey bark with fine mottling; dead wood, silver-grey weathered timber split along the grain with scraps of bark left.
#include "vegetation/veg_noise.wgsl"

const BARK_OAK : u32 = 0u;
const BARK_PINE : u32 = 1u;
const BARK_BIRCH : u32 = 2u;
const BARK_BEECH : u32 = 3u;
const BARK_SPRUCE : u32 = 4u;
const BARK_DEAD : u32 = 5u;
// A bark vertex's phase byte is sqrt(radius / BARK_RADIUS_MAX) (meshBuilder.ts).
const BARK_RADIUS_MAX : f32 = 1.2;

struct BarkSurface {
  col : vec3f,
  rough : f32,
  // Ambient factor of the crevices and the depth (m) of the bark relief for the bump normal.
  cavity : f32,
  depth : f32,
  // Surface height for the bump normal: the bark's own, raised and roughened where moss covers it.
  h : f32,
};

// Point on the limb's cylinder in metres: x, y round the limb at its radius, z along it.
fn barkPoint(uv : vec2f, radius : f32, scale : f32) -> vec3f {
  let a = uv.x * TAU;
  return vec3f(radius * cos(a), radius * sin(a), uv.y * 64.0 * scale);
}

// Baked tileable noise (barkNoise.ts): 16 noise cells across the texture, so a coordinate in cells samples at p / 16. One filtered read
// replaces the eight hashed lattice corners of procedural noise.
@group(2) @binding(6) var barkNoiseTex : texture_3d<f32>;
const BARK_NOISE_CELLS : f32 = 16.0;

fn barkNoise4(p : vec3f) -> vec4f {
  return textureSampleLevel(barkNoiseTex, linearRepeat, p * (1.0 / BARK_NOISE_CELLS), 0.0);
}

// Gradient noise in about [-1, 1].
fn gnoise3(p : vec3f) -> f32 {
  return (barkNoise4(p).r - 0.5) * 2.5;
}

// A second, independent gradient noise.
fn gnoise3b(p : vec3f) -> f32 {
  return (barkNoise4(p).b - 0.5) * 2.5;
}

// Smooth noise in [0, 1] with a mean of 0.5 (the third baked channel, stretched to about the spread of value noise).
fn bvalue(p : vec3f) -> f32 {
  return saturate1(0.5 + (barkNoise4(p).g - 0.5) * 1.4);
}

// Cellular noise: x = roughly how far from the cell border toward its middle, y = gap to the second-nearest feature point (0 on a cell
// border), z = a slowly varying shade standing in for the cell's own random value.
fn cells3(p : vec3f) -> vec3f {
  let gap = barkNoise4(p).a * 0.7;
  return vec3f(0.6 - gap, gap, bvalue(p * 0.37 + 3.1));
}

// How much of a pattern of feature size \`size\` (m) survives at a pixel footprint \`foot\` (m): fades to its mean before it would alias.
fn barkDetail(size : f32, foot : f32) -> f32 {
  return 1.0 - smoothstep(0.25 * size, 0.6 * size, foot);
}

// Oak: mature bark is broken into long blocky ridges in vertical rows, split by deep furrows that braid round them; the ridge faces are
// rough with flakes and pits. Thin limbs are smooth grey-brown with fine cracks.
fn oakHeight(c : vec3f, r : f32, foot : f32) -> f32 {
  // Past the distance where the pattern has faded to its mean, skip the noise.
  if (foot >= 0.018) { return 0.6; }
  let warp = vec2f(gnoise3b(vec3f(c.xy * 4.0, c.z * 1.0) + 11.0), gnoise3(vec3f(c.xy * 4.0, c.z * 1.0) + 17.0));
  // Ridges a few centimetres wide and up to half a metre long: cells drawn out along the trunk, their borders the furrows, with a second
  // braided set of furrows splitting the long ridges unevenly.
  let cl = cells3(vec3f(c.xy * 12.0 + warp * 0.8, c.z * 1.3));
  let braid = abs(gnoise3(vec3f(c.xy * 20.0 + warp * 1.2, c.z * 3.0) + 29.0));
  var ridge = (smoothstep(0.0, 0.16, cl.y) * 0.85 + 0.15 * smoothstep(0.16, 0.4, cl.y)) * (0.6 + 0.4 * smoothstep(0.02, 0.3, braid));
  // The ridge faces are rough at every scale: flakes, pits and loose scales.
  let fine = barkDetail(0.004, foot);
  let q = vec3f(c.xy * 30.0, c.z * 9.0);
  let rough = gnoise3(q) * 0.45 + gnoise3b(q * 2.7 + 3.0) * 0.35 * fine + gnoise3(c * 150.0) * 0.3 * fine;
  ridge *= 0.78 + 0.22 * smoothstep(-0.8, 0.8, rough);
  let mature = smoothstep(0.05, 0.16, r);
  let young = 0.82 + 0.18 * smoothstep(0.0, 0.25, abs(gnoise3(vec3f(c.xy * 55.0, c.z * 12.0))));
  let h = mix(young, ridge, mature);
  return mix(0.6, h, barkDetail(mix(0.015, 0.03, mature), foot));
}

// Scots pine: how much of the bark at a point is the thick grey plated bark of the lower trunk (1) rather than the thin orange flakes of the
// upper trunk and limbs (0). The plates reach higher up a stouter trunk, and the boundary is ragged: tongues of plate run up between flakes.
fn pinePlated(c : vec3f, r : f32, height : f32) -> f32 {
  let reach = 3.0 + 22.0 * smoothstep(0.12, 0.45, r);
  let ragged = 1.6 * gnoise3(vec3f(c.xy * 1.5, c.z * 0.35) + 41.0);
  return smoothstep(0.08, 0.15, r) * smoothstep(reach + 1.5, reach - 1.5, height + ragged);
}

// Scots pine plate faces peel in layers: 1 where the grey outer layer is still on, 0 where it has flaked off and the layer under it shows.
fn pineLayer(c : vec3f) -> f32 {
  return smoothstep(0.45, 0.55, bvalue(vec3f(c.xy * 14.0, c.z * 6.0) + 31.0));
}

// Scots pine: thick plates a hand wide and up to two hands tall in a network of deep dark fissures, their faces flaking in layers; thin
// papery flakes on the upper trunk and limbs.
fn pineHeight(c : vec3f, r : f32, height : f32, foot : f32) -> f32 {
  if (foot >= 0.06) { return 0.6; }
  let thick = pinePlated(c, r, height);
  var h = 0.0;
  if (thick > 0.0) {
    let warp = vec2f(gnoise3(vec3f(c.xy * 3.0, c.z * 1.5) + 3.0), gnoise3b(vec3f(c.xy * 3.0, c.z * 1.5) + 8.0));
    let cl = cells3(vec3f(c.xy * 9.0 + warp * 1.2, c.z * 2.6));
    // Narrow, deep fissures of uneven width: the plate face drops steeply at its edge into a dark bottom. Shallower cracks split the long
    // plates across, so they are irregular polygons rather than lenses.
    let fissure = smoothstep(0.0, 0.08 + 0.08 * bvalue(c * 3.0 + 1.7), cl.y);
    let split = cells3(vec3f(c.xy * 16.0 + warp * 2.0, c.z * 9.0) + 13.0);
    let across = smoothstep(0.0, 0.1, split.y);
    // Plate faces flake in thin layers: terraced steps where a layer has come away, and pits, rather than a smooth face.
    let fine = barkDetail(0.005, foot);
    let layer = pineLayer(c);
    let flaky = layer * 0.6 + gnoise3(vec3f(c.xy * 30.0, c.z * 14.0)) * 0.25 + gnoise3(c * vec3f(80.0, 80.0, 40.0)) * 0.3 * fine;
    h += thick * fissure * (0.6 + 0.4 * across) * (0.72 + 0.08 * cl.z + 0.2 * flaky);
  }
  if (thick < 1.0) {
    let fl = smoothstep(0.0, 0.25, abs(gnoise3(vec3f(c.xy * 22.0, c.z * 9.0) + 9.0)));
    h += (1.0 - thick) * (0.8 + 0.2 * fl);
  }
  return mix(0.6, h, barkDetail(mix(0.012, 0.1, thick), foot));
}

// Norway spruce: thin bark of small rounded scales that lift at their edges. On an old trunk the scales lift in groups, so it also breaks
// into irregular patches a hand or two across with shallow cracks between them, which is the texture still seen from ten metres.
fn spruceHeight(c : vec3f, r : f32, foot : f32) -> f32 {
  if (foot >= 0.05) { return 0.65; }
  let w = vec2f(gnoise3(vec3f(c.xy * 3.0, c.z * 1.5) + 5.0), gnoise3b(vec3f(c.xy * 3.0, c.z * 1.5) + 2.0));
  let big = cells3(vec3f(c.xy * 6.0 + w * 0.6, c.z * 3.0));
  let coarse = 0.62 + 0.18 * smoothstep(0.0, 0.1, big.y) + 0.2 * big.z;
  var h = coarse;
  if (foot < 0.0072) {
    let warp = gnoise3(c * 9.0);
    let cl = cells3(vec3f(c.xy * 17.0 + warp * 0.4, c.z * 12.0));
    // Each scale is a low flake lifting at its edge; neighbours overlap, so the border is a small step, not a crack. The lifted lower edge of a scale casts a thin dark line, and the scale rises from it toward its upper end, where the next one overlaps.
    let lift = fract(c.z * 12.0 + 0.6 * cl.z + 0.25 * warp);
    let scale = 0.5 + 0.22 * smoothstep(0.0, 0.12, cl.y) + 0.14 * smoothstep(0.0, 0.15, lift) * (0.6 + 0.4 * lift) + 0.14 * smoothstep(-0.6, 0.6, gnoise3b(c * vec3f(60.0, 60.0, 40.0)));
    h = coarse * mix(0.84, scale, barkDetail(0.012, foot));
  } else {
    h = coarse * 0.84;
  }
  h = mix(0.85, h, smoothstep(0.03, 0.1, r));
  return mix(0.65, h, barkDetail(0.06, foot));
}

// Birch foot factor: old stems turn black and deeply fissured near the ground, the higher the thicker they are.
fn birchFoot(c : vec3f, r : f32, height : f32) -> f32 {
  // The edge of the black bark is ragged: tongues of it run up the fissures and white islands are left between them.
  let ragged = 0.3 * gnoise3(c * vec3f(3.0, 3.0, 1.5)) + 0.18 * gnoise3(c * vec3f(14.0, 14.0, 5.0));
  return smoothstep(0.3 + 8.0 * r, 0.1 + 3.0 * r, height + ragged) * smoothstep(0.06, 0.14, r);
}

// Position on the unrolled birch stem in metres: round it (angle times radius) and up it.
fn birchSheet(c : vec3f, r : f32) -> vec2f {
  return vec2f(atan2(c.y, c.x) * r, c.z);
}

// Lenticels: short dark dashes lying across the stem, a few millimetres tall and one to five centimetres long, in loose staggered rows.
fn birchLenticels(q : vec2f) -> f32 {
  let g = q * vec2f(1.0 / 0.06, 1.0 / 0.016);
  let row = floor(g.y);
  let x = g.x + hash21(vec2u(u32(i32(row) + 100000), 7u)) * 3.0;
  let cell = vec2f(floor(x), row);
  let id = vec2u(vec2i(cell) + vec2i(100000));
  if (hash21(id) > 0.55) { return 0.0; }
  let len = mix(0.15, 0.45, hash21(id + vec2u(3u, 0u)));
  let centre = mix(-0.25, 0.25, hash21(id + vec2u(0u, 5u)));
  let f = vec2f(fract(x) - 0.5 - centre, fract(g.y) - 0.5);
  // A lens: thickest in the middle, tapering to points at both ends.
  let t = min(abs(f.x) / len, 1.0);
  let thick = 0.22 * (1.0 - t * t);
  return (1.0 - smoothstep(len - 0.04, len, abs(f.x))) * (1.0 - smoothstep(thick * 0.55, thick, abs(f.y)));
}

// Black scars: rough dark patches wider than they are tall, where a branch was shed or the paper has cracked open, with ragged edges.
fn birchScars(q : vec2f, c : vec3f) -> f32 {
  let g = q * vec2f(1.0 / 0.5, 1.0 / 0.5);
  let cell = floor(g);
  let id = vec2u(vec2i(cell) + vec2i(100000));
  if (hash21(id + vec2u(11u, 0u)) > 0.3) { return 0.0; }
  let f = fract(g) - 0.5 - (vec2f(hash21(id + vec2u(1u, 1u)), hash21(id + vec2u(2u, 2u))) - 0.5) * 0.2;
  // A wide lens 12 to 34 cm across and under a third as tall, measured in metres (cells are 50 cm square).
  let reach = mix(0.06, 0.17, hash21(id + vec2u(4u, 9u)));
  let d = length(f * 0.5 / vec2f(reach, reach * 0.3));
  return 1.0 - smoothstep(0.75, 1.0, d + 0.25 * gnoise3(c * vec3f(25.0, 25.0, 12.0)));
}

// Rough black bark (the foot and the scars): small plates in a network of deep fissures, running mostly up the stem.
fn birchRough(c : vec3f) -> f32 {
  let w = vec2f(gnoise3(vec3f(c.xy * 5.0, c.z * 1.5) + 4.0), gnoise3b(vec3f(c.xy * 5.0, c.z * 1.5) + 9.0));
  // Long ridges up the stem between deep fissures, broken across by shallower cracks, their faces lumpy and corky.
  let ridge = cells3(vec3f(c.xy * 14.0 + w * 1.4, c.z * 2.5));
  let breaks = cells3(vec3f(c.xy * 9.0 + w, c.z * 9.0) + 17.0);
  let lumps = gnoise3(c * vec3f(45.0, 45.0, 25.0)) * 0.5 + gnoise3b(c * vec3f(120.0, 120.0, 80.0)) * 0.3;
  return smoothstep(0.0, 0.16, ridge.y) * (0.65 + 0.35 * smoothstep(0.0, 0.08, breaks.y)) * (0.78 + 0.22 * smoothstep(-0.8, 0.8, lumps));
}

// Silver birch: smooth paper with dark horizontal lenticel dashes and peeling strips, black scars, and at the foot of an old stem rough black
// fissured bark. y = how much of the point is black bark.
fn birchHeight(c : vec3f, r : f32, height : f32, foot : f32) -> vec2f {
  let q = birchSheet(c, r);
  let peel = smoothstep(0.55, 0.6, gnoise3(vec3f(c.xy * 2.5, c.z * 9.0) + 21.0));
  var h = 0.82 + 0.12 * peel;
  if (foot < 0.008) { h -= 0.36 * birchLenticels(q) * barkDetail(0.01, foot); }
  // Past the distance where single dashes resolve, the rows of lenticels still read as faint grey streaks across the stem.
  h -= 0.22 * smoothstep(0.45, 0.8, bvalue(vec3f(c.xy * 6.0, c.z * 30.0) + 2.0)) * (1.0 - barkDetail(0.01, foot)) * barkDetail(0.1, foot);
  let base = max(birchFoot(c, r, height), birchScars(q, c) * smoothstep(0.05, 0.12, r));
  if (base > 0.0) { h = mix(h, birchRough(c), base); }
  return vec2f(mix(0.75, h, barkDetail(0.01, foot)), base);
}

// Beech: almost smooth, with faint wrinkles.
fn beechHeight(c : vec3f, foot : f32) -> f32 {
  let w = gnoise3(vec3f(c.xy * 10.0, c.z * 4.0)) * 0.06 + gnoise3(c * 45.0) * 0.03 * barkDetail(0.005, foot);
  return 0.8 + w;
}

// Dead wood: weathered grain split by long cracks, with patches of bark still clinging to it.
fn deadHeight(c : vec3f, r : f32, foot : f32) -> vec2f {
  if (foot >= 0.0072) { return vec2f(0.6, 0.5); }
  let left = smoothstep(0.15, 0.3, gnoise3(vec3f(c.xy * 4.0, c.z * 1.6) + 13.0));
  let crack = smoothstep(0.0, 0.07, abs(gnoise3(vec3f(c.xy * 34.0, c.z * 1.3))));
  let grain = 0.5 + 0.5 * gnoise3(vec3f(c.xy * 110.0, c.z * 3.0));
  let wood = crack * (0.62 + 0.18 * grain * barkDetail(0.004, foot));
  let bark = 0.85 + 0.15 * smoothstep(0.02, 0.35, abs(gnoise3(vec3f(c.xy * 20.0, c.z * 5.0))));
  return vec2f(mix(0.6, mix(wood, bark, left), barkDetail(0.012, foot)), left);
}

// Bark surface height at a point: the bump normal differentiates this.
fn barkHeight(kind : u32, c : vec3f, r : f32, height : f32, foot : f32) -> f32 {
  switch kind {
    case BARK_PINE: { return pineHeight(c, r, height, foot); }
    case BARK_BIRCH: { return birchHeight(c, r, height, foot).x; }
    case BARK_BEECH: { return beechHeight(c, foot); }
    case BARK_SPRUCE: { return spruceHeight(c, r, foot); }
    case BARK_DEAD: { return deadHeight(c, r, foot).x; }
    default: { return oakHeight(c, r, foot); }
  }
}

// Photoscanned bark (barkScans.ts): \`colour\` = albedo + ambient occlusion, \`surface\` = normal X, Y (0.5 = flat) + height + roughness, one layer
// per scan. With the scans missing the arrays are one-layer stand-ins and the procedural bark above is used instead.
@group(2) @binding(8) var barkScanColour : texture_2d_array<f32>;
@group(2) @binding(9) var barkScanSurface : texture_2d_array<f32>;
@group(2) @binding(10) var barkScanSampler : sampler;

const SCAN_PINE_PLATES : i32 = 0;
const SCAN_PINE_FLAKES : i32 = 1;
const SCAN_OAK : i32 = 2;
const SCAN_SPRUCE : i32 = 3;
const SCAN_BEECH : i32 = 4;
const SCAN_BIRCH_PAPER : i32 = 5;
// Metres of bark one tile of each scan covers (tools/bark/build_bark_scans.py LAYERS; barkScans.test.ts checks they match).
const SCAN_METRES = array<f32, 6>(0.9, 1.1, 0.8, 0.8, 1.2, 0.7);
// Metres one tile covers up the limb: a tall scan is stored squeezed into its square tile whole, since it tiles only as a whole.
const SCAN_ALONG = array<f32, 6>(0.9, 1.1, 1.6, 0.8, 2.4, 0.7);

// Texture coordinates per metre of bark (round the limb, up it) of a scan layer.
fn scanPerMetre(layer : i32) -> vec2f { return vec2f(1.0 / SCAN_METRES[layer], 1.0 / SCAN_ALONG[layer]); }

fn barkScansReady() -> bool { return textureNumLayers(barkScanColour) > 1u; }

// Whether a bark type takes the scans; dead wood keeps its own procedural grain.
fn scannedKind(kind : u32) -> bool { return kind == BARK_PINE || kind == BARK_OAK || kind == BARK_SPRUCE || kind == BARK_BEECH || kind == BARK_BIRCH; }

// Position on the limb's unrolled surface in metres: round it and along it, with a per-tree offset. The angle wraps at uv.x = 0 / 1, where a
// tile does not meet itself, so a second position, turned half way round, takes over near the seam (\`w\` is its weight).
struct ScanCoords { a : vec2f, b : vec2f, w : f32 };

fn scanCoords(uv : vec2f, radius : f32, scale : f32, seed : f32) -> ScanCoords {
  let around = TAU * radius;
  let along = uv.y * 64.0 * scale;
  let off = vec2f(seed * 13.7, seed * 7.3);
  var s : ScanCoords;
  s.a = vec2f(uv.x * around, along) + off;
  s.b = vec2f(fract(uv.x + 0.5) * around, along) + off + vec2f(0.37, 0.0);
  s.w = 1.0 - smoothstep(0.02, 0.07, min(uv.x, 1.0 - uv.x));
  return s;
}

struct ScanSample { col : vec3f, ao : f32, nrm : vec2f, h : f32, rough : f32 };

fn scanRead(layer : i32, q : vec2f, gx : vec2f, gy : vec2f) -> ScanSample {
  let m = scanPerMetre(layer);
  let c = textureSampleGrad(barkScanColour, barkScanSampler, q * m, layer, gx * m, gy * m);
  let s = textureSampleGrad(barkScanSurface, barkScanSampler, q * m, layer, gx * m, gy * m);
  var o : ScanSample;
  o.col = c.rgb; o.ao = c.a; o.nrm = s.xy * 2.0 - 1.0; o.h = s.z; o.rough = s.w;
  return o;
}

fn scanMix(p : ScanSample, q : ScanSample, t : f32) -> ScanSample {
  var o : ScanSample;
  o.col = mix(p.col, q.col, t); o.ao = mix(p.ao, q.ao, t); o.nrm = mix(p.nrm, q.nrm, t); o.h = mix(p.h, q.h, t); o.rough = mix(p.rough, q.rough, t);
  return o;
}

// The scans one bark type reads and how much of the second (pine: the thin orange flakes above the plated lower trunk; birch: the rough
// black bark of the foot and scars over the white paper).
struct ScanLayers { first : i32, second : i32, t : f32 };

fn scanLayers(kind : u32, c : vec3f, r : f32, height : f32) -> ScanLayers {
  var l : ScanLayers;
  l.second = -1; l.t = 0.0;
  switch kind {
    case BARK_PINE: { l.first = SCAN_PINE_PLATES; l.second = SCAN_PINE_FLAKES; l.t = 1.0 - pinePlated(c, r, height); }
    case BARK_SPRUCE: { l.first = SCAN_SPRUCE; }
    case BARK_BEECH: { l.first = SCAN_BEECH; }
    case BARK_BIRCH: {
      l.first = SCAN_BIRCH_PAPER; l.second = SCAN_OAK;
      l.t = smoothstep(0.2, 0.6, max(birchFoot(c, r, height), birchScars(birchSheet(c, r), c) * smoothstep(0.05, 0.12, r)));
    }
    default: { l.first = SCAN_OAK; }
  }
  return l;
}

// One bark point from the scans, both seam positions and both layers blended.
fn scanAt(kind : u32, l : ScanLayers, s : ScanCoords, gx : vec2f, gy : vec2f) -> ScanSample {
  var o = scanRead(l.first, s.a, gx, gy);
  if (s.w > 0.0) { o = scanMix(o, scanRead(l.first, s.b, gx, gy), s.w); }
  o.col = scanGrade(kind, l.first, o.col);
  if (l.second >= 0 && l.t > 0.0) {
    var p = scanRead(l.second, s.a, gx, gy);
    if (s.w > 0.0) { p = scanMix(p, scanRead(l.second, s.b, gx, gy), s.w); }
    p.col = scanGrade(kind, l.second, p.col);
    o = scanMix(o, p, l.t);
  }
  return o;
}

// Height only, at a fixed mip, for parallax and the extreme displacement (no derivatives needed).
fn scanHeightLevel(l : ScanLayers, s : ScanCoords, level : f32) -> f32 {
  var h = textureSampleLevel(barkScanSurface, barkScanSampler, s.a * scanPerMetre(l.first), l.first, level).z;
  if (s.w > 0.0) { h = mix(h, textureSampleLevel(barkScanSurface, barkScanSampler, s.b * scanPerMetre(l.first), l.first, level).z, s.w); }
  if (l.second >= 0 && l.t > 0.0) {
    var g = textureSampleLevel(barkScanSurface, barkScanSampler, s.a * scanPerMetre(l.second), l.second, level).z;
    if (s.w > 0.0) { g = mix(g, textureSampleLevel(barkScanSurface, barkScanSampler, s.b * scanPerMetre(l.second), l.second, level).z, s.w); }
    h = mix(h, g, l.t);
  }
  return h;
}

// Depth (m) of the scanned relief per bark type: deep plates on old pine, deep oak furrows, shallow spruce scales, nearly smooth beech.
fn scanDepth(kind : u32, c : vec3f, r : f32, height : f32) -> f32 {
  let mature = smoothstep(0.05, 0.16, r);
  switch kind {
    case BARK_PINE: { return mix(0.006, 0.045, pinePlated(c, r, height)); }
    case BARK_OAK: { return mix(0.004, 0.035, mature); }
    case BARK_SPRUCE: { return 0.012 * mature; }
    case BARK_BEECH: { return 0.003; }
    default: { return 0.03 * mature; }
  }
}

// Albedo of each scan layer graded to the measured bark it stands for (the raw scans are brighter or darker and each was shot in its own
// light): Scots pine plates grey-brown about 0.12, its upper flakes orange, oak grey-brown about 0.1, spruce grey-brown, beech pale elephant
// grey, birch paper chalk white, and the oak scan as the birch's near-black foot.
fn scanGrade(kind : u32, layer : i32, col : vec3f) -> vec3f {
  let g = dot(col, vec3f(0.3, 0.55, 0.15));
  switch layer {
    // Warmer than the scan as shot: Scots pine plates are a red-brown grey, hue about 30 to 35 degrees on a sunlit trunk.
    case SCAN_PINE_PLATES: { return col * vec3f(0.54, 0.35, 0.23); }
    case SCAN_PINE_FLAKES: { return col * vec3f(1.5, 1.35, 1.2); }
    case SCAN_SPRUCE: { return mix(vec3f(g), col, 0.7) * 0.65; }
    case SCAN_BEECH: { return mix(vec3f(g), col, 0.25) * vec3f(0.62, 0.62, 0.66); }
    case SCAN_BIRCH_PAPER: { return mix(vec3f(g), col, 0.2) * vec3f(3.7, 3.6, 3.4); }
    default: {
      if (kind == BARK_BIRCH) { return vec3f(g) * 0.28; }
      return col * 0.5;
    }
  }
}

// Sun visibility of a bark point inside its own relief: a short march toward the sun over the height field; 1 = lit, 0 = in a furrow's
// shadow. \`lt\` is the sun direction in the surface frame (x round the limb, y along it, z out of the bark), \`depth\` the relief depth.
fn scanSunShadow(l : ScanLayers, s : ScanCoords, h0 : f32, lt : vec3f, depth : f32, level : f32) -> f32 {
  if (lt.z <= 0.02) { return 1.0; }
  // Horizontal metres the ray covers while it climbs one unit of height above the start.
  let run = lt.xy / lt.z * depth;
  var vis = 1.0;
  for (var i = 1; i <= 8; i++) {
    let t = f32(i) / 8.0;
    let rise = t * (1.0 - h0);
    var sh = s;
    sh.a += run * rise; sh.b += run * rise;
    let above = scanHeightLevel(l, sh, level) - (h0 + rise);
    vis = min(vis, 1.0 - saturate1(above * 6.0));
  }
  return vis;
}

// Parallax occlusion: the bark point seen along the view ray once the furrows sink below the surface. \`vt\` is the direction to the eye in
// the surface frame. Returns the coordinates offset to where the ray meets the height field.
fn scanParallax(l : ScanLayers, s : ScanCoords, vt : vec3f, depth : f32, steps : i32, level : f32) -> ScanCoords {
  let z = max(vt.z, 0.15);
  // The full relief depth seen from this angle shifts the point by \`shift\` metres across the bark.
  let shift = -vt.xy / z * depth;
  var prevDepth = 0.0;
  var prevGap = 1.0 - scanHeightLevel(l, s, level);
  var o = s;
  for (var i = 1; i <= steps; i++) {
    let d = f32(i) / f32(steps);
    var p = s;
    p.a += shift * d; p.b += shift * d;
    let gap = (1.0 - scanHeightLevel(l, p, level)) - d;
    if (gap <= 0.0) {
      // Between the last step above the surface and this one below it.
      let t = prevGap / max(prevGap - gap, 1e-4);
      let dd = mix(prevDepth, d, t);
      o.a = s.a + shift * dd; o.b = s.b + shift * dd;
      return o;
    }
    prevDepth = d; prevGap = gap;
    o = p;
  }
  return o;
}

// Moss and lichen amounts (x, y) of each bark type, as barkSurface sets them.
fn barkWeatherAmounts(kind : u32) -> vec2f {
  switch kind {
    case BARK_PINE: { return vec2f(0.35, 1.0); }
    case BARK_BIRCH: { return vec2f(0.4, 0.1); }
    case BARK_BEECH: { return vec2f(0.7, 0.8); }
    case BARK_SPRUCE: { return vec2f(0.6, 0.45); }
    case BARK_DEAD: { return vec2f(0.8, 1.0); }
    default: { return vec2f(1.0, 1.0); }
  }
}

// Parallax and the furrow shadow run while a pixel covers less than this much bark (m): nearer than about 10 m at 1080p.
const SCAN_POM_FOOTPRINT : f32 = 0.008;

struct ScanBark { s : BarkSurface, n : vec3f, sunOcc : f32 };

// The scanned bark at a fragment: parallax into the relief, the scan's albedo (graded per species), ambient occlusion, normal and roughness,
// the furrows' shadow on the sunlight, then lichen, moss and the wet foot. \`n\` is the smooth surface normal, \`toEye\` the direction to the eye,
// \`sun\` the direction to the sun, \`detail\` whether this LOD and tier take the parallax and furrow shadow, \`steps\` the parallax steps.
fn scanBark(kind : u32, uv : vec2f, radius : f32, scale : f32, height : f32, seed : f32, c : vec3f, n : vec3f, dpx : vec3f, dpy : vec3f,
    footprint : f32, toEye : vec3f, sun : vec3f, detail : bool, steps : i32) -> ScanBark {
  let layers = scanLayers(kind, c, radius, height);
  var sc = scanCoords(uv, radius, scale, seed);
  // Surface frame from the screen derivatives of the bark coordinates (continuous on whichever side of the seam carries the weight).
  var gx = dpdx(sc.a);
  var gy = dpdy(sc.a);
  if (sc.w > 0.5) { gx = dpdx(sc.b); gy = dpdy(sc.b); }
  let r1 = cross(dpy, n);
  let r2 = cross(n, dpx);
  var t = r1 * gx.x + r2 * gy.x;
  var b = r1 * gx.y + r2 * gy.y;
  t = normalize(t - n * dot(n, t) + vec3f(1e-6, 0.0, 0.0));
  b = normalize(b - n * dot(n, b) + vec3f(0.0, 1e-6, 0.0));
  let depth = scanDepth(kind, c, radius, height);
  let texels = f32(textureDimensions(barkScanSurface).x);
  let level = max(log2(max(footprint, 1e-5) * texels / SCAN_METRES[layers.first]), 0.0);
  let near = detail && footprint < SCAN_POM_FOOTPRINT && depth > 0.003;
  if (near) {
    let vt = vec3f(dot(toEye, t), dot(toEye, b), dot(toEye, n));
    sc = scanParallax(layers, sc, vt, depth, steps, level);
  }
  let ss = scanAt(kind, layers, sc, gx, gy);
  var o : ScanBark;
  // The scans' normals are OpenGL style (green up the image); the bark coordinate runs up the limb while the image's v runs down it.
  // Beech bark is nearly smooth: the scan's fine fissures are kept faint on it.
  let relief = select(1.0, 0.4, kind == BARK_BEECH);
  let nt = vec3f(ss.nrm.x * relief, -ss.nrm.y * relief, sqrt(saturate1(1.0 - dot(ss.nrm, ss.nrm))));
  o.n = normalize(t * nt.x + b * nt.y + n * max(nt.z, 0.05));
  o.sunOcc = 0.0;
  if (near) {
    let lt = vec3f(dot(sun, t), dot(sun, b), dot(sun, n));
    o.sunOcc = 1.0 - scanSunShadow(layers, sc, ss.h, lt, depth, level);
  }
  var s : BarkSurface;
  s.col = ss.col;
  if (kind == BARK_BIRCH) {
    // The birch paper keeps its procedural marks over the scanned relief: dark horizontal lenticels and buff where a strip has peeled.
    let bh = birchHeight(c, radius, height, footprint);
    let lent = smoothstep(0.8, 0.45, bh.x) * (1.0 - layers.t);
    let peel = smoothstep(0.55, 0.6, gnoise3(vec3f(c.xy * 2.5, c.z * 9.0) + 21.0)) * 0.5 * (1.0 - layers.t);
    s.col = mix(mix(s.col, vec3f(0.4, 0.3, 0.25), peel), vec3f(0.06, 0.045, 0.035), lent);
  }
  // Dry bark is matte: the scans' roughness only varies it between 0.85 and 1.
  s.rough = mix(0.85, 1.0, ss.rough);
  // The scan's own occlusion, deepened in the bottoms of the furrows.
  s.cavity = mix(0.45, 1.0, ss.ao) * mix(0.75, 1.0, smoothstep(0.0, 0.45, ss.h));
  s.depth = depth;
  s.h = ss.h;
  let amounts = barkWeatherAmounts(kind);
  let twig = 1.0 - smoothstep(0.012, 0.035, radius);
  o.s = barkWeathering(s, c, radius, ss.h, height, n, barkFine(footprint), seed, amounts.x, amounts.y, twig);
  return o;
}

// Bark relief displacement at the extreme tier: the vertex shader pushes a finely cut near trunk in along its normal by this much (m, 0 or
// less), so furrows and fissures sink below the plate faces and break the outline. Only relief at least a few vertices across is used (the
// height is taken at RELIEF_FOOTPRINT, about the vertex spacing); the fragment bump adds the finer detail on top. The depth per bark type
// matches barkSurface's bump depth.
const RELIEF_FOOTPRINT : f32 = 0.012;
const RELIEF_GAIN : f32 = 2.0;

fn barkDisplacement(kind : u32, c : vec3f, r : f32, height : f32, uv : vec2f, scale : f32, seed : f32) -> f32 {
  // With the scans the displacement follows the scanned height, so the geometry, the parallax and the normal agree; the birch only on its black
  // foot and scars.
  if (barkScansReady() && scannedKind(kind)) {
    var weight = 1.0;
    if (kind == BARK_BIRCH) { weight = max(birchFoot(c, r, height), birchScars(birchSheet(c, r), c) * smoothstep(0.05, 0.12, r)); }
    let depth = scanDepth(kind, c, r, height) * weight;
    if (depth < 0.004) { return 0.0; }
    let h = scanHeightLevel(scanLayers(kind, c, r, height), scanCoords(uv, r, scale, seed), 2.0);
    return -depth * (1.0 - h);
  }
  var depth = 0.0;
  switch kind {
    case BARK_PINE: { depth = mix(0.003, 0.05, pinePlated(c, r, height)); }
    case BARK_BIRCH: {
      let q = birchSheet(c, r);
      depth = mix(0.0025, 0.025, max(birchFoot(c, r, height), birchScars(q, c) * smoothstep(0.05, 0.12, r)));
    }
    case BARK_BEECH: { depth = 0.002; }
    case BARK_SPRUCE: { depth = 0.018; }
    case BARK_DEAD: { depth = 0.008; }
    default: { depth = mix(0.003, 0.026, smoothstep(0.05, 0.16, r)); }
  }
  if (depth < 0.006) { return 0.0; }
  let h = barkHeight(kind, c, r, height, RELIEF_FOOTPRINT);
  return min(depth * RELIEF_GAIN * (h - 0.9), 0.0);
}

// Crustose lichen (Lepraria, Lecanora and the like): pale grey-green, powdery crusts flat on the raised bark, in patches from a hand to a
// forearm wide that merge on old trunks; a patch is paler and greener at its growing rim, and the crust is broken into granules. It keeps to the
// plate faces and leaves the furrows dark. \`amount\` 1 covers about a fifth of the bark. Returns the lichen colour and its cover.
// Weight of the fine weathering noise for a pixel covering \`footprint\` metres of bark: full under 1.2 cm, none past 2 cm.
fn barkFine(footprint : f32) -> f32 { return 1.0 - smoothstep(0.012, 0.02, footprint); }

fn crustLichen(c : vec3f, h : f32, seed : f32, amount : f32, fine : f32) -> vec4f {
  let p = c * vec3f(1.0, 1.0, 0.6) + vec3f(seed * 5.1);
  let blotch = bvalue(p * 3.5) * 0.65 + bvalue(p * 9.0 + 2.0) * 0.35;
  var grain = 0.5;
  if (fine > 0.0) { grain = mix(0.5, bvalue(p * 60.0) * 0.6 + bvalue(p * 150.0 + 4.0) * 0.4, fine); }
  let cut = 0.74 - 0.12 * amount;
  let cover = smoothstep(cut, cut + 0.06, blotch + 0.3 * (grain - 0.5)) * smoothstep(0.35, 0.7, h);
  // Pale at the rim of a patch, greyer and a little darker at its old centre.
  let rim = 1.0 - smoothstep(cut + 0.04, cut + 0.16, blotch);
  let col = mix(vec3f(0.17, 0.19, 0.16), vec3f(0.24, 0.27, 0.2), rim) * (0.8 + 0.4 * grain);
  return vec4f(col, cover * 0.75);
}

// Colour, roughness, crevice shading and relief depth of the bark at a point with surface height \`h\`. \`c\` is the cylinder point, \`r\` the limb
// radius, \`height\` metres above the tree's foot, \`nw\` the world normal of the limb (moss takes the north side, -Z, and the tops of limbs), and
// \`seed\` varies the tree.
fn barkSurface(kind : u32, c : vec3f, r : f32, h : f32, height : f32, nw : vec3f, foot : f32, seed : f32) -> BarkSurface {
  var s : BarkSurface;
  // Fine noise (specks, moss texture) is only worth evaluating while a pixel covers less than about 2 cm of bark.
  let near = foot < 0.02;
  let tone = 0.9 + 0.2 * bvalue(vec3f(c.xy * 2.0, c.z * 0.7) + vec3f(seed * 30.0));
  let twig = 1.0 - smoothstep(0.012, 0.035, r);
  var mossAmount = 1.0;
  var lichenAmount = 1.0;
  s.rough = 0.92;
  s.h = h;
  switch kind {
    case BARK_PINE: {
      let thick = pinePlated(c, r, height);
      // Grey-brown plate faces, weathered paler grey on their outer layer, with patches of red-brown where a flake has come away; the
      // fissures are nearly black. Higher up, thin papery flakes of orange-brown, paler where they curl away from the stem.
      // The same layers pineHeight terraces: where the grey outer layer has flaked off, the red-brown layer under it shows.
      var flakeOff = 0.3;
      if (near) { flakeOff = 1.0 - pineLayer(c); }
      let weathered = bvalue(vec3f(c.xy * 3.0, c.z * 1.2) + 7.0);
      let face = mix(vec3f(0.12, 0.1, 0.085), vec3f(0.17, 0.155, 0.14), smoothstep(0.35, 0.8, weathered));
      let plate = mix(vec3f(0.06, 0.045, 0.036), mix(face, vec3f(0.14, 0.08, 0.052), flakeOff * 0.8), smoothstep(0.55, 0.85, h));
      let fissure = vec3f(0.022, 0.016, 0.012);
      let lower = mix(fissure, plate, smoothstep(0.15, 0.6, h));
      let flake = mix(vec3f(0.17, 0.08, 0.04), vec3f(0.3, 0.15, 0.075), smoothstep(0.8, 1.0, h));
      s.col = mix(flake, lower, thick) * tone;
      s.cavity = mix(0.9, mix(0.15, 1.0, smoothstep(0.05, 0.6, h)), thick);
      s.depth = mix(0.003, 0.05, thick);
      s.rough = mix(0.8, 0.95, thick);
      mossAmount = 0.35;
      lichenAmount = 1.0;
    }
    case BARK_BIRCH: {
      let b = birchHeight(c, r, height, foot);
      let paper = vec3f(0.6, 0.58, 0.53) * (0.86 + 0.14 * bvalue(vec3f(c.xy * 3.0, c.z * 12.0) + vec3f(seed)));
      // Pinkish-buff where the outer paper has peeled away in horizontal strips.
      let peeled = smoothstep(0.55, 0.6, gnoise3(vec3f(c.xy * 2.5, c.z * 9.0) + 21.0)) * 0.5 * (0.6 + 0.4 * bvalue(c * vec3f(30.0, 30.0, 4.0)));
      var white = mix(paper, vec3f(0.4, 0.3, 0.25), peeled);
      white = mix(vec3f(0.05, 0.036, 0.03), white, smoothstep(0.42, 0.7, h));
      // The black foot: near-black fissures, grey weathered ridges, and the odd fleck of white paper left on a ridge.
      let ridgeGrey = mix(vec3f(0.035, 0.032, 0.03), vec3f(0.1, 0.095, 0.09), bvalue(c * vec3f(18.0, 18.0, 6.0)));
      let black = mix(vec3f(0.015, 0.013, 0.012), ridgeGrey, smoothstep(0.5, 0.95, h));
      s.col = mix(white, black, smoothstep(0.25, 0.55, b.y));
      s.col = mix(s.col, vec3f(0.08, 0.045, 0.03) * (0.7 + 0.5 * h), twig);
      s.cavity = mix(0.95, mix(0.4, 1.0, h), b.y);
      s.depth = mix(0.0025, 0.025, b.y);
      s.rough = mix(0.7, 0.92, b.y);
      mossAmount = 0.4;
      lichenAmount = 0.4;
    }
    case BARK_BEECH: {
      let mottle = bvalue(vec3f(c.xy * 5.0, c.z * 2.0) + vec3f(seed * 9.0)) + 0.3 * bvalue(c * 25.0);
      s.col = mix(vec3f(0.19, 0.19, 0.18), vec3f(0.31, 0.3, 0.285), smoothstep(0.35, 1.0, mottle)) * (0.92 + 0.6 * (h - 0.8));
      // Green algae film on the weather side, common on smooth beech bark.
      s.col = mix(s.col, vec3f(0.11, 0.14, 0.07), 0.4 * smoothstep(0.55, 0.8, bvalue(c * 1.8 + vec3f(seed))) * smoothstep(-0.2, 0.6, -nw.z));
      s.col = mix(s.col, vec3f(0.11, 0.08, 0.06), twig);
      s.cavity = 0.95;
      s.depth = 0.002;
      s.rough = 0.75;
      mossAmount = 0.7;
      lichenAmount = 0.8;
    }
    case BARK_SPRUCE: {
      // Grey-brown weathered scale faces, each patch its own shade, over red-brown fresh bark showing at the scale edges; the cracks between
      // patches are dark.
      let weathered = bvalue(vec3f(c.xy * 9.0, c.z * 4.0) + 5.0);
      let face = mix(vec3f(0.085, 0.075, 0.065), vec3f(0.13, 0.12, 0.108), smoothstep(0.3, 0.75, weathered));
      let fresh = vec3f(0.095, 0.06, 0.042);
      let scale = mix(mix(vec3f(0.035, 0.028, 0.022), fresh, smoothstep(0.35, 0.55, h)), face, smoothstep(0.55, 0.75, h));
      // Branches are darker than the stem: brown-grey wood with red-brown fresh bark, the pale weathered grey only on the old trunk.
      let branch = 1.0 - smoothstep(0.04, 0.14, r);
      s.col = mix(mix(scale, scale * vec3f(0.62, 0.55, 0.5), branch), vec3f(0.06, 0.042, 0.03), twig) * tone;
      s.cavity = mix(0.45, 1.0, smoothstep(0.4, 0.75, h));
      s.depth = 0.018;
      mossAmount = 0.8;
      lichenAmount = 0.8;
    }
    case BARK_DEAD: {
      let d = deadHeight(c, r, foot);
      let wood = mix(vec3f(0.06, 0.055, 0.05), vec3f(0.27, 0.255, 0.23), smoothstep(0.3, 0.85, h)) * (0.85 + 0.3 * bvalue(vec3f(c.xy * 6.0, c.z * 0.5)));
      let bark = mix(vec3f(0.03, 0.025, 0.02), vec3f(0.1, 0.08, 0.062), smoothstep(0.85, 1.0, h));
      s.col = mix(wood, bark, d.y);
      s.cavity = mix(0.55, 1.0, h);
      s.depth = 0.008;
      s.rough = mix(0.85, 0.95, d.y);
      mossAmount = 0.8;
      lichenAmount = 1.0;
    }
    default: {
      var face = 1.0;
      if (near) { face = 0.78 + 0.3 * bvalue(vec3f(c.xy * 40.0, c.z * 15.0)) + 0.15 * bvalue(c * 130.0); }
      let plate = mix(vec3f(0.075, 0.065, 0.055), vec3f(0.125, 0.115, 0.1) * face, smoothstep(0.65, 1.0, h));
      let furrow = vec3f(0.028, 0.02, 0.015);
      let mature = smoothstep(0.05, 0.16, r);
      let young = vec3f(0.12, 0.105, 0.085) * (0.8 + 0.3 * h);
      s.col = mix(young, mix(furrow, plate, smoothstep(0.08, 0.6, h)), mature) * tone;
      s.cavity = mix(0.9, mix(0.3, 1.0, smoothstep(0.0, 0.65, h)), mature);
      s.depth = mix(0.003, 0.026, mature);
    }
  }
  return barkWeathering(s, c, r, h, height, nw, barkFine(foot), seed, mossAmount, lichenAmount, twig);
}

// Lichen, moss and the wet foot over a bark surface \`s0\` of height \`h\` (shared by the procedural and the scanned bark).
// How forest-grown the tree is (0 open-grown to 1 a long bare bole under a closed canopy), set per pixel by the caller (tree.wgsl) for oak
// and beech: such trunks stand in damp shade, so they carry more moss, higher up the north side, and their bark between the moss is
// darker. Photo trunks in a beech wood measure about 0.9 stop darker against the frame than open-grown ones lit by the sky.
var<private> barkForest : f32 = 0.0;

// \`fine\` (0 to 1, barkFine) weighs in the fine noise: faded in, not switched on, so the edges of moss and lichen do not jump along the line on
// a trunk where the pixel footprint crosses the threshold.
fn barkWeathering(s0 : BarkSurface, c : vec3f, r : f32, h : f32, height : f32, nw : vec3f, fine : f32, seed : f32, mossAmount : f32, lichenAmount : f32, twig : f32) -> BarkSurface {
  var s = s0;
  // Crustose lichen: pale grey-green crusts on the raised bark, in patches a hand to a forearm wide (crustLichen).
  let l = crustLichen(c, h, seed, lichenAmount, fine) * (1.0 - twig * 0.5);
  s.col = mix(s.col, l.rgb, l.a);
  s.rough = mix(s.rough, 1.0, l.a);
  // Moss: thickest round the foot and over the root swell, climbing the north (-Z) side and lying on the tops of near-level limbs. It fills
  // the furrows first and spreads over the plates only where it is thick, so its edge follows the bark relief; the edge is soft and frayed,
  // and the moss itself is a mat of small cushions, bright on their tops and dark between them.
  // Round the foot the moss is a mat on the shaded north side and in patches elsewhere, so the root flare and the surface roots keep bark
  // showing between the patches instead of wearing a solid green skirt.
  let foot01 = smoothstep(0.9 + 0.8 * seed, 0.0, height) * (0.45 + 0.55 * smoothstep(-0.3, 0.7, -nw.z));
  let north = smoothstep(-0.1, 0.8, -nw.z) * smoothstep(3.0 + 4.0 * seed + 5.0 * barkForest, 0.2, height) * (0.55 + 0.3 * barkForest);
  let top = smoothstep(0.5, 0.9, nw.y) * smoothstep(0.05, 0.15, r) * 0.5;
  // (select() would evaluate both sides, so the fine terms sit behind ifs.) Patches a hand wide break the mat up at every distance.
  var patchy = bvalue(vec3f(c.xy * 4.0, c.z * 2.0) + vec3f(seed * 17.0)) + 0.3 * (bvalue(c * 12.0 + 5.0) - 0.5);
  var cushion = 0.5;
  if (fine > 0.0) {
    patchy += fine * (0.35 * (bvalue(c * 45.0) - 0.5) + 0.2 * (bvalue(c * 110.0) - 0.5));
    cushion = mix(0.5, 0.6 * bvalue(c * 70.0) + 0.4 * bvalue(c * 180.0 + 9.0), fine);
  }
  let want = max(foot01 * 1.1, max(north, top)) * mossAmount * (1.0 + 0.8 * barkForest) * (0.45 + 0.6 * seed);
  let moss = smoothstep(0.88 - want, 1.12 - want, patchy + 0.45 * (0.65 - h)) * (1.0 - twig);
  // Thin moss at the edge of a patch is a yellower, sparser film; the thick mat is deeper green.
  let mossCol = mix(vec3f(0.032, 0.042, 0.016), mix(vec3f(0.075, 0.08, 0.03), vec3f(0.06, 0.085, 0.025), moss), smoothstep(0.15, 0.85, cushion));
  s.col = mix(s.col, mossCol, moss);
  s.rough = mix(s.rough, 1.0, moss);
  // Damp, shaded bark of a forest-grown trunk.
  s.col *= 1.0 - 0.25 * barkForest * (1.0 - moss);
  // The mat sits proud of the bark and fills its furrows; its own surface is the cushions.
  s.h = mix(h, max(h, 0.7) + 0.35 * (cushion - 0.5), moss);
  s.depth = mix(s.depth, max(s.depth, 0.012), moss);
  s.cavity = mix(s.cavity, 0.7 + 0.3 * smoothstep(0.2, 0.8, cushion), moss);
  // Soil splashed up by rain over the lowest hand-widths of bark, and the bark darkened where it meets the ground (the litter round the foot
  // shades it from the sky).
  let splash = smoothstep(0.3, 0.0, height + 0.1 * gnoise3(c * 9.0)) * (1.0 - moss);
  s.col = mix(s.col, vec3f(0.075, 0.058, 0.042), 0.55 * splash);
  s.cavity *= mix(0.5, 1.0, smoothstep(0.0, 0.4, height));
  // Wet, darker bark just above the soil, where splash and ground damp keep it moist.
  let wet = smoothstep(0.4, 0.0, height + 0.12 * gnoise3(c * 5.0));
  s.col *= 1.0 - 0.35 * wet;
  s.rough = mix(s.rough, 0.6, wet * (1.0 - moss));
  return s;
}
`,"./shaders/vegetation/tree_cull.wgsl":`// One thread per instance slot: distance, pixel-size and frustum culling of a bounding sphere, LOD selection, and an append into the
// per-(variant, LOD) visible lists (a plant inside a LOD hand-over band goes into both lists, rocks switch hard). Counts become indirect instance counts in tree_finalize.wgsl; nothing is read back.
#include "vegetation/veg_params.wgsl"
#include "vegetation/veg_instance.wgsl"

@group(2) @binding(1) var<storage, read> instances : array<Instance>;
@group(2) @binding(2) var<storage, read> variants : array<Variant>;
@group(2) @binding(3) var<storage, read_write> counts : array<atomic<u32>>;
@group(2) @binding(4) var<storage, read_write> visible : array<u32>;

// Slack on the frustum test for wind sway and rock tilt.
const FRUSTUM_SCALE : f32 = 1.08;
const FRUSTUM_PAD : f32 = 0.6;

@compute @workgroup_size(64)
fn cull(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= vp.treeCount.x) { return; }
  let inst = instances[i];
  if (inst.scale <= 0.0) { return; }
  let v = variants[inst.variant];
  let c = inst.pos + vec3f(0.0, v.bound.x * inst.scale, 0.0);
  let r = v.bound.y * inst.scale;
  let d = distance(c, frame.camPos.xyz);
  let farDistance = select(vp.tree.y, PARK_PLANT_DISTANCE, inst.nrm == PARK_PLANT_NORMAL);
  if (d > farDistance) { return; }
  let pxPerM = frame.screen.y * 0.5 * frame.proj[1][1];
  if (r * pxPerM < vp.tree.z * d) { return; }
  // A spread crown (tree.wgsl crownSpread, tint alpha) reaches further out than the variant's bounding sphere.
  // The crown spread in the tint alpha, and the per-tree crown size variation and lean (tree.wgsl crownSpread, at most 1.12 x 1.16, and a
  // top up to 3 % of the height off the axis).
  let spread = max(unpack4x8unorm(inst.tint).a * 2.0, 1.0) * 1.2;
  if (!frustumSphereVisible(c, r * spread * FRUSTUM_SCALE + FRUSTUM_PAD)) { return; }
  let e = lodEdges(v, inst);
  let b = select(LOD_FADE_BAND, 0.0, v.range.z == 2u);
  if (d < e.x * (1.0 + b)) { append(0u, inst.variant, v.range.x, i); }
  if (d >= e.x * (1.0 - b) && d < e.y * (1.0 + b)) { append(1u, inst.variant, v.range.x, i); }
  if (d >= e.y * (1.0 - b)) { append(2u, inst.variant, v.range.x, i); }
}

fn append(lod : u32, variant : u32, first : u32, i : u32) {
  let slot = atomicAdd(&counts[variant * 3u + lod], 1u);
  visible[lod * vp.treeCount.x + first + slot] = i;
}
`,"./shaders/vegetation/tree_finalize.wgsl":`// Copies the visible counts into the instanceCount word of each indexed indirect draw (the other four words are written once by the CPU).
#include "vegetation/veg_params.wgsl"

@group(2) @binding(1) var<storage, read> counts : array<u32>;
@group(2) @binding(2) var<storage, read_write> args : array<u32>;

@compute @workgroup_size(64)
fn finalize(@builtin(local_invocation_index) k : u32) {
  if (k < vp.treeCount.y) { args[k * 5u + 1u] = counts[k]; }
}
`,"./shaders/vegetation/veg_far.wgsl":`// Far-field canopy: one camera-facing card per clump of trees (treePlanFar.ts). The cards stand in for trees the real instances do not
// cover: beyond the tree draw distance (they dither in over the same band the real trees dither out of) and over ground where the tree
// instance cap left no trees at all. A card is drawn as up to three procedural crowns (cones for conifers, ellipses for broadleaves) with
// a ragged edge and a rounded normal, so the sun, sky and aerial perspective shade it like the real canopy. All culling is in the vertex
// shader (a rejected card collapses to a point outside the clip volume); the draw is 4 vertices per card.
#include "vegetation/veg_params.wgsl"
#include "vegetation/veg_noise.wgsl"
#include "terrain/gbuffer.wgsl"

struct Card {
  pos : vec3f,
  height : f32,
  width : f32,
  tint : u32,   // unorm8x4 colour multiplier, decoded as value * 2
  near : f32,   // camera distance the card shows from; 0 = the real-tree draw distance
  info : u32,   // species 3 bits | lobes - 1 2 bits | 16-bit random
};

@group(2) @binding(1) var<storage, read> cards : array<Card>;

const FOLIAGE_ID : f32 = 5.0;
// Same band as the real trees' fade-out in tree.wgsl.
const FADE_START : f32 = 0.86;
const FADE_END_START : f32 = 0.88;
// Far-LOD blobs of the real trees are painted this much darker than the leaf tone (tree.wgsl BLOB_DARKEN).
const DARKEN : f32 = 0.78;
// Conifer needles are shaded darker and less blue than their tone (tree.wgsl NEEDLE_SHADE).
const NEEDLE_SHADE : vec3f = vec3f(0.55, 0.6, 0.4);
const SINK : f32 = 0.05;

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) world : vec3f,
  @location(1) uv : vec2f,                       // metres from the card's bottom centre
  @location(2) @interpolate(flat) card : vec4f,  // xy = horizontal direction to the camera, zw = card size (m)
  @location(3) @interpolate(flat) ids : vec4u,   // x = tint, y = info, z = card index
  @location(4) @interpolate(flat) fade : vec2f,  // draws where t >= 1 - x and t < y
};

// Leaf albedo and translucency of spruce, pine, oak and birch: defines from the variant table (farToneDefines in treePlanFar.ts).
fn toneOf(species : u32) -> vec4f {
  switch (species) {
    case 0u: { return vec4f(\${TONE0}); }
    case 1u: { return vec4f(\${TONE1}); }
    case 2u: { return vec4f(\${TONE2}); }
    default: { return vec4f(\${TONE3}); }
  }
}

@vertex
fn vs(@builtin(vertex_index) vid : u32, @builtin(instance_index) iid : u32) -> VsOut {
  let c = cards[iid];
  let mid = c.pos + vec3f(0.0, 0.5 * c.height, 0.0);
  let toCam = frame.camPos.xyz - mid;
  let d = length(toCam);
  let near = select(c.near, vp.tree.y, c.near <= 0.0);
  let fadeIn = smoothstep(FADE_START * near, near, d);
  let fadeOut = 1.0 - smoothstep(FADE_END_START * vp.far.x, vp.far.x, d);
  var o : VsOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (fadeIn <= 0.0 || fadeOut <= 0.0 || !frustumSphereVisible(mid, 0.5 * length(vec2f(c.width, c.height)))) { return o; }
  let horiz = normalize(vec2f(toCam.x, toCam.z) + vec2f(1.0e-4, 0.0));
  let right = vec3f(horiz.y, 0.0, -horiz.x);
  let u = select(-0.5, 0.5, (vid & 1u) == 1u) * c.width;
  let v = select(0.0, c.height, (vid & 2u) == 2u);
  let world = c.pos + right * u + vec3f(0.0, v - SINK * c.height, 0.0);
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.world = world;
  o.uv = vec2f(u, v);
  o.card = vec4f(horiz, c.width, c.height);
  o.ids = vec4u(c.tint, c.info, iid, 0u);
  o.fade = vec2f(fadeIn, fadeOut);
  return o;
}

fn ditherThreshold(px : vec2u, id : u32) -> f32 {
  var t = textureLoad(blueNoise, vec2i(px & vec2u(127u)), 0).x + hash11(id);
  if ((frame.misc.y & 4u) != 0u) { t += f32(frame.misc.x & 255u) * 0.6180339887; }
  return fract(t);
}

struct Crown {
  inside : bool,
  local : vec2f,   // x in -1..1 across the crown, y in 0..1 up it
  shade : f32,     // the crown's own brightness: neighbouring trees in one card differ in vigour and light
};

fn noise2(p : vec2f, s : f32) -> f32 { return vnoise3(vec3f(p, s)); }

// Is metre position \`p\` inside crown \`k\` of the card? Conifers are cones with a serrated edge, broadleaves lumpy ellipses.
fn crown(k : u32, lobes : u32, conifer : bool, p : vec2f, width : f32, height : f32, rnd : u32, fine : bool) -> Crown {
  var r = vec3f(u01(pcg(rnd * 7u + k * 131u + 1u)), u01(pcg(rnd * 13u + k * 17u + 5u)), u01(pcg(rnd * 29u + k * 61u + 9u)));
  var cr : Crown;
  cr.inside = false;
  cr.local = vec2f(0.0);
  cr.shade = 0.72 + 0.5 * u01(pcg(rnd * 41u + k * 977u + 3u));
  let cx = select((r.x - 0.5) * 0.55 * width, 0.0, lobes == 1u && k == 0u);
  let h = height * select(0.62 + 0.38 * r.y, 1.0, k == 0u);
  let jag = noise2(p * select(1.3, 0.9, conifer), f32(k) * 3.7 + 1.0) - 0.5;
  if (conifer) {
    let base = 0.07 * h;
    let ly = (p.y - base) / max(h - base, 1.0e-3);
    if (ly < 0.0 || ly > 1.0) { return cr; }
    var half = (0.17 + 0.05 * r.z) * h * pow(1.0 - ly, 0.8) + 0.4;
    var edge = 0.45 * jag * (1.0 - ly * 0.6);
    if (fine) {
      // Whorls: each ring of branches droops out wide at its tip and the next ring starts narrower, a saw-toothed spruce outline, and the
      // needle sprays fray the edge finely.
      let tier = fract((p.y - base) / 1.1 + r.x);
      half *= 0.72 + 0.38 * smoothstep(0.0, 0.85, tier);
      edge += 0.35 * (noise2(p * 3.3, f32(k) * 5.1 + 9.0) - 0.5);
    }
    let x = (p.x - cx) / half;
    cr.local = vec2f(clamp(x, -1.0, 1.0), ly);
    cr.inside = abs(x) < 1.0 + edge;
  } else {
    let a = (0.36 + 0.1 * r.z) * h + 0.5;
    let b = 0.36 * h;
    let cy = 0.3 * h + b;
    let x = (p.x - cx) / a;
    let y = (p.y - cy) / b;
    let rr = length(vec2f(x, y));
    cr.local = vec2f(clamp(x, -1.0, 1.0), clamp(0.5 + 0.5 * y, 0.0, 1.0));
    var edge = 0.5 * jag;
    // A broadleaf crown is a heap of leaf clumps a metre or two across: their bulges and notches break the outline at a finer scale.
    if (fine) { edge += 0.3 * (noise2(p * 1.9, f32(k) * 7.3 + 3.0) - 0.5) + 0.12 * (noise2(p * 4.5, f32(k) + 21.0) - 0.5); }
    cr.inside = rr < 1.0 + edge;
  }
  return cr;
}

@fragment
fn fs(in : VsOut) -> FsOut {
  let t = ditherThreshold(vec2u(in.pos.xy), in.ids.z);
  if (t < 1.0 - in.fade.x || t >= in.fade.y) { discard; }

  let info = in.ids.y;
  let species = info & 7u;
  let lobes = ((info >> 3u) & 3u) + 1u;
  let rnd = info >> 5u;
  let conifer = species < 2u;
  let width = in.card.z;
  let height = in.card.w;
  let p = in.uv + vec2f(0.0, SINK * height);
  // The extreme tier (vp.tree.w = 1) draws the cards with a real silhouette: whorled or clumped edges, sky gaps through the crown, lit and
  // shaded clumps and the trunk below the crown.
  let fine = vp.tree.w > 0.5;
  var hit : Crown;
  hit.inside = false;
  for (var k = 0u; k < lobes; k++) {
    let cr = crown(k, lobes, conifer, p, width, height, rnd, fine);
    if (cr.inside && (!hit.inside || cr.local.y > hit.local.y)) { hit = cr; }
  }
  var trunk = false;
  if (!hit.inside) {
    // The trunk under the crown: a dark stem a few percent of the tree's height wide, from the ground to where the crown starts.
    let stem = select(0.035, 0.025, conifer) * height;
    if (!fine || p.y > select(0.32, 0.12, conifer) * height || abs(p.x) > stem) { discard; }
    trunk = true;
    hit.local = vec2f(p.x / stem, 0.0);
  }
  var clump = 0.5;
  if (fine && !trunk) {
    clump = noise2(p * select(1.4, 2.2, conifer), 31.0 + f32(rnd & 15u));
    // Gaps: sky shows through between clumps and branch tiers, more toward the rim and the top.
    let rim = max(abs(hit.local.x), select(abs(hit.local.y * 2.0 - 1.0), hit.local.y, conifer));
    if (clump < 0.12 + 0.22 * smoothstep(0.55, 1.0, rim)) { discard; }
  }

  // Rounded normal in the card frame (x right, y up, z towards the camera): a sphere for broadleaves, a cone for conifers.
  let lx = hit.local.x;
  let ly = hit.local.y;
  var nl : vec3f;
  if (conifer) {
    nl = vec3f(lx * 0.85, 0.5, sqrt(max(1.0 - lx * lx, 0.1)));
  } else {
    let yy = (ly - 0.5) * 2.0;
    nl = vec3f(lx, yy, sqrt(max(1.0 - lx * lx - yy * yy, 0.05)));
  }
  let horiz = in.card.xy;
  let right = vec3f(horiz.y, 0.0, -horiz.x);
  var n = normalize(right * nl.x + vec3f(0.0, nl.y, 0.0) + vec3f(horiz.x, 0.0, horiz.y) * nl.z);
  if (fine && !trunk) {
    // Each clump bulges toward the light on its own: tilt the normal by the clump noise's slope.
    let e = 0.35;
    let gx = noise2((p + vec2f(e, 0.0)) * select(1.4, 2.2, conifer), 31.0 + f32(rnd & 15u)) - clump;
    let gy = noise2((p + vec2f(0.0, e)) * select(1.4, 2.2, conifer), 31.0 + f32(rnd & 15u)) - clump;
    n = normalize(n - (right * gx + vec3f(0.0, gy, 0.0)) * 2.5);
  }

  let tone = toneOf(species);
  let tint = unpack4x8unorm(in.ids.x).rgb * 2.0;
  let tex = 0.7 + 0.6 * noise2(p * 0.9, 17.0 + f32(species));
  let ao = mix(0.3, 1.0, smoothstep(0.0, 0.8, ly)) * (1.0 - 0.35 * lx * lx);
  var col = tone.rgb * tint * tex * (0.3 + 0.7 * ao) * DARKEN * select(vec3f(1.0), NEEDLE_SHADE, conifer);
  // Clumps facing out are brighter, the hollows between them darker.
  if (fine) { col *= 0.75 + 0.5 * clump; }
  col *= hit.shade;
  if (trunk) { col = select(vec3f(0.07, 0.06, 0.05), vec3f(0.08, 0.05, 0.035), conifer); }

  var o : FsOut;
  o.albedo = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), ao);
  o.normal = vec4f(octEncode(n), 1.0, 0.0);
  o.misc = vec4f(FOLIAGE_ID / 255.0, min(tone.a * 1.9, 1.0), 0.0, 0.0);
  o.motion = motionVectorPrev(in.world, in.world);
  return o;
}
`,"./shaders/vegetation/veg_instance.wgsl":`// Static tree, bush and rock instances and the per-variant table, shared by the cull and draw shaders.
// Layouts mirrored by src/render/vegetation/instanceData.ts.
#include "vegetation/veg_params.wgsl"

struct Instance {
  pos : vec3f,
  scale : f32,     // uniform scale; a rock's radius in metres. 0 marks a padding slot
  yaw : f32,
  variant : u32,
  tint : u32,      // unorm8x4 colour multiplier, decoded as value * 2
  nrm : u32,       // terrain normal (x, z) as two snorm16
};

struct Variant {
  range : vec4u,     // x = first instance slot (multiple of 64), y = instance count, z = kind (0 tree, 1 bush, 2 rock)
  bound : vec4f,     // x = bounding sphere centre height, y = radius (m at scale 1), z = LOD0 range, w = LOD1 range (in radii)
  shape : vec4f,     // x = mesh height, y = sway Hz, z = sway strength (crown offset per m/s of wind, as a fraction of height), w = leaf flutter (m)
  leafTone : vec4f,  // rgb = leaf or rock albedo, a = translucency
  crown : vec4f,     // x = crown centre height, yzw = crown radii (m at scale 1; zero for rocks)
};

const KIND_BUSH : u32 = 1u;
// Reserved packed normal: the CPU encoder uses [-32767,32767], never -32768.
const PARK_PLANT_NORMAL : u32 = 0x80008000u;
const PARK_PLANT_DISTANCE : f32 = 1900.0;

fn yawRotate(p : vec3f, yaw : f32) -> vec3f {
  let c = cos(yaw);
  let s = sin(yaw);
  return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// Instances inside this relative band around a LOD hand-over distance are drawn at both LODs and dithered against each other.
const LOD_FADE_BAND : f32 = 0.12;

// Distances (m) at which an instance hands over from LOD0 to LOD1 and from LOD1 to LOD2 (the cull and the draw shaders must agree).
// At the extreme tier (vp.tree.w = 1) a tree never drops to its LOD2 crown billboards: out to the draw distance it keeps its LOD1 mesh,
// whose limbs and leaf clusters give a real silhouette with gaps, so distant forest does not turn into smooth blobs.
const NEVER : f32 = 1.0e9;

fn lodEdges(v : Variant, inst : Instance) -> vec2f {
  let reach = v.bound.y * inst.scale * vp.tree.x;
  var e = vec2f(v.bound.z, v.bound.w) * reach;
  if (vp.tree.w > 0.5 && v.range.z != 2u) { e.y = NEVER; }
  return e;
}
`,"./shaders/vegetation/veg_noise.wgsl":`// 3D value noise for procedural bark; integer-hashed so it is stable under any camera or instance transform.
#include "vegetation/veg_params.wgsl"

fn vnoise3(p : vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let b = bitcast<vec3u>(vec3i(i));
  let x00 = mix(hash31(b), hash31(b + vec3u(1u, 0u, 0u)), u.x);
  let x10 = mix(hash31(b + vec3u(0u, 1u, 0u)), hash31(b + vec3u(1u, 1u, 0u)), u.x);
  let x01 = mix(hash31(b + vec3u(0u, 0u, 1u)), hash31(b + vec3u(1u, 0u, 1u)), u.x);
  let x11 = mix(hash31(b + vec3u(0u, 1u, 1u)), hash31(b + vec3u(1u, 1u, 1u)), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}
`,"./shaders/vegetation/veg_params.wgsl":`// Vegetation uniforms shared by every vegetation shader (group 2, binding 0), plus the frustum test used by the compute culls.
// Layout mirrored by packVegParams() in src/render/vegetation/params.ts.
#include "common/world_bindings.wgsl"

struct VegParams {
  wind : vec4f,     // xy = unit wind direction (x, z), z = mean speed (m/s), w = unused
  quad : vec4f,     // xyz = quad position, w = total thrust (N); 0 disables prop wash and trample
  quadVel : vec4f,  // xyz = quad velocity (m/s)
  grass : vec4f,    // x = patch size (m), y = grass distance, z = full-density radius, w = blades per m2
  grass2 : vec4f,   // x,y unused (level of detail is chosen by projected size in grass_cull.wgsl), z = water level (-1e9 when none), w = slots per patch
  cells : vec4i,    // xy = first cell of the camera-centred patch grid, z = cells per side, w = seed
  caps : vec4u,     // xyz = grass instance capacity of LOD0..2, w = chunk capacity
  tree : vec4f,     // x = LOD distance scale, y = max draw distance (m), z = smallest bounding radius kept (pixels), w = 1 for extreme-tier leaf detail
  treeCount : vec4u, // x = instance slots (padding included; also the visible-list stride per LOD), y = number of draws
  far : vec4f,      // x = canopy-card fade-out distance (m)
};

@group(2) @binding(0) var<uniform> vp : VegParams;

const NO_WATER_LEVEL : f32 = -1.0e8;

// Sphere against the five side planes of the (reverse-Z, infinite-far) view frustum; the far plane is at infinity.
fn frustumSphereVisible(c : vec3f, r : f32) -> bool {
  let m = frame.viewProjUnjittered;
  let x = vec4f(m[0].x, m[1].x, m[2].x, m[3].x);
  let y = vec4f(m[0].y, m[1].y, m[2].y, m[3].y);
  let z = vec4f(m[0].z, m[1].z, m[2].z, m[3].z);
  let w = vec4f(m[0].w, m[1].w, m[2].w, m[3].w);
  let p = vec4f(c, 1.0);
  let planes = array<vec4f, 5>(w + x, w - x, w + y, w - y, w - z);
  for (var i = 0; i < 5; i++) {
    let pl = planes[i];
    if (dot(pl, p) < -r * length(pl.xyz)) { return false; }
  }
  return true;
}
`,"./shaders/vegetation/veg_wind.wgsl":`// Ambient wind, rotor prop wash and trample, shared by grass and trees. All bend results are (x, z) tilt angles in radians of the
// blade axis away from vertical, so callers just add them and clamp.
#include "vegetation/veg_params.wgsl"

const WASH_ROTOR_AREA : f32 = 0.0507;   // four 5" props: 4 * pi * 0.0635^2
const AIR_DENSITY : f32 = 1.2;

fn vegLattice(p : vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let ip = bitcast<vec2u>(vec2i(i));
  let a = hash21(ip);
  let b = hash21(ip + vec2u(1u, 0u));
  let c = hash21(ip + vec2u(0u, 1u));
  let d = hash21(ip + vec2u(1u, 1u));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Local air velocity (x, z) in m/s: gusts travel along the mean wind as two wave trains (about 57 m and 14 m long) that modulate the mean
// speed, plus turbulence advected by the flow.
fn windAt(pos : vec3f, t : f32) -> vec2f {
  let dir = vp.wind.xy;
  let speed = vp.wind.z;
  let along = dot(pos.xz, dir);
  let across = dot(pos.xz, vec2f(-dir.y, dir.x));
  let phase = along - 0.8 * speed * t;
  let g1 = 0.5 + 0.5 * sin(phase * 0.11 + 0.35 * sin(across * 0.05));
  let g2 = 0.5 + 0.5 * sin(phase * 0.46 + across * 0.13 + 1.7);
  let gust = 0.45 + 0.75 * g1 * (0.55 + 0.45 * g2);
  let adv = pos.xz * 0.55 - dir * speed * 0.5 * t;
  let turb = vec2f(vegLattice(adv), vegLattice(adv + vec2f(17.3, 4.1))) - vec2f(0.5);
  return dir * (speed * gust) + turb * (0.9 * speed);
}

// Prop wash: momentum-theory induced velocity of the four rotors, a turbulent jet that decays with distance below the quad, and a wall
// jet spreading outward along the ground. The footprint trails behind a moving quad. Returns (bend x, bend z, height squash 0..1).
fn washAt(root : vec3f, h : f32, t : f32, rnd : f32) -> vec3f {
  let thrust = vp.quad.w;
  if (thrust < 0.3) { return vec3f(0.0); }
  let vi = sqrt(thrust / (2.0 * AIR_DENSITY * WASH_ROTOR_AREA));
  let depth = vp.quad.y - root.y;
  if (depth < 0.02 || depth > 8.0) { return vec3f(0.0); }
  let lag = clamp(depth / (2.0 * vi), 0.0, 0.7);
  let centre = vp.quad.xz - vp.quadVel.xz * lag;
  let rel = root.xz - centre;
  let r = length(rel);
  let radial = select(vec2f(cos(rnd * TAU), sin(rnd * TAU)), rel / max(r, 1e-4), r > 0.02);
  let jet = 2.0 * vi * min(1.0, 0.75 / (depth + 0.05));
  let rp = 0.3 + 0.55 * depth;
  let x = r / rp;
  let u = jet * x * exp(1.0 - x);
  let mag = 1.5 * (1.0 - exp(-0.03 * u * u * (0.25 + 2.0 * h)));
  let swirl = vec2f(-radial.y, radial.x);
  let shiver = sin(t * 41.0 + rnd * 97.0) * 0.22 * mag + sin(t * 23.0 + rnd * 41.0) * 0.12 * mag;
  let dir = radial + 0.3 * swirl + 0.5 * shiver * swirl;
  let squash = saturate1(u / 9.0) * exp(-x * x);
  return vec3f(dir * (mag + shiver), squash);
}

// Body contact when the quad sits on or just above the grass: blades under the frame are pushed outward and flat.
fn trampleAt(root : vec3f) -> vec2f {
  let above = vp.quad.y - root.y;
  if (above > 0.6 || above < -0.2) { return vec2f(0.0); }
  let rel = root.xz - vp.quad.xz;
  let r = length(rel);
  if (r > 0.3) { return vec2f(0.0); }
  let k = 1.0 - r / 0.3;
  return rel / max(r, 1e-3) * (1.2 * k * k);
}
`}),t=new Map;for(let[n,r]of Object.entries(e))t.set(n.replace(/^\.\/shaders\//,``),r);var n=null;function r(e,t={}){let r=new Set,a=i(e,t,r);return n?.(e,[...r],t,a),a}function i(e,n,r){let i=[],a=(e,o)=>{if(r.has(e))return;r.add(e);let s=t.get(e);if(s===void 0)throw Error(`WGSL include not found: "${e}" (from ${o.join(` -> `)||`root`})`);let c=[],l=s.split(`
`);for(let t=0;t<l.length;t++){let r=l[t],s=r.trim(),u;if(u=s.match(/^#ifdef\s+(\w+)/)){c.push(!n[u[1]]);continue}if(u=s.match(/^#ifndef\s+(\w+)/)){c.push(!!n[u[1]]);continue}if(s.startsWith(`#else`)){c.push(!c.pop());continue}if(s.startsWith(`#endif`)){c.pop();continue}if(!c.some(Boolean)){if(u=s.match(/^#include\s+"([^"]+)"/)){a(u[1],[...o,e]);continue}i.push(r.replace(/\$\{(\w+)\}/g,(r,i)=>String(n[i]??(()=>{throw Error(`Undefined WGSL define ${i} in ${e}:${t+1}`)})())))}}};return a(e,[]),i.join(`
`)}export{r as t};