/**
 * Game-facing audio engine. Call `start()` from a user gesture, then `update(state, ctx)` once per frame; everything
 * else (motor tones, wind, ground and crash sounds, arm/low-battery/beacon beeps) follows from the quad state.
 * Race events go through `engine.beeper`. Without WebAudio every method is a silent no-op.
 */
import type { QuadState } from '../contracts';
import { Beeper } from './beeper';
import { clamp } from './dsp';
import { FlightEvents, type FlightFlags } from './events';
import { ImpactSynth, scrapeLevel, washLevel, type TerrainKind } from './impact';
import { DEFAULT_VOLUMES, Mixer, type Volumes } from './mixer';
import { DEFAULT_OMEGA_MAX, MotorModel, type MotorFrame } from './motorModel';
import { MOTOR_PARAM_COUNT, P_AMP } from './motorParams';
import { createMotorSynth, type MotorSynth } from './motorSynth';
import { PilotSpace } from './spatial';
import { airspeedFrom, WindSynth } from './wind';

export type { TerrainKind } from './impact';

export interface AudioUpdateContext {
  /** Ground speed in m/s. */
  speed: number;
  /** Height above ground in m. */
  agl: number;
  /** Frame time in s. */
  dt: number;
  cameraMode: 'fpv' | 'chase' | 'free';
  windSpeed: number;
  /** 0..1 amount of grass under the quad (prop wash rustle); defaults to a light amount on grass. */
  grassness?: number;
  terrainKind?: TerrainKind;
}

/** `pilot`: the listener stands on the ground; `onboard`: on the quad (camera mic); `auto`: onboard in the FPV camera. */
export type AudioMode = 'pilot' | 'onboard' | 'auto';

export interface AudioEngineOptions {
  mode?: AudioMode;
  volumes?: Partial<Volumes>;
  /** Full-throttle motor speed in rad/s. */
  omegaMax?: number;
  /** Pack size; otherwise inferred from the battery voltage. */
  cells?: number;
  /** Play the arm, disarm, low-battery and lost-model beeps from the quad state (default true). */
  autoBeeps?: boolean;
  forceFallbackSynth?: boolean;
  /** Supplies the context instead of `new AudioContext()`, e.g. an OfflineAudioContext. */
  contextFactory?: () => BaseAudioContext;
}

const WRITE_INTERVAL_S = 0.008;
const FAST_TC = 0.012;
const SLOW_TC = 0.03;
const DEFAULT_GRASS = 0.7;
const RESUME_WAIT_MS = 1000;

const finite = (x: number, fallback = 0): number => (Number.isFinite(x) ? x : fallback);
const finite3 = (v: ArrayLike<number>): boolean => Number.isFinite(v[0] + v[1] + v[2]);
const isRealContext = (ctx: BaseAudioContext): ctx is AudioContext => typeof AudioContext !== 'undefined' && ctx instanceof AudioContext;

/** Offline contexts have no close(); a real one holds a hardware stream until it is closed. */
function closeContext(ctx: BaseAudioContext): void {
  if (isRealContext(ctx)) void ctx.close().catch(() => undefined);
}

export class AudioEngine {
  /** Race tones: `gatePass()`, `lap()`, `countdown(n)`, `finished()`. Silent until `start()` has completed. */
  readonly beeper = new Beeper();
  private ctx: BaseAudioContext | null = null;
  private mixer: Mixer | null = null;
  private synth: MotorSynth | null = null;
  private wind: WindSynth | null = null;
  private impact: ImpactSynth | null = null;
  private startPromise: Promise<void> | null = null;
  private ready = false;
  private disposed = false;
  private readonly model: MotorModel;
  private readonly space = new PilotSpace();
  private readonly events = new FlightEvents();
  private readonly frame: MotorFrame = { omega: [0, 0, 0, 0], dt: 0, vy: 0, doppler: 1, onboard: false };
  private volumes: Volumes;
  private mode: AudioMode;
  private onboard = false;
  private explicitPilot: readonly [number, number, number] | null = null;
  private lastWrite = -Infinity;
  private pendingDt = 0;
  private readonly autoBeeps: boolean;
  private readonly onVisibility = (): void => {
    const ctx = this.ctx;
    if (!ctx || !isRealContext(ctx)) return;
    void (document.hidden ? ctx.suspend() : ctx.resume()).catch(() => undefined);
  };

