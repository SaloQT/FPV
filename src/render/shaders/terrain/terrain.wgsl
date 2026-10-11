// Terrain G-buffer pass: clipmap vertex placement plus the layered PBR material. Group 2 is declared in bindings.wgsl.
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
// pixel, ledges before they shrink to a few, block facets and tones last to a few hundred metres. `steep` (0..1) allows the ledges.
struct RockFace {
  n : vec3f,
  ao : f32,
  tone : f32,
};

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
  let crack = (1.0 - smoothstep(0.4 * width, width + 0.5 * fp, dCrack)) * lineFade;

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
  r.ao *= 1.0 - 0.65 * crack;
  // Each bed its own shade (strata), each block a little off it.
  let bedTone = mix(1.0, 0.78 + 0.44 * rockHash(bi, 53), 1.0 - smoothstep(0.3, 0.8, fp / spacing));
  r.tone = bedTone * mix(1.0, (0.9 + 0.2 * h1) * (1.0 - 0.45 * crack), facetFade);
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
  // Bare bedrock, from slabs to cliffs: runnels on the steep part, joints and blocks throughout, ledges only where it is steep.
  if (rockShare > 0.3 && ts.normal.y < 0.95) {
    let rockK = smoothstep(0.3, 0.7, rockShare);
    let steep = 1.0 - smoothstep(0.5, 0.7, ts.normal.y);
    if (steep > 0.0) {
      let runnel = rockRunnels(w, n, ctx.footprint);
      n = normalize(mix(n, runnel.xyz, rockK * steep));
      microAo *= mix(1.0, runnel.w, rockK * steep);
    }
    let k = rockK * (1.0 - smoothstep(0.85, 0.95, ts.normal.y));
    let face = rockFace(w, n, ctx.footprint, steep);
    n = normalize(mix(n, face.n, k));
    microAo *= mix(1.0, face.ao, k);
    albedo *= mix(1.0, face.tone, k);
  }

  // Where the key light grazes a surface or falls behind it, detail normals that tip toward it light isolated specks: a lit/unlit mosaic
  // that a real face, which the same relief shadows, does not show. Ease them toward the smooth normal there; the blocks and ledges of
  // a cliff keep half their bend, so the face still reads as jointed in its own shade.
  let keyL = select(frame.sunDir.xyz, frame.moonDir.xyz, frame.misc.w == 1u);
  let graze = 1.0 - smoothstep(0.05, 0.35, dot(ts.normal, keyL));
  n = normalize(mix(n, ts.normal, mix(0.8, 0.5, rockShare) * graze));

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
