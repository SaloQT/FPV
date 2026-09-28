/** Every knob of the terrain pipeline in one place. Values were tuned by eye on hillshaded previews of several seeds. */

export const TUNING = {
  /** Smallest and largest grid the coarse-to-fine pipeline starts on (vertices per side). */
  coarseMin: 32,
  coarseMax: 256,
  /** Wavelength-proportional roughness added on every grid refinement (metres of amplitude per metre of wavelength). */
  detailSlopeGain: 0.07,
  /** Stream-power incision. Iterations are per level from the coarsest; levels beyond the list skip it. */
  spl: {
    iterations: [64, 24] as readonly number[],
    k: 0.2,
    diffusion: 0.18,
    /** Slope of the drop toward the map edge (edge cells are open outlets). */
    edgeSlope: 0.03,
    /** Peak uplift per iteration as a fraction of relief; the rate at the lowest ground is `upliftFloor` times this. */
    uplift: 0.045,
    upliftFloor: 0.35,
    softErodibility: 1.7,
    hardErodibility: 0.35,
  },
  /** Droplet erosion. Arrays are indexed by distance from the finest level (0 = finest); deeper levels get none. */
  droplets: {
    perCell: [0.35, 0.9] as readonly number[],
    lifetime: [48, 40] as readonly number[],
    inertia: 0.05,
    capacity: 4,
    minSlope: 0.01,
    erodeSpeed: 0.3,
    depositSpeed: 0.3,
    evaporation: 0.01,
    gravity: 4,
    radius: 3,
  },
  thermal: {
    soilTan: 0.7,
    rockTan: 2.0,
    iterations: 20,
    rate: 0.5,
  },
  creep: {
    flatTan: 0.25,
    strength: 0.5,
    iterations: 3,
  },
} as const;
