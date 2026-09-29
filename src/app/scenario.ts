/**
 * Scripted autopilot for headless runs: an `InputSource` wrapper that ignores the pilot's sticks and produces a synthetic
 * `StickInput` (angle mode) from the true quad state. Actions, arming, pointer-lock state and the enabled flag pass through
 * to the wrapped source, so menus, respawns and the session's own logic behave exactly as with a human pilot.
 *
 *   hover  take off, climb to 1.5 m above the ground and hold position and heading
 *   fly    follow the track gate by gate at a modest speed (then hover after the last gate)
 *   gate   fly through gate 0, then hover past it
 *   crash  climb to 3 m, cut the throttle and dive into the ground
 */
import type { QuadState, StickInput, TrackData, Vec3 } from '../contracts';
import type { GameState } from '../game/stateMachine';
import type { InputAction, InputSource } from '../input/types';
import type { ScenarioName } from './params';

export interface ScenarioContext {
  /** The true (not render-interpolated) physics state. */
  quad(): QuadState;
  state(): GameState;
  track(): TrackData | null;
  /** Index of the next gate to clear. */
  nextGate(): number;
  groundHeightAt(x: number, z: number): number;
  /** Altitude above the ground the hover holds; `HOVER_AGL_M` when absent. */
  readonly hoverAgl?: number;
}

/** Stick throttle that roughly balances the 5 inch quad's weight; the altitude loop trims the rest. */
export const HOVER_STICK = 0.3;
export const HOVER_AGL_M = 1.5;
export const CRASH_CLIMB_M = 3;
const ARM_DELAY_S = 0.3;
const CRUISE_MPS = 8;
const MIN_MPS = 3;
const LOOKAHEAD_M = 4;
const SEARCH_BACK = 6;
const SEARCH_FWD = 30;
const LOST_M = 25;
const GATE_CARROT_M = 3;
const APPROACH_M = 16;
const RETURN_M = 30;
const APPROACH_MPS = 3.5;
const GATE_ALT_MIN_AGL = 1.2;
const TWO_PI = Math.PI * 2;

interface Nav {
  track: TrackData;
  path: readonly Vec3[];
  /** Path index nearest to each gate's centre. */
  gateIdx: number[];
  closed: boolean;
  /** Path spacing in metres. */
  step: number;
}

/** `pts` joined by straight legs sampled about every metre. */
function resample(pts: readonly Vec3[], closed: boolean): Vec3[] {
  const out: Vec3[] = [];
  const legs = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < legs; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const m = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
    for (let j = 0; j < m; j++) out.push([a[0] + ((b[0] - a[0]) * j) / m, a[1] + ((b[1] - a[1]) * j) / m, a[2] + ((b[2] - a[2]) * j) / m]);
  }
  if (!closed && pts.length > 0) out.push([pts[pts.length - 1][0], pts[pts.length - 1][1], pts[pts.length - 1][2]]);
  return out;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const wrap = (a: number): number => a - TWO_PI * Math.round(a / TWO_PI);

export class ScenarioPilot implements InputSource {
  private readonly stick: StickInput = { roll: 0, pitch: 0, yaw: 0, throttle: 0, armed: false, mode: 'angle', turtle: false };
  private enabled = false;
  private readyT = 0;
  private flyT = 0;
  private altI = 0;
  private diving = false;
  private lastState: GameState = 'menu';
  private headingHold = NaN;
  private nav: Nav | null = null;
  private pathIdx = -1;

  constructor(private readonly inner: InputSource, readonly scenario: ScenarioName, private readonly ctx: ScenarioContext) {}

  get armed(): boolean {
    return this.inner.armed;
  }

  get pointerLocked(): boolean {
    return this.inner.pointerLocked;
  }

  setArmed(armed: boolean): void {
    this.inner.setArmed(armed);
  }

  setThrottle(value: number): void {
    this.inner.setThrottle(value);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.inner.setEnabled(enabled);
  }

  takeActions(): readonly InputAction[] {
    return this.inner.takeActions();
  }

