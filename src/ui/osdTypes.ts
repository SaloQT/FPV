/** The slice of `CanvasRenderingContext2D` the OSD uses, so tests can pass a recording double. */
export type OsdContext = Pick<
  CanvasRenderingContext2D,
  | 'clearRect' | 'fillRect' | 'fillText' | 'strokeText' | 'measureText' | 'beginPath' | 'moveTo' | 'lineTo' | 'stroke'
  | 'font' | 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'lineJoin' | 'lineCap' | 'textAlign' | 'textBaseline' | 'globalAlpha'
>;

/** The slice of the canvas element the OSD sizes itself from. */
export interface OsdSurface {
  width: number;
  height: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  style: { width: string; height: string };
}
