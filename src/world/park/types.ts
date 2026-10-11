import type { Quat, TerrainData, TrackData, Vec3 } from '../../contracts';

export const PARK_THEMES = ['space', 'fantasy', 'jungle', 'western', 'seaside', 'steampunk', 'alpine', 'carnival'] as const;
export type ParkTheme = typeof PARK_THEMES[number];
export const PARK_LAYOUTS = ['hub', 'loop', 'valley', 'boardwalk'] as const;
export type ParkLayout = typeof PARK_LAYOUTS[number];
export const PARK_SIZES = ['compact', 'destination', 'mega'] as const;
export type ParkSize = typeof PARK_SIZES[number];
export const COASTER_FAMILIES = ['steel', 'launch', 'inverted', 'wooden', 'hyper', 'mine', 'space'] as const;
export type CoasterFamily = typeof COASTER_FAMILIES[number];
export const FLAT_FAMILIES = ['wheel', 'carousel', 'swings', 'ship', 'pendulum', 'drop', 'teacups', 'scrambler', 'observation', 'enterprise', 'topspin'] as const;
export type FlatFamily = typeof FLAT_FAMILIES[number];
export type RideFamily = CoasterFamily | FlatFamily;
export type RidePhase = 'boarding' | 'restraints' | 'dispatch' | 'running' | 'braking' | 'unloading';

/** Compact, versioned, JSON-safe source of truth. Render quality is deliberately absent. */
export interface ParkRecipe {
  version: 1;
  seed: number;
  size: ParkSize;
  layout: ParkLayout | 'random';
  theme: ParkTheme | 'mixed';
  guests: number;
  route: 'free' | 'tour' | 'coaster' | 'race';
  coaster: number;
}

export interface ParkPalette { primary: Vec3; secondary: Vec3; accent: Vec3; timber: Vec3; ground: Vec3 }
/** Cylinder/cone are circular (half.x = half.z); sphere scales to an ellipsoid; gable is an XY triangle extruded along Z. */
export type PartShape = 'box' | 'cylinder' | 'sphere' | 'cone' | 'gable';
/** All three consumers (drawing, collision and RT) consume the same physical part. */
export interface ParkPart {
  shape: PartShape;
  pos: Vec3;
  rot: Quat;
  half: Vec3;
  color: Vec3;
  roughness: number;
  metalness: number;
  emissive: number;
  solid: boolean;
  detail: number;
  /** Rigid attachment, -1 = static world, otherwise ParkRuntime.bodies index. */
  body: number;
  wheelRadius?: number;
  /** Collision/ray proxy drawn by another scene system, such as detailed tree meshes. */
  render?: boolean;
  /** A different scene system may supply a coarser shadow proxy while collision remains exact. */
  rayTrace?: boolean;
  /** Procedural surface treatment; base colour remains the mean physical albedo. */
  surface?: 'paint' | 'concrete' | 'timber' | 'fabric' | 'masonry' | 'foliage' | 'glass' | 'paving';
  /** Semantic land-use category for plan views and layout diagnostics. */
  category?: 'building' | 'landscape' | 'path' | 'ride' | 'furniture' | 'service';
  /** Actual tread solids supply guest contact planes; boarding waypoints are not support geometry. */
  walkSurface?: { kind: 'tread'; ride: number };
}
export interface ParkBody {
  ride: number;
  role: 'car' | 'bogie' | 'coupler' | 'rotor' | 'seat' | 'cup' | 'tower' | 'gondola' | 'restraint' | 'frame' | 'actuator' | 'platform';
  index: number;
  local: Vec3;
  train?: number;
  parent?: number;
  localRot?: Quat;
}
export interface ParkLight {
  pos: Vec3;
  color: Vec3;
  /** Isotropic luminous intensity, candela; inverse-square falloff. */
  candela: number;
  radius: number;
  room: number;
  /** Indices of the glowing parts of the fitting that casts this light (see `luminaire`). */
  emitters?: number[];
}
export interface ParkRoom { min: Vec3; max: Vec3; ride: number }
export interface PathNode { pos: Vec3; links: number[]; kind: 'path' | 'entrance' | 'station' | 'facility' }
export interface ParkPath { a: number; b: number; width: number }

/** Arc samples include position, tangent, banked up, curvature vector, bank and distance. */
export interface CoasterCurve {
  samples: Float64Array;
  length: number;
  count: number;
  stationEnd: number;
  liftEnd: number;
  brakeStart: number;
}
export interface RideDefinition {
  id: number;
  family: RideFamily;
  name: string;
  theme: ParkTheme;
  pos: Vec3;
  yaw: number;
  radius: number;
  height: number;
  capacity: number;
  station: number;
  queue: Vec3[];
  exit: Vec3[];
  boarding: Vec3[];
  curve?: CoasterCurve;
  cars: number;
  trains: number;
  carLength: number;
  emptyCarMass: number;
  dragArea: number;
  rolling: number;
  liftSpeed: number;
  motorForce: number;
  motorPower: number;
  /** Rotary drive rating, N m. Power is still bounded by motorPower (watts). */
  motorTorque: number;
  brakeForce: number;
  targetOmega: number;
  inertia: number;
  duration: number;
  bodies: number[];
  /** Nominal design limits, simulation envelopes rather than certification claims. */
  maxG: number;
  maxJerk: number;
  preflight?: { duration: number; maxG: number; maxJerk: number; minSpeed: number; maxAt: number; maxSpeed: number; cycle: Float64Array };
}
export interface ParkPlanting { pos: Vec3; yaw: number; variant: number; scale: number; tint: Vec3 }
export interface ParkData {
  /** Explicit manufactured interfaces, measured from the same primitives used by collision and drawing. */
  joints?: import('./construction').ConstructionJoint[];
  /** Geometric contracts that explain each permitted overlap between two primitives. */
  interfaces?: import('./construction').PartInterface[];
  /** Primitive groups that model one manufactured piece. */
  monoliths?: import('./construction').Monolith[];
  /** Explicit, quality-independent instances of the engine's deterministic tree variants. */
  plantings?: ParkPlanting[];
  recipe: ParkRecipe;
  layout: ParkLayout;
  bounds: { min: Vec3; max: Vec3 };
  entrance: number;
  launch: { pos: Vec3; yaw: number };
  rides: RideDefinition[];
  nodes: PathNode[];
  paths: ParkPath[];
  parts: ParkPart[];
  bodies: ParkBody[];
  lights: ParkLight[];
  rooms: ParkRoom[];
  routes: TrackData[];
}
export interface ParkBuild { terrain: TerrainData; park: ParkData; track: TrackData }
export interface BodyPose { pos: Vec3; rot: Quat; vel: Vec3; omega: Vec3 }

/** A query-only scene attached to the quad's existing contact solver. */
export interface EnvironmentContact { normal: Vec3; penetration: number; velocity: Vec3; friction: number; restitution: number }
export interface EnvironmentCollision {
  setStep?(dt: number): void;
  contact(x: number, y: number, z: number, radius: number, out: EnvironmentContact): boolean;
  sweep?(from: Vec3, to: Vec3, radius: number, out: EnvironmentContact): number;
}
