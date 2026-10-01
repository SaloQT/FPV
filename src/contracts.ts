/**
 * Shared, renderer-independent contracts. Every subsystem (terrain, track, astro, physics, input, game, render)
 * depends on these types and on nothing else from its siblings, so they can be built and tested in isolation.
 *
 * COORDINATES  Right-handed, +Y up. +X = east, -Z = north. Yaw 0 faces -Z (north). Positive yaw turns
 *              counter-clockwise seen from above (toward -X, west).  Body frame: +X right, +Y up, -Z forward
 *              (same handedness as the world, so the identity quaternion means "level, facing north").
 * UNITS        meters, seconds, kilograms, radians, Newtons, Volts, Amps unless a field says otherwise.
 * QUATERNION   [x, y, z, w], rotates body-frame vectors into world-frame vectors.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

// ───────────────────────────── Terrain ─────────────────────────────

export interface TerrainData {
  seed: number;
  /** Samples per side (square grid, N x N). Power of two. */
  resolution: number;
  /** Meters between adjacent samples. World extent per side = resolution * cellSize. */
  cellSize: number;
  /** World (x, z) of sample (0, 0). The grid is centred on the world origin: -resolution*cellSize/2. */
  origin: [number, number];
  /** Heights in meters above the datum, row-major: index = j * N + i, i along +X, j along +Z. */
  height: Float32Array;
  /** Per-sample material/erosion maps, each N*N, each value 0..1. */
  maps: {
    /** Regolith depth: 0 = bare rock, 1 = deep soil. Drives rock/dirt/grass split. */
    soil: Float32Array;
    /** Log-normalised upstream drainage area (channels ~1). Drives gullies, wet dirt, sand bars. */
    flow: Float32Array;
    /** Sediment deposited by the erosion sim (alluvial fans, valley floors). */
    deposit: Float32Array;
    /** Moisture index (flow + low slope + low height); drives grass lushness and mud. */
    wetness: Float32Array;
  };
  minHeight: number;
  maxHeight: number;
  /** Water surface height (lakes/sea) or -Infinity when the map has none. */
  waterLevel: number;
}

/** Fast exact queries against a TerrainData (bilinear over the triangulated grid used by the renderer). */
export interface TerrainSampler {
  readonly data: TerrainData;
  /** Ground height at world (x, z). Outside the map it clamps to the border. */
  heightAt(x: number, z: number): number;
  /** Unit surface normal at world (x, z). */
  normalAt(x: number, z: number, out?: Vec3): Vec3;
  /** Slope in radians (0 = flat). */
  slopeAt(x: number, z: number): number;
  /** Nearest ray hit against the terrain surface, or null. Direction need not be normalised. */
  raycast(origin: Vec3, dir: Vec3, maxDist: number): { t: number; point: Vec3; normal: Vec3 } | null;
}

export type TerrainQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface TerrainParams {
  seed: number;
  quality: TerrainQuality;
  /** Overrides for the defaults derived from `quality`. */
  resolution?: number;
  cellSize?: number;
  /** Peak-to-valley relief in meters (default ~220). */
  relief?: number;
}

/** Progress callback: stage name and 0..1 completion. */
export type ProgressFn = (stage: string, fraction: number) => void;

// ───────────────────────────── Track ─────────────────────────────

export type GateKind = 'square' | 'arch' | 'hoop' | 'dive' | 'flag' | 'start' | 'finish';

export interface TrackGate {
  index: number;
  kind: GateKind;
  /** Centre of the opening, world meters. */
  pos: Vec3;
  /** Heading of travel through the gate (radians, see COORDINATES). The gate plane is perpendicular to it. */
  yaw: number;
  /** Rotation about the travel axis (radians, +ve rolls clockwise from behind). Used by tilted gates. */
  roll: number;
  /** Pitch of the travel axis (radians, +ve = climbing). Used by dive gates. */
  pitch: number;
  /** Opening width and height in meters (inner clear size). */
  width: number;
  height: number;
}

export interface TrackObstacle {
  kind: 'pole' | 'cone' | 'tree' | 'rock' | 'wall' | 'flagpole';
  pos: Vec3;
  yaw: number;
  size: Vec3; // extents in meters (x,y,z of the collision box, or radius,height,radius for round things)
}

export interface TrackData {
  seed: number;
  style: 'race' | 'freestyle' | 'mountain' | 'sprint';
  gates: TrackGate[];
  obstacles: TrackObstacle[];
  /** Smooth centreline polyline (about 1 m spacing) an ideal pilot would fly; closed when `closed`. */
  path: Vec3[];
  closed: boolean;
  /** Total centreline length in meters. */
  length: number;
  /** Start / launch pad position (on the ground) and heading. */
  start: { pos: Vec3; yaw: number };
  laps: number;
}

export interface TrackParams {
  seed: number;
  style: TrackData['style'];
  /** Desired number of gates (the generator may return slightly fewer if the terrain is hostile). */
  gateCount?: number;
  laps?: number;
  /** Difficulty 0..1: tighter turns, more elevation change, smaller gates. */
  difficulty?: number;
}

// ───────────────────────────── Astronomy ─────────────────────────────

export interface Observer {
  latitudeDeg: number;
  longitudeDeg: number;
  /** Meters above sea level (only used for horizon dip / atmosphere path). */
  altitudeM: number;
}

