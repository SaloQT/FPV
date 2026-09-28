// Group 0, binding 0: per-frame uniforms. Layout mirrored by writeFrameUniforms() in src/render/frameUniforms.ts.
// Conventions: world is +Y up, +X east, -Z north. Depth is reverse-Z (near = 1, far = 0), infinite far plane.
struct Frame {
  view : mat4x4f,
  proj : mat4x4f,               // includes TAA jitter
  viewProj : mat4x4f,           // includes TAA jitter (use for rasterisation)
  viewProjUnjittered : mat4x4f, // use for motion vectors (current frame)
  invView : mat4x4f,
  invProj : mat4x4f,            // inverse of the jittered proj
  invViewProj : mat4x4f,        // inverse of the jittered viewProj (use to reconstruct world pos from depth)
  prevViewProj : mat4x4f,       // previous frame, unjittered
  celestial : mat4x4f,          // upper-left 3x3: J2000 equatorial -> world axes
  camPos : vec4f,               // xyz = world position (m), w = simulation time (s)
  screen : vec4f,               // x,y = render width,height (px); z,w = reciprocals
  jitter : vec4f,               // xy = current jitter (NDC units), zw = previous
  sunDir : vec4f,               // xyz = unit vector toward the sun, w = angular radius (rad)
  sunIrradiance : vec4f,        // rgb = illuminance at the TOP of the atmosphere on a surface facing the sun (lux, ~1.27e5); shaders multiply by transmittance(surface height, sun zenith) from transmittanceLUT. w = 1 if above horizon
  moonDir : vec4f,              // xyz = toward the moon, w = angular radius (rad)
  moonIrradiance : vec4f,       // rgb = top-of-atmosphere illuminance from the moon in lux (phase-dependent, ~0.3 at full moon); apply transmittance like the sun. w = illuminated fraction
  terrain : vec4f,              // x = N samples per side, y = cellSize (m), z = minHeight, w = maxHeight
  terrainOrigin : vec4f,        // xy = world (x,z) of sample (0,0), zw = world extent (m)
  misc : vec4u,                 // x = frame index, y = quality flags, z = per-frame random seed, w = KEY LIGHT flag: 0 => sunShadow texture holds the SUN's visibility, 1 => the MOON's. y bits: 1 = rtSpecular, 2 = bloom, 4 = taa
  params : vec4f,               // x = dt (s), y = PRE-EXPOSURE (multiply all HDR writes), z = near, w = far (unused: infinite)
  sky : vec4f,                  // x = planet radius (km), y = atmosphere top radius (km), z = camera height above datum (km), w = night-sky brightness scale
};

@group(0) @binding(0) var<uniform> frame : Frame;
