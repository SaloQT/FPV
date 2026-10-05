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
  /** Corrugated shipping container; a2 = colour (CONTAINER_COLOURS). */
  CONTAINER: 16,
  /** Cast concrete (pillars, bridge piers and decks); a2 = 0 formwork, 1 asphalt, 2 weathered. */
  CONCRETE: 17,
  /** Yellow and black warning stripes. */
  HAZARD: 18,
  /** Painted structural steel (towers, scaffolds, beam posts); a2 = paint (STEEL_COLOURS). */
  STEEL_PAINT: 19,
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
  /**
   * Printed board of a window wall or tunnel sleeve, accented in the gate's colour (gates[a3]). a2 encodes the opening it frames,
   * round(half width * 100) * 1000 + round(half height * 100) (see panelCode), so a band can be drawn round it; 0 = a plain board.
   */
  GATE_PANEL: 34,
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

/** Container paint colours (linear RGB) by a2; track_materials.wgsl CONTAINER_COLOURS holds the same list (shaders.test.ts compares them). */
export const CONTAINER_COLOURS: readonly [number, number, number][] = [
  [0.33, 0.055, 0.03],
  [0.025, 0.11, 0.32],
  [0.04, 0.2, 0.075],
  [0.62, 0.17, 0.02],
  [0.3, 0.3, 0.29],
  [0.6, 0.6, 0.57],
  [0.19, 0.03, 0.04],
  [0.6, 0.38, 0.02],
];

/** Structural steel paints by a2: galvanised, aviation red, aviation white, safety yellow, blue. Mirrored in track_materials.wgsl STEEL_COLOURS. */
export const STEEL_COLOURS: readonly [number, number, number][] = [
  [0.42, 0.43, 0.44],
  [0.55, 0.04, 0.025],
  [0.72, 0.72, 0.7],
  [0.7, 0.45, 0.02],
  [0.04, 0.16, 0.38],
];
export const STEEL_GALVANISED = 0;
export const STEEL_RED = 1;
export const STEEL_WHITE = 2;
export const STEEL_YELLOW = 3;
export const STEEL_BLUE = 4;

/** a2 of a GATE_PANEL face that frames an opening of half width `hw` and half height `hh` (metres, below 10). */
export function panelCode(hw: number, hh: number): number {
  return Math.round(Math.min(hw, 9.99) * 100) * 1000 + Math.round(Math.min(hh, 9.99) * 100);
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
