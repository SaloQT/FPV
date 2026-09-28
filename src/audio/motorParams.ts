/** Parameter layout shared by the motor AudioWorklet, its OscillatorNode fallback and the pure motor model. */

export interface ParamSpec {
  name: string;
  min: number;
  max: number;
  def: number;
}

export const MOTOR_COUNT = 4;

/** First index of each parameter group; freq and amp hold one entry per motor. */
export const P_FREQ = 0;
export const P_AMP = 4;
export const P_NOISE = 8;
export const P_NOISE_FC = 9;
export const P_ROUGH = 10;
export const P_FLUTTER = 11;
export const P_RUMBLE = 12;
export const P_SPREAD = 13;
export const MOTOR_PARAM_COUNT = 14;

/** Highest mechanical frequency the synth accepts (Hz): the top of the wavetable mip chain. */
export const MOTOR_FREQ_MAX = 1920;

export const MOTOR_PARAM_SPECS: readonly ParamSpec[] = [
  ...[0, 1, 2, 3].map((i) => ({ name: `f${i}`, min: 0, max: MOTOR_FREQ_MAX, def: 0 })),
  ...[0, 1, 2, 3].map((i) => ({ name: `a${i}`, min: 0, max: 2, def: 0 })),
  { name: 'noise', min: 0, max: 2, def: 0 },
  { name: 'noiseFc', min: 200, max: 12000, def: 3500 },
  { name: 'rough', min: 0, max: 0.05, def: 0.003 },
  { name: 'flutter', min: 0, max: 1, def: 0 },
  { name: 'rumble', min: 0, max: 2, def: 0 },
  { name: 'spread', min: 0, max: 1, def: 0 },
];

/** Stereo side of each motor for the onboard microphone: +1 right, -1 left (FR, RR, RL, FL). */
export const MOTOR_SIDE: readonly number[] = [1, 1, -1, -1];