  poll(dt: number): StickInput {
    this.inner.poll(dt);
    const s = this.stick;
    s.roll = s.pitch = s.yaw = s.throttle = 0;
    s.mode = 'angle';
    s.turtle = false;
    const state = this.ctx.state();
    if (state !== this.lastState) this.onState(state);
    if (this.enabled && state === 'ready') this.ready(dt);
    else if (this.enabled && state === 'flying') this.fly(dt);
    s.armed = this.inner.armed;
    return s;
  }

  private onState(state: GameState): void {
    if (state === 'ready') {
      this.readyT = 0;
      this.flyT = 0;
      this.altI = 0;
      this.diving = false;
      this.headingHold = NaN;
      this.pathIdx = -1;
    }
    this.lastState = state;
  }

  private ready(dt: number): void {
    this.readyT += dt;
    if (!this.inner.armed) {
      if (this.readyT >= ARM_DELAY_S) this.inner.setArmed(true);
      return;
    }
    // Armed on the pad: the same controller as in flight, so the first frames are the climb-out.
    this.fly(dt);
  }

  private fly(dt: number): void {
    const q = this.ctx.quad();
    this.flyT += dt;
    const qx = q.quat[0], qy = q.quat[1], qz = q.quat[2], qw = q.quat[3];
    // Horizontal heading unit vector (body -Z projected on the ground) and yaw, 0 = -Z, positive counter-clockwise.
    const fx = -2 * (qx * qz + qw * qy);
    const fz = -(1 - 2 * (qx * qx + qy * qy));
    const fl = Math.hypot(fx, fz) || 1;
    const hx = fx / fl, hz = fz / fl;
    const yaw = Math.atan2(-hx, -hz);
    if (Number.isNaN(this.headingHold)) this.headingHold = yaw;
    const ground = this.ctx.groundHeightAt(q.pos[0], q.pos[2]);
    const agl = q.pos[1] - ground;
    let targetY = ground + (this.ctx.hoverAgl ?? HOVER_AGL_M);
    let targetVf = 0;
    let targetYaw = this.headingHold;
    if (this.scenario === 'crash') {
      if (agl >= CRASH_CLIMB_M - 0.3 || this.flyT > 4) this.diving = true;
      if (this.diving) {
        this.stick.throttle = 0;
        this.stick.pitch = 0.5;
        return;
      }
      targetY = ground + CRASH_CLIMB_M;
    } else if (this.scenario === 'fly' || this.scenario === 'gate') {
      const aim = this.aim(q, ground);
      if (aim !== null) {
        targetY = aim.y;
        targetYaw = aim.yaw;
        targetVf = aim.speed * Math.max(0, Math.cos(wrap(aim.yaw - yaw))) ** 2;
      }
    }
    this.control(dt, q, hx, hz, yaw, agl, targetY, targetVf, targetYaw);
  }

  private control(dt: number, q: QuadState, hx: number, hz: number, yaw: number, agl: number, targetY: number, targetVf: number, targetYaw: number): void {
    const s = this.stick;
    const err = targetY - q.pos[1];
    this.altI = clamp(this.altI + err * dt * 0.06, -0.08, 0.08);
    s.throttle = clamp(HOVER_STICK + 0.13 * err - 0.09 * q.vel[1] + this.altI, agl < 0.3 ? 0.18 : 0.02, 0.8);
    // Velocity in the heading frame: vf ahead, vr to the right (right = heading rotated clockwise from above).
    const vf = q.vel[0] * hx + q.vel[2] * hz;
    const vr = q.vel[0] * -hz + q.vel[2] * hx;
    s.pitch = clamp(0.1 * (targetVf - vf), -0.5, 0.5);
    s.roll = clamp(-0.1 * vr, -0.5, 0.5);
    s.yaw = clamp(-1.6 * wrap(targetYaw - yaw), -0.6, 0.6);
  }

  private readonly aimOut = { y: 0, yaw: 0, speed: 0 };
  private readonly carrot: [number, number, number] = [0, 0, 0];

