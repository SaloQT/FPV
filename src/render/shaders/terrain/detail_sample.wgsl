// Ground detail sampling for the 8 layers of detail_gen.wgsl. Fine scale is hex-tiled (no visible repetition), the macro scale is a
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
    case 4: { return 4.5; }
    case 5: { return 3.0; }
    case 6: { return 4.0; }
    default: { return 1.6; }
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
  t.a = vec4f(f.a.rgb * mix(vec3f(1.0), m.a.rgb / glBaseColor(layer), 0.6), mix(f.a.a, m.a.a, 0.35));
  t.b = vec4f(f.b.xy + 0.18 * m.b.xy, mix(f.b.z, m.b.z, 0.3), f.b.w * mix(1.0, m.b.w, 0.4));
  return t;
}

fn dsAccumulate(acc : ptr<function, DsTex>, t : DsTex, w : f32) {
  (*acc).a += w * t.a;
  (*acc).b += w * t.b;
}

fn dsLayerDetail(layer : i32, c : DsCtx) -> DsLayer {
  let inv = 1.0 / dsLayerTile(layer);
  let tpp = c.footprint * inv * DS_SIZE;
  let hex = tpp < DS_HEX_MAX_TPP;
  var w = vec3f(0.0, 1.0, 0.0);
  if (c.planes) {
    w = pow(abs(c.n), vec3f(6.0));
    w = w / (w.x + w.y + w.z);
    w = max(w - vec3f(0.1), vec3f(0.0));
    w = w / (w.x + w.y + w.z);
  }
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
