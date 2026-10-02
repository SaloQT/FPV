// Grass blades. One instance per blade record (grass_cull.wgsl); the vertices are a strip of rows, two vertices per row, plus a tip vertex
// when HAS_TIP. LOD0/1/2 only differ in NSEG/HAS_TIP. All animation is a bend of the blade axis: an arc whose tip is displaced by
// H * sin(tilt), where the tilt vector adds the blade's own curl, the wind lean and flutter, prop wash and trample.
#include "vegetation/veg_params.wgsl"
#include "vegetation/veg_wind.wgsl"
#include "vegetation/grass_blade.wgsl"
#include "terrain/gbuffer.wgsl"
#include "terrain/grass_tone.wgsl"

@group(2) @binding(1) var<storage, read> blades : array<Blade>;

const NSEG : u32 = ${NSEG}u;
const HAS_TIP : bool = ${HAS_TIP};
const MIN_HALF_PX : f32 = 0.35;
const MAX_TILT : f32 = 1.45;
const GRASS_ID : f32 = 2.0;
const TRANSLUCENCY : f32 = 0.42;
// Blades thinner than a pixel (true half width in px below THIN_PX) shade as the sward, not as a mirror: roughness, normals and translucency
// are pulled to the smooth values, because a sub-pixel blade samples one random normal per pixel and flickers under TAA.
const THIN_PX : f32 = 0.9;
const GRAZE_ROUGH : f32 = 1.0;

const STRAW : vec3f = vec3f(0.285, 0.235, 0.115);
const SEED_HEAD : vec3f = vec3f(0.24, 0.17, 0.065);

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
};

// Flower heads are small camera-facing discs on a thin stem: the top rows of the strip are laid out as a polygon on the head plane.
// Head radius in metres by colour code (ox-eye daisy 2.4-4 cm across, buttercup 1.8-3, self-heal or vetch 1.2-2.2, clover 1.6-2.8).
fn headRadius(code : u32, u : f32) -> f32 {
  switch (code) {
    case 1u: { return 0.012 + 0.008 * u; }
    case 2u: { return 0.009 + 0.006 * u; }
    case 3u: { return 0.006 + 0.005 * u; }
    default: { return 0.008 + 0.006 * u; }
  }
}

