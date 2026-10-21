/**
 * SourceSink — elementary feedback-loop enumeration.
 *
 * Loops are simple directed cycles in the causal graph. Material links carry
 * the sign of their effect on a stock; information links use the sign computed
 * by numeric perturbation. The loop type is the product of those signs.
 */

import type { Model } from "@sourcesink/model";
import { linkPolarities, type Link } from "./links.js";

export interface Loop {
  id: string; // "R1", "B1", … in order found
  elements: string[]; // cycle in order, first element not repeated
  type: "reinforcing" | "balancing" | "unknown"; // product of link polarities
  links: Link[];
}

const LOOP_CAP = 500;

function loopType(links: Link[]): Loop["type"] {
  let sign = 1;
  for (const link of links) {
    if (link.polarity === "?") return "unknown";
    if (link.polarity === "-") sign = -sign;
  }
  return sign > 0 ? "reinforcing" : "balancing";
}

/** All elementary feedback loops (a bounded DFS; cap at 500 loops and report
 * `truncated: true`). Each cycle is reported once, starting at its
 * lowest-numbered element. */
export function findLoops(model: Model): { loops: Loop[]; truncated: boolean } {
  // Use the perturbed polarities so loop type reflects the actual equations.
  const links = linkPolarities(model);

  const nodeIndex = new Map<string, number>();
  const nodes: string[] = [];
  const node = (name: string): number => {
    let i = nodeIndex.get(name);
    if (i === undefined) {
      i = nodes.length;
      nodes.push(name);
      nodeIndex.set(name, i);
    }
    return i;
  };
  for (const link of links) {
    node(link.from);
    node(link.to);
  }

  // Adjacency lists hold link indices, preserving causalLinks order.
  const out: number[][] = nodes.map(() => []);
  const to: number[] = [];
  links.forEach((link, i) => {
    const from = nodeIndex.get(link.from)!;
    out[from].push(i);
    to[i] = nodeIndex.get(link.to)!;
  });

  const loops: Loop[] = [];
  const seenCycles = new Set<string>();
  const counters: Record<Loop["type"], number> = { reinforcing: 0, balancing: 0, unknown: 0 };
  let truncated = false;

  const record = (edgePath: number[], closing: number): void => {
    const cycleLinks = [...edgePath, closing].map((i) => links[i]);
    const elements = cycleLinks.map((link) => link.from);

    const key = elements.join("\u0000");
    if (seenCycles.has(key)) return;
    seenCycles.add(key);

    const type = loopType(cycleLinks);
    counters[type] += 1;
    const prefix = type === "reinforcing" ? "R" : type === "balancing" ? "B" : "U";
    loops.push({ id: `${prefix}${counters[type]}`, elements, type, links: cycleLinks });
    if (loops.length >= LOOP_CAP) truncated = true;
  };

  for (let start = 0; start < nodes.length && !truncated; start += 1) {
    const path: number[] = [];
    const visited = new Set<number>([start]);

    const dfs = (at: number): void => {
      for (const edge of out[at]) {
        if (truncated) return;
        const next = to[edge];
        if (next === start) {
          record(path, edge);
          continue;
        }
        // Only start at the lowest-numbered vertex of a cycle: never step
        // to a node visited earlier in this enumeration.
        if (next < start || visited.has(next)) continue;
        visited.add(next);
        path.push(edge);
        dfs(next);
        path.pop();
        visited.delete(next);
      }
    };

    dfs(start);
  }

  return { loops, truncated };
}
