// Ground layer ids and their mean linear albedo. Shared by the detail-texture generator (which bakes these colours into the
// texture array) and by ground_color.wgsl (macro colour, grass tint). No bindings: safe to include from compute shaders.
// Measured broadband reflectances: living grass 0.10-0.14 (luminance), dry grass 0.18-0.25, soil 0.10-0.18, gravel and rock 0.15-0.25.

const GL_GRASS : i32 = 0;
const GL_HAY : i32 = 1;
const GL_DIRT : i32 = 2;
const GL_GRAVEL : i32 = 3;
const GL_ROCK : i32 = 4;
const GL_SAND : i32 = 5;
const GL_SNOW : i32 = 6;
const GL_LOAM : i32 = 7;
const GL_COUNT : i32 = 8;

const GL_GRASS_LUSH : vec3f = vec3f(0.052, 0.114, 0.021);
const GL_GRASS_YELLOW : vec3f = vec3f(0.096, 0.142, 0.030);
const GL_GRASS_CLOVER : vec3f = vec3f(0.040, 0.098, 0.030);
const GL_GRASS_DRY : vec3f = vec3f(0.170, 0.150, 0.048);

fn glBaseColor(layer : i32) -> vec3f {
  switch (layer) {
    case 0: { return vec3f(0.072, 0.124, 0.026); }
    case 1: { return vec3f(0.222, 0.180, 0.082); }
    case 2: { return vec3f(0.165, 0.108, 0.064); }
    case 3: { return vec3f(0.240, 0.222, 0.196); }
    case 4: { return vec3f(0.185, 0.166, 0.148); }
    case 5: { return vec3f(0.340, 0.282, 0.190); }
    case 6: { return vec3f(0.800, 0.820, 0.860); }
    default: { return vec3f(0.066, 0.047, 0.032); }
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
    default: { return 0.88; }
  }
}
