import { expect, it } from 'vitest';
import { gatherGrid, gatherWgsl } from './nn';

it('keeps ordinary gathers one-dimensional and splits the observed oversized rollout within the device limit', () => {
  expect(gatherGrid(16384*32/8,40)).toEqual([40960,1,1]);
  expect(gatherGrid(16384*64/8,40)).toEqual([65535,2,1]);
  expect(gatherGrid(65535*64,1)).toEqual([65535,1,1]);
  expect(gatherGrid(65535*64+1,1)).toEqual([65535,2,1]);
  expect(gatherWgsl(65536,40)).not.toContain('gid.y');
  expect(gatherWgsl(131072,40,65535)).toContain('gid.y * 4194240u');
});

it('copies each permuted observation and per-row record exactly once across 2D row boundaries and padding', () => {
  const rows=31,features=40, grid=gatherGrid(rows,features,5);
  const source=Float32Array.from({length:rows*features},(_,i)=>Math.fround((i-345)/13));
  const perm=Array.from({length:rows},(_,i)=>(i*7)%rows), expected=new Float32Array(source.length);
  for(let row=0;row<rows;row++)expected.set(source.subarray(perm[row]*features,(perm[row]+1)*features),row*features);
  const actual=new Float32Array(source.length), visits=new Uint8Array(source.length), records=new Uint8Array(rows);
  for(let y=0;y<grid[1];y++)for(let x=0;x<grid[0]*64;x++) {
    const flat=x+y*grid[0]*64,row=Math.floor(flat/features),feature=flat%features;
    if(row>=rows)continue;
    actual[flat]=source[perm[row]*features+feature];visits[flat]++;
    if(feature===0)records[row]++;
  }
  expect(new Uint8Array(actual.buffer)).toEqual(new Uint8Array(expected.buffer));
  expect([...visits].every(n=>n===1)).toBe(true);expect([...records].every(n=>n===1)).toBe(true);
  expect(()=>gatherGrid(10000,40,2)).toThrow(/dispatch limits/);
});
