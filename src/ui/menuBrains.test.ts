import { describe, expect, it } from 'vitest';
import { raceCounts } from './menuBrains';

describe('raceCounts', () => {
  it('counts the quads of each brain in a running race from their labels', () => {
    const names = ['ace', 'steady', 'ultimate', 'ultimate1'];
    const labels = ['ultimate #1', 'ultimate #2', 'ultimate #3', 'ace #1', 'ace #2', 'ultimate1'];
    expect([...raceCounts(names, labels)]).toEqual([['ultimate', 3], ['ace', 2], ['ultimate1', 1]]);
  });

  it('skips labels of brains the list does not hold', () => {
    expect([...raceCounts(['ace'], ['ace', 'gone #1', 'gone #2'])]).toEqual([['ace', 1]]);
  });
});
