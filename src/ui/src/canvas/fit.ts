/**
 * SourceSink — fit-to-screen that stays readable.
 *
 * Fitting a large diagram into the window can shrink it until labels are
 * specks. `readableViewport` fits when the result is legible; otherwise it
 * holds a minimum zoom and shows the top-left of the diagram (where the stock
 * rows start), leaving the rest a pan away.
 */

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** Below this zoom, element names are too small to read. */
export const MIN_READABLE_ZOOM = 0.55;

export function readableViewport(
  bounds: Bounds,
  width: number,
  height: number,
  { padding = 0.1, maxZoom = 1.3, minZoom = MIN_READABLE_ZOOM } = {},
): Viewport {
  const padX = width * padding;
  const padY = height * padding;
  const bw = Math.max(bounds.width, 1);
  const bh = Math.max(bounds.height, 1);
  const fit = Math.min((width - 2 * padX) / bw, (height - 2 * padY) / bh, maxZoom);
  const zoom = Math.max(fit, minZoom);
  // Centre each axis that fits; otherwise start at the content's top/left edge.
  const along = (start: number, size: number, view: number, pad: number): number =>
    size * zoom <= view - 2 * pad ? (view - size * zoom) / 2 - start * zoom : pad - start * zoom;
  return {
    x: along(bounds.x, bw, width, padX),
    y: along(bounds.y, bh, height, padY),
    zoom,
  };
}
