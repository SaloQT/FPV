// Shared ground colour field. The terrain fragment shader and the vegetation module both evaluate it, so grass blades and the turf
// under them agree. Public entry points (all take world xz in metres; height, normal and maps are fetched from group 1):
//   grassTint(xz)                     mean turf albedo (linear) incl. dry/lush patches, without per-blade variation
//   grassTintFromMaps(xz, maps)       same when the caller already sampled terrainMapsAt (x soil, y flow, z deposit, w wetness)
//   groundBaseColor(xz)               macro albedo of the layered ground (no detail texture), any xz including outside the map
//   groundBaseColorAt(xz, y, ny, maps, waterLevel)   same with caller-supplied height, normal.y and maps
//   terrainLayerWeights(xz, y, ny, maps, waterLevel) affinity of the 8 ground layers (see GL_* in ground_palette.wgsl)
#include "common/world_bindings.wgsl"
#include "terrain/noise.wgsl"
#include "terrain/ground_palette.wgsl"
#include "terrain/terrain_height.wgsl"

struct LayerWeights {
  lo : vec4f,  // grass, hay, dirt, gravel
  hi : vec4f,  // rock, sand, snow, loam
};

fn glDryness(xz : vec2f, wet : f32) -> f32 {
  let n = tnFbm(xz * 0.012 + vec2f(3.1, 7.7), 3);
  return saturate1(smoothstep(0.48, 0.68, n) - 0.6 * smoothstep(0.35, 0.8, wet));
}

// Living turf: lush green with yellow-green and clover patches at 10 m and 1-2 m scale, bleached toward straw where it is dry.
fn grassTintFromMaps(xz : vec2f, maps : vec4f) -> vec3f {
  let dry = glDryness(xz, maps.w);
  let tuft = tnFbm(xz * 0.31 + vec2f(41.0, 5.0), 2);
  let hue = tnFbm(xz * 0.09 + vec2f(7.0, 63.0), 2);
  let clover = smoothstep(0.55, 0.72, tnFbm(xz * 0.9 + vec2f(19.0, 3.0), 2));
  var c = mix(GL_GRASS_LUSH, GL_GRASS_YELLOW, smoothstep(0.42, 0.66, hue));
  c = mix(c, GL_GRASS_CLOVER, 0.7 * clover);
  return mix(c, GL_GRASS_DRY, dry) * (0.82 + 0.4 * tuft);
}

fn grassTint(xz : vec2f) -> vec3f {
  return grassTintFromMaps(xz, terrainMapsAt(terrainMirrorXz(xz)));
}

fn terrainLayerWeights(xz : vec2f, y : f32, ny : f32, maps : vec4f, waterLevel : f32) -> LayerWeights {
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
  let rill = smoothstep(0.955, 0.99, ridged) * smoothstep(0.04, 0.10, slope) * (1.0 - steep);
  let fan = smoothstep(0.30, 0.65, dep) * (1.0 - smoothstep(0.05, 0.14, slope));
  let scree = smoothstep(0.10, 0.20, slope) * (1.0 - steep) * smoothstep(0.40, 0.70, tnFbm(q * 0.35 + vec2f(2.0, 19.0), 2));

  // The sward thins in metre-scale patches, more on slopes, dry ground and thin soil; soil shows through the gaps.
  let dry = glDryness(xz, wet);
  let patchN = tnFbm(q * 0.55 + vec2f(23.0, 51.0), 3);
  let thinSoil = 1.0 - smoothstep(0.30, 0.70, soilJ);
  let sparse = smoothstep(0.52, 0.80, patchN + 0.30 * smoothstep(0.03, 0.15, slope) + 0.18 * dry + 0.25 * thinSoil);
  let cover = smoothstep(0.22, 0.65, soilJ) * gentle * (1.0 - 0.85 * gully) * (1.0 - 0.8 * rill);
  let sward = cover * (1.0 - 0.9 * sparse);
  let grass = sward * (1.0 - dry);
  let hay = sward * dry;

  let channel = smoothstep(0.5, 0.9, flow);
  let dirt = 0.10 + 0.9 * smoothstep(0.05, 0.35, soilJ) * (1.0 - smoothstep(0.35, 0.7, soilJ)) + 0.7 * channel
    + 0.9 * cover * sparse + 0.9 * gully + 0.8 * rill;
  let gravel = 0.7 * scree + 0.7 * channel * (0.4 + 0.6 * dep) + 0.6 * fan * (0.3 + 0.7 * smoothstep(0.3, 0.7, flow)) + 0.4 * gully * dep;

  var shore = 0.0;
  if (waterLevel > -1.0e8) { shore = 1.0 - smoothstep(-8.0, 3.5, y - waterLevel); }
  let sand = max(shore, 0.3 * smoothstep(0.5, 0.85, dep) * gentle);

  let pat = smoothstep(0.42, 0.70, tnFbm(q * 0.08 + vec2f(31.0, 17.0), 2));
  let bank = smoothstep(0.5, 0.85, wet) * (1.0 - smoothstep(0.05, 0.14, slope));
  let loam = (0.6 * wet * smoothstep(0.35, 0.8, soilJ) * pat + 0.8 * bank * (0.4 + 0.6 * pat)) * (1.0 - smoothstep(0.06, 0.16, slope));

  let snow = smoothstep(0.78, 0.86, hRel + 0.05 * jitter) * gentle;
  let keep = 1.0 - snow;
  var w : LayerWeights;
  w.lo = vec4f(grass, hay, dirt, gravel) * keep;
  w.hi = vec4f(rock * keep, sand * keep * (1.0 - 0.6 * rock), snow, loam * keep);
  return w;
}

