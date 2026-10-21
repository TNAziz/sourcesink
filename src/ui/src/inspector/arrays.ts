/**
 * Pure helpers for editing arrays (dimensions and per-element equations).
 */

import type { Model } from "@sourcesink/model";

/** Parse "North, South ,East" (or one label per line) into trimmed labels,
 * dropping empties and duplicates. */
export function parseLabels(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const label = part.trim();
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/** Problems with a dimension list (names must be identifiers, unique, with
 * at least one label). Returns one message per problem. */
export function dimensionErrors(dims: Array<{ name: string; values: string[] }>): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const d of dims) {
    const name = d.name.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) errors.push(`'${d.name}': use letters, digits and _ only`);
    const key = name.toLowerCase();
    if (seen.has(key)) errors.push(`'${name}' is defined twice`);
    seen.add(key);
    if (d.values.length === 0) errors.push(`'${name}' needs at least one label`);
  }
  return errors;
}

/** Every label combination of an element's dimensions, as comma-joined keys
 * ("North,Old"), in row-major order. */
export function elementKeys(model: Model, dimensions: string[]): string[] {
  const labels = dimensions.map((n) => model.dimensions.find((d) => d.name === n)?.values ?? []);
  return labels
    .reduce<string[][]>((acc, ls) => acc.flatMap((c) => ls.map((l) => [...c, l])), [[]])
    .map((c) => c.join(","));
}

/** Largest number of elements the inspector lists for per-element equations. */
export const MAX_LISTED_ELEMENTS = 60;
