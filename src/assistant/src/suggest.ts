/**
 * Deterministic feature suggestions.
 *
 * The language model's own suggestions can be vague or missing; these rules
 * cover the obvious cases (data, uncertainty, what-if, explanation, first run)
 * so the panel still points the user at the right tool with a weak model.
 */

import { canonicalName } from "@sourcesink/engine";
import { allElements, validate, type Model } from "@sourcesink/model";

import type { Feature, FeatureSuggestion } from "./contracts.js";

const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** A constant converter has a plain numeric equation (no names or calls). */
export function constantConverters(model: Model): string[] {
  return model.converters.filter((c) => NUMBER_RE.test(c.equation.trim())).map((c) => c.name);
}

/** Whole-word, case-insensitive match of any phrase in `text`. */
function mentions(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  });
}

/** The model can be simulated once it has state and passes structural checks. */
function isRunnable(model: Model): boolean {
  return model.stocks.length > 0 && validate(model).length === 0;
}

/** Rule-table suggestions for the user's latest text. */
export function ruleSuggestions(
  model: Model,
  userText: string,
  previousModel?: Model,
): FeatureSuggestion[] {
  const out: FeatureSuggestion[] = [];

  if (
    model.stocks.length > 0 &&
    mentions(userText, ["data", "observation", "observations", "measurement", "measurements", "csv", "field", "fields"])
  ) {
    out.push({
      feature: "calibrate",
      reason: "You mentioned observations, so the constant parameters can be fitted to your data.",
      elements: constantConverters(model),
    });
  }

  if (
    constantConverters(model).length >= 2 &&
    mentions(userText, ["unsure", "uncertain", "don't know", "dont know", "do not know", "range", "estimate"])
  ) {
    out.push({
      feature: "sensitivity",
      reason: "Several parameter values are uncertain, so a sensitivity analysis can show which matter most.",
    });
  }

  if (mentions(userText, ["what if", "scenario", "scenarios", "policy", "policies", "compare"])) {
    out.push({
      feature: "scenarios",
      reason: "You asked a what-if question, so scenarios can compare alternatives.",
    });
  }

  if (mentions(userText, ["explain", "explains", "explained", "describe", "describes", "story", "stories", "summary", "summarize", "summarise"])) {
    out.push({
      feature: "describe",
      reason: "A plain-language explanation of the model is available.",
    });
  }

  if (previousModel && !isRunnable(previousModel) && isRunnable(model)) {
    out.push({
      feature: "run",
      reason: "The model is now runnable, so you can simulate it.",
    });
  }

  return out;
}

/** Keep the model's own reason, union the elements, and drop names that are
 * not in the model. At most three suggestions survive. */
export function mergeSuggestions(
  model: Model,
  fromModel: FeatureSuggestion[],
  fromRules: FeatureSuggestion[],
): FeatureSuggestion[] {
  const names = new Map<string, string>();
  for (const element of allElements(model)) names.set(canonicalName(element.name), element.name);

  const normalize = (elements: string[] | undefined): string[] => {
    if (!elements) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of elements) {
      const key = canonicalName(name);
      const actual = names.get(key);
      if (!actual || seen.has(key)) continue;
      seen.add(key);
      out.push(actual);
    }
    return out;
  };

  const merged = new Map<Feature, FeatureSuggestion>();
  for (const suggestion of [...fromModel, ...fromRules]) {
    const elements = normalize(suggestion.elements);
    const existing = merged.get(suggestion.feature);
    if (!existing) {
      merged.set(suggestion.feature, {
        feature: suggestion.feature,
        reason: suggestion.reason,
        ...(elements.length ? { elements } : {}),
      });
      continue;
    }
    const union = [...(existing.elements ?? [])];
    const seen = new Set(union.map(canonicalName));
    for (const name of elements) {
      const key = canonicalName(name);
      if (seen.has(key)) continue;
      seen.add(key);
      union.push(name);
    }
    if (union.length) existing.elements = union;
  }
  return [...merged.values()].slice(0, 3);
}
