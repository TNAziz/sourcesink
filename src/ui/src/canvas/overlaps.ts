/**
 * SourceSink — overlap detection for the "Tidy up" hint.
 *
 * Counts pairs of drawn shapes (stocks, valve chips, converter pills) whose
 * boxes overlap, using the same positions the canvas draws (layout entries
 * plus auto-layout for anything without one). Pure, so it is cheap to test.
 */

import type { Model, Point } from "@sourcesink/model";
import { autoLayout } from "./autoLayout.js";
import { centerOf, SIZES } from "./geometry.js";

type Kind = "stock" | "valve" | "converter";

/** Overlapping element pairs (by name), at most `limit` of them. */
export function overlappingPairs(m: Model, limit = 50): Array<[string, string]> {
  const layout: Record<string, Point> = { ...(m.layout ?? {}), ...autoLayout(m) };
  const boxes: Array<{ name: string; kind: Kind; c: Point }> = [];
  const add = (name: string, kind: Kind) => {
    const pos = layout[name];
    if (pos) boxes.push({ name, kind, c: centerOf(pos, kind) });
  };
  for (const s of m.stocks) add(s.name, "stock");
  for (const f of m.flows) add(f.name, "valve");
  for (const c of m.converters) add(c.name, "converter");

  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      // A few pixels of touching is fine; real overlap hides text.
      const overlapX = (SIZES[a.kind].w + SIZES[b.kind].w) / 2 - Math.abs(a.c.x - b.c.x);
      const overlapY = (SIZES[a.kind].h + SIZES[b.kind].h) / 2 - Math.abs(a.c.y - b.c.y);
      if (overlapX > 6 && overlapY > 6) {
        pairs.push([a.name, b.name]);
        if (pairs.length >= limit) return pairs;
      }
    }
  }
  return pairs;
}