// Petal colours are muted reflectances (white petals about 0.6, not paper white); `keep` 0 cuts the gaps between petals once the head
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
      col = mix(vec3f(0.55, 0.42, 0.06) * (0.88 + 0.12 * smoothstep(0.1, 0.9, r)), vec3f(0.42, 0.28, 0.02), eye);
      if (r > 0.86 + 0.14 * cos(5.0 * a) && detail > 0.5) { keep = 0.0; }
    }
    case 3u: {
      let eye = 1.0 - smoothstep(0.14, 0.24, r);
      col = mix(vec3f(0.23, 0.095, 0.37) * (0.85 + 0.15 * smoothstep(0.2, 0.8, r)), vec3f(0.42, 0.38, 0.16), eye);
      if (r > 0.7 + 0.3 * abs(cos(2.5 * a)) && detail > 0.5) { keep = 0.0; }
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
  let lean = dir * (1.0 - exp(-sp * (0.05 + 0.15 * h))) * stiff;
  let freq = TAU * 0.8 / pow(0.05 + h, 0.9);
  let phase = freq * time + dot(root.xz, vp.wind.xy) * 0.9 + rnd * 6.0;
  let flutter = (sin(phase) * 0.6 + sin(phase * 2.3 + 1.3) * 0.4) * 0.16 * saturate1(sp / 6.0) * stiff;
  let across = vec2f(-dir.y, dir.x);
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

// Centre line of the blade at parameter t for the wind state of `time`; the previous-frame call only needs `centre`.
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

  var curl = 0.12 + 0.35 * rnd;
  var stiff = 1.0;
  switch (species) {
    case 1u: { curl = 0.25 + 0.4 * rnd; }
    case 2u: { curl = 0.5 + 0.55 * rnd; }
    case 3u: { curl = 0.05 + 0.2 * rnd; stiff = 0.7; }
    case 4u: { curl = 0.7 + 0.5 * rnd; stiff = 0.5; }
    default: {}
  }
  if (isFlower) { curl *= 0.4; }
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
  let side = normalize(mix(side0, sideB, smoothstep(0.0, 0.8, t)));
  let nb = normalize(cross(side, tang));

  var wf = 1.0 - 0.85 * t * t;
  if (species == 4u) { wf = max(0.12, 6.75 * t * (1.0 - t) * (1.0 - t)); }
  if (isFlower) { wf = 0.3; }
  if (isSeed && t > 0.66) { wf = 1.9; }
  if (isTip) { wf = 0.0; }

  let toCam = frame.camPos.xyz - centre;
  let vdir = normalize(toCam);
  let vr = normalize(cross(vdir, vec3f(0.0, 1.0, 0.0)) + vec3f(1.0e-5, 0.0, 0.0));
  let c = dot(side, vr);
  let sideEff = side + vr * (select(-1.0, 1.0, c >= 0.0) * max(abs(c), 0.55) - c);

  let clip0 = frame.viewProj * vec4f(centre, 1.0);
  let pxPerM = frame.screen.y * 0.5 * frame.proj[1][1] / max(clip0.w, 0.05);
  let trueHw = b.halfWidth * wf;
  let hw = max(trueHw, select(MIN_HALF_PX / pxPerM, 0.0, isTip));
  var world = centre + sideEff * (sv * hw);
  var cover = select(1.0, saturate1(trueHw / hw), !isTip);
  var thinPx = trueHw * pxPerM;
  var headPos = vec2f(0.0, -9.0);
  var headPx = 0.0;
  var headN = nb + side * (0.5 * sv);

  let r2 = hash11(b.info * 747796405u + b.tint);
  if (hasHead && row >= NECK) {
    // The head faces up and a little toward the camera, like a flower following the sun; its disc is the plane of vr and `ha`.
    let nH = normalize(vec3f(0.0, 0.5 + 0.5 * rnd, 0.0) + vdir * (0.9 - 0.3 * rnd));
    var ha = normalize(cross(nH, vr));
    if (ha.y < 0.0) { ha = -ha; }
    let R = headRadius(code, r2);
    let Rpx = R * pxPerM;
    // A head under half a pixel across is drawn at the floor on `cover` of its pixels, so its area stays the real one.
    let Rd = max(R, 0.5 / pxPerM);
    headN = nH;
    headPx = Rpx;
    thinPx = Rpx;
    if (headRow) {
      let L = NSEG - NECK;
      let s = -1.0 + 2.0 * f32(row - NECK) / f32(L);
      let w = sqrt(max(1.0 - s * s, 0.0));
      world = centre + ha * (Rd * (1.0 + s)) + vr * (Rd * w * sv);
      headPos = vec2f(sv * w, s);
      cover = sq(R / Rd);
    } else {
      headPos = vec2f(sv * 0.08, -0.98);
    }
  }

  // Patch colour (turf, already bleached where the ground is dry) times per-blade variation: luminance, a blue-green to yellow-green
  // hue pick and dead straw blades or dead tips. Dark root to lighter, slightly yellower tip; roots also stand in for sward self-shadow.
  // Variation that is random per blade averages out below a pixel and then only shimmers, so it fades to the sward mean as blades thin;
  // the world-space clump tone below is correlated between neighbouring blades, survives the distance and is stable under TAA.
  let thinV = 1.0 - smoothstep(0.3 * THIN_PX, 1.6 * THIN_PX, trueHw * pxPerM);
  let calm = 0.6 * thinV;
  let gt = pow(t, 0.8);
  var base = turf * mix(0.72 + 0.56 * rnd, 1.0, calm);
  base *= mix(mix(vec3f(0.88, 1.04, 1.05), vec3f(1.22, 1.08, 0.62), smoothstep(0.5, 1.0, r2)), vec3f(1.0), calm);
  if (species == 3u) { base *= vec3f(0.9, 1.0, 0.9); }
  if (species == 4u) { base *= vec3f(0.82, 1.0, 0.78); }
  base *= grassClumpTone(b.pos.xz, 0.0);
  var col = base * mix(mix(0.35, 1.4, gt), 0.93, 0.5 * thinV) * mix(vec3f(1.0), vec3f(1.06, 1.02, 0.8), gt);
  var strawMix = 0.45 * smoothstep(0.6, 1.0, t) * smoothstep(0.3, 0.9, fract(r2 * 9.7));
  if (r2 < 0.06 + 0.35 * dry) { strawMix = 0.85; }
  strawMix = mix(strawMix, 0.12 + 0.3 * dry, calm);
  col = mix(col, STRAW * (0.55 + 0.6 * rnd) * mix(0.5, 1.0, gt), strawMix);
  if (isSeed && t > 0.66) { col = mix(vec3f(0.12, 0.13, 0.05), SEED_HEAD, 0.4 + 0.6 * dry); }

  let tn2 = unpack2x16snorm(b.nrm);
  let tn = vec3f(tn2.x, sqrt(max(1.0 - dot(tn2, tn2), 0.0)), tn2.y);

  var o : VsOut;
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.world = world;
  o.nrm = normalize(headN);
  o.terrainNrm = tn;
  o.albedo = col;
  o.shade = vec2f(mix(0.42, 1.0, saturate1(t * 1.8)), mix(0.64, 0.5, gt));
  o.motion = motionVectorPrev(world, world + (prevCentre - centre));
  o.cover = vec2f(cover, 1.0 - smoothstep(0.3 * THIN_PX, THIN_PX, thinPx));
  o.head = vec4f(headPos, headPx, 0.0);
  o.hcode = select(0u, code, hasHead);
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
  // A blade narrower than the one-pixel floor is drawn at the floor but only on `cover` of its pixels, so the coverage stays the real one.
  if (in.cover.x < 1.0 && coverThreshold(vec2u(in.pos.xy), hash21(bitcast<vec2u>(vec2i(in.world.xz * 64.0)))) >= in.cover.x) { discard; }
  let toCam = frame.camPos.xyz - in.world;
  var n = normalize(in.nrm);
  if (dot(n, toCam) < 0.0) { n = -n; }
  let thin = in.cover.y;
  var albedo = in.albedo;
  var tr = TRANSLUCENCY * (1.0 - 0.3 * thin);
  var cavity = in.shade.x;
  var rough0 = in.shade.y;
  var pull = mix(0.5, 0.9, thin);
  if (in.hcode != 0u && length(in.head.xy) < 1.0) {
    let h = headColour(in.hcode, in.head.xy, in.head.z, f32(in.hcode) * 0.37);
    if (h.w < 0.5) { discard; }
    albedo = h.rgb;
    tr = 0.3 * (1.0 - 0.3 * thin);
    cavity = 1.0;
    rough0 = 0.6;
    pull = mix(0.2, 0.9, thin);
  }
  n = normalize(mix(n, normalize(in.terrainNrm), pull));
  let nv = saturate1(dot(n, normalize(toCam)));
  // Wider lobe at grazing view and for thin blades: a sunlit or sky-lit mirror reflection off random blade normals is what glitters.
  let graze = sq(1.0 - nv);
  let rough = mix(rough0, GRAZE_ROUGH, max(graze, thin));
  var o : FsOut;
  o.albedo = vec4f(albedo, cavity);
  o.normal = vec4f(octEncode(n), rough, 0.0);
  o.misc = vec4f(GRASS_ID / 255.0, tr, 0.0, 0.0);
  o.motion = in.motion;
  return o;
}
