// Key-light (sun or moon) soft shadow: one binary visibility ray per RT texel, aimed at a random point inside the light's angular disc
// (blue noise + R2 per frame), so the penumbra width follows the occluder distance. The temporal + a-trous passes turn it into a soft value.
// Foliage comes from the canopy shadow map of every placed tree (src/render/terrain/canopyShadow.ts) rather than from the crown spheres
// (pipelines.ts sets CANOPY_SHADOW_MAP, which makes traceBvhTransmit skip them): only a few hundred trees near the scene focus have spheres,
// and their thin extinction let most of the sun through a crown. Trunks and limbs still cast from their capsules.
#include "rt/rt_trace_io.wgsl"

const SHADOW_RANGE : f32 = 6000.0;

@group(${GRP}) @binding(17) var canopyShadowTex : texture_2d<f32>;

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

// Fraction of the key light the crowns let through to p along d.
fn canopyTransmittance(p : vec3f, d : vec3f) -> f32 {
  let dy = max(d.y, CANOPY_MIN_SUN_Y);
  let slant = CANOPY_STEP_M / dy;
  var tau = 0.0;
  for (var k = 0; k < CANOPY_STEPS; k++) {
    let h = CANOPY_STEP_M * (f32(k) + 0.5);
    let q = p + d * (h / dy);
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
    if (vis > 0.0) { vis *= canopyTransmittance(o, dir); }
  }
  textureStore(out0, px, vec4f(vis, 0.0, 0.0, 0.0));
}
