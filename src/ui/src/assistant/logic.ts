/**
 * SourceSink — pure logic for the Assistant panel.
 *
 * Everything here is free of React and the DOM so it can be unit-tested:
 * diff grouping, building the subset patch the user accepted, feature-suggestion
 * routing, message splitting and small display formatters.
 */

import { canonicalName } from "@sourcesink/engine";
import type { Model } from "@sourcesink/model";
import type { FeatureSuggestion, InterviewStage } from "@sourcesink/assistant";
import type {
  ElementDiff,
  ElementKind,
  Finding,
  ModelDiff,
  ModelPatch,
  PatchOp,
} from "@sourcesink/patch";

/**
 * Mirrors `DEFAULT_MODEL` in `@sourcesink/assistant/node`. That module is
 * Node-only, so the browser must not import it.
 */
export const DEFAULT_MODEL = "openrouter/deepseek/deepseek-v4.1-flash-1017";

/** localStorage key for the chosen model (every access is guarded). */
export const MODEL_STORAGE_KEY = "sourcesink:assistant:model";

export const SCENARIOS_HINT = "Scenarios are in the inspector when nothing is selected.";

export const SETUP_ADVICE =
  "Install the OpenCode CLI and sign in to OpenRouter (`opencode auth login`), then choose Check again.";

/** Example prompts shown in the empty state. */
export const EXAMPLE_PROMPTS = [
  "Oxygen in a river below a treatment plant",
  "A lake receiving phosphorus from farms",
  "Groundwater pumped faster than it recharges",
] as const;

export type AnalyzeTab = "calibrate" | "sensitivity" | "uncertainty";

/** What clicking a suggestion button should do. */
export type SuggestionAction =
  | { kind: "run" }
  | { kind: "describe" }
  | { kind: "analyze"; tab: AnalyzeTab; elements?: string[] }
  | { kind: "scenarios"; hint: string };

/** Route a feature suggestion to the panel it opens. */
export function suggestionAction(suggestion: FeatureSuggestion): SuggestionAction {
  switch (suggestion.feature) {
    case "run":
      return { kind: "run" };
    case "describe":
      return { kind: "describe" };
    case "calibrate":
    case "sensitivity":
    case "uncertainty":
      return {
        kind: "analyze",
        tab: suggestion.feature,
        ...(suggestion.elements?.length ? { elements: suggestion.elements } : {}),
      };
    case "scenarios":
      return { kind: "scenarios", hint: SCENARIOS_HINT };
  }
}

const SUGGESTION_LABELS: Record<FeatureSuggestion["feature"], string> = {
  run: "Run the model",
  describe: "Describe the model",
  calibrate: "Open Calibrate",
  sensitivity: "Open Sensitivity",
  uncertainty: "Open Uncertainty",
  scenarios: "Open Scenarios",
};

export function suggestionLabel(suggestion: FeatureSuggestion): string {
  return SUGGESTION_LABELS[suggestion.feature];
}

/** "next-steps" → "Next steps". */
export function stageLabel(stage: InterviewStage): string {
  const [first, ...rest] = stage.split("-");
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

/* ---------------------------------------------------------------------------
 * Diff review
 * ------------------------------------------------------------------------- */

export type DiffChange = "added" | "changed" | "removed";

/** One reviewable row: an element change or a connector change. */
export interface DiffRow {
  /** Stable selection key (shared with `buildSubsetPatch`). */
  key: string;
  kind: "element" | "connector";
  change: DiffChange;
  elementKind?: ElementKind;
  name: string;
  from?: string;
  to?: string;
  fields: ElementDiff["fields"];
}

export function elementRowKey(name: string): string {
  return `element:${canonicalName(name)}`;
}

export function connectorRowKey(from: string, to: string): string {
  return `connector:${canonicalName(from)}->${canonicalName(to)}`;
}

/** Fields worth reviewing, in reading order. Provenance, ids and wiring id
 * lists are hidden (the AI badge shows provenance on the canvas). */
// Inflow/outflow lists hold internal flow ids; the flows' own rows already
// show the wiring in readable form.
const HIDDEN_FIELDS = new Set(["provenance", "id", "kind", "inflows", "outflows"]);
const FIELD_ORDER = ["equation", "units", "documentation"];

function reviewFields(fields: ElementDiff["fields"]): ElementDiff["fields"] {
  const rank = (name: string) => {
    const i = FIELD_ORDER.indexOf(name);
    return i < 0 ? FIELD_ORDER.length : i;
  };
  return fields.filter((f) => !HIDDEN_FIELDS.has(f.field)).sort((a, b) => rank(a.field) - rank(b.field));
}

/** Flatten a model diff into selectable rows, elements before connectors. */
export function diffRows(diff: ModelDiff): DiffRow[] {
  return [
    ...diff.elements.map(
      (e): DiffRow => ({
        key: elementRowKey(e.name),
        kind: "element",
        change: e.change,
        elementKind: e.kind,
        name: e.name,
        fields: reviewFields(e.fields),
      }),
    ),
    ...diff.connectors.map(
      (c): DiffRow => ({
        key: connectorRowKey(c.from, c.to),
        kind: "connector",
        change: c.change,
        name: `${c.from} -> ${c.to}`,
        from: c.from,
        to: c.to,
        fields: [],
      }),
    ),
  ];
}

export interface DiffSection {
  id: string;
  title: string;
  rows: DiffRow[];
}

const SECTIONS: Array<{
  id: string;
  title: string;
  kind: DiffRow["kind"];
  change: DiffChange;
}> = [
  { id: "elements-added", title: "Added elements", kind: "element", change: "added" },
  { id: "elements-changed", title: "Changed elements", kind: "element", change: "changed" },
  { id: "elements-removed", title: "Removed elements", kind: "element", change: "removed" },
  { id: "connectors-added", title: "Added connectors", kind: "connector", change: "added" },
  { id: "connectors-removed", title: "Removed connectors", kind: "connector", change: "removed" },
];

/** Group diff rows as Added / Changed / Removed elements and connectors. */
export function groupDiff(diff: ModelDiff): DiffSection[] {
  const rows = diffRows(diff);
  return SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    rows: rows.filter((r) => r.kind === section.kind && r.change === section.change),
  })).filter((section) => section.rows.length > 0);
}

