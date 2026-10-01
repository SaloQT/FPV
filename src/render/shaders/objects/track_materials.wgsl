// Procedural materials of the static track mesh, selected by the per-vertex kind (K_* defines from materials.ts).
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
  o.albedo = mix(orange, vec3f(0.72, 0.72, 0.7), band);
  o.roughness = mix(0.45, 0.22, band);
  return o;
}

fn shadeTrack(m : MatIn) -> Surf {
  var o = newSurf(vec3f(0.5), m.n, 0.7, MAT_GATE);
  o.ao = m.ao;
  let gate = u32(m.a3 + 0.5);
  switch (m.kind) {
    case ${K_GATE_FRAME}u: {
      let info = gates[min(gate, arrayLength(&gates) - 1u)];
      let grain = vnoise2(m.uv * 320.0) * (1.0 - saturate1(m.fp / 0.004));
      let h = m.world.y - terrainHeightAt(m.world.xz);
      let dirt = smoothstep(0.55, 0.0, h) * (0.2 + 0.6 * fbm2(m.uv * 25.0));
      o.albedo = mix(info.colour.rgb * (0.88 + 0.16 * grain), vec3f(0.11, 0.085, 0.06), dirt);
      o.roughness = 0.4 + 0.12 * grain + 0.4 * dirt;
    }
    case ${K_GATE_CHEVRON}u: {
      let st = stripes((m.uv.x + m.uv.y) / 0.05, m.fp / 0.05);
      o.albedo = mix(vec3f(0.025), vec3f(0.78), st);
      o.roughness = mix(0.5, 0.3, st);
    }
    case ${K_GATE_LED}u: {
      let led = gateLed(gate);
      o.albedo = led.rgb;
      o.emissive = led.a;
      o.roughness = 0.3;
      o.material = MAT_EMISSIVE;
    }
    case ${K_GATE_BASE}u: {
      o.albedo = vec3f(0.03) * (0.7 + 0.6 * vnoise2(m.uv * 70.0));
      o.roughness = 0.85;
    }
    case ${K_GATE_CHECKER}u: {
      let c = (floor(m.uv.x / 0.03) + floor(m.uv.y / 0.03)) % 2.0;
      o.albedo = mix(vec3f(0.025), vec3f(0.78), abs(c));
      o.roughness = 0.4;
    }
    case ${K_CONE}u: { o = coneSurf(m, o); }
    case ${K_POLE}u: {
      let st = stripes(m.uv.y / 0.7, m.fp / 0.7);
      o.albedo = mix(vec3f(0.6, 0.03, 0.03), vec3f(0.75), st);
      o.roughness = 0.35;
    }
    case ${K_FLAGPOLE}u: {
      o.albedo = vec3f(0.78, 0.79, 0.8);
      o.metalness = 1.0;
      o.roughness = 0.3;
    }
    case ${K_WALL}u: { o = wallSurf(m, o); }
    case ${K_ROCK}u: { o = rockSurf(m, o); }
    case ${K_TRUNK}u: {
      let bark = fbm2(vec2f(m.uv.x * 7.0, m.uv.y * 1.2));
      o.albedo = vec3f(0.085, 0.07, 0.056) * (0.45 + 0.9 * bark);
      o.roughness = 0.95;
      o.material = MAT_FOLIAGE;
    }
    case ${K_PAD}u: { o = padSurf(m, o); }
    case ${K_PAD_EDGE}u: {
      o.albedo = vec3f(0.02);
      o.roughness = 0.9;
      o.material = MAT_GROUND;
    }
    default: {}
  }
  return o;
}
