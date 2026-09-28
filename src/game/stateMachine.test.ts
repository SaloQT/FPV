import { describe, expect, it } from 'vitest';
import { GameStateMachine, type GameEvent, type GameState } from './stateMachine';

function machine(...events: GameEvent[]): GameStateMachine {
  const m = new GameStateMachine();
  for (const e of events) m.send(e);
  return m;
}

describe('GameStateMachine', () => {
  it('starts on the menu and does not simulate there', () => {
    const m = new GameStateMachine();
    expect(m.state).toBe('menu');
    expect(m.simulating).toBe(false);
  });

  it('closing the start menu readies the quad', () => {
    expect(machine('close-menu').state).toBe('ready');
  });

  it('runs ready -> flying -> crashed -> ready', () => {
    const m = machine('close-menu');
    expect(m.send('takeoff')).toBe('flying');
    expect(m.send('crash')).toBe('crashed');
    expect(m.send('respawn-ready')).toBe('ready');
  });

  it('a mid-air respawn goes straight back to flying', () => {
    expect(machine('close-menu', 'takeoff', 'crash', 'respawn-air').state).toBe('flying');
  });

  it('flying finishes the race and only a respawn or reset leaves finished', () => {
    const m = machine('close-menu', 'takeoff', 'finish');
    expect(m.state).toBe('finished');
    expect(m.send('crash')).toBe('finished');
    expect(m.send('takeoff')).toBe('finished');
    expect(m.send('reset')).toBe('ready');
  });

  it('a crashed quad that re-arms and lifts off is flying again', () => {
    expect(machine('close-menu', 'takeoff', 'crash', 'takeoff').state).toBe('flying');
  });

  it('a crash on the pad counts, a finish while grounded does not', () => {
    expect(machine('close-menu', 'crash').state).toBe('crashed');
    expect(machine('close-menu', 'finish').state).toBe('ready');
  });

  it('ignores events that make no sense for the current state', () => {
    const cases: [GameEvent[], GameEvent, GameState][] = [
      [[], 'takeoff', 'menu'],
      [[], 'crash', 'menu'],
      [['close-menu'], 'close-menu', 'ready'],
      [['close-menu', 'takeoff'], 'takeoff', 'flying'],
      [['close-menu', 'takeoff', 'crash'], 'crash', 'crashed'],
    ];
    for (const [setup, event, expected] of cases) expect(machine(...setup).send(event)).toBe(expected);
  });

  it('pause toggles and returns to the state it interrupted', () => {
    const m = machine('close-menu', 'takeoff');
    expect(m.send('toggle-pause')).toBe('paused');
    expect(m.simulating).toBe(false);
    expect(m.send('toggle-pause')).toBe('flying');
  });

  it('pause is refused on the start menu', () => {
    expect(machine('toggle-pause').state).toBe('menu');
  });

  it('the menu opens over any state and closes back to it', () => {
    for (const setup of [['close-menu'], ['close-menu', 'takeoff'], ['close-menu', 'takeoff', 'crash'], ['close-menu', 'takeoff', 'finish']] as GameEvent[][]) {
      const m = machine(...setup);
      const before = m.state;
      expect(m.send('open-menu')).toBe('menu');
      expect(m.resumeState).toBe(before);
      expect(m.send('close-menu')).toBe(before);
    }
  });

  it('opening the menu from pause resumes the state under the pause', () => {
    const m = machine('close-menu', 'takeoff', 'toggle-pause', 'open-menu');
    expect(m.state).toBe('menu');
    expect(m.send('close-menu')).toBe('flying');
  });

  it('events that change the base state apply underneath an open overlay', () => {
    const m = machine('close-menu', 'takeoff', 'open-menu');
    expect(m.send('reset')).toBe('menu');
    expect(m.resumeState).toBe('ready');
    expect(m.send('close-menu')).toBe('ready');
    const p = machine('close-menu', 'takeoff', 'toggle-pause');
    p.send('respawn-air');
    expect(p.send('toggle-pause')).toBe('flying');
  });

  it('gameplay events do not leak through an overlay', () => {
    const m = machine('close-menu', 'open-menu');
    expect(m.send('takeoff')).toBe('menu');
    expect(m.send('crash')).toBe('menu');
    expect(m.resumeState).toBe('ready');
  });
});
