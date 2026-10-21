/**
 * Arrays (subscripts), compiled to scalars.
 *
 * An arrayed element `Prey` over dimensions Region × Type becomes one scalar
 * element per combination of labels, named `Prey[North,Deer]`. Before
 * simulation the whole model is rewritten that way, so every engine feature
 * (conveyors, ovens, RK, …) works on arrays unchanged.
 *
 * Equations are rewritten per element:
 *  - a dimension name used as a subscript stands for the current element:
 *    `Population[Region] * r` in element `[North]` reads `Population[North]`;
 *  - a bare reference to an arrayed variable inside an arrayed equation means
 *    the matching element (same labels on shared dimensions);
 *  - `*` selects every element along a dimension, for the aggregate functions
 *    SUM, MEAN, STDDEV, MIN, MAX (and the ARRAYSUM, ARRAYMEAN,
 *    ARRAYSTDDEV, ARRAYMIN, ARRAYMAX).
 */

import type { Connector, Model, Stock } from "@sourcesink/model";

import { canonicalName } from "./order.js";

export class ArrayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArrayError";
  }
}

const AGGREGATE_ALIASES: Record<string, string> = {
  ARRAYSUM: "SUM",
  ARRAYMEAN: "MEAN",
  ARRAYSTDDEV: "STDDEV",
  ARRAYMIN: "MIN",
  ARRAYMAX: "MAX",
};

/** Name of one element of an array. */
export const elementName = (base: string, labels: string[]) => `${base}[${labels.join(",")}]`;

/** Every combination of labels over `dims`, in row-major order. */
function combinations(dims: string[][]): string[][] {
  return dims.reduce<string[][]>((acc, labels) => acc.flatMap((c) => labels.map((l) => [...c, l])), [[]]);
}

const quote = (name: string) => `"${name}"`;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A name as a regex, with spaces and underscores interchangeable. */
const namePattern = (name: string) =>
  name
    .trim()
    .split(/[\s_]+/)
    .map(escapeRe)
    .join("[ _]+");

/** True when the model uses arrays and must be compiled before simulating. */
export function hasArrays(model: Model): boolean {
  return Object.values(model.arrayed ?? {}).some((a) => a.dimensions.length > 0);
}

