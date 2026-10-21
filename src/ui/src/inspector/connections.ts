/**
 * SourceSink — pure "input wiring" analysis for the inspector.
 *
 * A stock/flow/converter equation reads other elements by name. The diagram
 * expresses that relationship as a connector *into* the element, so the
 * inspector can tell the modeler when an equation uses a name that has no
 * incoming link, and when a link into the element is dead weight.
 *
 * Names may be written with spaces or underscores interchangeably
 * (`Birth Rate` / `Birth_Rate`), so every comparison normalises to the
 * lowercase underscore form. Built-ins, the run clock and constants are not
 * model elements and never need a connector.
 */

import {
  BUILTINS,
  CLOCK_VARIABLES,
  CONSTANTS,
  ParseError,
  collectReferences,
  parse,
} from "@sourcesink/engine";
import type { Model } from "@sourcesink/model";

/** A name used by an equation but not wired in by a connector. */
export interface MissingLink {
  /** id of the element that should feed this one. */
  fromId: string;
  /** That element's display name. */
  fromName: string;
  /** The reference as written in the equation. */
  refName: string;
}

/** A connector into this element whose source the equation never reads. */
export interface UnusedLink {
  connectorId: string;
  fromName: string;
}

export interface ConnectionAnalysis {
  missing: MissingLink[];
  unused: UnusedLink[];
}

const normalize = (name: string): string =>
  name.trim().toLowerCase().replace(/\s+/g, "_");

const NON_MODEL_NAMES = new Set<string>([
  ...BUILTINS.map((b) => b.name.toUpperCase()),
  ...CLOCK_VARIABLES.map((v) => v.toUpperCase()),
  ...CONSTANTS.map((c) => c.toUpperCase()),
  "IF",
  "THEN",
  "ELSE",
  "AND",
  "OR",
  "NOT",
]);

/**
 * Analyse the wiring around `elementId`: which referenced elements lack a
 * connector into it, and which incoming connectors are never referenced.
 * Returns empty lists when the element is unknown or its equation is
 * unparseable (there is nothing trustworthy to report).
 */
export function analyzeConnections(model: Model, elementId: string): ConnectionAnalysis {
  const element =
    model.stocks.find((e) => e.id === elementId) ??
    model.flows.find((e) => e.id === elementId) ??
    model.converters.find((e) => e.id === elementId);
  if (!element) return { missing: [], unused: [] };

  const elements = [
    ...model.stocks,
    ...model.flows,
    ...model.converters,
    ...model.graphFunctions,
  ];
  const byNormalizedName = new Map(elements.map((e) => [normalize(e.name), e] as const));

  const referenced = new Map<string, MissingLink>();
  try {
    for (const ref of collectReferences(parse(element.equation))) {
      if (NON_MODEL_NAMES.has(ref.name.toUpperCase())) continue;
      const target = byNormalizedName.get(normalize(ref.name));
      if (!target || target.id === element.id) continue;
      const key = normalize(target.name);
      if (!referenced.has(key)) {
        referenced.set(key, {
          fromId: target.id,
          fromName: target.name,
          refName: ref.name,
        });
      }
    }
  } catch (e) {
    if (e instanceof ParseError) return { missing: [], unused: [] };
    throw e;
  }

  const elementKey = normalize(element.name);
  const incoming = model.connectors.filter((c) => normalize(c.to) === elementKey);
  const connected = new Set(incoming.map((c) => normalize(c.from)));

  const missing: MissingLink[] = [];
  for (const [key, link] of referenced) {
    if (connected.has(key)) continue;
    missing.push(link);
  }
  missing.sort((a, b) => a.fromName.toLowerCase().localeCompare(b.fromName.toLowerCase()));

  const unused: UnusedLink[] = [];
  for (const c of incoming) {
    if (referenced.has(normalize(c.from))) continue;
    unused.push({ connectorId: c.id, fromName: c.from });
  }

  return { missing, unused };
}
