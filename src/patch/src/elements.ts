/**
 * Internal helpers shared by the patch, gauntlet and diff modules.
 */

import type {
  Converter,
  Flow,
  GraphFunction,
  Model,
  Stock,
} from "@sourcesink/model";
import { canonicalName } from "@sourcesink/engine";

/** The four element kinds a patch may address by name. */
export type Patchable = Stock | Flow | Converter | GraphFunction;

/** Identifier canonical form (case-insensitive, spaces ≡ underscores). */
export { canonicalName };

/** Every element a patch can name, in a stable kind order. */
export function patchableElements(m: Model): Patchable[] {
  return [...m.stocks, ...m.flows, ...m.converters, ...m.graphFunctions];
}

export function elementByName(m: Model, name: string): Patchable | undefined {
  const key = canonicalName(name);
  return patchableElements(m).find((e) => canonicalName(e.name) === key);
}

export function stockByName(m: Model, name: string): Stock | undefined {
  const key = canonicalName(name);
  return m.stocks.find((s) => canonicalName(s.name) === key);
}

/** Model names a user may write unquoted in an equation: letters, digits,
 * underscores and single spaces, starting with a letter or underscore. */
export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_ ]*$/;

/** Validate a user-visible name. Names outside the bare identifier grammar
 * are allowed (they are quoted when written into equations), but a double
 * quote would make that impossible, so it is rejected here. */
export function normalizeNewName(name: unknown, what = "name"): string {
  if (typeof name !== "string") throw new Error(`${what} must be a string`);
  const trimmed = name.trim();
  if (!trimmed) throw new Error(`${what} must not be empty`);
  if (/[\r\n\t"]/.test(trimmed)) {
    throw new Error(`${what} '${trimmed}' contains a character that cannot appear in a model name`);
  }
  return trimmed;
}

/** How a name is written into an equation: bare when it fits the identifier
 * grammar, double-quoted otherwise. */
export function referenceToken(name: string): string {
  return NAME_RE.test(name) ? name.replace(/ /g, "_") : `"${name}"`;
}

/** Pick a document-unique element id, deterministic for a given model. */
export function nextElementId(m: Model, kind: string, name: string): string {
  const taken = new Set<string>([
    ...patchableElements(m).map((e) => e.id),
    ...m.connectors.map((c) => c.id),
  ]);
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const base = `${kind}-${slug || "element"}`;
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const id = `${base}-${i}`;
    if (!taken.has(id)) return id;
  }
}

export function nextConnectorId(m: Model, from: string, to: string): string {
  const taken = new Set<string>([
    ...patchableElements(m).map((e) => e.id),
    ...m.connectors.map((c) => c.id),
  ]);
  const base = `${from}->${to}`;
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const id = `${base}-${i}`;
    if (!taken.has(id)) return id;
  }
}

/** Split a conveyor's initial-value list at top-level commas. The engine
 * treats a single value as a single initial amount and a list as one value
 * per time unit. */
export function topLevelList(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === "," && depth === 0) {
      parts.push(source.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(source.slice(from));
  return parts;
}

/**
 * Flow ids whose value the engine computes (conveyor exits and queue
 * outflows). Their equations are unused, so parse/reference checks skip them.
 */
export function computedFlowIds(m: Model): Set<string> {
  const out = new Set<string>();
  for (const s of m.stocks) {
    if (s.queue) {
      for (const ref of s.outflows ?? []) {
        const f = resolveFlowRef(m, ref);
        if (f) out.add(f.id);
      }
    }
    if (s.conveyor) {
      for (const ref of s.outflows ?? []) {
        const f = resolveFlowRef(m, ref);
        if (f && !f.leak) out.add(f.id);
      }
    }
  }
  return out;
}

/** Resolve a stock wiring entry (flow id or flow name) to a flow. */
export function resolveFlowRef(m: Model, ref: string): Flow | undefined {
  const byId = m.flows.find((f) => f.id === ref);
  if (byId) return byId;
  const key = canonicalName(ref);
  return m.flows.find((f) => canonicalName(f.name) === key);
}

/** One equation-like string in a model, with where it lives. */
export interface EquationUnit {
  element: string;
  field: string;
  text: string;
}

/** Every equation the engine actually parses, including conveyor transit
 * times, oven parameters and conveyor initial-value lists. */
export function equationUnits(m: Model): EquationUnit[] {
  const units: EquationUnit[] = [];
  const computed = computedFlowIds(m);
  for (const s of m.stocks) {
    const parts = s.conveyor ? topLevelList(s.equation) : [s.equation];
    parts.forEach((text, i) => {
      units.push({ element: s.name, field: parts.length > 1 ? `equation[${i}]` : "equation", text });
    });
    if (s.conveyor) units.push({ element: s.name, field: "conveyor.transitTime", text: s.conveyor.transitTime });
    if (s.oven) {
      units.push({ element: s.name, field: "oven.capacity", text: s.oven.capacity });
      units.push({ element: s.name, field: "oven.fillTime", text: s.oven.fillTime });
    }
  }
  for (const f of m.flows) {
    if (!computed.has(f.id)) units.push({ element: f.name, field: "equation", text: f.equation });
  }
  for (const c of m.converters) units.push({ element: c.name, field: "equation", text: c.equation });
  return units;
}

/** Rewrite whole-word, case-insensitive references to `from` with `to`.
 * Handles both bare and double-quoted occurrences and the spaces ↔
 * underscores spelling variants the engine treats as the same name. */
export function replaceReference(equation: string, from: string, to: string): string {
  const replacement = referenceToken(to);
  const forms = [from, from.replace(/ /g, "_"), from.replace(/_/g, " ")].filter(
    (form, i, all) => form && all.indexOf(form) === i,
  );
  let out = equation;
  for (const form of forms) {
    const esc = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A name may contain single spaces, so a boundary is a non-identifier
    // character *not* followed by a word (otherwise "Population" would match
    // inside "Population Data").
    const before = "(?<![A-Za-z0-9_] )(?<![A-Za-z0-9_])";
    const after = "(?![A-Za-z0-9_])(?! [A-Za-z0-9_])";
    const re = new RegExp(`"${esc}"|${before}${esc}${after}`, "gi");
    out = out.replace(re, () => replacement);
  }
  return out;
}
