/** Per-vertex material kinds shared by the CPU mesh builders and the WGSL (injected as `${K_<NAME>}` defines). */
export const KIND = {
  GATE_FRAME: 1,
  GATE_CHEVRON: 2,
  GATE_LED: 3,
  GATE_BASE: 4,
  GATE_CHECKER: 5,
  CONE: 6,
  POLE: 7,
  FLAGPOLE: 8,
  WALL: 9,
  ROCK: 10,
  TRUNK: 11,
  LEAVES: 12,
  CLOTH: 13,
  PAD: 14,
  PAD_EDGE: 15,
  CARBON: 20,
  ALU: 21,
  PCB: 22,
  BATTERY: 23,
  RUBBER: 24,
  MOTOR_BELL: 25,
  MOTOR_BASE: 26,
  PLASTIC: 27,
  LENS: 28,
  LED: 29,
  PROP: 30,
  WIRE: 31,
  STEEL: 32,
  PROP_HUB: 33,
} as const;

export type KindName = keyof typeof KIND;

/** WGSL defines `K_<NAME>` for every kind. */
export function kindDefines(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(KIND)) out[`K_${k}`] = v;
  return out;
}

/** Gate frame colours (linear RGB): the start gate is green, the rest cycle orange, lime, magenta. */
const GATE_COLOURS: readonly [number, number, number][] = [
  [1.0, 0.24, 0.02],
  [0.42, 0.85, 0.02],
  [0.9, 0.03, 0.42],
];
const START_COLOUR: [number, number, number] = [0.03, 0.62, 0.1];

export function gateColour(index: number): [number, number, number] {
  return index === 0 ? START_COLOUR : GATE_COLOURS[(index - 1) % GATE_COLOURS.length];
}

/** A cloth flag hoisted on a pole: `pos` is the top of the hoist edge, the cloth hangs `height` below it and streams `width` downwind. */
export interface ClothFlag {
  pos: [number, number, number];
  width: number;
  height: number;
  colour: [number, number, number];
  /** Decorrelates the wave phase between flags. */
  seed: number;
}
