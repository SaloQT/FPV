import { describe, expect, it } from 'vitest';
import { Rng } from '../../world/track/rng';
import { makeLeaf, newSample, paintLeaf, sprigPainter } from './treeLeafShapes';

const N = 256;

/** Half widths of an upright leaf (base at the bottom centre, tip up) in `rows` bands along its length. */
function profile(lobes: number, amp: number, rows: number): number[] {
  const l = makeLeaf(new Rng(3), 0.5, 0.9, 0, 0.8, 0.2, lobes, amp);
  l.petiole = 0;
  const s = newSample(), out: number[] = [];
  for (let r = 0; r < rows; r++) {
    const v = 0.9 - 0.8 * ((r + 0.5) / rows);
    let w = 0;
    for (let x = 0; x < N; x++) if (paintLeaf(l, (x + 0.5) / N, v, s)) w = Math.max(w, Math.abs((x + 0.5) / N - 0.5));
    out.push(w);
  }
  return out;
}

describe('leaf outline', () => {
  it('cuts deep sinuses between rounded lobes when the lobe amplitude is large', () => {
    const wavy = profile(4.5, 0.5, 60), smooth = profile(4.5, 0.1, 60);
    const dips = (p: number[]): number => p.slice(8, 52).filter((w, i, a) => i > 0 && i < a.length - 1 && w < a[i - 1] && w < a[i + 1] - 0.004).length;
    expect(dips(wavy)).toBeGreaterThanOrEqual(3);
    expect(dips(wavy)).toBeGreaterThan(dips(smooth));
  });

  it('never exceeds its nominal half width', () => {
    for (const w of profile(4.5, 0.5, 40)) expect(w).toBeLessThanOrEqual(0.2 + 1 / N);
  });
});

describe('oak sprig tile', () => {
  const paint = sprigPainter(new Rng(11));
  const s = newSample();
  let covered = 0, dark = 0;
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      if (!paint((x + 0.5) / 128, (y + 0.5) / 128, s)) continue;
      covered++;
      if (s.shade < 0.5) dark++;
    }
  }

  it('covers a modest part of the card with leaves, leaving gaps for light between them', () => {
    expect(covered / (128 * 128)).toBeGreaterThan(0.14);
    expect(covered / (128 * 128)).toBeLessThan(0.5);
  });

  it('paints veins and the stem darker than the blade', () => {
    expect(dark).toBeGreaterThan(0);
    expect(dark).toBeLessThan(covered * 0.4);
  });
});
