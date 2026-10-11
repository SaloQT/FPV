/// <reference lib="webworker" />
import { packAssets } from './treePack';
import { treeAsset } from './variants';

/** Builds the tree variants it is given (treeBuildPool.ts) and posts them back packed, their buffers transferred. */
self.onmessage = (e: MessageEvent<{ dense: boolean; variants: number[] }>) => {
  const { dense, variants } = e.data;
  const buffer = packAssets(variants.map((v) => treeAsset(v, dense)));
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ variants, buffer }, [buffer]);
};
