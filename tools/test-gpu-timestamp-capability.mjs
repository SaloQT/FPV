// Native timestamp-query support/readback smoke test; software values are not hardware benchmarks.
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const {create,globals} = await import(process.env.WEBGPU_MODULE ? pathToFileURL(process.env.WEBGPU_MODULE).href : 'webgpu');
import {writeFileSync} from 'node:fs';
Object.assign(globalThis,globals);
const gpu=create(['backend=vulkan']);const adapter=await gpu.requestAdapter();
const supported=adapter.features.has('timestamp-query');
const device=await adapter.requestDevice({requiredFeatures:supported?['timestamp-query']:[]});
device.pushErrorScope('validation');
let stamps=null;
if(supported){const queries=device.createQuerySet({type:'timestamp',count:2});const resolved=device.createBuffer({size:16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});const read=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const enc=device.createCommandEncoder();enc.beginComputePass({timestampWrites:{querySet:queries,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}}).end();enc.resolveQuerySet(queries,0,2,resolved,0);enc.copyBufferToBuffer(resolved,0,read,0,16);device.queue.submit([enc.finish()]);await read.mapAsync(GPUMapMode.READ);stamps=[...new BigUint64Array(read.getMappedRange())].map(String);read.unmap();read.destroy();resolved.destroy();queries.destroy();}
const validation=await device.popErrorScope(); const result={supported,stamps,validation:validation?.message??null,adapter: {vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,isFallbackAdapter:adapter.info.isFallbackAdapter},timingClaim:false};if (process.argv[2]) writeFileSync(process.argv[2],JSON.stringify(result,null,2));console.log(result);device.destroy();assert.equal(validation,null);if(stamps)assert(BigInt(stamps[1])>=BigInt(stamps[0]));
