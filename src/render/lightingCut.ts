import type { AstroState } from '../contracts';
import { estimateSceneLuminance } from './exposure';

/**
 * A lighting cut: the sun or moon jumped across the sky, or the scene's brightness jumped by several stops, between two frames (the
 * time-of-day slider, a night session loaded after a day one). The real sun moves about 0.004 degrees a second and dusk dims the land by
 * well under an EV a second, so either threshold is far beyond anything time itself does. On a cut every temporal lighting cache (RT GI
 * and probes, cloud history, TAA, the exposure and white-balance adaptation) must start again: left alone, the probes keep two thirds of
 * a noon light for 2 s after a jump to midnight, which the night camera's gain turns into green-glowing crowns under a black sky.
 */
export const LIGHTING_CUT = {
  /** Sun or moon direction change per frame (radians, 1 degree). */
  angleRad: Math.PI / 180,
  /** Change of the astronomy's scene-luminance estimate per frame (EV). */
  luminanceEv: 2,
} as const;

const angleBetween = (a: readonly number[], b: readonly number[]): number => {
  const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(a[0], a[1], a[2]) * Math.hypot(b[0], b[1], b[2]) || 1);
  return Math.acos(Math.min(1, Math.max(-1, d)));
};

export class LightingCutDetector {
  private readonly sun = [0, 0, 0];
  private readonly moon = [0, 0, 0];
  private logLum = 0;
  private primed = false;

  /** True when this frame's lighting is discontinuous with the last one's; the first frame never is (every cache starts empty then). */
  step(astro: AstroState, cameraHeight: number): boolean {
    const logLum = Math.log2(estimateSceneLuminance(astro, cameraHeight));
    const cut = this.primed && (angleBetween(this.sun, astro.sunDir) > LIGHTING_CUT.angleRad || angleBetween(this.moon, astro.moonDir) > LIGHTING_CUT.angleRad
      || Math.abs(logLum - this.logLum) > LIGHTING_CUT.luminanceEv);
    for (let i = 0; i < 3; i++) { this.sun[i] = astro.sunDir[i]; this.moon[i] = astro.moonDir[i]; }
    this.logLum = logLum;
    this.primed = true;
    return cut;
  }
}
