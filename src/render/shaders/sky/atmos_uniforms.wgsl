// AtmosParams: the atmosphere module's own uniform block (no binding declared here; each shader declares it). Mirrors packAtmosParams()
// in src/render/atmosphere/uniforms.ts row for row. Define MARIA_ROWS (2 rows per lunar mare) before including.

// The cloud target stores rgb / CLOUD_STORE_SCALE: rgba16float tops out at 65504 and sunlit cloud edges seen near the sun scatter
// several 1e5 nits toward the eye.
const CLOUD_STORE_SCALE : f32 = 32.0;

// rgba16float holds finite values up to 65504 and overflows to Inf, which then poisons every bilinear tap, blend and history that touches it
// (Inf * 0 = NaN). Every LUT or target that can see the aureole beside the sun is clamped to this before the store.
const FP16_STORE_MAX : f32 = 65000.0;

// The sun-pass sky-view LUT (skySun, read only by sky.wgsl) stores nits / skySunStoreScale(): the aureole peaks near 4e5 nits at the sun (sun
// at 12 degrees), above fp16's range, and the sky pass keeps the physical value by multiplying back. The world sky-view LUT keeps plain nits for
// its many consumers and is clamped instead. A night sky sits at fp16's smallest normal value (6.1e-5) already, so the scale applies only
// while the sun is above SKY_SUN_SCALE_MIN_MU (about -5.7 degrees), where no aureole is left and the whole sky is brighter than a nit.
const SKY_SUN_STORE_SCALE : f32 = 16.0;
const SKY_SUN_SCALE_MIN_MU : f32 = -0.1;

fn skySunStoreScale() -> f32 { return select(1.0, SKY_SUN_STORE_SCALE, frame.sunDir.y > SKY_SUN_SCALE_MIN_MU); }

struct AtmosParams {
  flags : vec4f,     // x = moonlight scattering active (0/1), y = night-sky scale, z = star brightness, w = twinkle amount 0..1
  sky2 : vec4f,      // x = Milky Way brightness, y = stars enabled, z = clouds enabled, w = star magnitude limit
  cloudA : vec4f,    // x = cumulus coverage, y = cirrus coverage, z = density scale, w = seed (0..1000)
  cloudB : vec4f,    // x = cumulus base km, y = cumulus top km, z = cirrus base km, w = cirrus top km
  wind : vec4f,      // xy = cumulus drift (m, world x/z), zw = cirrus drift (m)
  cloudC : vec4f,    // x = march steps, y = frame/jitter index, z,w = shadow-map centre (world x, z in m)
  cloudD : vec4f,    // x = history blend, y = 1 when history is valid, z = light march steps, w = shadow-map side length (m)
  eclNorth : vec4f,  // xyz = world-space ecliptic north pole, w = cirrus streak bearing (rad, compass, the upper wind's direction)
  gal0 : vec4f,      // J2000 equatorial coordinates of the galactic axis l=0 b=0 (galactic centre)
  gal1 : vec4f,      // ... l=90 b=0
  gal2 : vec4f,      // ... north galactic pole
  maria : array<vec4f, ${MARIA_ROWS}>, // row 2k: lon, lat, radius lon, radius lat (rad); row 2k+1: darkness, edge softness, rotation, 0
};
