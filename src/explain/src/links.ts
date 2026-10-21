/**
 * SourceSink — causal graph construction and link-polarity analysis.
 *
 * The graph is derived entirely from the model: material links come from each
 * stock's inflow/outflow wiring, information links from the names an equation
 * reads. No AI or network access is involved.
 */

import type {
  Converter,
  Flow,
  GraphFunction,
  Model,
  Stock,
} from "@sourcesink/model";
import {
  canonicalName,
  collectReferences,
  evaluate,
  evaluateBuiltin,
  lookupBuiltin,
  parse,
  simulate,
  type EvalContext,
  type Reference,
  type SimulationResult,
  type StateStore,
} from "@sourcesink/engine";

/** A directed causal link between two named elements. */
export interface Link {
  from: string;
  to: string;
  kind: "information" | "flow-into-stock" | "flow-out-of-stock";
  /** "+" if increasing `from` increases `to`, "-" if it decreases it, "?" if
   * the sign is not determinable. flow-into-stock is "+", flow-out-of-stock "-". */
  polarity: "+" | "-" | "?";
}

type GraphElement = Stock | Flow | Converter | GraphFunction;

interface ElementIndex {
  byCanonical: Map<string, GraphElement>;
  flowsById: Map<string, Flow>;
}

function buildIndex(model: Model): ElementIndex {
  const byCanonical = new Map<string, GraphElement>();
  const flowsById = new Map<string, Flow>();
  const elements: GraphElement[] = [
    ...model.stocks,
    ...model.flows,
    ...model.converters,
    ...model.graphFunctions,
  ];
  for (const e of elements) {
    byCanonical.set(canonicalName(e.name), e);
    if (e.kind === "flow") flowsById.set(e.id, e);
  }
  return { byCanonical, flowsById };
}

/** Every graph element, in section order (stocks, flows, converters, graph
 * functions). Connectors and dimensions are structural metadata, not elements
 * a verbal description must name. */
export function graphElements(model: Model): GraphElement[] {
  return [...model.stocks, ...model.flows, ...model.converters, ...model.graphFunctions];
}

/** The element feeding a graph function through its input connector, if any. */
function graphInput(model: Model, gf: GraphFunction, idx: ElementIndex): GraphElement | undefined {
  const c = model.connectors.find((k) => canonicalName(k.to) === canonicalName(gf.name));
  if (!c) return undefined;
  return idx.byCanonical.get(canonicalName(c.from));
}

function resolveFlow(idx: ElementIndex, ref: string): Flow | undefined {
  const byId = idx.flowsById.get(ref);
  if (byId) return byId;
  const e = idx.byCanonical.get(canonicalName(ref));
  return e?.kind === "flow" ? e : undefined;
}

/** Causal links: information links come from each flow/converter equation's
 * references (a graph function used as a variable links from its input
 * connector); material links from stock inflows/outflows. */
