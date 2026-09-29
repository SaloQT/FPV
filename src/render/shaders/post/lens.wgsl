// FPV lens and rolling shutter geometry. Every function maps an OUTPUT (sensor) uv to the uv to fetch from the rectilinear render.
// Radii are aspect-correct and normalised so the image corner has radius 1.

// Brown-Conrady radial model r_d = r_u (1 + k1 r_u^2 + k2 r_u^4), inverted per pixel with Newton (g is increasing and concave,
// so iterating from r_d approaches the root monotonically from below). `zoom` = 1 + k1 + k2 keeps the corner fixed: no black wedges, only a fisheye look.
// Returns (uvRect, outputRadius).
fn lensUndistort(uv : vec2f, size : vec2f, k1 : f32, k2 : f32, zoom : f32) -> vec3f {
  let hd = 0.5 * length(size);
  let p = (uv - 0.5) * size / hd;
  let len = length(p);
  let rd = len * zoom;
  var ru = rd;
  for (var i = 0; i < 4; i++) {
    let r2 = ru * ru;
    let g = ru * (1.0 + k1 * r2 + k2 * r2 * r2) - rd;
    ru -= g / (1.0 + 3.0 * k1 * r2 + 5.0 * k2 * r2 * r2);
  }
  return vec3f(0.5 + p * (ru / max(len, 1e-6)) * hd / size, len);
}

// Camera angular velocity `omega` (camera frame, rad/s) moves the scene during the readout: row at v exposes (v - 0.5) * readout later
// than the frame centre. Returns the scene displacement in pixels (y down) at that row; the caller samples at (uv - d / size).
// jello = (amplitude px, phase at frame centre, rad per unit v, unused): motor vibration seen through the same line-by-line readout.
fn rollingShift(uv : vec2f, size : vec2f, omega : vec3f, focalPx : f32, readout : f32, jello : vec4f) -> vec2f {
  let yn = uv.y - 0.5;
  let th = omega * (yn * readout);
  let c = (uv - 0.5) * size;
  var d = vec2f(focalPx * th.y - c.y * th.z, focalPx * th.x + c.x * th.z);
  d.x += jello.x * sin(jello.y + jello.z * yn);
  let lim = 0.08 * max(size.x, size.y);
  return clamp(d, vec2f(-lim), vec2f(lim));
}

struct LensCoords {
  g : vec2f,
  r : vec2f,
  b : vec2f,
  rad : f32,
};

// Lateral chromatic aberration: red magnified and blue shrunk about the centre, growing with r^3 so it is zero on axis.
// caRel = edge displacement in pixels / half diagonal in pixels.
fn lensCoords(uv : vec2f, size : vec2f, k : vec3f, shiftPx : vec2f, caRel : f32) -> LensCoords {
  let u = lensUndistort(uv, size, k.x, k.y, k.z);
  let g = u.xy - shiftPx / size;
  let s = caRel * u.z * u.z;
  return LensCoords(g, vec2f(0.5) + (g - 0.5) * (1.0 + s), vec2f(0.5) + (g - 0.5) * (1.0 - s), u.z);
}

// cos^4 natural falloff (a = tan of the field angle, roughly r / 2 for a wide FPV lens) times a mechanical barrel cut-off.
fn lensVignette(rad : f32, strength : f32) -> f32 {
  let a = 0.5 * rad;
  let nat = 1.0 / ((1.0 + a * a) * (1.0 + a * a));
  let mech = 1.0 - 0.22 * smoothstep(0.8, 1.15, rad);
  return mix(1.0, nat * mech, strength);
}

// One-pixel anti-aliased edge of the image; 1 everywhere inside, so the identity lens never darkens a border pixel.
fn lensMask(uv : vec2f, size : vec2f) -> f32 {
  let d = (vec2f(0.5) - abs(uv - 0.5)) * size + 0.5;
  return saturate(d.x) * saturate(d.y);
}
