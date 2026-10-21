/**
 * SourceSink — custom canvas edges.
 *
 * `BowEdge` renders a connector (information link) as one gentle quadratic
 * arc between the shapes' boundaries. The bow magnitude/side is computed in
 * `toFlow` (pure, pipe-aware) and passed via edge data: a small clockwise bow
 * by default, bending further away from a pipe when the straight run would
 * come too close to one.
 */

import { BaseEdge, type EdgeProps } from "@xyflow/react";
import { bowControl } from "./geometry";

export function BowEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerStart,
  markerEnd,
  style,
  interactionWidth,
  data,
}: EdgeProps) {
  const a = { x: sourceX, y: sourceY };
  const b = { x: targetX, y: targetY };
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const bow = typeof data?.bow === "number" ? data.bow : Math.min(30, length * 0.15);
  const c = bowControl(a, b, bow);
  const path = `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
  return (
    <BaseEdge
      path={path}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={interactionWidth}
    />
  );
}

/** A pipe segment drawn between precomputed boundary points (see toFlow), so
 * a valve above a stock can drop straight into it at the valve's own x. */
export function PipeEdge({ sourceX, sourceY, targetX, targetY, markerEnd, style, interactionWidth, data }: EdgeProps) {
  const pts = data as { a?: { x: number; y: number }; b?: { x: number; y: number } } | undefined;
  const a = pts?.a ?? { x: sourceX, y: sourceY };
  const b = pts?.b ?? { x: targetX, y: targetY };
  return (
    <BaseEdge
      path={`M ${a.x} ${a.y} L ${b.x} ${b.y}`}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={interactionWidth}
    />
  );
}
