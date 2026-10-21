/**
 * Regroup a flattened legacy import into native arrays.
 *
 * The importer first brings every array element in as its own variable
 * (`Prey[South,Hares]`, with its resolved equation and wiring). This pass
 * turns groups of such elements back into one arrayed variable over named
 * dimensions, keeping each element's own equation as a per-element
 * equation, so the engine — which compiles arrays to exactly these element
 * names — reproduces the flattened model's results.
 *
 * A group is converted only when it is made of plain stocks, flows or
 * converters (no graph functions, conveyors, queues, ovens, leaks or computed
 * outflows) and its stock/flow wiring pairs elements with identical labels;
 * anything else stays flattened.
 */

import type { Connector, Converter, Dimension, Flow, Model, Point, Stock } from "@sourcesink/model";

export interface ArrayParent {
  /** The parent record's own (generic) equation, already cleaned; may be "". */
  equation: string;
  documentation?: string;
  position?: Point;
}

type Plain = Stock | Flow | Converter;

const base = (n: string) => (n.includes("[") ? n.slice(0, n.indexOf("[")) : undefined);
const labelsOf = (n: string) => n.slice(n.indexOf("[") + 1, -1).split(",").map((s) => s.trim());

/**
 * Convert element groups to arrays. `parents` describes each array's parent
 * record; `equations` are all raw equations in the file (used to recover
 * dimension names such as `Prey[Geography,Prey_Type]`). Returns the new
 * model and the names of arrays that were left flattened.
 */