fn layerMacroColor(layer : i32, xz : vec2f, y : f32, maps : vec4f) -> vec3f {
  switch (layer) {
    case 0: { return grassTintFromMaps(xz, maps); }
    case 1: { return glBaseColor(GL_HAY) * (0.8 + 0.4 * tnFbm(xz * 0.07 + vec2f(2.0, 8.0), 2)); }
    case 2: {
      let t = tnFbm(xz * 0.05 + vec2f(13.0, 1.0), 3);
      let tone = mix(vec3f(1.15, 0.95, 0.75), vec3f(0.85, 0.9, 1.0), t);
      return glBaseColor(GL_DIRT) * tone * (1.0 - 0.3 * smoothstep(0.5, 0.9, maps.y));
    }
    case 3: { return glBaseColor(GL_GRAVEL) * (0.85 + 0.3 * tnFbm(xz * 0.11 + vec2f(5.0, 27.0), 2)); }
    case 4: {
      let warp = 2.2 * tnFbm(xz * 0.03 + vec2f(3.0, 44.0), 2);
      let band = 0.5 + 0.5 * sin(y * 0.85 + warp * 6.0);
      let tone = mix(vec3f(1.12, 1.0, 0.88), vec3f(0.86, 0.9, 0.98), band);
      let lichen = smoothstep(0.60, 0.72, tnFbm(xz * 0.21 + vec2f(71.0, 9.0), 2)) * 0.5;
      return mix(glBaseColor(GL_ROCK) * tone, vec3f(0.20, 0.21, 0.08), lichen);
    }
    case 5: { return glBaseColor(GL_SAND) * (0.9 + 0.2 * tnFbm(xz * 0.13 + vec2f(9.0, 3.0), 2)); }
    case 6: { return glBaseColor(GL_SNOW); }
    default: { return glBaseColor(GL_LOAM); }
  }
}

fn groundBaseColorAt(xz : vec2f, y : f32, ny : f32, maps : vec4f, waterLevel : f32) -> vec3f {
  let lw = terrainLayerWeights(xz, y, ny, maps, waterLevel);
  var w = array<f32, 8>(lw.lo.x, lw.lo.y, lw.lo.z, lw.lo.w, lw.hi.x, lw.hi.y, lw.hi.z, lw.hi.w);
  var sum = 0.0;
  for (var i = 0; i < GL_COUNT; i++) { sum += w[i]; }
  var c = vec3f(0.0);
  for (var i = 0; i < GL_COUNT; i++) {
    if (w[i] > 0.02 * sum) { c += w[i] * layerMacroColor(i, xz, y, maps); }
  }
  return c / max(sum, 1e-4);
}

fn groundBaseColor(xz : vec2f) -> vec3f {
  let m = terrainMirrorXz(xz);
  return groundBaseColorAt(xz, terrainHeightMirrored(xz), terrainNormalAt(m).y, terrainMapsAt(m), -1.0e9);
}