export function causalLinks(model: Model): Link[] {
  const idx = buildIndex(model);
  const out: Link[] = [];
  const seen = new Set<string>();
  const add = (link: Link): void => {
    const key = `${link.kind}\u0000${link.from}\u0000${link.to}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(link);
  };

  for (const stock of model.stocks) {
    for (const ref of stock.inflows ?? []) {
      const flow = resolveFlow(idx, ref);
      if (flow) add({ from: flow.name, to: stock.name, kind: "flow-into-stock", polarity: "+" });
    }
    for (const ref of stock.outflows ?? []) {
      const flow = resolveFlow(idx, ref);
      if (flow) add({ from: flow.name, to: stock.name, kind: "flow-out-of-stock", polarity: "-" });
    }
  }

  for (const target of [...model.flows, ...model.converters]) {
    let refs: Reference[];
    try {
      refs = collectReferences(parse(target.equation));
    } catch {
      continue;
    }
    for (const ref of refs) {
      const element = idx.byCanonical.get(canonicalName(ref.name));
      if (!element) continue; // clock variables, PI, or an unknown name

      if (element.kind === "graphFunction") {
        // `lookup(x)` is a pure numeric call; its argument creates its own
        // link. A bare `lookup` is a variable driven by the connector feeding
        // the graph function.
        if (ref.isFunction) continue;
        const input = graphInput(model, element, idx);
        add({
          from: input?.name ?? element.name,
          to: target.name,
          kind: "information",
          polarity: "?",
        });
        continue;
      }

      // A call to a non-graph element does not read its value.
      if (ref.isFunction) continue;
      add({ from: element.name, to: target.name, kind: "information", polarity: "?" });
    }
  }

  return out;
}

/** Linear interpolation, as used for polarity probes. */
function interpolate(gf: GraphFunction, x: number): number {
  const pts = gf.points;
  if (pts.length === 0 || !Number.isFinite(x)) return Number.NaN;
  if (pts.length === 1) return pts[0].y;

  if (x <= pts[0].x) {
    if (gf.extrapolation === "extend") {
      const slope = (pts[1].y - pts[0].y) / (pts[1].x - pts[0].x);
      return pts[0].y + slope * (x - pts[0].x);
    }
    return pts[0].y;
  }
  const last = pts[pts.length - 1];
  if (x >= last.x) {
    if (gf.extrapolation === "extend") {
      const prev = pts[pts.length - 2];
      const slope = (last.y - prev.y) / (last.x - prev.x);
      return last.y + slope * (x - last.x);
    }
    return last.y;
  }
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return last.y;
}

interface Override {
  canonical: string;
  value: number;
}

/** Values known at one recorded time step, keyed by canonical name. */
type Values = Map<string, number>;

interface Resolvers {
  value(name: string): number | undefined;
  target(target: Flow | Converter): number;
}

/** Build an evaluator for one probe point. Graph functions are resolved from
 * their input connector, exactly as the engine does for a bare reference. */
function makeResolvers(
  model: Model,
  idx: ElementIndex,
  values: Values,
  time: number,
  override?: Override,
): Resolvers {
  const resolving = new Set<string>();

  const graphValue = (gf: GraphFunction): number => {
    const key = canonicalName(gf.name);
    if (resolving.has(key)) return Number.NaN;
    const input = model.connectors.find((k) => canonicalName(k.to) === key);
    if (!input) return Number.NaN;
    resolving.add(key);
    const x = value(input.from);
    resolving.delete(key);
    if (x === undefined) return Number.NaN;
    return interpolate(gf, x);
  };

  const value = (name: string): number | undefined => {
    const canon = canonicalName(name);
    if (override && canon === override.canonical) return override.value;
    const upper = name.trim().toUpperCase();
    if (upper === "TIME") return time;
    if (upper === "DT") return model.run.dt;
    if (upper === "STARTTIME" || upper === "INITIAL_TIME") return model.run.start;
    if (upper === "STOPTIME" || upper === "FINAL_TIME") return model.run.stop;
    if (upper === "PI") return Math.PI;
    const known = values.get(canon);
    if (known !== undefined) return known;
    const element = idx.byCanonical.get(canon);
    if (element?.kind === "graphFunction") return graphValue(element);
    return undefined;
  };

  const target = (el: Flow | Converter): number => {
    const ast = parse(el.equation);
    const state: StateStore = new Map();
    const ctx: EvalContext = {
      resolve: (name) => {
        const v = value(name);
        if (v === undefined) throw new Error(`unresolved identifier '${name}'`);
        return v;
      },
      fn: (name, args, site) => {
        if (lookupBuiltin(name)) {
          return evaluateBuiltin(
            { time, dt: model.run.dt, state, seed: 0, start: model.run.start },
            name.toUpperCase(),
            args,
            `${el.id}:${site}`,
          );
        }
        const element = idx.byCanonical.get(canonicalName(name));
        if (element?.kind === "graphFunction") {
          if (args.length !== 1) {
            throw new Error(`graphical function '${name}' expects 1 argument`);
          }
          return interpolate(element, args[0]);
        }
        throw new Error(`unknown function '${name}'`);
      },
    };
    return evaluate(ast, ctx);
  };

  return { value, target };
}

type Probe = "+" | "-" | "?" | "zero";

/** Nudge one source and report how the target equation responds. */
function probe(
  model: Model,
  idx: ElementIndex,
  values: Values,
  time: number,
  link: Link,
): Probe {
  const el = idx.byCanonical.get(canonicalName(link.to));
  if (!el || (el.kind !== "flow" && el.kind !== "converter")) return "?";

  const base = makeResolvers(model, idx, values, time);
  const source = base.value(link.from);
  if (source === undefined || !Number.isFinite(source)) return "?";

  try {
    const before = base.target(el);
    if (!Number.isFinite(before)) return "?";

    // Small relative nudge; an absolute floor lets links from zero-valued
    // sources still be tested at t0.
    const h = Math.max(Math.abs(source) * 1e-4, 1e-6);
    const nudged = makeResolvers(model, idx, values, time, {
      canonical: canonicalName(link.from),
      value: source + h,
    });
    const after = nudged.target(el);
    if (!Number.isFinite(after)) return "?";

    const delta = after - before;
    const tol = 1e-9 * Math.max(1, Math.abs(before), Math.abs(after));
    if (Math.abs(delta) <= tol) return "zero";
    return delta > 0 ? "+" : "-";
  } catch {
    return "?";
  }
}

/** Polarity of information links by numeric perturbation: simulate() the
 * model once to get values at the start time, then for each link evaluate the
 * target's equation with the source nudged up by a small relative amount and
 * compare. If evaluation fails or the change is zero at t0, a second point
 * mid-run is tried; otherwise the sign is "?". */
export function linkPolarities(model: Model): Link[] {
  const links = causalLinks(model);
  const idx = buildIndex(model);

  let result: SimulationResult;
  try {
    result = simulate(model);
  } catch {
    return links;
  }
  if (result.time.length === 0) return links;

  const rows = [0, Math.floor((result.time.length - 1) / 2)];

  const valuesAt = (row: number): Values => {
    const values: Values = new Map();
    for (const [name, series] of Object.entries(result.series)) {
      const v = series[row];
      if (Number.isFinite(v)) values.set(canonicalName(name), v);
    }
    return values;
  };

  return links.map((link) => {
    if (link.kind !== "information") return link;
    for (const row of rows) {
      const polarity = probe(model, idx, valuesAt(row), result.time[row], link);
      if (polarity === "+" || polarity === "-") return { ...link, polarity };
    }
    return { ...link, polarity: "?" };
  });
}