  /** The polyline the pilot follows: the track's centreline, or straight legs between the gate centres when a track has none. */
  private navFor(track: TrackData): Nav {
    if (this.nav !== null && this.nav.track === track) return this.nav;
    const closed = track.closed;
    const path = track.path.length >= 2 ? track.path : resample(track.gates.map((g) => g.pos), closed);
    const gateIdx = track.gates.map((g) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < path.length; i++) {
        const d = Math.hypot(path[i][0] - g.pos[0], path[i][1] - g.pos[1], path[i][2] - g.pos[2]);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    });
    const step = Math.max(0.1, track.length / (closed ? path.length : path.length - 1)) || 1;
    this.pathIdx = -1;
    return (this.nav = { track, path, gateIdx, closed, step });
  }

  private nearest(nav: Nav, q: QuadState): void {
    const n = nav.path.length;
    const local = this.pathIdx >= 0;
    const from = local ? -SEARCH_BACK : 0;
    const to = local ? SEARCH_FWD : n - 1;
    let best = this.pathIdx, bd = Infinity;
    for (let k = from; k <= to; k++) {
      const i = local ? this.pathIdx + k : k;
      const idx = nav.closed ? ((i % n) + n) % n : i;
      if (idx < 0 || idx >= n) continue;
      const p = nav.path[idx];
      const d = Math.hypot(p[0] - q.pos[0], p[1] - q.pos[1], p[2] - q.pos[2]);
      if (d < bd) { bd = d; best = idx; }
    }
    // Blown far off the line (a respawn, a knock): look at the whole path again next time.
    this.pathIdx = local && bd > LOST_M ? -1 : best;
    if (this.pathIdx < 0) this.nearest(nav, q);
  }

  /** Where to steer for the next gate: a point a little way ahead on the centreline, which ends just past the gate. Null: nothing to fly to. */
  private aim(q: QuadState, ground: number): { y: number; yaw: number; speed: number } | null {
    const track = this.ctx.track();
    if (!track || track.gates.length === 0) return null;
    const next = this.ctx.nextGate();
    const limit = this.scenario === 'gate' ? 1 : track.gates.length;
    if (next >= limit) return null;
    const g = track.gates[next];
    const nav = this.navFor(track);
    const n = nav.path.length;
    this.nearest(nav, q);
    let ahead = nav.gateIdx[next] - this.pathIdx;
    if (nav.closed) {
      ahead = ((ahead % n) + n) % n;
      if (ahead > n / 2) ahead -= n;
    }
    // An open track that asks for another lap wants the start gate again, far behind: hover at the finish rather than fly back through the last gate's posts.
    if (!nav.closed && ahead * nav.step < -RETURN_M) return null;
    const look = Math.max(2, Math.round(LOOKAHEAD_M / nav.step));
    // Ahead of the gate: stop the carrot just past it. Behind it (missed): back up along the line.
    const k = ahead >= 0 ? Math.min(look, ahead + 3) : -look;
    const at = (i: number): Vec3 => nav.path[nav.closed ? ((i % n) + n) % n : Math.min(Math.max(i, 0), n - 1)];
    const c = this.carrot;
    const far = at(this.pathIdx + k + Math.sign(k || 1) * look);
    if (ahead >= 0 && ahead <= look + 3) {
      // Close in: line up on the gate's own axis (the centreline misses the centre by up to half a metre) and aim through it.
      const cp = Math.cos(g.pitch);
      c[0] = g.pos[0] - Math.sin(g.yaw) * cp * GATE_CARROT_M;
      c[1] = g.pos[1] + Math.sin(g.pitch) * GATE_CARROT_M;
      c[2] = g.pos[2] - Math.cos(g.yaw) * cp * GATE_CARROT_M;
    } else {
      const p = at(this.pathIdx + k);
      c[0] = p[0];
      c[1] = p[1];
      c[2] = p[2];
    }
    const o = this.aimOut;
    o.yaw = Math.atan2(-(c[0] - q.pos[0]), -(c[2] - q.pos[2]));
    o.y = Math.max(c[1], ground + GATE_ALT_MIN_AGL);
    // Slow for the bend beyond the carrot so the quad does not swing wide.
    const bend = Math.abs(wrap(Math.atan2(-(far[0] - c[0]), -(far[2] - c[2])) - o.yaw));
    o.speed = clamp(CRUISE_MPS * (1 - bend / 1.2), MIN_MPS, CRUISE_MPS);
    // Gates are only about two metres wide: creep through them so the last lateral correction has room to settle.
    if (ahead >= 0 && ahead * nav.step <= APPROACH_M) o.speed = Math.min(o.speed, APPROACH_MPS);
    this.headingHold = o.yaw;
    return o;
  }
}
