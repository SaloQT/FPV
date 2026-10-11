// Shared ground colour field. The terrain fragment shader and the vegetation module both evaluate it, so grass blades and the turf
// under them agree. Public entry points (all take world xz in metres; height, normal and maps are fetched from group 1):
//   grassTint(xz)                     mean turf albedo (linear) incl. dry/lush patches, without per-blade variation
//   grassTintFromMaps(xz, maps)       same when the caller already sampled terrainMapsAt (x soil, y flow, z deposit, w wetness)
//   groundBaseColor(xz)               macro albedo of the layered ground (no detail texture), any xz including outside the map
//   groundBaseColorAt(xz, y, ny, maps, waterLevel)   same with caller-supplied height, normal.y and maps
//   terrainLayerWeights(xz, y, ny, maps, waterLevel) affinity of the 8 ground layers (see GL_* in ground_palette.wgsl)
// grass_tone.wgsl (included here) holds the blade tuft/swath tone and the streak field both the blades and the turf layer read.
#include "common/world_bindings.wgsl"
#include "terrain/noise.wgsl"
#include "terrain/grass_tone.wgsl"
#include "terrain/ground_palette.wgsl"
#include "terrain/terrain_height.wgsl"

struct LayerWeights {
  lo : vec4f,  // grass, hay, dirt, gravel
  hi : vec4f,  // rock, sand, snow, loam
};

// Straw-coloured stretches a few tens of metres across whose edges are mottled at 5 m scale, so they never end on a clean contour.
fn glDryness(xz : vec2f, wet : f32) -> f32 {
  let n = tnFbm(xz * 0.012 + vec2f(3.1, 7.7), 3);
  let m = tnFbm(xz * 0.17 + vec2f(61.0, 13.0), 3);
  return saturate1(0.85 * smoothstep(0.58, 0.82, n + 0.2 * (m - 0.5)) - 0.6 * smoothstep(0.35, 0.8, wet));
}

// Living turf: lush green with yellow-green and clover patches at 10 m and 1-2 m scale, bleached toward straw where it is dry.
// `dry` is the caller's glDryness(xz, maps.w) so a point that also evaluates terrainLayerWeights reuses it instead of recomputing the FBM.
fn grassTintFromMapsDry(xz : vec2f, maps : vec4f, dry : f32) -> vec3f {
  let tuft = tnFbm(xz * 0.31 + vec2f(41.0, 5.0), 2);
  let hue = tnFbm(xz * 0.09 + vec2f(7.0, 63.0), 2);
  let clover = smoothstep(0.55, 0.72, tnFbm(xz * 0.9 + vec2f(19.0, 3.0), 2));
  var c = mix(GL_GRASS_LUSH, GL_GRASS_YELLOW, smoothstep(0.42, 0.66, hue));
  c = mix(c, GL_GRASS_CLOVER, 0.7 * clover);
  // A meadow is not one green: drifts of sorrel and seed heads give it russet and olive casts a few metres across, so from a distance it
  // reads as a muted mix of hues rather than a saturated lawn.
  let russet = smoothstep(0.55, 0.78, tnFbm(xz * 0.21 + vec2f(77.0, 31.0), 2));
  c = mix(c, GL_GRASS_RUSSET, 0.45 * russet);
  return mix(c, GL_GRASS_DRY, dry) * (0.82 + 0.4 * tuft) * groundVigour(xz);
}

// Field-scale vigour of the sward, a few hundred metres across: richer, bluer green on one pasture, paler and yellower on the next, as
// soil and grazing differ. It is what keeps a valley from reading as one flat green from the air.
fn groundVigour(xz : vec2f) -> vec3f {
  let v = 0.5 + 0.5 * tnGradient(xz * 0.0042 + vec2f(71.0, 29.0));
  return mix(vec3f(1.10, 1.02, 0.78), vec3f(0.92, 1.0, 0.86), smoothstep(0.3, 0.7, v)) * (0.88 + 0.24 * v);
}

// The regional bedrock: grey granite, warm sandstone and dark slate, in districts a few hundred metres across. Outcrops, scree and
// boulders all take their colour from it, so loose rock matches the face it fell from.
fn bedrockTone(xz : vec2f) -> vec3f {
  let r = 0.5 + 0.5 * tnGradient(xz * 0.0028 + vec2f(13.0, 57.0));
  let granite = vec3f(0.98, 0.99, 1.02);
  let sandstone = vec3f(1.12, 1.00, 0.86);
  let slate = vec3f(0.72, 0.76, 0.82);
  return mix(mix(slate, granite, smoothstep(0.3, 0.45, r)), sandstone, smoothstep(0.58, 0.72, r));
}

