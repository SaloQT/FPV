import { describe, expect, it } from 'vitest';
import type { GeneratedStyle, TerrainSampler } from '../../contracts';
import { createTerrainSampler, generateTerrain } from '../terrain';
import { generateTrack } from './generator';
import { makeTestSampler } from './testTerrain';

/**
 * The four original styles must build exactly the tracks they built before the technical, acro, industrial and custom styles were
 * added: replays, share links and trained brains depend on them. Each value is the FNV-1a hash of JSON.stringify(track) and of
 * JSON.stringify(track.gates), taken before any of that work started (seeds 1, 2, 3, 17, 77, 1234 on three synthetic terrains,
 * 1 to 3 on a real one).
 */
const BASELINE: Record<string, string[]> = {
  't3:race': ['aaff3327/bb18bc95', '9a364413/af397f08', '11271333/fabd32fb', '550f2ae8/4bb6db0a', '4221de5e/c2377210', '7b3b50e3/e5eb7a5c'],
  't3:freestyle': ['f02c10e2/8d4b004e', '1496e35d/d940e74b', 'bddba134/00dc17fc', '707be493/3f144e1d', 'caf34948/77aaf463', '6b398418/dd7c7255'],
  't3:mountain': ['a55d0339/1226aed9', 'f046e421/1a2831c8', '9699e640/5b72051d', '3c12b048/089a90f9', '16a69f81/bebd23fa', '323512c5/b593d34d'],
  't3:sprint': ['67602281/addba0bf', '94d3aa96/fabcd16b', 'fcf29901/c2ffcda6', '0f4f3378/4640637f', '0977022f/9604adf8', '4d33f168/47faf8d0'],
  'lake5:race': ['43bcabc4/48bddd60', '4643ef4a/700ac196', 'dabfd444/9144c178', 'c1627d4e/5b73ceca', '1ca57342/a7131def', 'a88a212f/998ebe16'],
  'lake5:freestyle': ['c0e5659a/3c96b1de', '1eaaf0f4/99f398dc', '78ce930c/13ce2ad1', 'fff5714b/bc3accfa', '8e5b32c3/27556080', 'd99b7af3/437da6cc'],
  'lake5:mountain': ['fd0d815f/d7902fb0', '504f4fd4/cd8cc594', '74c80ec9/23dee76b', '322b2091/60515c17', 'ec627be6/a5d54424', '21bc7077/18da84c1'],
  'lake5:sprint': ['1c743f26/5f0053bb', '5cb75ba4/c441f33a', '9274ac45/17022268', '68d183d3/24c8a97a', '2654839f/18184c6c', 'ecbfc369/6cf8c947'],
  'rough7:race': ['dd1f2666/38659aeb', 'ce8ca38e/b9f714ec', '9c761461/25f82367', '3b28ded3/40b29dba', 'bed1eab7/6a9787fc', 'f215b531/22a12ee8'],
  'rough7:freestyle': ['7c423903/a562e3f3', '48dfd532/dab9f80f', '2a598825/044bc903', '87df9d5f/44609625', '482adb21/5efeccc5', 'bb7bbb26/2a6e2157'],
  'rough7:mountain': ['8a55b4f9/ec91d2ec', 'e777b1ed/bd86f8c3', 'a7bfb7fa/cc680c49', '1a85a5d6/e60c9838', 'cf95b8bc/458e2e31', 'ceed1119/d6c80f97'],
  'rough7:sprint': ['1890639b/73b69455', '232d9d10/0339bdc1', '3fbcb899/170d02ae', '78f87683/0207aef9', '02e3a14b/5262304a', '41d78fc5/ca8eb6ae'],
  'real42:race': ['2bb7c4d7/4542f998', '170d6b68/e388909d', '9ce57e14/7370ab3d'],
  'real42:freestyle': ['b6d8f332/9ed75ff7', 'afaab130/e54a4c17', '77935de2/486fa0f5'],
  'real42:mountain': ['1e69044c/bfa76071', 'bcfeab80/ac45b672', 'b652103e/c64c3ffe'],
  'real42:sprint': ['71fc0045/7a09ba2b', '56adec75/225c4615', '5d722574/5ccb79df'],
};

const ORIGINAL: readonly GeneratedStyle[] = ['race', 'freestyle', 'mountain', 'sprint'];

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function prints(sampler: TerrainSampler, style: GeneratedStyle, seeds: readonly number[]): string[] {
  return seeds.map((seed) => {
    try {
      const t = generateTrack({ seed, style }, sampler);
      return `${fnv(JSON.stringify(t))}/${fnv(JSON.stringify(t.gates))}`;
    } catch {
      return 'throw';
    }
  });
}

describe('the original styles build exactly the tracks they built before the new styles', () => {
  const terrains = [
    ['t3', { seed: 3 }],
    ['lake5', { seed: 5, waterFraction: 0.18 }],
    ['rough7', { seed: 7, roughness: 3 }],
  ] as const;
  for (const [name, opt] of terrains) {
    it(`synthetic terrain ${name}`, () => {
      const sampler = makeTestSampler(opt);
      for (const style of ORIGINAL) expect(prints(sampler, style, [1, 2, 3, 17, 77, 1234]), `${name}:${style}`).toEqual(BASELINE[`${name}:${style}`]);
    }, 60_000);
  }

  it('real terrain seed 42', () => {
    const sampler = createTerrainSampler(generateTerrain({ seed: 42, quality: 'low', resolution: 256, cellSize: 8 }));
    for (const style of ORIGINAL) expect(prints(sampler, style, [1, 2, 3]), `real42:${style}`).toEqual(BASELINE[`real42:${style}`]);
  }, 60_000);
});