/** Rewrite an arrayed model as an equivalent model of scalar elements. */
export function expandArrays(model: Model): Model {
  const dimLabels = new Map<string, string[]>();
  const dimName = new Map<string, string>();
  for (const d of model.dimensions) {
    dimLabels.set(canonicalName(d.name), d.values);
    dimName.set(canonicalName(d.name), d.name);
  }

  // arrayed element (canonical base name) -> its dimensions (canonical)
  const arrayedDims = new Map<string, string[]>();
  const baseName = new Map<string, string>();
  for (const [name, spec] of Object.entries(model.arrayed ?? {})) {
    if (!spec.dimensions.length) continue;
    const dims = spec.dimensions.map((d) => {
      const key = canonicalName(d);
      if (!dimLabels.has(key)) throw new ArrayError(`'${name}' uses unknown dimension '${d}'`);
      return key;
    });
    arrayedDims.set(canonicalName(name), dims);
    baseName.set(canonicalName(name), name);
  }
  if (model.graphFunctions.some((g) => arrayedDims.has(canonicalName(g.name)))) {
    throw new ArrayError("arrayed graph functions are not supported yet");
  }

  /** Elements of `base` consistent with a partial label mapping (dims not in
   * the mapping range over all their labels). */
  const matching = (base: string, mapping: Map<string, string>): string[] => {
    const dims = arrayedDims.get(canonicalName(base))!;
    const choices = dims.map((d) => (mapping.has(d) ? [mapping.get(d)!] : dimLabels.get(d)!));
    return combinations(choices).map((labels) => elementName(baseName.get(canonicalName(base))!, labels));
  };

  // Longest arrayed names first, so `birth rate` wins over `rate`.
  const arrayedNames = [...baseName.values()].sort((a, b) => b.length - a.length);

  /** The equation of one element, rewritten for its labels. `scope` maps the
   * current element's dimensions to its labels (empty for scalars). */
  const rewrite = (equation: string, scope: Map<string, string>, owner: string): string => {
    let eq = equation.replace(/\b(ARRAYSUM|ARRAYMEAN|ARRAYSTDDEV|ARRAYMIN|ARRAYMAX)\s*\(/gi, (_, f: string) => `${AGGREGATE_ALIASES[f.toUpperCase()]}(`);

    // Subscripted references: NAME[ ... ] or "NAME"[ ... ].
    for (const name of arrayedNames) {
      const dims = arrayedDims.get(canonicalName(name))!;
      const re = new RegExp(`(?<![A-Za-z0-9_"])(?:"${escapeRe(name)}"|${namePattern(name)})\\s*\\[([^\\]]*)\\]`, "gi");
      eq = eq.replace(re, (_, inner: string) => {
        const items = inner.split(",").map((s) => s.trim());
        if (items.length !== dims.length) {
          throw new ArrayError(`'${owner}': ${name} has ${dims.length} dimension(s) but is subscripted with ${items.length}`);
        }
        const mapping = new Map<string, string>();
        items.forEach((item, i) => {
          if (item === "*") return;
          const asDim = canonicalName(item.replace(/^.*\./, ""));
          const label = item.includes(".") ? item.slice(item.indexOf(".") + 1) : item;
          if (dimLabels.has(canonicalName(item))) {
            const current = scope.get(canonicalName(item));
            if (current === undefined) throw new ArrayError(`'${owner}': dimension '${item}' is not one of its own dimensions`);
            mapping.set(dims[i], current);
          } else {
            const labels = dimLabels.get(dims[i])!;
            const hit = labels.find((l) => canonicalName(l) === canonicalName(label)) ?? labels.find((l) => canonicalName(l) === asDim);
            if (!hit) throw new ArrayError(`'${owner}': '${item}' is not a label of ${dimName.get(dims[i])}`);
            mapping.set(dims[i], hit);
          }
        });
        return matching(name, mapping).map(quote).join(", ");
      });
    }

    // Bare references to arrayed variables: the element with the same labels.
    for (const name of arrayedNames) {
      const dims = arrayedDims.get(canonicalName(name))!;
      const re = new RegExp(`(?<![A-Za-z0-9_"\\[])(?:"${escapeRe(name)}"|${namePattern(name)})(?![A-Za-z0-9_"\\[])`, "gi");
      eq = eq.replace(re, () => {
        const missing = dims.filter((d) => !scope.has(d));
        if (missing.length) {
          throw new ArrayError(`'${owner}': ${name} needs subscripts (e.g. ${name}[${dims.map((d) => dimName.get(d)).join(",")}])`);
        }
        return quote(matching(name, scope)[0]);
      });
    }
    return eq;
  };

  /** Expand one element (or rewrite a scalar's equation). */
  const expand = <T extends { name: string; id: string; equation: string }>(e: T, extra: (copy: T, scope: Map<string, string>) => void = () => {}): T[] => {
    const dims = arrayedDims.get(canonicalName(e.name));
    if (!dims) {
      const copy = { ...e, equation: rewrite(e.equation, new Map(), e.name) };
      extra(copy, new Map());
      return [copy];
    }
    const spec = model.arrayed[e.name] ?? model.arrayed[baseName.get(canonicalName(e.name))!];
    return combinations(dims.map((d) => dimLabels.get(d)!)).map((labels) => {
      const scope = new Map(dims.map((d, i) => [d, labels[i]]));
      const name = elementName(e.name, labels);
      const own = spec?.elements?.[labels.join(",")];
      const copy = { ...e, id: name, name, equation: rewrite(own ?? e.equation, scope, name) };
      extra(copy, scope);
      return copy;
    });
  };

  /** Flow references of a stock element: arrayed flows map by shared labels
   * (and sum over dimensions the stock does not have). */
  const flowRefs = (refs: string[] | undefined, scope: Map<string, string>, owner: string): string[] | undefined => {
    if (!refs) return refs;
    return refs.flatMap((ref) => {
      const flow = model.flows.find((f) => f.id === ref || canonicalName(f.name) === canonicalName(ref));
      const name = flow?.name ?? ref;
      if (!arrayedDims.has(canonicalName(name))) {
        if (scope.size) throw new ArrayError(`'${owner}': arrayed stock is wired to scalar flow '${name}'`);
        return [name];
      }
      return matching(name, scope);
    });
  };

  const stocks = model.stocks.flatMap((s) =>
    expand(s, (copy: Stock, scope) => {
      copy.inflows = flowRefs(s.inflows, scope, copy.name);
      copy.outflows = flowRefs(s.outflows, scope, copy.name);
      if (s.conveyor) copy.conveyor = { transitTime: rewrite(s.conveyor.transitTime, scope, copy.name) };
      if (s.oven) {
        copy.oven = { capacity: rewrite(s.oven.capacity, scope, copy.name), fillTime: rewrite(s.oven.fillTime, scope, copy.name) };
      }
    }),
  );

  const connectors: Connector[] = [];
  const seen = new Set<string>();
  for (const c of model.connectors) {
    const fromArr = arrayedDims.has(canonicalName(c.from));
    const toDims = arrayedDims.get(canonicalName(c.to));
    const targets = toDims
      ? combinations(toDims.map((d) => dimLabels.get(d)!)).map((labels) => ({
          name: elementName(baseName.get(canonicalName(c.to))!, labels),
          scope: new Map(toDims.map((d, i) => [d, labels[i]])),
        }))
      : [{ name: c.to, scope: new Map<string, string>() }];
    for (const t of targets) {
      const sources = fromArr ? matching(c.from, t.scope) : [c.from];
      for (const from of sources) {
        const key = `${from}\u0000${t.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        connectors.push({ kind: "connector", id: `${from}->${t.name}`, name: `${from} -> ${t.name}`, from, to: t.name });
      }
    }
  }

  return {
    ...model,
    stocks,
    flows: model.flows.flatMap((f) => expand(f)),
    converters: model.converters.flatMap((c) => expand(c)),
    connectors,
    dimensions: [],
    arrayed: {},
    layout: undefined,
  };
}