fn grassTintFromMaps(xz : vec2f, maps : vec4f) -> vec3f {
  return grassTintFromMapsDry(xz, maps, glDryness(xz, maps.w));
}

fn grassTint(xz : vec2f) -> vec3f {
  return grassTintFromMaps(xz, terrainMapsAt(terrainMirrorXz(xz)));
}

// As terrainLayerWeights, with the caller's glDryness(xz, maps.w) passed in rather than recomputed (see grassTintFromMapsDry).
fn terrainLayerWeightsDry(xz : vec2f, y : f32, ny : f32, maps : vec4f, waterLevel : f32, dry : f32) -> LayerWeights {
  let soil = maps.x;
  let flow = maps.y;
  let dep = maps.z;
  let wet = maps.w;
  let q = xz + 14.0 * tnWarp2(xz * 0.02);
  let jitter = tnFbm(q * 0.045 + vec2f(9.7, 2.3), 3) - 0.5;
  let slope = 1.0 - ny + 0.06 * jitter;
  let soilJ = soil + 0.22 * jitter;
  let hRel = (y - frame.terrain.z) / max(frame.terrain.w - frame.terrain.z, 1.0);

  let steep = smoothstep(0.16, 0.30, slope);
  let gentle = 1.0 - smoothstep(0.10, 0.26, slope);
  let bare = 1.0 - smoothstep(0.02, 0.24, soilJ);
  let alpine = smoothstep(0.62, 0.92, hRel + 0.08 * jitter);
  let rock = saturate1(steep + 0.9 * bare + 0.5 * alpine);

  // Erosion features: gullies follow the drainage map, rills are thin winding scars on slopes, fans are deposited gravel.
  let gully = smoothstep(0.35, 0.70, flow) * smoothstep(0.01, 0.05, slope);
  let ridged = 1.0 - abs(2.0 * tnFbm(q * 0.24 + vec2f(5.0, 77.0), 2) - 1.0);
  // Rills cut only where a slope is grazed or trampled bare, in some districts, not on every hillside.
  let rill = smoothstep(0.955, 0.99, ridged) * smoothstep(0.04, 0.10, slope) * (1.0 - steep) * smoothstep(0.5, 0.7, tnFbm(q * 0.012 + vec2f(61.0, 3.0), 2));
  let fan = smoothstep(0.30, 0.65, dep) * (1.0 - smoothstep(0.05, 0.14, slope));
  let scree = smoothstep(0.10, 0.20, slope) * (1.0 - steep) * smoothstep(0.40, 0.70, tnFbm(q * 0.35 + vec2f(2.0, 19.0), 2));

  // Waterline: wet sand, pebbles and mud below about a metre of the water surface, no sward on it; the seabed seen through the water
  // is the same sediment (everything below the surface counts as fully shore).
  var shore = 0.0;
  if (waterLevel > -1.0e8) { shore = 1.0 - smoothstep(0.1, 1.0, y - waterLevel); }

  // The sward thins in metre-scale patches, more on slopes, dry ground and thin soil; soil shows through the gaps.
  let patchN = tnFbm(q * 0.55 + vec2f(23.0, 51.0), 3);
  let thinSoil = 1.0 - smoothstep(0.30, 0.70, soilJ);
  let sparse = smoothstep(0.60, 0.86, patchN + 0.30 * smoothstep(0.03, 0.15, slope) + 0.18 * dry + 0.25 * thinSoil);
  let cover = smoothstep(0.22, 0.65, soilJ) * gentle * (1.0 - 0.85 * gully) * (1.0 - 0.8 * rill) * (1.0 - 0.95 * shore);
  let sward = cover * (1.0 - 0.9 * sparse);
  let grass = sward * (1.0 - dry);
  let hay = sward * dry;

  let channel = smoothstep(0.5, 0.9, flow);
  let dirt = 0.10 + 0.9 * smoothstep(0.05, 0.35, soilJ) * (1.0 - smoothstep(0.35, 0.7, soilJ)) + 0.7 * channel
    + 0.9 * cover * sparse + 0.9 * gully + 0.8 * rill;
  let gravel = 0.7 * scree + 0.7 * channel * (0.4 + 0.6 * dep) + 0.6 * fan * (0.3 + 0.7 * smoothstep(0.3, 0.7, flow)) + 0.4 * gully * dep
    + 0.55 * shore * smoothstep(0.35, 0.65, tnFbm(q * 0.2 + vec2f(44.0, 12.0), 2));

  let sand = max(0.9 * shore, 0.3 * smoothstep(0.5, 0.85, dep) * gentle);

  let pat = smoothstep(0.42, 0.70, tnFbm(q * 0.08 + vec2f(31.0, 17.0), 2));
  let bank = smoothstep(0.7, 0.95, wet) * (1.0 - smoothstep(0.05, 0.14, slope));
  let loam = (0.3 * wet * smoothstep(0.35, 0.8, soilJ) * pat + 0.8 * bank * (0.3 + 0.7 * pat) + 0.6 * shore * (0.3 + 0.7 * pat)) * (1.0 - smoothstep(0.06, 0.16, slope));

  let snow = smoothstep(0.78, 0.86, hRel + 0.05 * jitter) * gentle;
  let keep = 1.0 - snow;
  var w : LayerWeights;
  w.lo = vec4f(grass, hay, dirt, gravel) * keep;
  w.hi = vec4f(rock * keep, sand * keep * (1.0 - 0.6 * rock), snow, loam * keep);
  return w;
}

