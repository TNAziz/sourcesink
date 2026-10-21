/**
 * SourceSink — deterministic evaluation order.
 *
 * Two orders are computed:
 *
 *   - **initial**: every stock, flow, converter and graph function, sorted so
 *     each element is evaluated after everything its equation reads. Stock
 *     initial values may reference converters, other stocks, flows, etc.
 *   - **perStep**: flows, converters and graph functions, sorted by their
 *     dependencies on each other. Stocks are excluded: during a step their
 *     values come from the integrator, which breaks every feedback loop that
 *     passes through a stock.
 *
 * Dependencies come from bare references in equations, plus the connector
 * feeding a graph function used as a variable (its input). Connectors alone do
 * not create dependencies: an equation that does not read a connected element
 * does not need it.
 *
 * A cycle among elements in the same order (an algebraic loop, or a circular
 * initial value) raises `CycleError` listing its members.
 */

import type { Model } from "@sourcesink/model";
import { collectReferences, parse } from "./expr.js";

export interface OrderPhases {
  /** Stock ids, in model order (integration order). */
  stocks: string[];
  /** Flow, converter and graph-function ids, in per-step dependency order. */
  perStep: string[];
  /** Every element id, in t0 initialization order. */
  initial: string[];
}

export class CycleError extends Error {
  constructor(
    readonly names: string[],
    readonly phase: "initial" | "perStep",
  ) {
    super(
      phase === "initial"
        ? `circular initial values: ${names.join(" → ")}`
        : `algebraic loop (no stock in the cycle): ${names.join(" → ")}`,
    );
    this.name = "CycleError";
  }
}

/** Identifier canonical form: case-insensitive, spaces ≡ underscores. */
export function canonicalName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "_");
}

interface Node {
  id: string;
  name: string;
  kind: "stock" | "flow" | "converter" | "graphFunction";
  /** ids this node reads. */
  reads: Set<string>;
}

function buildNodes(model: Model): Node[] {
  const nodes: Node[] = [];
  const idByName = new Map<string, string>();
  const all = [
    ...model.stocks,
    ...model.flows,
    ...model.converters,
    ...model.graphFunctions,
  ];
  for (const e of all) idByName.set(canonicalName(e.name), e.id);

  const gfIds = new Set(model.graphFunctions.map((g) => g.id));
  const refsOf = (equation: string): Set<string> => {
    const out = new Set<string>();
    for (const ref of collectReferences(parse(equation))) {
      const id = idByName.get(canonicalName(ref.name));
      // A call `gf(x)` is a pure lookup; only a bare `gf` reads the graph
      // function's value (driven by its input connector). Builtins are not in
      // the index and are ignored.
      if (id && !(ref.isFunction && gfIds.has(id))) out.add(id);
    }
    return out;
  };

  // Conveyor outflows and leaks take their values from the conveyor's state,
  // so they depend only on the stock; the stock's initialisation needs its
  // transit time and leak fractions.
  // A queue's outflows pass its contents plus this step's inflow, so they
  // also depend on the queue's inflows.
  const conveyorFlows = conveyorFlowOwners(model);
  const queueFlows = queueFlowOwners(model);
  const ovenFlows = ovenFlowOwners(model);
  const inflowsOf = (stockId: string) => {
    const s = model.stocks.find((x) => x.id === stockId);
    return (s?.inflows ?? []).map((r) => idByName.get(canonicalName(r)) ?? r);
  };
  for (const e of [...model.stocks, ...model.flows, ...model.converters]) {
    const owner = conveyorFlows.get(e.id) ?? ovenFlows.get(e.id);
    if (owner) {
      nodes.push({ id: e.id, name: e.name, kind: e.kind, reads: new Set([owner]) });
      continue;
    }
    const queue = queueFlows.get(e.id);
    if (queue) {
      // Into an oven or conveyor the downstream stock decides and only what
      // is already queued can go; elsewhere this step's arrivals pass through.
      const sink = model.stocks.find((s) =>
        (s.inflows ?? []).some((r) => (idByName.get(canonicalName(r)) ?? r) === e.id),
      );
      const controlled = Boolean(sink?.oven || sink?.conveyor);
      nodes.push({
        id: e.id,
        name: e.name,
        kind: e.kind,
        reads: new Set(controlled ? [queue] : [queue, ...inflowsOf(queue)]),
      });
      continue;
    }
    // A conveyor's initial value may be a comma list of expressions.
    const reads = e.kind === "stock" && e.conveyor
      ? new Set(e.equation.split(",").flatMap((p) => [...refsOf(p)]))
      : refsOf(e.equation);
    if (e.kind === "stock" && e.conveyor) {
      for (const r of refsOf(e.conveyor.transitTime)) reads.add(r);
      for (const f of model.flows) {
        if (f.leak && conveyorFlows.get(f.id) === e.id) for (const r of refsOf(f.equation)) reads.add(r);
      }
    }
    nodes.push({ id: e.id, name: e.name, kind: e.kind, reads });
  }
  for (const g of model.graphFunctions) {
    const reads = new Set<string>();
    const input = model.connectors.find(
      (c) => canonicalName(c.to) === canonicalName(g.name),
    );
    const inputId = input && idByName.get(canonicalName(input.from));
    if (inputId) reads.add(inputId);
    nodes.push({ id: g.id, name: g.name, kind: "graphFunction", reads });
  }
  return nodes;
}

