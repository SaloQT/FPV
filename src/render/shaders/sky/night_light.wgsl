// Night light that is not scattered sunlight: airglow (Van Rhijn shell), the unresolved starlight floor and zodiacal light. Radiance in
// nits at a night-scale of 1, BEFORE extinction (callers multiply by the LUT transmittance). Mirrors the night section of
// src/render/atmosphere/physics.ts. Include after common/math.wgsl (PI).

const AIRGLOW_HEIGHT : f32 = 90.0;
const AIRGLOW_ZENITH : vec3f = vec3f(3.1e-4, 3.2e-4, 3.4e-4);
const AIRGLOW_SLANT_TINT : vec3f = vec3f(-1.5e-5, 4.0e-5, -1.0e-5);
const STARLIGHT_FLOOR : vec3f = vec3f(3.5e-5, 3.5e-5, 3.8e-5);
const NITS_PER_S10 : f32 = 8.3e-7;
const ZODIACAL_COLOR : vec3f = vec3f(1.0, 0.98, 0.93);
const ZODIACAL_POLE_S10 : f32 = 77.0;
const ZODIACAL_FAR_S10 : f32 = 140.0;
const ZODIACAL_NEAR_S10 : f32 = 1360.0;
const GEGENSCHEIN_S10 : f32 = 45.0;

fn vanRhijn(cosZ : f32, groundRadiusKm : f32) -> f32 {
  let s = (groundRadiusKm / (groundRadiusKm + AIRGLOW_HEIGHT)) * sqrt(max(1.0 - cosZ * cosZ, 0.0));
  return 1.0 / sqrt(1.0 - s * s);
}

fn nightSkyNits(cosZ : f32, groundRadiusKm : f32) -> vec3f {
  let vr = vanRhijn(cosZ, groundRadiusKm);
  return AIRGLOW_ZENITH * vr + AIRGLOW_SLANT_TINT * (vr - 1.0) + STARLIGHT_FLOOR;
}

// Zodiacal light in S10 from the cosine of the sun elongation and the sine of the ecliptic latitude of the view direction.
fn zodiacalS10(cosElong : f32, sinLat : f32) -> f32 {
  let eps = max(degrees(acos(clamp(cosElong, -1.0, 1.0))), 15.0);
  let g = (180.0 - eps) / 8.0;
  let gegen = GEGENSCHEIN_S10 * exp(-g * g);
  let onEcliptic = ZODIACAL_FAR_S10 + ZODIACAL_NEAR_S10 * pow(30.0 / eps, 2.5) + gegen;
  let cosLat = sqrt(max(1.0 - sinLat * sinLat, 0.0));
  let steepness = 5.0 + 25.0 * exp(-eps / 35.0);
  return ZODIACAL_POLE_S10 + (onEcliptic - ZODIACAL_POLE_S10) * pow(cosLat, steepness);
}

fn zodiacalNits(dir : vec3f, sunDir : vec3f, eclNorth : vec3f) -> vec3f {
  return ZODIACAL_COLOR * (zodiacalS10(dot(dir, sunDir), dot(dir, eclNorth)) * NITS_PER_S10);
}
