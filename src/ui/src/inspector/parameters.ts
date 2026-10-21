/**
 * SourceSink — constants ("parameters") of a model.
 *
 * A converter whose equation is a plain number is a parameter: it has no
 * inputs and exists to be tuned. Large models carry dozens of them, so the
 * canvas can hide them and the inspector lists them in one table instead.
 */

import type { Converter, Model } from "@sourcesink/model";

/** True when the equation is a single numeric literal ("0.3", "-2", "1e6"). */
export function isConstantEquation(equation: string): boolean {
  const t = equation.trim();
  return t !== "" && Number.isFinite(Number(t));
}

/** Scalar converters with a numeric equation, sorted by name. Arrayed
 * converters are left out: their values live in the array panels. */
export function constantConverters(m: Model): Converter[] {
  return m.converters
    .filter((c) => isConstantEquation(c.equation) && !m.arrayed?.[c.name])
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/** The model without its constants and the connectors that leave them, for
 * drawing only (never saved or simulated). */
export function withoutConstants(m: Model): Model {
  const hidden = new Set(constantConverters(m).map((c) => c.name));
  if (hidden.size === 0) return m;
  return {
    ...m,
    converters: m.converters.filter((c) => !hidden.has(c.name)),
    connectors: m.connectors.filter((c) => !hidden.has(c.from) && !hidden.has(c.to)),
  };
}
