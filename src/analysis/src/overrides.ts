/**
 * SourceSink — model overrides for analysis.
 *
 * An override names an element and replaces its equation: a stock's equation
 * is its initial value, a flow's or converter's is its rate/definition. Values
 * are matched by canonical name (case-insensitive, spaces ≡ underscores) and
 * applied to a deep copy, so a base model can be reused for many runs.
 */

import { canonicalName } from "@sourcesink/engine";
import type { Model, RunSpec, Scenario } from "@sourcesink/model";

/** Element name -> new equation (string) or constant (number). */
export type Overrides = Record<string, string | number>;

type OverrideKind = "stock" | "flow" | "converter";

/** Deep copy of the plain IR graph (models contain only JSON-like values). */
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) out[key] = clone(v);
    return out as T;
  }
  return value;
}

const toEquation = (value: string | number): string => (typeof value === "string" ? value : String(value));

/** Apply overrides (and optional run-spec changes) to a copy of a model.
 * Names match case-insensitively with spaces ≡ underscores (use
 * `canonicalName` from @sourcesink/engine). Unknown names throw. A number
 * becomes its decimal string as the equation. Stocks: the equation is the
 * initial value. Graph functions cannot be overridden (throw). A key
 * `name[labels]` overrides one element of an arrayed element. */
export function applyOverrides(model: Model, overrides: Overrides, run?: Partial<RunSpec>): Model {
  const m = clone(model);

  const targets = new Map<string, { kind: OverrideKind; set: (equation: string) => void }>();
  const add = (name: string, kind: OverrideKind, set: (equation: string) => void): void => {
    targets.set(canonicalName(name), { kind, set });
  };
  for (const s of m.stocks) add(s.name, "stock", (eq) => (s.equation = eq));
  for (const f of m.flows) add(f.name, "flow", (eq) => (f.equation = eq));
  for (const c of m.converters) add(c.name, "converter", (eq) => (c.equation = eq));

  const graphs = new Set(m.graphFunctions.map((g) => canonicalName(g.name)));
  const known = new Set(
    [...m.connectors, ...m.dimensions, ...m.graphFunctions].map((e) => canonicalName(e.name)),
  );

  for (const [name, value] of Object.entries(overrides)) {
    const key = canonicalName(name);
    const target = targets.get(key);
    const indexed = /^(.+?)\s*\[([^\]]*)\]\s*$/.exec(name);
    if (!target && indexed) {
      setArrayElement(m, indexed[1], indexed[2], toEquation(value));
    } else if (target) {
      target.set(toEquation(value));
    } else if (graphs.has(key)) {
      throw new Error(`cannot override graph function '${name}'`);
    } else if (known.has(key)) {
      throw new Error(`cannot override element '${name}' (only stocks, flows and converters)`);
    } else {
      throw new Error(`unknown element '${name}'`);
    }
  }

  if (run) m.run = { ...m.run, ...run };
  return m;
}

/** Override one element of an arrayed element: `name[labels]` sets that
 * element's own equation (labels matched like names). */
function setArrayElement(m: Model, name: string, inner: string, equation: string): void {
  const specName = Object.keys(m.arrayed ?? {}).find((k) => canonicalName(k) === canonicalName(name));
  const spec = specName ? m.arrayed[specName] : undefined;
  if (!spec || spec.dimensions.length === 0) throw new Error(`'${name}' is not arrayed`);
  const items = inner.split(",").map((s) => s.trim());
  if (items.length !== spec.dimensions.length) {
    throw new Error(`'${name}' has ${spec.dimensions.length} dimension(s) but the override gives ${items.length}`);
  }
  const labels = items.map((item, i) => {
    const dim = m.dimensions.find((d) => canonicalName(d.name) === canonicalName(spec.dimensions[i]));
    const hit = dim?.values.find((v) => canonicalName(v) === canonicalName(item));
    if (!hit) throw new Error(`'${item}' is not a label of ${spec.dimensions[i]}`);
    return hit;
  });
  spec.elements = { ...(spec.elements ?? {}), [labels.join(",")]: equation };
}

/** Apply a Scenario from the IR (`model.scenarios`). */
export function applyScenario(model: Model, scenario: Scenario): Model {
  return applyOverrides(model, scenario.overrides, scenario.run);
}
