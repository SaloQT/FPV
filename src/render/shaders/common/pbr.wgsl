// Shared BRDF helpers (GGX / Smith-correlated / Schlick). Include after common/math.wgsl (PI, INV_PI, saturate1).
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

// Colour of the light a leaf of reflectance `c` passes: chlorophyll absorbs red and blue on the way through far more than green and the cell walls
// scatter little blue back out, so a backlit leaf glows a saturated yellow-green (a leaf's transmittance peaks near 550 nm and has almost no blue).
// Saturation is raised about the luminance, which it keeps, then tilted toward yellow.
fn leafTransmitColour(c : vec3f) -> vec3f {
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  return max(vec3f(l) + (c - vec3f(l)) * 1.15, vec3f(0.0)) * vec3f(1.08, 1.04, 0.7);
}

// The forward-scattered share of the light a leaf of translucency `t` passes, seen from its shaded side: a thin lamina scatters most of what it
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

// Outgoing radiance from one directional light. `e` is the illuminance on a surface facing the light (lux), `angRadius` the
// light's angular radius (rad, widens the specular lobe so a point-like sun does not alias into a 1e9 nit speck).
// translucency > 0 adds wrapped diffuse plus back-lit transmission (foliage), the transmitted light coloured `transmitColor` (leafTransmitColour
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
