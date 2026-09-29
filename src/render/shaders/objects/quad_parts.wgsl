// Materials of the quad other than carbon: machined and anodised aluminium, circuit boards, battery, rubber, motors and small parts.
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
  let yF = m.p.y + ${COM_Y};
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
