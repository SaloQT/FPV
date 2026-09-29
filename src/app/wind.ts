/**
 * Slowly varying mean wind (speed and direction) shared by physics, vegetation, flags and audio. The physics module adds
 * its own turbulence and discrete gusts on top; this is the large-scale breathing of the mean. Deterministic in time, no
 * allocation per update: the arrays and the config object handed out are the same instances forever.
 */
const DEG = Math.PI / 180;
/** Gust swing: the speed varies by up to this fraction of the mean. */
const SPEED_SWING = 0.4;
/** Direction swing in degrees at 2 m/s and above. */
const DIR_SWING_DEG = 14;

export class WindModel {
  /** Direction the air travels TOWARD in world (x, z); the objects and vegetation modules keep the reference they get. */
  readonly dirXZ: [number, number] = [0, 1];
  /** What `QuadPhysics.setWind` takes; rewritten by `update`. */
  readonly physics = { meanSpeed: 0, fromDirection: 0 };
  /** Current speed in m/s. */
  speed = 0;
  private mean = 0;
  private fromRad = 0;
  private time = 0;
  private readonly p: readonly number[];

  constructor(seed = 1) {
    // Fixed phases from the seed so two runs with the same seed breathe the same way.
    const h = (k: number): number => ((Math.sin((seed + 1) * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1 * Math.PI * 2;
    this.p = [h(1), h(2), h(3), h(4), h(5)];
    this.update(0);
  }

  /** Settings: mean speed in m/s and the compass bearing the wind blows FROM, in degrees clockwise from north. */
  configure(meanSpeed: number, fromDeg: number): void {
    this.mean = Math.max(0, Number.isFinite(meanSpeed) ? meanSpeed : 0);
    this.fromRad = (Number.isFinite(fromDeg) ? fromDeg : 0) * DEG;
    this.update(0);
  }

  get meanSpeed(): number {
    return this.mean;
  }

  update(dt: number): void {
    if (dt > 0) this.time += Math.min(dt, 1);
    const t = this.time;
    const p = this.p;
    const gust = 0.5 * Math.sin(t * 0.27 + p[0]) + 0.3 * Math.sin(t * 0.71 + p[1]) + 0.2 * Math.sin(t * 1.9 + p[2]);
    this.speed = Math.max(0, this.mean * (1 + SPEED_SWING * gust));
    const swing = Math.min(1, this.mean / 2) * DIR_SWING_DEG * DEG;
    const from = this.fromRad + swing * (0.6 * Math.sin(t * 0.13 + p[3]) + 0.4 * Math.sin(t * 0.37 + p[4]));
    this.dirXZ[0] = -Math.sin(from);
    this.dirXZ[1] = Math.cos(from);
    this.physics.meanSpeed = this.speed;
    this.physics.fromDirection = from;
  }
}
