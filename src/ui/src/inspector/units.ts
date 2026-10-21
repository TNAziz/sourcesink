/**
 * Inspector helpers: unit warnings for one element.
 *
 * `checkUnits` walks the whole model, which is cheap but not free. The editor
 * replaces the model object on every edit, so a WeakMap memo is both correct
 * and naturally garbage-collected.
 */

import { canonicalName } from "@sourcesink/engine";
import type { Model } from "@sourcesink/model";
import { checkUnits, type UnitFinding } from "@sourcesink/units";

const cache = new WeakMap<Model, UnitFinding[]>();

/** All unit findings for a model, cached for its lifetime. */
export function modelUnitFindings(model: Model): UnitFinding[] {
  const cached = cache.get(model);
  if (cached !== undefined) return cached;
  const findings = checkUnits(model);
  cache.set(model, findings);
  return findings;
}

/** Messages for the named element's findings. */
export function unitWarningsFor(model: Model, element: string): string[] {
  const key = canonicalName(element);
  return modelUnitFindings(model)
    .filter((finding) => canonicalName(finding.element) === key)
    .map((finding) => finding.message);
}
