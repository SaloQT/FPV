// Ground layer ids and their mean linear albedo. Shared by the detail-texture generator (which bakes these colours into the
// texture array) and by ground_color.wgsl (macro colour, grass tint). No bindings: safe to include from compute shaders.

const GL_GRASS : i32 = 0;
const GL_HAY : i32 = 1;
const GL_DIRT : i32 = 2;
const GL_GRAVEL : i32 = 3;
const GL_ROCK : i32 = 4;
const GL_SAND : i32 = 5;
const GL_SNOW : i32 = 6;
const GL_LOAM : i32 = 7;
const GL_COUNT : i32 = 8;

const GL_GRASS_LUSH : vec3f = vec3f(0.050, 0.118, 0.020);
const GL_GRASS_DRY : vec3f = vec3f(0.150, 0.150, 0.045);

fn glBaseColor(layer : i32) -> vec3f {
  switch (layer) {
    case 0: { return vec3f(0.085, 0.130, 0.030); }
    case 1: { return vec3f(0.245, 0.198, 0.088); }
    case 2: { return vec3f(0.170, 0.110, 0.065); }
    case 3: { return vec3f(0.290, 0.270, 0.240); }
    case 4: { return vec3f(0.195, 0.175, 0.155); }
    case 5: { return vec3f(0.430, 0.360, 0.240); }
    case 6: { return vec3f(0.800, 0.820, 0.860); }
    default: { return vec3f(0.070, 0.050, 0.034); }
  }
}

// Baseline microfacet roughness per layer (the lighting pass lowers it further with wetness).
fn glRoughness(layer : i32) -> f32 {
  switch (layer) {
    case 0: { return 0.86; }
    case 1: { return 0.88; }
    case 2: { return 0.93; }
    case 3: { return 0.80; }
    case 4: { return 0.78; }
    case 5: { return 0.90; }
    case 6: { return 0.60; }
    default: { return 0.85; }
  }
}
