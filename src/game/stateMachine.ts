export type GameState = 'menu' | 'ready' | 'flying' | 'crashed' | 'finished' | 'paused';

export type GameEvent =
  | 'open-menu'
  | 'close-menu'
  | 'toggle-pause'
  | 'takeoff'
  | 'crash'
  | 'finish'
  | 'respawn-ready'
  | 'respawn-air'
  | 'reset';

type BaseState = Exclude<GameState, 'menu' | 'paused'>;

/**
 * `menu` and `paused` are overlays: they remember the state underneath and hand it back when they close, and events that
 * change that underlying state (a respawn or a new track chosen from the menu) apply to it while the overlay stays up.
 */
export class GameStateMachine {
  private current: GameState = 'menu';
  private under: BaseState | null = null;

  get state(): GameState {
    return this.current;
  }

  /** The state the game returns to when the menu or pause closes; null until the start screen was left once. */
  get resumeState(): BaseState | null {
    return this.under;
  }

  /** The physics and race clock only run in these states. */
  get simulating(): boolean {
    return this.current !== 'menu' && this.current !== 'paused';
  }

  send(event: GameEvent): GameState {
    const s = this.current;
    switch (event) {
      case 'open-menu':
        if (s !== 'menu') this.enterOverlay('menu');
        break;
      case 'close-menu':
        if (s === 'menu') this.leaveOverlay();
        break;
      case 'toggle-pause':
        if (s === 'paused') this.leaveOverlay();
        else if (s !== 'menu') this.enterOverlay('paused');
        break;
      case 'takeoff':
        if (s === 'ready' || s === 'crashed') this.current = 'flying';
        break;
      case 'crash':
        if (s === 'ready' || s === 'flying') this.current = 'crashed';
        break;
      case 'finish':
        if (s === 'flying') this.current = 'finished';
        break;
      case 'respawn-ready':
      case 'reset':
        this.setBase('ready');
        break;
      case 'respawn-air':
        this.setBase('flying');
        break;
    }
    return this.current;
  }

  private setBase(next: BaseState): void {
    if (this.simulating) this.current = next;
    else this.under = next;
  }

  private enterOverlay(overlay: 'menu' | 'paused'): void {
    if (this.simulating) this.under = this.current as BaseState;
    this.current = overlay;
  }

  private leaveOverlay(): void {
    this.current = this.under ?? 'ready';
    this.under = null;
  }
}