/** Map each conveyor outflow / leak flow id to its conveyor stock's id.
 * Stock outflow lists may hold flow ids or names. */
export function conveyorFlowOwners(model: Model): Map<string, string> {
  const flowId = new Map<string, string>();
  for (const f of model.flows) {
    flowId.set(f.id, f.id);
    flowId.set(canonicalName(f.name), f.id);
  }
  const out = new Map<string, string>();
  for (const s of model.stocks) {
    if (!s.conveyor) continue;
    for (const ref of s.outflows ?? []) {
      const id = flowId.get(ref) ?? flowId.get(canonicalName(ref));
      if (id) out.set(id, s.id);
    }
  }
  return out;
}

/** Map each oven's outflow id to its oven stock's id. */
export function ovenFlowOwners(model: Model): Map<string, string> {
  return ownedOutflows(model, (s) => Boolean(s.oven));
}

function ownedOutflows(model: Model, owns: (s: Model["stocks"][number]) => boolean): Map<string, string> {
  const flowId = new Map<string, string>();
  for (const f of model.flows) {
    flowId.set(f.id, f.id);
    flowId.set(canonicalName(f.name), f.id);
  }
  const out = new Map<string, string>();
  for (const s of model.stocks) {
    if (!owns(s)) continue;
    for (const ref of s.outflows ?? []) {
      const id = flowId.get(ref) ?? flowId.get(canonicalName(ref));
      if (id) out.set(id, s.id);
    }
  }
  return out;
}

/** Map each queue outflow id to its queue stock's id. */
export function queueFlowOwners(model: Model): Map<string, string> {
  const flowId = new Map<string, string>();
  for (const f of model.flows) {
    flowId.set(f.id, f.id);
    flowId.set(canonicalName(f.name), f.id);
  }
  const out = new Map<string, string>();
  for (const s of model.stocks) {
    if (!s.queue) continue;
    for (const ref of s.outflows ?? []) {
      const id = flowId.get(ref) ?? flowId.get(canonicalName(ref));
      if (id) out.set(id, s.id);
    }
  }
  return out;
}

/** Kahn's algorithm with model-order tie-breaking; throws on a cycle. */
function topoSort(
  nodes: Node[],
  include: (n: Node) => boolean,
  phase: "initial" | "perStep",
): string[] {
  const members = nodes.filter(include);
  const inSet = new Set(members.map((n) => n.id));
  const index = new Map(members.map((n, i) => [n.id, i]));
  const deps = new Map<string, Set<string>>();
  const dependents = new Map<string, string[]>();
  for (const n of members) {
    const d = new Set([...n.reads].filter((r) => inSet.has(r) && r !== n.id));
    // Self-reference is only legal through a stock (a stock's own initial value
    // referencing itself is a cycle too).
    if (n.reads.has(n.id)) d.add(n.id);
    deps.set(n.id, d);
    for (const r of d) {
      if (!dependents.has(r)) dependents.set(r, []);
      dependents.get(r)!.push(n.id);
    }
  }

  const ready = members.filter((n) => deps.get(n.id)!.size === 0).map((n) => n.id);
  const sorted: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => index.get(a)! - index.get(b)!);
    const id = ready.shift()!;
    sorted.push(id);
    for (const other of dependents.get(id) ?? []) {
      const d = deps.get(other)!;
      if (d.delete(id) && d.size === 0) ready.push(other);
    }
  }

  if (sorted.length < members.length) {
    throw new CycleError(findCycle(members, deps), phase);
  }
  return sorted;
}

/** Return one cycle (as element names) among the unsorted remainder. */
function findCycle(members: Node[], deps: Map<string, Set<string>>): string[] {
  const nameOf = new Map(members.map((n) => [n.id, n.name]));
  const stuck = members.filter((n) => deps.get(n.id)!.size > 0).map((n) => n.id);
  // Walk dependency edges from a stuck node until a node repeats.
  const seen = new Map<string, number>();
  const path: string[] = [];
  let cur = stuck[0];
  while (!seen.has(cur)) {
    seen.set(cur, path.length);
    path.push(cur);
    cur = [...deps.get(cur)!][0];
  }
  const cycle = path.slice(seen.get(cur)!);
  cycle.push(cur);
  return cycle.map((id) => nameOf.get(id)!);
}

export function orderPhases(model: Model): OrderPhases {
  const nodes = buildNodes(model);
  return {
    stocks: model.stocks.map((s) => s.id),
    perStep: topoSort(nodes, (n) => n.kind !== "stock", "perStep"),
    initial: topoSort(nodes, () => true, "initial"),
  };
}

/** Element ids in per-step evaluation order (stocks first), for callers that
 * only need a flat list. */
export function computeOrder(model: Model): string[] {
  const p = orderPhases(model);
  return [...p.stocks, ...p.perStep];
}
