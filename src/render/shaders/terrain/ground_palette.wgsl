// Ground layer ids and their mean linear albedo. Shared by the detail-texture generator (which bakes these colours into the
// texture array) and by ground_color.wgsl (macro colour, grass tint). No bindings: safe to include from compute shaders.
// Measured broadband reflectances: living grass 0.10-0.14 (luminance), dry grass 0.20-0.30, soil 0.10-0.18, gravel and rock 0.15-0.25,
// moss 0.05-0.10, dry leaf litter 0.10-0.15, conifer needle duff 0.07-0.10, wet mud 0.05-0.08, dry crusted clay 0.18-0.28.
// Hues follow photographs of each surface under daylight: topsoil a warm brown (sRGB about 110/90/70), beech and oak litter a grey-brown
// (photographs of woodland floors: sRGB about 95/85/75, saturation 0.3-0.4, warmer only where fresh), needle duff a dull rust, moss yellow-green.

const GL_GRASS : i32 = 0;
const GL_HAY : i32 = 1;
const GL_DIRT : i32 = 2;
const GL_GRAVEL : i32 = 3;
const GL_ROCK : i32 = 4;
const GL_SAND : i32 = 5;
const GL_SNOW : i32 = 6;
const GL_LOAM : i32 = 7;
// The layers below refine the eight above for the terrain shader alone (see terrainMaterialWeights in ground_color.wgsl); the grass
// placement and the macro colour of other callers only ever see the first eight.
const GL_MOSS : i32 = 8;
const GL_LITTER : i32 = 9;
const GL_NEEDLES : i32 = 10;
const GL_MUD : i32 = 11;
const GL_CRACKED : i32 = 12;
const GL_SCREE : i32 = 13;
const GL_BASE_COUNT : i32 = 8;
const GL_COUNT : i32 = 14;

// Living grass reflects about 0.06-0.09 / 0.11-0.12 / 0.03-0.05 (R / G / B), and a sward mixes in seed heads, dead leaves and sheen,
// so it reads as a muted yellow-green (photographs: hue 65-80 degrees, saturation 0.4-0.6), neither teal nor neon lime.
const GL_GRASS_LUSH : vec3f = vec3f(0.078, 0.106, 0.052);
const GL_GRASS_YELLOW : vec3f = vec3f(0.100, 0.112, 0.058);
const GL_GRASS_CLOVER : vec3f = vec3f(0.056, 0.098, 0.050);
const GL_GRASS_RUSSET : vec3f = vec3f(0.100, 0.090, 0.055);
const GL_GRASS_DRY : vec3f = vec3f(0.235, 0.200, 0.105);
// Light under a closed canopy is skylight that has passed through and bounced off leaves: a green cast, not sky blue (but not orange
// either: most of it still comes through the gaps, so blue is only partly cut). The ground and grass
// beneath crowns take this tint on their albedo (scaled by the forest-floor cover) to stand in for it, since only the trees near the scene
// focus have ray-traced canopies for the GI to see.
const GL_CANOPY_LIGHT : vec3f = vec3f(0.96, 1.0, 0.78);

fn glBaseColor(layer : i32) -> vec3f {
  switch (layer) {
    case 0: { return vec3f(0.088, 0.121, 0.043); }
    case 1: { return vec3f(0.290, 0.245, 0.140); }
    case 2: { return vec3f(0.135, 0.112, 0.088); }
    case 3: { return vec3f(0.180, 0.163, 0.140); }
    case 4: { return vec3f(0.185, 0.166, 0.148); }
    case 5: { return vec3f(0.315, 0.272, 0.205); }
    case 6: { return vec3f(0.800, 0.820, 0.860); }
    case 7: { return vec3f(0.085, 0.066, 0.050); }
    case 8: { return vec3f(0.046, 0.066, 0.030); }
    case 9: { return vec3f(0.122, 0.099, 0.078); }
    case 10: { return vec3f(0.102, 0.080, 0.064); }
    case 11: { return vec3f(0.088, 0.071, 0.055); }
    case 12: { return vec3f(0.235, 0.205, 0.165); }
    default: { return vec3f(0.200, 0.186, 0.168); }
  }
}

// Baseline microfacet roughness per layer (the lighting pass lowers it further with wetness).
fn glRoughness(layer : i32) -> f32 {
  switch (layer) {
    case 0: { return 0.80; }
    case 1: { return 0.88; }
    case 2: { return 0.95; }
    case 3: { return 0.82; }
    case 4: { return 0.80; }
    case 5: { return 0.90; }
    case 6: { return 0.60; }
    case 7: { return 0.88; }
    case 8: { return 0.92; }
    case 9: { return 0.86; }
    case 10: { return 0.84; }
    case 11: { return 0.50; }
    case 12: { return 0.95; }
    default: { return 0.78; }
  }
}
