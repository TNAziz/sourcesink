/**
 * Parsing and validation of one language-model reply.
 *
 * Models do not always follow the "JSON only" instruction, so the parser
 * tolerates a fenced block or surrounding prose but still validates every
 * field by hand. It never throws: the conversation loop turns an error string
 * into a repair request.
 */

import type { ModelPatch } from "@sourcesink/patch";

import {
  STAGES,
  type AssistantTurn,
  type Feature,
  type FeatureSuggestion,
  type InterviewStage,
  type RunRequest,
} from "./contracts.js";

const FEATURES: readonly Feature[] = [
  "run",
  "scenarios",
  "calibrate",
  "sensitivity",
  "uncertainty",
  "describe",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Take the first balanced top-level {...}, ignoring braces inside strings. */
function firstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("reply does not contain a JSON object");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error("reply contains an incomplete JSON object");
}

function parseQuestions(value: unknown): { ok: true; questions: string[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, questions: [] };
  if (!Array.isArray(value) || value.some((q) => typeof q !== "string")) {
    return { ok: false, error: "questions must be an array of strings" };
  }
  return { ok: true, questions: value.slice(0, 3) };
}

function parseSuggestions(
  value: unknown,
): { ok: true; suggestions: FeatureSuggestion[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, suggestions: [] };
  if (!Array.isArray(value)) return { ok: false, error: "suggestions must be an array" };
  const suggestions: FeatureSuggestion[] = [];
  for (const [i, raw] of value.entries()) {
    if (!isRecord(raw)) return { ok: false, error: `suggestions[${i}] must be an object` };
    if (typeof raw.feature !== "string") {
      return { ok: false, error: `suggestions[${i}].feature must be a string` };
    }
    if (!FEATURES.includes(raw.feature as Feature)) continue;
    if (typeof raw.reason !== "string") {
      return { ok: false, error: `suggestions[${i}].reason must be a string` };
    }
    let elements: string[] | undefined;
    if (raw.elements !== undefined) {
      if (!Array.isArray(raw.elements) || raw.elements.some((e) => typeof e !== "string")) {
        return { ok: false, error: `suggestions[${i}].elements must be an array of strings` };
      }
      elements = raw.elements;
    }
    suggestions.push({
      feature: raw.feature as Feature,
      reason: raw.reason,
      ...(elements ? { elements } : {}),
    });
  }
  return { ok: true, suggestions };
}

/** Numeric entries only; non-numeric values are dropped rather than failing
 * the turn. Returns undefined when nothing usable remains. */
function numericRecord(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Validate `runs`, dropping anything malformed without failing the reply:
 * a bad run request should never cost the user their answer. */
function parseRuns(value: unknown): RunRequest[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const runs: RunRequest[] = [];
  for (const raw of value) {
    if (runs.length >= 3) break;
    if (!isRecord(raw)) continue;
    if (typeof raw.label !== "string" || !raw.label.trim()) continue;
    const run: RunRequest = { label: raw.label };
    if (raw.on === "current" || raw.on === "proposal") run.on = raw.on;
    const set = numericRecord(raw.set);
    if (set) run.set = set;
    if (Array.isArray(raw.series)) {
      const series = raw.series.filter((name): name is string => typeof name === "string");
      if (series.length > 0) run.series = series;
    }
    const thresholds = numericRecord(raw.thresholds);
    if (thresholds) run.thresholds = thresholds;
    runs.push(run);
  }
  return runs.length > 0 ? runs : undefined;
}

/** Parse a model reply into an AssistantTurn, tolerating fences and prose. */
export function parseTurn(
  text: string,
  fallbackStage: InterviewStage,
): { ok: true; turn: AssistantTurn } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(firstJsonObject(text));
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!isRecord(value)) return { ok: false, error: "reply must be a JSON object" };
  if (typeof value.message !== "string" || !value.message.trim()) {
    return { ok: false, error: "message must be a non-empty string" };
  }

  const questions = parseQuestions(value.questions);
  if (!questions.ok) return questions;

  const suggestions = parseSuggestions(value.suggestions);
  if (!suggestions.ok) return suggestions;

  let patch: ModelPatch | undefined;
  if (value.patch !== undefined) {
    if (!isRecord(value.patch) || !Array.isArray(value.patch.ops)) {
      return { ok: false, error: "patch must be an object with an ops array" };
    }
    patch = value.patch as unknown as ModelPatch;
  }

  const stage =
    typeof value.stage === "string" && (STAGES as readonly string[]).includes(value.stage)
      ? (value.stage as InterviewStage)
      : fallbackStage;

  const runs = parseRuns(value.runs);

  return {
    ok: true,
    turn: {
      message: value.message,
      questions: questions.questions,
      ...(patch ? { patch } : {}),
      suggestions: suggestions.suggestions,
      stage,
      ...(runs ? { runs } : {}),
    },
  };
}
