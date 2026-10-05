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
  var col = vec3f(0.36, 0.355, 0.34) * (0.8 + 0.35 * grain);
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
  var col = vec3f(0.6, 0.6, 0.58) * (0.9 + 0.12 * fbm2(uv * 3.0)) * (1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.006 + m.fp, joint)));
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
    case ${K_CONTAINER}u: { o = containerSurf(m, o); }
    case ${K_CONCRETE}u: { o = concreteSurf(m, o); }
    case ${K_HAZARD}u: { o = hazardSurf(m, o); }
    case ${K_STEEL_PAINT}u: { o = steelSurf(m, o); }
    case ${K_GATE_PANEL}u: { o = panelSurf(m, o, gate); }
    default: {}
  }
  return o;
}
