/**
 * Model diffs for review.
 *
 * A patch is only acceptable if a human can see exactly what it changed.
 * `diffModels` compares two models structurally and `renderDiff` turns the
 * result into Markdown suitable for a review pane, a commit message or an
 * audit log.
 */

import type { Model } from "@sourcesink/model";

import {
  canonicalName,
  patchableElements,
  type Patchable,
} from "./elements.js";
import type { ElementKind } from "./types.js";

export interface FieldDiff {
  field: string;
  before?: unknown;
  after?: unknown;
}

export interface ElementDiff {
  kind: ElementKind;
  name: string;
  change: "added" | "removed" | "changed";
  fields: FieldDiff[];
}

export interface ConnectorDiff {
  from: string;
  to: string;
  change: "added" | "removed";
}

export interface RunDiff {
  field: string;
  before?: unknown;
  after?: unknown;
}

export interface ModelDiff {
  elements: ElementDiff[];
  connectors: ConnectorDiff[];
  run: RunDiff[];
}

/** Preferred display order; any other field follows alphabetically. */
const FIELD_ORDER = [
  "name",
  "documentation",
  "units",
  "equation",
  "nonNegative",
  "inflows",
  "outflows",
  "conveyor",
  "queue",
  "oven",
  "biflow",
  "leak",
  "points",
  "interpolation",
  "extrapolation",
  "provenance",
  "annotations",
];

const INTERNAL_FIELDS = new Set(["id", "kind"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const ak = Object.keys(a).filter((k) => a[k] !== undefined);
    const bk = Object.keys(b).filter((k) => b[k] !== undefined);
    return ak.length === bk.length && ak.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function orderedFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const internal of INTERNAL_FIELDS) keys.delete(internal);
  const preferred = FIELD_ORDER.filter((f) => keys.has(f));
  const rest = [...keys].filter((k) => !FIELD_ORDER.includes(k)).sort();
  return [...preferred, ...rest];
}

function presentFields(element: Patchable): FieldDiff[] {
  const record = element as unknown as Record<string, unknown>;
  return orderedFields(record, {})
    .filter((field) => field !== "name" && record[field] !== undefined)
    .map((field) => ({ field, after: record[field] }));
}

function absentFields(element: Patchable): FieldDiff[] {
  const record = element as unknown as Record<string, unknown>;
  return orderedFields(record, {})
    .filter((field) => field !== "name" && record[field] !== undefined)
    .map((field) => ({ field, before: record[field] }));
}

function changedFields(before: Patchable, after: Patchable): FieldDiff[] {
  const a = before as unknown as Record<string, unknown>;
  const b = after as unknown as Record<string, unknown>;
  const out: FieldDiff[] = [];
  for (const field of orderedFields(a, b)) {
    if (!deepEqual(a[field], b[field])) out.push({ field, before: a[field], after: b[field] });
  }
  return out;
}

function connectorKey(c: { from: string; to: string }): string {
  return `${canonicalName(c.from)} -> ${canonicalName(c.to)}`;
}

export function diffModels(before: Model, after: Model): ModelDiff {
  const elements: ElementDiff[] = [];
  const beforeElements = patchableElements(before);
  const afterElements = patchableElements(after);
  const afterById = new Map(afterElements.map((e) => [e.id, e]));
  const afterByKey = new Map(afterElements.map((e) => [`${e.kind}:${canonicalName(e.name)}`, e]));
  const matched = new Set<Patchable>();

  for (const old of beforeElements) {
    let next = afterById.get(old.id);
    if (next?.kind !== old.kind) next = undefined;
    if (!next) {
      next = afterByKey.get(`${old.kind}:${canonicalName(old.name)}`);
      if (matched.has(next as Patchable)) next = undefined;
    }
    if (!next) {
      elements.push({ kind: old.kind, name: old.name, change: "removed", fields: absentFields(old) });
      continue;
    }
    matched.add(next);
    const fields = changedFields(old, next);
    if (fields.length > 0) {
      elements.push({ kind: next.kind, name: next.name, change: "changed", fields });
    }
  }
  for (const element of afterElements) {
    if (!matched.has(element)) {
      elements.push({ kind: element.kind, name: element.name, change: "added", fields: presentFields(element) });
    }
  }

  const connectors: ConnectorDiff[] = [];
  const beforeConnectors = new Map<string, { from: string; to: string }[]>();
  for (const c of before.connectors) {
    const key = connectorKey(c);
    const list = beforeConnectors.get(key) ?? [];
    list.push({ from: c.from, to: c.to });
    beforeConnectors.set(key, list);
  }
  for (const c of after.connectors) {
    const key = connectorKey(c);
    const list = beforeConnectors.get(key);
    if (list && list.length > 0) list.pop();
    else connectors.push({ from: c.from, to: c.to, change: "added" });
  }
  for (const list of beforeConnectors.values()) {
    for (const c of list) connectors.push({ from: c.from, to: c.to, change: "removed" });
  }

  const run: RunDiff[] = [];
  const runBefore = before.run as unknown as Record<string, unknown>;
  const runAfter = after.run as unknown as Record<string, unknown>;
  for (const field of orderedFields(runBefore, runAfter)) {
    if (!deepEqual(runBefore[field], runAfter[field])) {
      run.push({ field, before: runBefore[field], after: runAfter[field] });
    }
  }

  return { elements, connectors, run };
}

function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return `\`${value}\``;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : `\`${json}\``;
}

function fieldList(fields: FieldDiff[], change: "added" | "removed"): string {
  return fields.map((f) => `${f.field} = ${formatValue(change === "added" ? f.after : f.before)}`).join(", ");
}

/** Render a diff as Markdown with one section per kind of change. */
export function renderDiff(diff: ModelDiff): string {
  const lines: string[] = ["# Model diff", ""];
  const added = diff.elements.filter((e) => e.change === "added");
  const removed = diff.elements.filter((e) => e.change === "removed");
  const changed = diff.elements.filter((e) => e.change === "changed");

  if (
    added.length === 0 &&
    removed.length === 0 &&
    changed.length === 0 &&
    diff.connectors.length === 0 &&
    diff.run.length === 0
  ) {
    lines.push("No changes.");
    return `${lines.join("\n")}\n`;
  }

  const section = (title: string, items: string[]): void => {
    if (items.length === 0) return;
    lines.push(`## ${title}`, ...items, "");
  };

  section(
    "Added",
    added.map((e) => `- **${e.kind}** \`${e.name}\`${e.fields.length ? ` — ${fieldList(e.fields, "added")}` : ""}`),
  );
  section(
    "Removed",
    removed.map((e) => `- **${e.kind}** \`${e.name}\`${e.fields.length ? ` — ${fieldList(e.fields, "removed")}` : ""}`),
  );
  section(
    "Changed",
    changed.map(
      (e) =>
        `- **${e.kind}** \`${e.name}\` — ${e.fields
          .map((f) => `${f.field}: ${formatValue(f.before)} → ${formatValue(f.after)}`)
          .join(", ")}`,
    ),
  );
  section(
    "Connectors",
    diff.connectors.map((c) => `- ${c.change} \`${c.from} -> ${c.to}\``),
  );
  section(
    "Run",
    diff.run.map((r) => `- \`${r.field}\`: ${formatValue(r.before)} → ${formatValue(r.after)}`),
  );

  return `${lines.join("\n").trimEnd()}\n`;
}
