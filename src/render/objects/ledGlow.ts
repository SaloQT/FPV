/**
 * CPU mirror of the LED glow level the forward glow shaders compute (`ledDisplay` and `glowShown` in shaders/objects/common.wgsl),
 * so the numbers can be tested: a light source must read as a light at night without clipping to white or leaving fp16.
 */
import { EMISSIVE_MAX_NITS } from '../contracts';
import { DAY_TOTAL_EV, EXPOSURE_TUNING } from '../post/exposure';

/** Highest total exposure (pre-exposure times the exposure ratio) the camera model ever reaches: its full night gain over the daylight reference. */
export const NIGHT_TOTAL_EXPOSURE = 2 ** (EXPOSURE_TUNING.maxGainEv + DAY_TOTAL_EV);

/** Share of the emissive strength a glow ribbon radiates (a stand-in for the bloom of a real lens). */
export const GLOW_EMISSION_SHARE = 0.35;

/**
 * Camera distance (metres) over which a gate's glow ribbons fade in: gone at the near end, full from the far end. A ribbon a metre from
 * the lens would otherwise sweep across most of the screen at full strength, and at night that whites out the frame as the drone flies
 * through the gate; the LED strip itself stays lit.
 */
export const GLOW_NEAR_FADE_M = [1, 5] as const;

/** How much of a glow ribbon shows at this camera distance (0 inside the near end of GLOW_NEAR_FADE_M, 1 beyond its far end). */
export function glowNearFade(dist: number): number {
  const [near, far] = GLOW_NEAR_FADE_M;
  const t = Math.min(Math.max((dist - near) / (far - near), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Display level (after exposure, 1 is the camera's clipping point) the core of a glow may reach for an LED of this emissive strength. */
export function ledDisplay(strength: number): number {
  return Math.min(Math.max(strength * 4, 0.15), 2.2);
}

/**
 * Glow level in pre-exposed HDR units. Physical (nits times pre-exposure) while that stays under the cap; the cap keeps the display level
 * of the core near `ledDisplay`, so the LED colour survives instead of clipping to white. The exposure ratio is not known to the shader,
 * but total exposure never exceeds NIGHT_TOTAL_EXPOSURE, so the ratio is at most that over the pre-exposure.
 */
export function glowShown(strength: number, preExposure: number, energy: number): number {
  const nits = strength * EMISSIVE_MAX_NITS * GLOW_EMISSION_SHARE * energy;
  return Math.min(nits * preExposure, ledDisplay(strength) * Math.max(1, preExposure / NIGHT_TOTAL_EXPOSURE));
}
