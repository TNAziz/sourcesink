/**
 * SourceSink — suggested sectors.
 *
 * A first grouping of a model into sectors, for the modeler to rename and
 * adjust. Material decides the cores: stocks joined by flows form one sector
 * with their flows. Every other element joins the sector it is most linked
 * to (what it feeds counts four times what it reads), repeated until nothing
 * moves. Sectors too small to stand alone merge into their closest neighbour.
 * Deterministic for a given model.
 */

import type { Model, Sector } from "@sourcesink/model";
import { canonicalName, collectReferences, parse } from "@sourcesink/engine";

/** Sectors with fewer elements than this merge into a neighbour. */
const MIN_SECTOR_SIZE = 4;
/** A small sector only merges into a neighbour that stays within this size,
 * so merges never snowball into one giant sector. */
const MAX_MERGE_TARGET = 14;

/** Undirected-with-weight neighbour lists over element names. */
type Weights = Map<string, Map<string, number>>;

function addWeight(w: Weights, a: string, b: string, weight: number): void {
  if (a === b) return;
  const row = w.get(a) ?? new Map<string, number>();
  row.set(b, (row.get(b) ?? 0) + weight);
  w.set(a, row);
}

/** "Byproduct_buffer" → "Byproduct buffer". */
export function sectorTitle(name: string): string {
  const t = name.replace(/[_\s]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function suggestSectors(model: Model): Sector[] {
  const names = [...model.stocks, ...model.flows, ...model.converters, ...model.graphFunctions].map((e) => e.name);
  const byKey = new Map(names.map((n) => [canonicalName(n), n]));
  const flowName = new Map(model.flows.map((f) => [f.id, f.name]));
  const resolveFlow = (ref: string): string | undefined => flowName.get(ref) ?? byKey.get(canonicalName(ref));

  // --- information weights from equations and drawn connectors ---------------
  const weights: Weights = new Map();
  const link = (from: string, to: string): void => {
    addWeight(weights, from, to, 4); // `from` feeds `to`: pull `from` towards `to`
    addWeight(weights, to, from, 1);
  };
  for (const e of [...model.flows, ...model.converters]) {
    try {
      for (const ref of collectReferences(parse(e.equation))) {
        const from = byKey.get(canonicalName(ref.name));
        if (from) link(from, e.name);
      }
    } catch {
      // unparseable equations contribute no links
    }
  }
  for (const c of model.connectors) {
    const from = byKey.get(canonicalName(c.from));
    const to = byKey.get(canonicalName(c.to));
    if (from && to) link(from, to);
  }

  /** Sector (keyed by a root stock) of every element. */
  const assign = (): Map<string, string> => {
    // --- material cores: union-find over stocks sharing a flow -----------------
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r)!;
      parent.set(x, r);
      return r;
    };
    const union = (a: string, b: string): void => {
      parent.set(find(a), find(b));
    };
    for (const s of model.stocks) parent.set(s.name, s.name);
    const flowStocks = new Map<string, string[]>();
    const flowSource = new Map<string, string>();
    for (const s of model.stocks) {
      for (const ref of [...(s.inflows ?? []), ...(s.outflows ?? [])]) {
        const f = resolveFlow(ref);
        if (!f) continue;
        flowStocks.set(f, [...(flowStocks.get(f) ?? []), s.name]);
      }
      for (const ref of s.outflows ?? []) {
        const f = resolveFlow(ref);
        if (f) flowSource.set(f, s.name);
      }
    }
    for (const stocks of flowStocks.values()) {
      for (const s of stocks.slice(1)) union(stocks[0], s);
    }

    const sectorOf = new Map<string, string>();
    for (const s of model.stocks) sectorOf.set(s.name, find(s.name));
    // A flow between two stocks belongs with the stock it drains.
    for (const [f, stocks] of flowStocks) sectorOf.set(f, find(flowSource.get(f) ?? stocks[0]));

    // --- propagate: loose elements join their most-linked sector ----------------
    const loose = names.filter((n) => !sectorOf.has(n));
    const pull = (name: string): string | undefined => {
      const score = new Map<string, number>();
      for (const [other, w] of weights.get(name) ?? []) {
        const s = sectorOf.get(other);
        if (s !== undefined) score.set(s, (score.get(s) ?? 0) + w);
      }
      let best: string | undefined;
      let bestScore = 0;
      for (const [s, v] of [...score].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (v > bestScore) [best, bestScore] = [s, v];
      }
      return best;
    };
    for (let pass = 0; pass < 20; pass++) {
      let moved = false;
      for (const name of loose) {
        const next = pull(name);
        if (next !== undefined && next !== sectorOf.get(name)) {
          sectorOf.set(name, next);
          moved = true;
        }
      }
      if (!moved) break;
    }

    // --- merge small sectors into the neighbour they are most linked to ---------
    const members = (): Map<string, string[]> => {
      const out = new Map<string, string[]>();
      for (const n of names) {
        const s = sectorOf.get(n);
        if (s !== undefined) out.set(s, [...(out.get(s) ?? []), n]);
      }
      return out;
    };
    for (let guard = 0; guard < names.length; guard++) {
      const groups = members();
      const small = [...groups].filter(([, ms]) => ms.length < MIN_SECTOR_SIZE).sort((a, b) => a[1].length - b[1].length);
      let merged = false;
      for (const [id, ms] of small) {
        const score = new Map<string, number>();
        for (const m of ms) {
          for (const [other, w] of weights.get(m) ?? []) {
            const s = sectorOf.get(other);
            if (s !== undefined && s !== id) score.set(s, (score.get(s) ?? 0) + w);
          }
        }
        const ranked = [...score].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
        const roomy = ranked.filter(([s]) => (groups.get(s)?.length ?? 0) + ms.length <= MAX_MERGE_TARGET);
        // With no neighbour small enough, a small sector stands on its own.
        const target = roomy[0]?.[0];
        if (target === undefined) continue;
        for (const m of ms) sectorOf.set(m, target);
        merged = true;
        break;
      }
      if (!merged) break;
    }
    return sectorOf;
  };

  const members = (sectorOf: Map<string, string>): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    for (const n of names) {
      const s = sectorOf.get(n);
      if (s !== undefined) out.set(s, [...(out.get(s) ?? []), n]);
    }
    return out;
  };

  const sectorOf = assign();

  // --- name and order: by the sector's best-connected stock -------------------
  const degree = (n: string): number => [...(weights.get(n) ?? new Map<string, number>()).values()].reduce((a, b) => a + b, 0);
  const flowCount = (n: string): number => {
    const s = model.stocks.find((x) => x.name === n);
    return (s?.inflows?.length ?? 0) + (s?.outflows?.length ?? 0);
  };
  const groups = [...members(sectorOf)].filter(([, ms]) => ms.length > 0);
  const order = new Map(names.map((n, i) => [n, i]));
  groups.sort((a, b) => order.get(a[1][0])! - order.get(b[1][0])!);
  const used = new Set<string>();
  return groups.map(([, ms], i) => {
    const stocks = ms.filter((m) => model.stocks.some((s) => s.name === m));
    const lead = [...(stocks.length ? stocks : ms)].sort(
      (a, b) => flowCount(b) - flowCount(a) || degree(b) - degree(a) || order.get(a)! - order.get(b)!,
    )[0];
    let name = sectorTitle(lead);
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${sectorTitle(lead)} ${k}`;
    used.add(name.toLowerCase());
    return { id: `sector-${i + 1}`, name, members: ms };
  });
}
