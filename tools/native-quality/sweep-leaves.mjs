import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const path='src/render/rt/bvh.ts', source=await read(path);
if (!source.includes('const LEAF_SIZE = 4;')) throw new Error('Expected four-primitive baseline leaves');
const winner=JSON.parse(await read('.bench/research-20261005/overnight-hybrid-winner.json'));
const variants=[2,8,16,6,12,3,1,24].map((size,i)=>({id:`E${i+33}`,label:`BVH leaves ${size} primitives`,
  hypothesis:`Trade traversal depth against primitive intersection work using up to ${size} primitives per leaf. Preserve primitives, Morton ordering, ray counts and simulation; verify original-image output`,
  files:{[path]:source.replace('const LEAF_SIZE = 4;',`const LEAF_SIZE = ${size};`)} }));
await explore('overnight-leaves',variants,resolve(evidence,`${winner.id.toLowerCase()}-screen.json`),winner.id);
