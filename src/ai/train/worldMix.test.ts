import { describe, expect, it } from 'vitest';
import { GENERATED_STYLES } from '../../contracts';
import { CLASSIC_STYLES, defaultRecipes, evalWorldSpecs, parseStyles, trainWorldSpecs } from './worldMix';

describe('training world mix', () => {
  it('keeps the trainer seeds and adds every generated style and a sixth of recipes', () => {
    const specs = trainWorldSpecs({ worlds: 48, seed: 1 });
    expect(specs).toHaveLength(48);
    expect(specs.map((s) => s.seed)).toEqual(Array.from({ length: 48 }, (_, k) => 1000 + 7919 * k + 1));
    const styled = specs.filter((s) => s.style);
    const recipes = specs.filter((s) => s.recipe);
    expect(recipes).toHaveLength(defaultRecipes(48));
    expect(new Set(styled.map((s) => s.style))).toEqual(new Set(GENERATED_STYLES));
    expect(styled[0]).toEqual({ seed: 1001, style: 'race', difficulty: 0.3 });
    // Recipes are deterministic and differ from world to world
    expect(trainWorldSpecs({ worlds: 48, seed: 1 })).toEqual(specs);
    expect(new Set(recipes.map((s) => JSON.stringify(s.recipe))).size).toBe(recipes.length);
  });

  it('takes the styles and recipe count it is given', () => {
    const specs = trainWorldSpecs({ worlds: 6, seed: 2, styles: ['technical', 'acro'], recipes: 2 });
    expect(specs.map((s) => s.style ?? 'recipe')).toEqual(['technical', 'acro', 'technical', 'acro', 'recipe', 'recipe']);
    expect(trainWorldSpecs({ worlds: 4, seed: 2, recipes: 0 }).every((s) => s.style)).toBe(true);
    expect(trainWorldSpecs({ worlds: 3, seed: 2, recipes: 9 }).every((s) => s.recipe)).toBe(true);
  });

  it('gives the old 48-world mix with the classic styles and no recipes', () => {
    const specs = trainWorldSpecs({ worlds: 48, seed: 1, styles: CLASSIC_STYLES, recipes: 0 });
    expect(specs).toEqual(Array.from({ length: 48 }, (_, k) => ({ seed: 1000 + 7919 * k + 1, style: CLASSIC_STYLES[k % 4], difficulty: 0.3 + 0.1 * (k % 5) })));
  });

  it('evaluates on the original tracks by default', () => {
    const specs = evalWorldSpecs({ worlds: 4, seed: 0 });
    expect(specs).toEqual(CLASSIC_STYLES.map((style, k) => ({ seed: 900001 + 104729 * k, style, difficulty: 0.5 })));
    const more = evalWorldSpecs({ worlds: 2, seed: 0, styles: ['acro'], recipes: 1 });
    expect(more.map((s) => s.style ?? 'recipe')).toEqual(['acro', 'acro', 'recipe']);
  });

  it('checks style names', () => {
    expect(parseStyles('race, industrial')).toEqual(['race', 'industrial']);
    expect(() => parseStyles('race,custom')).toThrow(/unknown style custom/);
    expect(() => parseStyles(' , ')).toThrow(/no styles/);
  });
});
