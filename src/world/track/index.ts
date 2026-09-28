/** Public surface of the track subsystem: generation, validation, collision proxies and the helpers game logic needs. */
export { generateTrack } from './generator';
export { validateTrack } from './validate';
export type { TrackStats, TrackValidation } from './validate';
export { trackColliders, gateColliders } from './colliders';
export { gatePassed, trackGateFrame, insideOpening, gateOutline, GATE_TUBE } from './gate';
export type { GateFrame } from './gate';
export { distanceToPath, nearestPathIndex } from './pathIndex';
export { describeTrack } from './summary';
export type { TrackSummary } from './summary';
export { buildSpline, pathTangent, pathCurvature, yawOf } from './spline';
export type { SplinePath } from './spline';
export { STYLE_SPECS } from './styles';
export type { StyleSpec, TrackStyle } from './styles';
export { testTerrainData, testSampler, makeTestSampler } from './testTerrain';
