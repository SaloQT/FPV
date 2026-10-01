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

// Outgoing radiance from one directional light. `e` is the illuminance on a surface facing the light (lux), `angRadius` the
// light's angular radius (rad, widens the specular lobe so a point-like sun does not alias into a 1e9 nit speck).
// translucency > 0 adds wrapped diffuse plus back-lit transmission (foliage).
fn directLight(l : vec3f, n : vec3f, v : vec3f, diffuseColor : vec3f, f0 : vec3f, roughness : f32,
               translucency : f32, e : vec3f, angRadius : f32) -> vec3f {
  let ndl = dot(n, l);
  let wrap = 0.5 * translucency;
  let diffuseNl = saturate1((ndl + wrap) / (1.0 + wrap));
  let back = translucency * saturate1(-ndl) * (0.25 + 0.75 * pow(saturate1(dot(-l, v)), 4.0)) * LEAF_TRANSMITTANCE;
  var lo = diffuseColor * (diffuseNl + back) * INV_PI;
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