export interface AstroState {
  /** Julian date (UT) of the simulated instant. */
  julianDate: number;
  /** Unit vectors from the observer toward the bodies, in WORLD axes (+Y up, -Z north, +X east). */
  sunDir: Vec3;
  moonDir: Vec3;
  /** Elevation above the geometric horizon in radians. */
  sunElevation: number;
  moonElevation: number;
  /** Fraction of the lunar disc that is lit (0 new .. 1 full) and the phase angle in radians. */
  moonIlluminatedFraction: number;
  moonPhaseAngle: number;
  /**
   * 3x3 row-major matrix rotating a J2000 equatorial unit vector (x toward RA0/Dec0, z toward the north celestial
   * pole) into WORLD axes at this instant/location. Star directions are then just spherical->cartesian * this matrix.
   */
  equatorialToWorld: number[];
  /** Bright planets (magnitude, world direction). */
  planets: { name: string; magnitude: number; dir: Vec3; color: Vec3 }[];
}

/** Loaded star catalogue (public/data/stars.bin, HYG v4.1, magnitude <= 8). Sorted brightest first. */
export interface StarCatalog {
  count: number;
  /** Interleaved [ra_rad, dec_rad, apparent_mag, bv_index] x count, J2000. */
  data: Float32Array;
}

// ───────────────────────────── Flight ─────────────────────────────

export type FlightMode = 'acro' | 'angle' | 'horizon';

/** What the pilot's transmitter sends, already normalised. Roll/pitch/yaw in -1..1, throttle 0..1. */
export interface StickInput {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
  armed: boolean;
  mode: FlightMode;
  /** Turtle mode ("crash flip"): spin selected motors in reverse to flip an upside-down quad. */
  turtle: boolean;
}

export interface QuadState {
  /** Simulation time in seconds. */
  time: number;
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  /**
   * Angular velocity ω = (ωx, ωy, ωz) in BODY axes (rad/s). ωx > 0 pitches the nose up, ωy > 0 yaws left (CCW from
   * above), ωz > 0 rolls left (right side up, since +Z points backward).
   */
  angVel: Vec3;
  /** Motor speeds in rad/s. Order: 0 front-right, 1 rear-right, 2 rear-left, 3 front-left. */
  motorOmega: [number, number, number, number];
  /** Commanded motor throttle 0..1 per motor after the mixer. */
  motorCmd: [number, number, number, number];
  batteryVoltage: number;
  batteryCurrent: number;
  batteryMah: number;
  /** Measured proper acceleration in G (what the pilot would feel / an accelerometer reads), body frame. */
  gForce: Vec3;
  armed: boolean;
  onGround: boolean;
  /** True for one frame after an impact above the crash threshold; `impactSpeed` gives the closing speed. */
  crashed: boolean;
  impactSpeed: number;
}

export interface ObstacleCollider {
  /** Oriented box: centre, half extents, yaw about +Y. */
  kind: 'box';
  center: Vec3;
  half: Vec3;
  yaw: number;
}

export interface Physics {
  readonly state: QuadState;
  /** Advance by exactly `dt` seconds (the caller runs a fixed-step accumulator; ~4000 Hz). */
  step(dt: number, input: StickInput): void;
  reset(pos: Vec3, yawRad: number): void;
  setColliders(colliders: ObstacleCollider[]): void;
}

// ───────────────────────────── Camera / settings ─────────────────────────────

export interface CameraState {
  pos: Vec3;
  quat: Quat;
  /** Vertical field of view in radians for the rectilinear render (lens distortion is a post effect). */
  fovY: number;
  aspect: number;
  near: number;
  far: number;
}

export type RenderQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  quality: RenderQuality;
  /** Target frame rate for the dynamic-resolution controller; 0 follows the measured display refresh rate. */
  targetFps: number;
  /** Frame cap in fps; 0 follows the display. Browsers cannot turn v-sync off, so this only throttles below the refresh rate. */
  frameCap: number;
  /** 'Performance 240' preset: `quality` with lower ray, probe, cloud and grass budgets, aimed at 240 Hz displays. */
  performance240: boolean;
  dynamicResolution: boolean;
  /** 0.25..1.0 fraction of native resolution before dynamic scaling. */
  renderScale: number;
  fov: number; // degrees, vertical
  cameraTiltDeg: number; // FPV camera up-tilt, typically 0..45
  lensDistortion: number; // 0..1
  videoNoise: number; // 0..1 analog/digital FPV video artifacts
  mode: FlightMode;
  /** Simulated local date/time (ms since epoch, UTC) and whether it advances. */
  timeMs: number;
  timeScale: number; // 1 = real time, 60 = a minute per second, ...
  observer: Observer;
  seed: number;
  trackStyle: TrackData['style'];
  mouseSensitivity: number;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  targetFps: 0,
  frameCap: 0,
  performance240: false,
  dynamicResolution: true,
  renderScale: 1,
  fov: 100,
  cameraTiltDeg: 30,
  lensDistortion: 0.35,
  videoNoise: 0.15,
  mode: 'acro',
  timeMs: Date.UTC(2026, 5, 21, 6, 30, 0),
  timeScale: 1,
  observer: { latitudeDeg: 46.0, longitudeDeg: 8.0, altitudeM: 1200 },
  seed: 1337,
  trackStyle: 'race',
  mouseSensitivity: 1,
};