  constructor(private readonly opts: AudioEngineOptions = {}) {
    this.model = new MotorModel(opts.omegaMax ?? DEFAULT_OMEGA_MAX);
    this.volumes = { ...DEFAULT_VOLUMES, ...opts.volumes };
    this.mode = opts.mode ?? 'auto';
    this.autoBeeps = opts.autoBeeps ?? true;
    if (opts.cells) this.events.setCells(opts.cells);
  }

  get running(): boolean { return this.ready; }
  get synthKind(): 'worklet' | 'oscillator' | 'none' { return this.synth?.kind ?? 'none'; }
  get context(): BaseAudioContext | null { return this.ctx; }

  /**
   * Creates the context and graph; needs a user gesture in browsers. Never rejects; resolves once sound can play.
   * Calling it again from a later gesture resumes a context that the browser left suspended.
   */
  start(): Promise<void> {
    if (this.startPromise) {
      this.wake();
      return this.startPromise;
    }
    return (this.startPromise = this.init());
  }

  update(state: QuadState, c: AudioUpdateContext): void {
    const { ctx, mixer, synth, wind, impact } = this;
    if (!this.ready || !ctx || !mixer || !synth || !wind || !impact) return;
    // A non-finite target makes setTargetAtTime throw, so a corrupt frame is skipped as a whole.
    if (!Number.isFinite(state.time) || !finite3(state.pos) || !finite3(state.vel)) return;
    const dt = clamp(c.dt > 0 ? c.dt : 1 / 60, 1e-4, 0.25);
    const flags = this.events.update(state, dt);
    if (flags.reset) {
      this.model.reset();
      if (!this.explicitPilot) this.space.reset();
    }
    this.space.update(state.pos, state.vel, dt);
    this.fire(flags, impact);
    this.pendingDt += dt;
    const now = ctx.currentTime;
    if (now - this.lastWrite < WRITE_INTERVAL_S) return;
    this.lastWrite = now;
    this.write(state, c, this.pendingDt, now, mixer, synth, wind, impact);
    this.pendingDt = 0;
  }

  setVolumes(v: Partial<Volumes>): void {
    this.volumes = { ...this.volumes, ...v };
    this.mixer?.setVolumes(this.volumes);
  }

  /** `fpv` puts the listener on the quad (camera mic), `chase` on the ground; both override `auto`. */
  setListenerAttached(kind: 'fpv' | 'chase'): void {
    this.setMode(kind === 'fpv' ? 'onboard' : 'pilot');
  }

  setMode(mode: AudioMode): void {
    this.mode = mode;
    if (mode !== 'auto') this.applyOnboard(mode === 'onboard');
  }

  /** Where the ground listener stands; by default the spot under the quad's first position, at head height. */
  setPilotPosition(x: number, y: number, z: number): void {
    this.explicitPilot = [x, y, z];
    this.space.setPilot(x, y, z);
  }

  setCellCount(n: number): void {
    this.events.setCells(n);
  }

  /** Call on respawn or restart so trackers forget the previous flight. */
  reset(): void {
    this.model.reset();
    this.events.reset();
    this.space.reset();
    if (this.explicitPilot) this.space.setPilot(...this.explicitPilot);
    this.pendingDt = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.beeper.dispose();
    this.impact?.dispose();
    this.wind?.dispose();
    this.synth?.dispose();
    this.mixer?.dispose();
    if (this.ctx) closeContext(this.ctx);
    this.impact = null;
    this.wind = null;
    this.synth = null;
    this.mixer = null;
    this.ctx = null;
  }

