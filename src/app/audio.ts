/**
 * The app's audio front: the engine is created at the first user gesture (browsers refuse an AudioContext before one),
 * every call is a no-op until then, and the master volume is muted while the sim is paused or the menu is open.
 */
import type { QuadState } from '../contracts';
import { AudioEngine, type AudioUpdateContext } from '../audio';
import type { AppSettings } from '../ui/settingsSchema';

export class AppAudio {
  private engine: AudioEngine | null = null;
  private master: number;
  private motors: number;
  private wind: number;
  private muted = true;

  constructor(s: Pick<AppSettings, 'masterVolume' | 'motorVolume' | 'windVolume'>) {
    this.master = s.masterVolume;
    this.motors = s.motorVolume;
    this.wind = s.windVolume;
  }

  get running(): boolean {
    return this.engine?.running ?? false;
  }

  /** Call from a click or key press: creates the engine on the first call, resumes it on later ones. */
  start(): void {
    try {
      if (!this.engine) {
        this.engine = new AudioEngine({ mode: 'auto', volumes: this.volumes() });
      }
      void this.engine.start();
    } catch (e) {
      console.error('audio: could not start', e);
    }
  }

  setVolumes(s: Pick<AppSettings, 'masterVolume' | 'motorVolume' | 'windVolume'>): void {
    this.master = s.masterVolume;
    this.motors = s.motorVolume;
    this.wind = s.windVolume;
    this.engine?.setVolumes(this.volumes());
  }

  /** True while nothing should be heard (menu, pause, hidden tab). */
  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    this.engine?.setVolumes(this.volumes());
  }

  update(state: QuadState, c: AudioUpdateContext): void {
    if (this.engine && !this.muted) this.engine.update(state, c);
  }

  /** The quad was put somewhere else: drop the motor/wind smoothing so nothing sweeps across the jump. */
  reset(): void {
    this.engine?.reset();
  }

  gatePass(): void {
    if (!this.muted) this.engine?.beeper.gatePass();
  }

  lap(): void {
    if (!this.muted) this.engine?.beeper.lap();
  }

  finished(): void {
    if (!this.muted) this.engine?.beeper.finished();
  }

  dispose(): void {
    this.engine?.dispose();
    this.engine = null;
  }

  private volumes(): { master: number; motors: number; wind: number } {
    return { master: this.muted ? 0 : this.master, motors: this.motors, wind: this.wind };
  }
}