/** A field value for display; equations are rendered in monospace separately. */
export function formatFieldValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}

/* ---------------------------------------------------------------------------
 * Subset patches
 * ------------------------------------------------------------------------- */

function modelElementNames(model: Model): Set<string> {
  const names = new Set<string>();
  for (const e of [...model.stocks, ...model.flows, ...model.converters, ...model.graphFunctions]) {
    names.add(canonicalName(e.name));
  }
  return names;
}

function endpointOk(
  endpoint: string | null | undefined,
  existing: ReadonlySet<string>,
  selected: ReadonlySet<string>,
): boolean {
  if (endpoint === undefined || endpoint === null) return true;
  const key = canonicalName(endpoint);
  return existing.has(key) || selected.has(elementRowKey(endpoint));
}

function includeOp(op: PatchOp, existing: ReadonlySet<string>, selected: ReadonlySet<string>): boolean {
  switch (op.op) {
    case "add":
      return selected.has(elementRowKey(op.element.name));
    case "update":
    case "remove":
    case "setLayout":
      return selected.has(elementRowKey(op.name));
    case "rename":
      return selected.has(elementRowKey(op.name)) || selected.has(elementRowKey(op.to));
    case "connect":
    case "disconnect":
      return (
        selected.has(connectorRowKey(op.from, op.to)) &&
        endpointOk(op.from, existing, selected) &&
        endpointOk(op.to, existing, selected)
      );
    case "wire":
      return (
        selected.has(elementRowKey(op.flow)) &&
        endpointOk(op.from, existing, selected) &&
        endpointOk(op.to, existing, selected)
      );
    case "setRun":
      return false;
  }
}

/**
 * Keep only the operations the user accepted. Element ops follow their own
 * checkbox; `connect`/`disconnect` also need both ends to be selected or
 * already present; `wire` follows its flow plus its endpoints. Run-spec changes
 * have no element row, so they are kept only when every other op is accepted.
 */
export function buildSubsetPatch(
  patch: ModelPatch,
  model: Model,
  selected: ReadonlySet<string>,
): ModelPatch {
  const existing = modelElementNames(model);
  const chosen = new Set<PatchOp>();
  for (const op of patch.ops) {
    if (op.op !== "setRun" && includeOp(op, existing, selected)) chosen.add(op);
  }
  const everyOtherChosen = patch.ops.every((op) => op.op === "setRun" || chosen.has(op));

  const ops = patch.ops.filter((op) => (op.op === "setRun" ? everyOtherChosen : chosen.has(op)));
  return {
    ...patch,
    ops,
  };
}

/** A short assistant-side note describing an applied subset. */
export function appliedNote(patch: ModelPatch): string {
  const names = new Set<string>();
  for (const op of patch.ops) {
    switch (op.op) {
      case "add":
        names.add(op.element.name);
        break;
      case "update":
      case "remove":
      case "setLayout":
        names.add(op.name);
        break;
      case "rename":
        names.add(op.to);
        break;
      case "wire":
        names.add(op.flow);
        break;
      case "connect":
      case "disconnect":
      case "setRun":
        break;
    }
  }
  const list = [...names];
  if (list.length === 0) return "Applied the run-settings change.";
  return `Applied: ${list.join(", ")}.`;
}

/* ---------------------------------------------------------------------------
 * Messages and display
 * ------------------------------------------------------------------------- */

export interface MessageParts {
  text: string;
  questions: string[];
}

/**
 * Split an assistant history message into its prose and a trailing numbered
 * question list (the form `runTurn` writes into history).
 */
export function splitMessage(content: string): MessageParts {
  const lines = content.split(/\r?\n/);
  const isQuestion = (line: string): boolean => /^\d+\.\s+/.test(line.trim());

  let last = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (isQuestion(lines[i])) {
      last = i;
      break;
    }
  }
  if (last < 0) return { text: content.trim(), questions: [] };
  if (!lines.slice(last + 1).every((line) => line.trim() === "")) {
    return { text: content.trim(), questions: [] };
  }

  let first = last;
  while (first > 0 && isQuestion(lines[first - 1])) first -= 1;

  const questions = lines
    .slice(first, last + 1)
    .map((line) => line.trim().replace(/^\d+\.\s+/, ""));
  return { text: lines.slice(0, first).join("\n").trim(), questions };
}

/** A turn cost for the muted footer, e.g. "$0.0032". */
export function formatCost(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return "$0.0000";
  if (cost < 0.0001) return "<$0.0001";
  return `$${cost.toFixed(4)}`;
}

/** Findings worth showing after a failed subset apply. */
export function errorFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.severity === "error");
}
