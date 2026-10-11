// Entry for the Node prop lab tools (tools/prop-lab/bundle.mjs bundles it): the prop code plus the trainer's world and brain
// helpers, with no GPU code.
export * from './design';
export * from './bemt';
export * from './fit';
export * from './bench';
export * from './flight';
export * from './optimize';
export * from './files';
export { buildMixWorld, evalWorldSpecs, trackFileWorld, parseStyles, describeWorld } from '../ai/train/worldMix';
export { parseBrain } from '../ai/brain';
