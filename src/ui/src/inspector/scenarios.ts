/**
 * SourceSink — pure helpers for the scenarios panel.
 *
 * Scenarios live in `model.scenarios`; these functions generate stable unique
 * ids/names and convert between the IR's override record and the panel's
 * editable rows. Values that parse as finite numbers are kept as numbers so
 * `applyScenario` treats them as constants; everything else is an equation.
 */

import type { Scenario } from "@sourcesink/model";

/** One editable override row: an element name and its text value. */
export interface OverrideRow {
  name: string;
  value: string;
}

/** A numeric-looking value stays a number; other text is kept as an equation. */
export function parseOverrideValue(text: string): string | number {
  const s = text.trim();
  if (s === "") return "";
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}

/** The override record as rows, preserving entry order. */
export function overridesToRows(overrides: Record<string, string | number>): OverrideRow[] {
  return Object.entries(overrides).map(([name, value]) => ({ name, value: String(value) }));
}

/** Rows back to an override record; blank names are dropped, later rows win. */
export function rowsToOverrides(rows: readonly OverrideRow[]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name) out[name] = parseOverrideValue(row.value);
  }
  return out;
}

/** A URL-ish id derived from a scenario name, unique among existing ids. */
export function uniqueScenarioId(scenarios: readonly Scenario[], name: string): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "scenario";
  const taken = new Set(scenarios.map((s) => s.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const id = `${base}-${i}`;
    if (!taken.has(id)) return id;
  }
}

/** A scenario name that no existing scenario uses (case-insensitive). */
export function uniqueScenarioName(scenarios: readonly Scenario[], base = "Scenario"): string {
  const root = base.trim() || "Scenario";
  const taken = new Set(scenarios.map((s) => s.name.trim().toLowerCase()));
  if (!taken.has(root.toLowerCase())) return root;
  for (let i = 2; ; i += 1) {
    const name = `${root} ${i}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}
