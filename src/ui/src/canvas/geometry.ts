/**
 * SourceSink — canvas geometry shared by the auto-layout and the model→flow
 * projection. Pure helpers only (no React, no DOM), unit-testable in node.
 */

import type { Point } from "@sourcesink/model";

/** Drawn node sizes (px, flow coordinates): the card, chip and pill shapes.
 * Pipes and connectors end on these boundaries. */
export const SIZES = {
  stock: { w: 148, h: 62 },
  converter: { w: 128, h: 28 },
  valve: { w: 128, h: 26 },
  cloud: { w: 34, h: 24 },
  /** A folded sector's card. */
  sector: { w: 240, h: 92 },
} as const;

/** The box a layout entry refers to. Layout entries (saved files, legacy
 * imports, auto-layout) store the top-left corner of THIS box, whose sizes
 * predate the current shapes; keeping them fixed means a redesign never
 * moves an element's center, so existing diagrams keep their arrangement. */
export const ANCHORS = {
  stock: { w: 110, h: 64 },
  converter: { w: 56, h: 56 },
  valve: { w: 30, h: 30 },
  cloud: { w: 48, h: 36 },
  sector: { w: 240, h: 92 },
} as const;

/** Distance a derived cloud sits from its valve (center-to-center). */
export const CLOUD_OFFSET = 120;

/** Layout entry → element center. */
export function centerOf(pos: Point, kind: keyof typeof SIZES): Point {
  const s = ANCHORS[kind];
  return { x: pos.x + s.w / 2, y: pos.y + s.h / 2 };
}

/** Element center → layout entry. */
export function topLeftOf(center: Point, kind: keyof typeof SIZES): Point {
  const s = ANCHORS[kind];
  return { x: center.x - s.w / 2, y: center.y - s.h / 2 };
}

/** Element center → top-left of the drawn node (React Flow position). */
export function nodeTopLeft(center: Point, kind: keyof typeof SIZES): Point {
  const s = SIZES[kind];
  return { x: center.x - s.w / 2, y: center.y - s.h / 2 };
}

/** Drawn node position (after a drag) → layout entry. */
export function layoutFromNode(nodePos: Point, kind: keyof typeof SIZES): Point {
  return topLeftOf({ x: nodePos.x + SIZES[kind].w / 2, y: nodePos.y + SIZES[kind].h / 2 }, kind);
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Pick facing handle ids for an edge from `a` (source center) to `b`
 * (target center): every node exposes hidden source handles s-l/s-r/s-t/s-b
 * and target handles t-l/t-r/t-t/t-b on its four sides.
 */
export function pickHandle(a: Point, b: Point): { sourceHandle: string; targetHandle: string } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { sourceHandle: "s-r", targetHandle: "t-l" } : { sourceHandle: "s-l", targetHandle: "t-r" };
  }
  return dy >= 0 ? { sourceHandle: "s-b", targetHandle: "t-t" } : { sourceHandle: "s-t", targetHandle: "t-b" };
}

/** A straight line segment between two points. */
export interface Segment {
  a: Point;
  b: Point;
}

/** The point where a handle sits on a node's boundary (mid-side). */
export function boundaryPoint(
  center: Point,
  kind: keyof typeof SIZES,
  side: "l" | "r" | "t" | "b",
): Point {
  const s = SIZES[kind];
  switch (side) {
    case "l":
      return { x: center.x - s.w / 2, y: center.y };
    case "r":
      return { x: center.x + s.w / 2, y: center.y };
    case "t":
      return { x: center.x, y: center.y - s.h / 2 };
    default:
      return { x: center.x, y: center.y + s.h / 2 };
  }
}

/**
 * Control point for a quadratic arc from `a` to `b`. A positive `offset` bows
 * clockwise (screen coordinates, y grows down), negative bows the other way.
 */
export function bowControl(a: Point, b: Point, offset: number): Point {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: mx - (dy / d) * offset, y: my + (dx / d) * offset };
}

/** Shortest distance from a point to the segment [a, b]. */
export function pointSegDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function orient(a: Point, b: Point, c: Point): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return v === 0 ? 0 : v > 0 ? 1 : -1;
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

function segsIntersect(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const o1 = orient(p1, p2, q1);
  const o2 = orient(p1, p2, q2);
  const o3 = orient(q1, q2, p1);
  const o4 = orient(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, p2, q2)) return true;
  if (o3 === 0 && onSegment(q1, q2, p1)) return true;
  if (o4 === 0 && onSegment(q1, q2, p2)) return true;
  return false;
}

/** Shortest distance between two segments (0 when they touch or cross). */
export function segSegDist(p1: Point, p2: Point, q1: Point, q2: Point): number {
  if (segsIntersect(p1, p2, q1, q2)) return 0;
  return Math.min(
    pointSegDist(p1, q1, q2),
    pointSegDist(p2, q1, q2),
    pointSegDist(q1, p1, p2),
    pointSegDist(q2, p1, p2),
  );
}

/** How close a connector must stay from a flow pipe before bowing harder. */
export const CONNECTOR_CLEARANCE = 12;

/**
 * Signed bow for a connector arc from `a` to `b` (boundary points). Gentle by
 * default — min(30px, 15% of length), always clockwise — and bends further,
 * *away* from the nearest pipe, only when the straight run would come within
 * 12px of a pipe. The chord tips are ignored so connectors may share boundary
 * points with pipes where they attach to the same shapes.
 */
export function connectorBow(a: Point, b: Point, pipes: Segment[]): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const base = Math.min(30, d * 0.15);
  if (pipes.length === 0) return base;

  const a2 = { x: a.x + dx * 0.15, y: a.y + dy * 0.15 };
  const b2 = { x: b.x - dx * 0.15, y: b.y - dy * 0.15 };

  let nearest = Infinity;
  let side = 0;
  for (const seg of pipes) {
    const dist = segSegDist(a2, b2, seg.a, seg.b);
    if (dist < nearest) {
      nearest = dist;
      const px = -dy / d; // unit clockwise perpendicular of the chord
      const py = dx / d;
      const s1 = (seg.a.x - a.x) * px + (seg.a.y - a.y) * py;
      const s2 = (seg.b.x - a.x) * px + (seg.b.y - a.y) * py;
      side = s1 * s2 > 0 ? Math.sign(s1) : 0;
    }
  }

  if (nearest >= CONNECTOR_CLEARANCE) return base;
  const need = Math.min(56, Math.max(base, 2 * (CONNECTOR_CLEARANCE - nearest)));
  return side > 0 ? -need : need; // away from the pipe; parallel → clockwise
}

/** Midpoint of two points. */
export function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Format a simulation value compactly for on-canvas display. */
export function formatValue(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return n.toExponential(2);
  return String(Number(n.toPrecision(4)));
}