  private wake(): void {
    const ctx = this.ctx;
    if (!this.ready || !ctx || !isRealContext(ctx) || ctx.state === 'running' || ctx.state === 'closed') return;
    if (typeof document !== 'undefined' && document.hidden) return;
    void ctx.resume().catch(() => undefined);
  }

  private async init(): Promise<void> {
    let ctx: BaseAudioContext | null = null;
    try {
      ctx = this.createContext();
      if (!ctx) return;
      const mixer = new Mixer(ctx, this.volumes);
      const synth = await createMotorSynth(ctx, { forceFallback: this.opts.forceFallbackSynth });
      if (this.disposed) {
        synth.dispose();
        mixer.dispose();
        closeContext(ctx);
        return;
      }
      this.ctx = ctx;
      this.mixer = mixer;
      this.synth = synth;
      synth.output.connect(mixer.motors);
      this.wind = new WindSynth(ctx);
      this.wind.mic.connect(mixer.micIn);
      this.wind.ambient.connect(mixer.windIn);
      this.impact = new ImpactSynth(ctx, mixer.effects);
      this.beeper.attach(ctx, mixer.effects, mixer.uiBus);
      if (this.mode === 'onboard') this.applyOnboard(true);
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
      this.ready = true;
      if (isRealContext(ctx) && ctx.state !== 'running') {
        await Promise.race([ctx.resume(), new Promise<void>((r) => setTimeout(r, RESUME_WAIT_MS))]);
      }
    } catch {
      this.dispose();
      this.disposed = false;
      // A context that failed before it was adopted is not covered by dispose().
      if (ctx) closeContext(ctx);
    }
  }

  private createContext(): BaseAudioContext | null {
    if (this.opts.contextFactory) return this.opts.contextFactory();
    if (typeof AudioContext === 'undefined') return null;
    return new AudioContext({ latencyHint: 'interactive' });
  }

  private applyOnboard(on: boolean): void {
    if (on === this.onboard) return;
    this.onboard = on;
    this.mixer?.setOnboard(on);
  }

  private fire(f: FlightFlags, impact: ImpactSynth): void {
    if (f.crash) impact.crash(f.crashSpeed, f.propStrike);
    if (f.landing) impact.landing(f.landingLevel);
    if (f.tumble) impact.clack(f.tumbleLevel);
    if (!this.autoBeeps) return;
    if (f.armed) this.beeper.arm();
    if (f.disarmed) this.beeper.disarm();
    if (f.lowBattery) this.beeper.lowBattery();
    if (f.beacon) this.beeper.beacon();
  }

  private write(
    state: QuadState, c: AudioUpdateContext, dt: number, now: number,
    mixer: Mixer, synth: MotorSynth, wind: WindSynth, impact: ImpactSynth,
  ): void {
    const onboard = this.mode === 'auto' ? c.cameraMode === 'fpv' : this.mode === 'onboard';
    this.applyOnboard(onboard);

    const f = this.frame;
    f.omega = state.motorOmega;
    f.dt = dt;
    f.vy = state.vel[1];
    f.doppler = onboard ? 1 : this.space.doppler;
    f.onboard = onboard;
    const p = this.model.update(f);
    const params = synth.params;
    for (let i = 0; i < MOTOR_PARAM_COUNT; i++) params[i]?.setTargetAtTime(p[i], now, i < P_AMP + 4 ? FAST_TC : SLOW_TC);

    const s = this.space;
    mixer.setPilotScene(s.cutoff, s.relX, s.relY, s.relZ);

    const speed = Math.max(0, finite(c.speed));
    wind.update(airspeedFrom(speed, finite(c.windSpeed)), Math.max(0, finite(c.windSpeed)));

    const kind = c.terrainKind ?? 'grass';
    const grass = c.grassness ?? (kind === 'grass' ? DEFAULT_GRASS : 0);
    let ratio = 0;
    for (let i = 0; i < 4; i++) ratio += clamp(finite(state.motorOmega[i]) / this.model.omegaMax, 0, 1.2);
    impact.update(kind, scrapeLevel(speed, state.onGround), washLevel(finite(c.agl, 100), ratio * 0.25, grass), speed);
  }
}