fn terrainLayerWeights(xz : vec2f, y : f32, ny : f32, maps : vec4f, waterLevel : f32) -> LayerWeights {
  return terrainLayerWeightsDry(xz, y, ny, maps, waterLevel, glDryness(xz, maps.w));
}

// How much of xz is washed stream bed. A narrow drainage line is bed across its width; where the flow map saturates over a broad
// valley floor (a floodplain tens of metres wide) the bed is a few braided channels meandering through wet meadow instead.
fn streamBed(xz : vec2f, flow : f32) -> f32 {
  let bed = smoothstep(0.72, 0.92, flow);
  let broad = smoothstep(0.86, 0.97, flow);
  if (broad <= 0.0 || bed <= 0.0) { return bed; }
  let m = tnFbm(xz * 0.022 + vec2f(91.0, 37.0), 2);
  let n = tnFbm(xz * 0.05 + vec2f(13.0, 71.0), 2);
  let channels = max(1.0 - smoothstep(0.015, 0.05, abs(m - 0.5)), 0.7 * (1.0 - smoothstep(0.01, 0.035, abs(n - 0.5))));
  return bed * mix(1.0, channels, broad);
}

// The terrain shader's full material set: the eight layers of terrainLayerWeightsDry (which grass placement also reads, so it stays as
// it is), refined into forest floor, moss, mud, cracked earth, scree and stream beds. `cover` is the forest-floor cover at xz
// (r = canopy, g = conifer share). Weights are on the scale of the base weights' total.
fn terrainMaterialWeights(xz : vec2f, y : f32, ny : f32, maps : vec4f, waterLevel : f32, dry : f32, cover : vec2f) -> array<f32, 14> {
  let lw = terrainLayerWeightsDry(xz, y, ny, maps, waterLevel, dry);
  var w = array<f32, 14>(lw.lo.x, lw.lo.y, lw.lo.z, lw.lo.w, lw.hi.x, lw.hi.y, lw.hi.z, lw.hi.w, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  let total = max(dot(lw.lo, vec4f(1.0)) + dot(lw.hi, vec4f(1.0)), 1e-4);
  let soil = maps.x;
  let flow = maps.y;
  let dep = maps.z;
  let wet = maps.w;
  let slope = 1.0 - ny;
  let snowFree = 1.0 - lw.hi.z / total;
  // Two patch fields serve every refinement below (an octave pair at metre scale, one octave at field scale), unwarped to keep the
  // pixel cost down.
  let patchM = tnFbm(xz * 0.45 + vec2f(61.0, 7.0), 2);
  let patchL = 0.5 + 0.5 * tnGradient(xz * 0.06 + vec2f(17.0, 83.0));
  var shore = 0.0;
  if (waterLevel > -1.0e8) { shore = 1.0 - smoothstep(0.1, 1.0, y - waterLevel); }
  let gentle = 1.0 - smoothstep(0.12, 0.30, slope);

  // Stream beds: the strongest drainage is a channel of washed gravel and sand with mud along its edges, not turf.
  let bed = streamBed(xz, flow) * (1.0 - smoothstep(0.25, 0.4, slope)) * snowFree;
  w[0] *= 1.0 - 0.95 * bed;
  w[1] *= 1.0 - 0.95 * bed;
  w[5] *= 1.0 - 0.7 * bed;
  // Mostly cobbles and gravel, in patches of coarser and finer stone; sand settles in bars where the current slackens and fine silt
  // drapes the hollows, so a dry bed is a patchwork along its length rather than one even strip of stones.
  let drape = smoothstep(0.55, 0.75, tnFbm(xz * 0.21 + vec2f(37.0, 15.0), 2));
  w[3] += bed * total * (0.7 + 0.5 * dep) * (0.45 + 1.0 * patchM) * (1.0 - 0.5 * drape);
  w[5] += bed * total * 0.6 * smoothstep(0.5, 0.75, patchL) * (1.0 - patchM);
  w[5] += bed * total * 0.45 * drape;
  w[GL_MUD] += bed * total * 0.35 * smoothstep(0.4, 0.8, wet) * smoothstep(0.86, 0.74, flow + 0.1 * patchM);

  // Alluvial sand away from the waterline is a patchwork of sand, fine gravel and damp sward, not a beach.
  let alluvial = w[5] * (1.0 - shore);
  w[3] += 0.5 * alluvial * smoothstep(0.35, 0.65, patchM);
  w[0] += 0.5 * alluvial * smoothstep(0.3, 0.7, wet) * (1.0 - bed);
  w[5] -= 0.55 * alluvial;

  // Forest floor where the crowns close: leaf litter or needle duff replaces most of the sward (light gaps keep some), moss in the
  // damp. A lone tree in a meadow keeps grass to its trunk, so one crown alone (cover about 0.45) gives only a thin ring of litter.
  let canopy = cover.x * (1.0 - shore) * (1.0 - bed) * snowFree;
  let floorAmt = smoothstep(0.4, 0.75, canopy) * (1.0 - smoothstep(0.32, 0.5, slope));
  let gap = smoothstep(0.55, 0.8, patchM) * (1.0 - smoothstep(0.6, 0.95, canopy));
  let litter = floorAmt * (1.0 - gap);
  w[0] *= 1.0 - 0.92 * litter;
  w[1] *= 1.0 - 0.92 * litter;
  w[2] *= 1.0 - 0.6 * litter;
  w[7] *= 1.0 - 0.6 * litter;
  w[GL_LITTER] = 1.3 * litter * total * (1.0 - cover.y);
  w[GL_NEEDLES] = 1.3 * litter * total * cover.y;
  // A woodland floor is not one sheet of litter: patches of low green plants (wood sorrel, ivy, anemone, seedlings) a few metres to
  // tens of metres across where light gets through, more of them under broadleaves than under conifers, and dark bare humus where the
  // litter has rotted or been scuffed away.
  if (litter > 0.01) {
    let herbField = tnFbm(xz * 0.075 + vec2f(43.0, 21.0), 2) + 0.5 * (patchM - 0.5);
    let herbs = smoothstep(0.55, 0.7, herbField) * litter * (1.0 - 0.6 * cover.y);
    w[GL_MOSS] += 1.1 * herbs * total;
    w[GL_LITTER] *= 1.0 - 0.7 * herbs;
    w[GL_NEEDLES] *= 1.0 - 0.7 * herbs;
    let humus = smoothstep(0.6, 0.78, patchL + 0.3 * (patchM - 0.5)) * litter * (1.0 - herbs);
    w[7] += 0.9 * humus * total;
  }

  // Moss: cushions on damp, shaded ground, in forest hollows and on wet banks.
  let mossSite = (0.75 * smoothstep(0.4, 0.8, canopy) + 0.8 * smoothstep(0.55, 0.9, wet) * gentle) * (1.0 - bed) * (1.0 - shore) * snowFree;
  if (mossSite > 0.01) {
    let moss = smoothstep(0.5, 0.72, tnFbm(xz * 0.8 + vec2f(5.0, 41.0), 2)) * mossSite;
    w[GL_MOSS] += 0.9 * moss * total;
    w[0] *= 1.0 - 0.5 * moss;
  }

  // Mud where the ground stays wet: banks, damp hollows, the waterline.
  let mud = (smoothstep(0.66, 0.95, wet) * gentle * (0.25 + 0.75 * smoothstep(0.4, 0.75, patchL)) + 0.6 * shore * (1.0 - patchM)) * (1.0 - canopy * 0.5);
  w[GL_MUD] += mud * (w[2] + w[7] + 0.25 * total);
  w[7] *= 1.0 - 0.6 * mud;

  // Dry, bare clay crusts and cracks, only where it is really parched; a damp soil never cracks.
  let crack = smoothstep(0.4, 0.75, dry + 0.25 * (patchL - 0.5)) * (1.0 - smoothstep(0.15, 0.35, wet)) * gentle * (1.0 - bed);
  w[GL_CRACKED] = w[2] * crack;
  w[2] *= 1.0 - 0.8 * crack;

  // Talus below the outcrops: frost-split blocks on slopes near the angle of repose where the soil is thin, in aprons and tongues tens of
  // metres across with soil and rock between them, not over a whole hillside.
  let apron = smoothstep(0.45, 0.62, patchL + 0.25 * (tnFbm(xz * 0.018 + vec2f(29.0, 4.0), 2) - 0.5));
  let scree = smoothstep(0.10, 0.20, slope) * (1.0 - smoothstep(0.34, 0.46, slope)) * (1.0 - smoothstep(0.15, 0.45, soil))
    * smoothstep(0.3, 0.6, patchM + 0.3 * (1.0 - soil)) * apron * snowFree;
  w[GL_SCREE] = 1.2 * scree * total;
  w[3] *= 1.0 - 0.6 * scree;
  w[2] *= 1.0 - 0.5 * scree;
  return w;
}

// As layerMacroColor, with the caller's glDryness(xz, maps.w) supplied for the grass case (see grassTintFromMapsDry). Only layer 0 reads it.
fn layerMacroColorDry(layer : i32, xz : vec2f, y : f32, maps : vec4f, dry : f32) -> vec3f {
  switch (layer) {
    case 0: { return grassTintFromMapsDry(xz, maps, dry); }
    case 1: { return glBaseColor(GL_HAY) * (0.8 + 0.4 * tnFbm(xz * 0.07 + vec2f(2.0, 8.0), 2)); }
    case 2: {
      // Bare soil is a muted grey-brown that changes over metres: warmer subsoil where it is freshly cut, grey mineral soil, darker humus
      // patches and pale dried crusts. No single orange-tan.
      let t = tnFbm(xz * 0.05 + vec2f(13.0, 1.0), 3);
      let u = tnFbm(xz * 0.4 + vec2f(7.0, 29.0), 2);
      let tone = mix(vec3f(1.06, 0.98, 0.88), vec3f(0.92, 0.95, 1.0), t) * mix(0.82, 1.12, u);
      let humus = smoothstep(0.55, 0.8, tnFbm(xz * 0.13 + vec2f(41.0, 3.0), 2)) * smoothstep(0.3, 0.7, maps.x);
      return glBaseColor(GL_DIRT) * tone * mix(vec3f(1.0), vec3f(0.62, 0.6, 0.6), humus) * (1.0 - 0.3 * smoothstep(0.5, 0.9, maps.y))
        * mix(1.0, 0.8, smoothstep(0.25, 0.7, maps.x));
    }
    case 3: {
      // Dry channel gravel is a patchwork of warm and cool stones and darker damp patches, never one flat grey.
      let t = tnFbm(xz * 0.11 + vec2f(5.0, 27.0), 3);
      let u = tnFbm(xz * 0.6 + vec2f(15.0, 2.0), 2);
      return glBaseColor(GL_GRAVEL) * mix(vec3f(1.12, 1.0, 0.86), vec3f(0.92, 0.96, 1.02), u) * (0.7 + 0.6 * t);
    }
    case 4: {
      // Strata: beds of uneven thickness (a few tens of centimetres to a few metres), each with its own tone, warped and gently dipping, with
      // thin partings inside the thick ones; never a regular stripe.
      let warp = 2.2 * tnFbm(xz * 0.03 + vec2f(3.0, 44.0), 2);
      let s = y * 0.42 + warp * 2.5 + 0.02 * xz.x;
      let bedA = hash21(bitcast<vec2u>(vec2i(i32(floor(s)), 17)));
      let bedB = hash21(bitcast<vec2u>(vec2i(i32(floor(s * 2.7 + 0.3 * warp)), 41)));
      let tone = mix(vec3f(1.08, 1.0, 0.92), vec3f(0.90, 0.93, 0.98), bedA) * (0.9 + 0.2 * bedB);
      // Rain streaks: water running off the ledges stains the face in dark vertical streaks (any function of xz alone is constant down a
      // cliff), broken up along their length.
      let streakN = 1.0 - abs(2.0 * tnFbm(xz * vec2f(0.9, 0.9) + vec2f(31.0, 5.0), 2) - 1.0);
      let streak = smoothstep(0.82, 0.97, streakN) * smoothstep(0.35, 0.65, tnFbm(vec2f(xz.x + xz.y, y) * 0.08 + vec2f(2.0, 9.0), 2));
      let lichen = smoothstep(0.60, 0.72, tnFbm(xz * 0.21 + vec2f(71.0, 9.0), 2)) * smoothstep(0.38, 0.62, tnFbm(xz * 3.7 + vec2f(8.0, 33.0), 2)) * 0.45;
      let stone = glBaseColor(GL_ROCK) * tone * bedrockTone(xz) * (1.0 - 0.35 * streak);
      return mix(stone, vec3f(0.17, 0.19, 0.10), lichen);
    }
    case 5: { return glBaseColor(GL_SAND) * (0.9 + 0.2 * tnFbm(xz * 0.13 + vec2f(9.0, 3.0), 2)); }
    case 6: { return glBaseColor(GL_SNOW); }
    case 7: { return glBaseColor(GL_LOAM); }
    case 8: {
      // Moss is yellow-green in light, deep green in shade and damp.
      let t = tnFbm(xz * 0.35 + vec2f(3.0, 91.0), 2);
      return glBaseColor(GL_MOSS) * mix(vec3f(0.85, 0.95, 1.05), vec3f(1.2, 1.12, 0.8), t) * (1.0 - 0.25 * smoothstep(0.7, 1.0, maps.w));
    }
    case 9: {
      // Fresh litter is brighter and warmer, last year's is grey-brown, and it is darker where it lies wet. A metre-scale brightness
      // field (drifts, hollows, twig-strewn and bare patches) keeps the floor from turning into one even brown at ten metres.
      let t = tnFbm(xz * 0.12 + vec2f(51.0, 9.0), 2);
      let drift = 0.5 + 0.5 * tnGradient(xz * 0.55 + vec2f(3.0, 77.0));
      return glBaseColor(GL_LITTER) * mix(vec3f(0.86, 0.9, 0.98), vec3f(1.07, 1.01, 0.91), t) * (0.72 + 0.5 * drift)
        * (1.0 - 0.3 * smoothstep(0.55, 0.95, maps.w));
    }
    case 10: {
      let t = tnFbm(xz * 0.15 + vec2f(27.0, 3.0), 2);
      return glBaseColor(GL_NEEDLES) * mix(vec3f(0.85, 0.9, 0.95), vec3f(1.15, 1.0, 0.85), t);
    }
    case 11: { return glBaseColor(GL_MUD) * (0.85 + 0.3 * tnFbm(xz * 0.2 + vec2f(5.0, 66.0), 2)); }
    case 12: { return glBaseColor(GL_CRACKED) * mix(vec3f(1.04, 0.98, 0.9), vec3f(0.94, 0.96, 1.0), tnFbm(xz * 0.08 + vec2f(9.0, 12.0), 2)); }
    default: { return glBaseColor(GL_SCREE) * bedrockTone(xz) * (0.85 + 0.3 * tnFbm(xz * 0.1 + vec2f(44.0, 2.0), 2)); }
  }
}

fn layerMacroColor(layer : i32, xz : vec2f, y : f32, maps : vec4f) -> vec3f {
  // Only the grass case needs the dryness, so compute it for that case alone; the rest never reads it.
  if (layer == 0) { return grassTintFromMaps(xz, maps); }
  return layerMacroColorDry(layer, xz, y, maps, 0.0);
}

fn groundBaseColorAt(xz : vec2f, y : f32, ny : f32, maps : vec4f, waterLevel : f32) -> vec3f {
  let dryField = glDryness(xz, maps.w);
  let lw = terrainLayerWeightsDry(xz, y, ny, maps, waterLevel, dryField);
  var w = array<f32, 8>(lw.lo.x, lw.lo.y, lw.lo.z, lw.lo.w, lw.hi.x, lw.hi.y, lw.hi.z, lw.hi.w);
  var sum = 0.0;
  for (var i = 0; i < GL_BASE_COUNT; i++) { sum += w[i]; }
  var c = vec3f(0.0);
  for (var i = 0; i < GL_BASE_COUNT; i++) {
    if (w[i] > 0.02 * sum) { c += w[i] * layerMacroColorDry(i, xz, y, maps, dryField); }
  }
  return c / max(sum, 1e-4);
}

fn groundBaseColor(xz : vec2f) -> vec3f {
  let m = terrainMirrorXz(xz);
  return groundBaseColorAt(xz, terrainHeightMirrored(xz), terrainNormalAt(m).y, terrainMapsAt(m), -1.0e9);
}
