// Display transform: a hue-preserving filmic curve on luminance (Narkowicz's ACES fit), sensor-style highlight desaturation, a
// smooth gamut compression, a mild FPV-camera grade and the sRGB OETF.
// Input is scene-linear light already multiplied by the exposure ratio (0.22 ~ mid grey); output of `tonemap` is display-linear in [0, 1].
// The curve acts on luminance only and the colour keeps its chromaticity, so hue does not skew with brightness the way a per-channel curve
// does (blue sky drifting to cyan, foliage to neon yellow-green). A colour that nears the gamut edge slides along the line to the grey of
// the same luminance (a smooth knee on its chroma), so the brightest channel approaches but never sits on white: a saturated sky keeps its
// gradient instead of a flat 255 plateau in one channel.

struct Grade {
  preScale : f32,
  saturation : f32,
  contrast : f32,
  desatStart : f32,
  desatEnd : f32,
  gamutCeil : f32,
  gamutKnee : f32,
};

// preScale 0.64 puts the 0.22 key at about 0.2 display-linear (sRGB 0.48); saturation is the camera's colour matrix strength;
// desat: a scene luminance range over which the sensor saturates all three channels and the colour burns out to white.
// gamut: the brightest channel of a chromatic colour tops out at gamutCeil (display-linear; a neutral still reaches 1), and the chroma
// compression starts at gamutKnee of the room below that ceiling.
const GRADE : Grade = Grade(0.64, 1.05, 0.15, 4.0, 40.0, 0.93, 0.72);

fn lumaOf(c : vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

// Odd around zero, so sensor noise on a black pixel averages to black instead of rectifying into a lifted floor. Slope at 0 is 0.03 / 0.14.
fn filmicLuma(x : f32) -> f32 {
  let a = abs(x) * GRADE.preScale;
  return sign(x) * a * (2.51 * a + 0.03) / (a * (2.43 * a + 0.59) + 0.14);
}

// Chroma (brightest channel minus luma) of a colour of luma y is compressed with a hyperbolic knee whose asymptote is the gamut ceiling.
fn compressGamut(o : vec3f, y : f32) -> vec3f {
  let room = max(mix(GRADE.gamutCeil, 1.0, y * y * y * y) - y, 1e-4);
  let c = max(o.r, max(o.g, o.b)) - y;
  let knee = GRADE.gamutKnee * room;
  if (c <= knee) { return o; }
  let over = c - knee;
  let span = room - knee;
  return vec3f(y) + (o - vec3f(y)) * ((knee + span * over / (over + span)) / c);
}

fn tonemap(sceneLinear : vec3f) -> vec3f {
  let l = lumaOf(sceneLinear);
  let y = min(filmicLuma(l), 1.0);
  let k = select(GRADE.preScale * 0.03 / 0.14, y / l, abs(l) > 1e-6);
  var o = sceneLinear * k;
  o = mix(o, vec3f(y), smoothstep(GRADE.desatStart, GRADE.desatEnd, l));
  o = vec3f(y) + (o - vec3f(y)) * GRADE.saturation;
  return clamp(compressGamut(o, y), vec3f(0.0), vec3f(1.0));
}

fn srgbEncode(x : vec3f) -> vec3f {
  let c = clamp(x, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308));
}

fn srgbDecode(x : vec3f) -> vec3f {
  let c = clamp(x, vec3f(0.0), vec3f(1.0));
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

// Smoothstep-blended S-curve in the encoded domain: pivots at 0.5 and leaves 0 and 1 fixed.
fn gradeContrast(e : vec3f) -> vec3f {
  return mix(e, e * e * (3.0 - 2.0 * e), GRADE.contrast);
}

// Interleaved gradient noise (Jimenez 2014): a cheap, well-distributed per-pixel pattern.
fn ign(p : vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

// Triangular-PDF dither of +-1 output LSB: two decorrelated IGN lanes, rotated every frame so it averages out in time.
fn tpdfDither(pix : vec2f, frame : u32) -> f32 {
  let f = f32(frame & 63u);
  return ign(pix + vec2f(5.588238, 5.588238) * f) + ign(pix.yx + vec2f(47.0, 13.0) + vec2f(8.311, 3.917) * f) - 1.0;
}
