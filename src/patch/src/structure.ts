/**
 * Structural stage of the validation gauntlet.
 *
 * Runs the IR's own `validate` plus the relations the IR cannot know about:
 * connectors must point at something and never into a stock, flow wiring must
 * resolve and each flow may have at most one source and one sink, and every
 * equation must only read names the model or the built-in catalog defines.
 */

import { collectReferences, parse, CLOCK_VARIABLES, CONSTANTS } from "@sourcesink/engine";
import { BUILTIN_FUNCTIONS, validate, type Model } from "@sourcesink/model";

import {
  canonicalName,
  equationUnits,
  patchableElements,
  resolveFlowRef,
} from "./elements.js";
import type { Finding } from "./types.js";

/** Identifiers the engine's resolver understands besides model elements and
 * the documented clock/constant catalog. */
const ENGINE_EXTRA_NAMES = ["RUNCOUNT", "PAUSE", "INF"];

const BUILTIN_NAMES = new Set(BUILTIN_FUNCTIONS.map((f) => f.name.toUpperCase()));
const CLOCK_NAMES = new Set<string>([
  ...CLOCK_VARIABLES,
  ...CONSTANTS,
  ...ENGINE_EXTRA_NAMES,
]);

function error(message: string, element?: string): Finding {
  return { stage: "structure", severity: "error", element, message };
}

function warning(message: string, element?: string): Finding {
  return { stage: "structure", severity: "warning", element, message };
}

/** Every connector, wiring and equation check. */
export function structuralFindings(m: Model): Finding[] {
  const findings: Finding[] = [];
  const elements = patchableElements(m);
  const byKey = new Map(elements.map((e) => [canonicalName(e.name), e]));
  const graphFunctions = new Set(m.graphFunctions.map((g) => canonicalName(g.name)));

  for (const message of validate(m)) findings.push(error(message));

  for (const c of m.connectors) {
    const target = byKey.get(canonicalName(c.to));
    if (target?.kind === "stock") {
      findings.push(
        error(`connector '${c.name}' points into stock '${target.name}'; stocks change only through flows`, target.name),
      );
    }
  }

  // Flow wiring: entries may be flow ids or names, and each flow is material
  // for at most one stock at each end.
  const inflowOwners = new Map<string, string[]>();
  const outflowOwners = new Map<string, string[]>();
  for (const stock of m.stocks) {
    for (const [side, owners] of [
      ["inflows", inflowOwners],
      ["outflows", outflowOwners],
    ] as const) {
      for (const ref of stock[side] ?? []) {
        const flow = resolveFlowRef(m, ref);
        if (!flow) {
          findings.push(error(`stock '${stock.name}' lists unknown ${side} '${ref}'`, stock.name));
          continue;
        }
        const list = owners.get(flow.id) ?? [];
        list.push(stock.name);
        owners.set(flow.id, list);
      }
    }
  }
  for (const [side, owners] of [
    ["inflow", inflowOwners],
    ["outflow", outflowOwners],
  ] as const) {
    for (const flow of m.flows) {
      const stocks = owners.get(flow.id) ?? [];
      if (stocks.length > 1) {
        findings.push(
          error(
            `flow '${flow.name}' is listed as an ${side} by more than one stock (${stocks.join(", ")})`,
            flow.name,
          ),
        );
      }
    }
  }

  // Equation references. Computed conveyor/queue outflows have no equation to
  // read, so `equationUnits` omits them.
  for (const unit of equationUnits(m)) {
    let refs;
    try {
      refs = collectReferences(parse(unit.text));
    } catch {
      continue; // the parse stage reports this first
    }
    for (const ref of refs) {
      if (ref.isFunction) {
        const upper = ref.name.toUpperCase();
        if (!BUILTIN_NAMES.has(upper) && !graphFunctions.has(canonicalName(ref.name))) {
          findings.push(
            error(`${unit.element}.${unit.field} calls unknown function '${ref.name}'`, unit.element),
          );
        }
        continue;
      }
      const known =
        byKey.has(canonicalName(ref.name)) ||
        CLOCK_NAMES.has(ref.name.toUpperCase());
      if (!known) {
        findings.push(
          error(`${unit.element}.${unit.field} references unknown name '${ref.name}'`, unit.element),
        );
      }
    }
  }

  // Warnings: dead converters and isolated stocks are usually authoring slips.
  const referenced = new Set<string>();
  for (const unit of equationUnits(m)) {
    try {
      for (const ref of collectReferences(parse(unit.text))) referenced.add(canonicalName(ref.name));
    } catch {
      // reported by the parse stage
    }
  }
  for (const c of m.connectors) {
    referenced.add(canonicalName(c.from));
    referenced.add(canonicalName(c.to));
  }
  for (const converter of m.converters) {
    if (!referenced.has(canonicalName(converter.name))) {
      findings.push(warning(`converter '${converter.name}' is not used by any equation or connector`, converter.name));
    }
  }
  for (const stock of m.stocks) {
    if ((stock.inflows?.length ?? 0) === 0 && (stock.outflows?.length ?? 0) === 0) {
      findings.push(warning(`stock '${stock.name}' has no flows`, stock.name));
    }
  }

  return findings;
}
