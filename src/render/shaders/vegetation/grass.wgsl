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
const FERN : vec3f = vec3f(0.050, 0.090, 0.030);
const FERN_DEAD : vec3f = vec3f(0.130, 0.085, 0.045);
const HERB : vec3f = vec3f(0.042, 0.080, 0.030);
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
    // A head under half a pixel across is drawn at the floor on `cover` of its pixels, so its area stays the real one.
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
  // Wide, near blades keep more of their own facing (each catches the sun its own way); thin ones lean on the ground normal.
  var pull = mix(0.35, 0.9, thin);
  if (in.hcode == CODE_FERN) {
    // Pinnae: paired leaflets angled toward the tip off a thin rachis, each narrowing to its own point.
    let across = abs(in.head.x);
    let ph = fract(in.head.y * FERN_PINNAE - 0.8 * across);
    let detail = smoothstep(4.0, 8.0, in.head.z);
    if (across > 0.08 && ph > 0.82 - 0.3 * across && detail > 0.5) { discard; }
    tr = 0.35;
    pull = mix(0.2, 0.9, thin);
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
