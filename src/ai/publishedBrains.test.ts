import { describe, expect, it } from 'vitest';
import { parseBrain } from './brain';

const files = import.meta.glob<string>('../../public/brains/*.json', { query: '?raw', import: 'default', eager: true });
const text = (file: string): string => {
  const t = files[`../../public/brains/${file}`];
  if (t === undefined) throw new Error(`public/brains/${file} is missing`);
  return t;
};

describe('published brains', () => {
  const index = JSON.parse(text('index.json')) as { brains: { file: string; name: string }[] };

  it('lists at least two brains, so the spectator race has racers', () => {
    expect(index.brains.length).toBeGreaterThanOrEqual(2);
  });

  it.each(index.brains.map((b) => [b.name, b.file]))('%s parses and carries the name the index gives it', (name, file) => {
    const brain = parseBrain(text(file));
    expect(brain.name).toBe(name);
    expect(brain.stats.steps).toBeGreaterThan(0);
  });
});
