// AtmosParams: the atmosphere module's own uniform block (no binding declared here; each shader declares it). Mirrors packAtmosParams()
// in src/render/atmosphere/uniforms.ts row for row. Define MARIA_ROWS (2 rows per lunar mare) before including.

// The cloud target stores rgb / CLOUD_STORE_SCALE: rgba16float tops out at 65504 and sunlit cloud edges seen near the sun scatter
// several 1e5 nits toward the eye.
const CLOUD_STORE_SCALE : f32 = 32.0;

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