export function nativeArrays(
  model: Model,
  parents: Map<string, ArrayParent>,
  equations: string[],
): { model: Model; converted: string[]; flattened: string[] } {
  const all: Plain[] = [...model.stocks, ...model.flows, ...model.converters];
  const groups = new Map<string, Plain[]>();
  for (const e of all) {
    const b = base(e.name);
    if (b && parents.has(b)) groups.set(b, [...(groups.get(b) ?? []), e]);
  }
  const graphNames = new Set(model.graphFunctions.map((g) => base(g.name) ?? g.name));

  // --- which groups can become arrays -------------------------------------
  const ok = new Set<string>();
  for (const [b, els] of groups) {
    const sizes = new Set(els.map((e) => labelsOf(e.name).length));
    const plain = els.every((e) => {
      if (e.kind !== els[0].kind) return false;
      if (e.kind === "stock") return !e.conveyor && !e.queue && !e.oven;
      if (e.kind === "flow") return !e.leak && e.equation !== "";
      return true;
    });
    if (plain && sizes.size === 1 && !graphNames.has(b)) ok.add(b);
  }
  // Stock/flow wiring must pair elements with the same labels, and both
  // sides must be converted (or neither); iterate until stable.
  const groupOf = (n: string) => {
    const b = base(n);
    return b && groups.has(b) ? b : undefined;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const s of model.stocks) {
      const sb = groupOf(s.name);
      for (const f of [...(s.inflows ?? []), ...(s.outflows ?? [])]) {
        const fb = groupOf(f);
        if (!(sb && ok.has(sb)) && !(fb && ok.has(fb))) continue;
        const valid = sb && fb && ok.has(sb) && ok.has(fb) && labelsOf(s.name).join() === labelsOf(f).join();
        if (valid) continue;
        for (const g of [sb, fb]) if (g && ok.delete(g)) changed = true;
      }
    }
  }

  // --- dimensions -----------------------------------------------------------
  // A dimension is identified by its label set; its name comes from a
  // subscript in the file's equations that is not one of its labels.
  const dims: Dimension[] = [];
  const dimFor = (labels: string[], hint?: string): string => {
    const key = [...labels].sort().join("\u0000");
    const found = dims.find((d) => [...d.values].sort().join("\u0000") === key);
    if (found) return found.name;
    let name = hint && !dims.some((d) => d.name === hint) ? hint : `Dim${dims.length + 1}`;
    while (model.dimensions.some((d) => d.name === name)) name = `${name}_`;
    dims.push({ kind: "dimension", id: name, name, values: labels });
    return name;
  };
  const hintsFor = (b: string, labelSets: string[][]): (string | undefined)[] => {
    const re = new RegExp(`(?<![A-Za-z0-9_])${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\[([^\\]]*)\\]`, "g");
    const hints: (string | undefined)[] = labelSets.map(() => undefined);
    for (const eq of equations) {
      for (const m of eq.matchAll(re)) {
        m[1].split(",").map((s) => s.trim()).forEach((tok, i) => {
          if (i < hints.length && !hints[i] && tok !== "*" && !labelSets[i].includes(tok) && /^[A-Za-z_]\w*$/.test(tok)) hints[i] = tok;
        });
      }
    }
    return hints;
  };

  const out: Model = { ...model, stocks: [], flows: [], converters: [], connectors: [], dimensions: [...model.dimensions], arrayed: { ...model.arrayed } };
  const layout = { ...(model.layout ?? {}) };
  const parentOfElement = new Map<string, string>();

  for (const b of [...ok].sort()) {
    const els = groups.get(b)!;
    const n = labelsOf(els[0].name).length;
    const labelSets = Array.from({ length: n }, (_, i) => [...new Set(els.map((e) => labelsOf(e.name)[i]))]);
    const hints = hintsFor(b, labelSets);
    const dimensions = labelSets.map((ls, i) => dimFor(ls, hints[i]));
    const elements: Record<string, string> = {};
    for (const e of els) {
      elements[labelsOf(e.name).join(",")] = e.equation;
      parentOfElement.set(e.name, b);
      delete layout[e.name];
    }
    out.arrayed[b] = { dimensions, elements };
    const p = parents.get(b)!;
    if (p.position) layout[b] = p.position;
    const first = els[0];
    const shared = {
      id: b,
      name: b,
      equation: p.equation,
      ...(p.documentation ? { documentation: p.documentation } : {}),
      ...(first.units ? { units: first.units } : {}),
      ...(first.provenance ? { provenance: first.provenance } : {}),
    };
    if (first.kind === "stock") {
      const parentFlows = (list: (s: Stock) => string[] | undefined) => [
        ...new Set((els as Stock[]).flatMap((s) => (list(s) ?? []).map((f) => base(f) ?? f))),
      ];
      const inflows = parentFlows((s) => s.inflows);
      const outflows = parentFlows((s) => s.outflows);
      out.stocks.push({
        kind: "stock",
        ...shared,
        ...(first.nonNegative ? { nonNegative: true } : {}),
        ...(inflows.length ? { inflows } : {}),
        ...(outflows.length ? { outflows } : {}),
      });
    } else if (first.kind === "flow") {
      out.flows.push({ kind: "flow", ...shared, ...(first.biflow ? { biflow: true } : {}), ...(first.nonNegative ? { nonNegative: true } : {}) });
    } else {
      out.converters.push({ kind: "converter", ...shared });
    }
  }

  // Everything not converted stays as it was (scalars and flattened arrays).
  const keep = (e: Plain) => !parentOfElement.has(e.name);
  out.stocks.push(...model.stocks.filter(keep));
  out.flows.push(...model.flows.filter(keep));
  out.converters.push(...model.converters.filter(keep));
  const order = new Map(all.map((e, i) => [base(e.name) && parentOfElement.has(e.name) ? base(e.name)! : e.name, i]));
  const byOrder = (a: Plain, c: Plain) => (order.get(a.name) ?? 0) - (order.get(c.name) ?? 0);
  out.stocks.sort(byOrder);
  out.flows.sort(byOrder);
  out.converters.sort(byOrder);

  // Connectors into converted arrays become array-level links. A link into
  // anything else keeps its element-level source: element names still exist
  // after the engine expands the arrays, and e.g. each flattened graph
  // function must keep reading its own element.
  const seen = new Set<string>();
  for (const c of model.connectors) {
    const intoArray = parentOfElement.has(c.to);
    const from = intoArray ? (parentOfElement.get(c.from) ?? c.from) : c.from;
    const to = parentOfElement.get(c.to) ?? c.to;
    const key = `${from}\u0000${to}`;
    if (from === to || seen.has(key)) continue;
    seen.add(key);
    out.connectors.push(from === c.from && to === c.to ? c : ({ ...c, id: `${from}->${to}`, name: `${from} -> ${to}`, from, to } as Connector));
  }

  out.dimensions.push(...dims);
  if (Object.keys(layout).length) out.layout = layout;
  const flattened = [...groups.keys()].filter((b) => !ok.has(b)).sort();
  return { model: out, converted: [...ok].sort(), flattened };
}
