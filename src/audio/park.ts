import type { CameraState, Vec3 } from '../contracts';
import type { ParkRuntime } from '../world/park/runtime';
import { inverseRotate, clamp } from '../world/park/math';

interface Voice { oscillator: OscillatorNode; noise: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode; tone: GainNode; pan: StereoPannerNode }
/** Physical source state drives procedural rolling, lift clicks, motors and distant crowd formants. No recordings. */
export class ParkAudio {
  private readonly master: GainNode;
  private readonly voices: Voice[] = [];
  private readonly direction: Vec3 = [0, 0, 0];
  private readonly noise: AudioBuffer;
  private readonly lastCamera: Vec3 = [0, 0, 0];
  private readonly cameraVelocity: Vec3 = [0, 0, 0];
  private lastTime = -1;
  constructor(private readonly ctx: BaseAudioContext) {
    this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    let seed = 0x19ac7; const samples = this.noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; samples[i] = ((seed >>> 0) / 2147483648 - 1) * 0.35; }
    for (let i = 0; i < 12; i++) {
      const oscillator = ctx.createOscillator(), noise = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain(), tone = ctx.createGain(), pan = ctx.createStereoPanner();
      oscillator.type = i < 8 ? 'triangle' : 'sine'; oscillator.frequency.value = 70; noise.buffer = this.noise; noise.loop = true; filter.type = 'bandpass'; filter.Q.value = 0.8;
      gain.gain.value = tone.gain.value = 0; noise.connect(filter); filter.connect(gain); oscillator.connect(tone); tone.connect(gain); gain.connect(pan); pan.connect(this.master);
      oscillator.start(); noise.start(i * 0.013); this.voices.push({ oscillator, noise, filter, gain, tone, pan });
    }
  }
  update(runtime: ParkRuntime | undefined, camera: CameraState, volume: number): void {
    const now = this.ctx.currentTime; this.master.gain.setTargetAtTime(runtime ? volume * 0.3 : 0, now, 0.06);
    const dt = now - this.lastTime;
    for (let k = 0; k < 3; k++) { this.cameraVelocity[k] = this.lastTime >= 0 && dt > 0 && dt < 0.2 && Math.abs(camera.pos[k] - this.lastCamera[k]) < 30 ? (camera.pos[k] - this.lastCamera[k]) / dt : 0; this.lastCamera[k] = camera.pos[k]; } this.lastTime = now;
    if (!runtime || volume <= 0) return;
    const nearest = runtime.park.rides.map(r => ({ r, d: Math.hypot(r.pos[0] - camera.pos[0], r.pos[1] + 8 - camera.pos[1], r.pos[2] - camera.pos[2]) })).sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i]; let source: Vec3, speed: number, level: number, frequency: number, sourceVelocity: Vec3 = [0, 0, 0];
      if (i < 8) {
        const item = nearest[i % nearest.length], ride = item.r, state = runtime.rides[ride.id];
        let ti = 0; for (let k = 1; k < state.trains.length; k++) if (Math.abs(state.trains[k].v) > Math.abs(state.trains[ti].v)) ti = k;
        const train = state.trains[ti], body = runtime.bodies[ride.bodies.find(id => runtime.park.bodies[id].role === 'car' && runtime.park.bodies[id].train === ti && runtime.park.bodies[id].index === 0) ?? ride.bodies[0]];
        source = ride.curve ? body.pos : ride.pos; sourceVelocity = body.vel;
        speed = ride.curve ? Math.abs(train.v) : Math.abs(state.omega) * ride.radius + Math.abs(state.vy);
        const lift = ride.curve && train.s % ride.curve.length < ride.curve.liftEnd;
        const click = lift ? Math.max(0, Math.sin(runtime.elapsed * Math.max(1, speed) * 22)) ** 12 : 0;
        level = Math.min(0.75, speed / 35 + click * 0.12 + (state.phase === 'restraints' ? 0.04 : 0)); frequency = lift ? 45 + speed * 11 : 55 + speed * 13;
        voice.filter.frequency.setTargetAtTime(clamp(180 + speed * 75, 150, 5000), now, 0.04); voice.tone.gain.setTargetAtTime(lift ? 0.08 : 0.035, now, 0.04);
      } else {
        const path = runtime.park.paths[(i * 17) % runtime.park.paths.length], a = runtime.park.nodes[path.a].pos, b = runtime.park.nodes[path.b].pos;
        source = [(a[0] + b[0]) / 2, 13.6, (a[2] + b[2]) / 2]; speed = 0;
        const syllable = (Math.sin(runtime.elapsed * 3.3 + i) * Math.sin(runtime.elapsed * 1.8 + i * 2) + 1) * 0.5;
        level = Math.min(0.25, runtime.crowd.count / 10000) * (0.3 + syllable); frequency = 140 + 35 * Math.sin(runtime.elapsed * 0.75 + i);
        voice.filter.frequency.setTargetAtTime(650 + 850 * syllable, now, 0.08); voice.tone.gain.setTargetAtTime(0.09 * syllable, now, 0.08);
      }
      const dx = source[0] - camera.pos[0], dy = source[1] - camera.pos[1], dz = source[2] - camera.pos[2], distance = Math.hypot(dx, dy, dz);
      this.direction[0] = dx; this.direction[1] = dy; this.direction[2] = dz; inverseRotate(camera.quat, this.direction, this.direction);
      const inside = (p: Vec3) => runtime.park.rooms.findIndex(r => p[0] > r.min[0] && p[0] < r.max[0] && p[1] > r.min[1] && p[1] < r.max[1] && p[2] > r.min[2] && p[2] < r.max[2]);
      const transmission = inside(camera.pos) === inside(source) ? 1 : 0.08;
      const radial = distance > 0 ? (dx * (sourceVelocity[0] - this.cameraVelocity[0]) + dy * (sourceVelocity[1] - this.cameraVelocity[1]) + dz * (sourceVelocity[2] - this.cameraVelocity[2])) / distance : 0;
      voice.oscillator.frequency.setTargetAtTime(frequency * clamp(343 / (343 + radial), 0.8, 1.25), now, 0.035);
      // Pressure amplitude falls as 1/r, giving inverse-square acoustic power.
      voice.gain.gain.setTargetAtTime(level * transmission / Math.sqrt(1 + (distance / 14) ** 2), now, 0.05);
      voice.pan.pan.setTargetAtTime(clamp(this.direction[0] / Math.max(distance, 0.1), -1, 1), now, 0.05);
    }
  }
  dispose(): void { for (const v of this.voices) { v.oscillator.stop(); v.noise.stop(); v.pan.disconnect(); } this.master.disconnect(); }
}
