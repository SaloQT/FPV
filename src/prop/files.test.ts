import { describe, expect, it } from 'vitest';
import { DEFAULT_PROP } from './design';
import { parseProp, serializeProp } from './files';

describe('prop files', () => {
  it('a saved prop loads back as the same design', () => {
    const back = parseProp(JSON.stringify(serializeProp(DEFAULT_PROP, 'note')));
    expect(back.diameter).toBeCloseTo(DEFAULT_PROP.diameter, 9);
    expect(back.pitch).toBeCloseTo(DEFAULT_PROP.pitch, 9);
    expect(back.blades).toBe(DEFAULT_PROP.blades);
    expect(back.airfoil).toEqual(DEFAULT_PROP.airfoil);
  });

  it('a hand-edited file with silly numbers is clamped instead of rejected', () => {
    const d = parseProp({ diameterIn: 99, blades: 40, pitchIn: -3 });
    expect(d.diameter).toBeCloseTo(7 * 0.0254, 9);
    expect(d.blades).toBe(6);
    expect(d.pitch).toBeCloseTo(0.0254, 9);
  });
});
