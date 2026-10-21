/**
 * Prompts sent to the language model.
 *
 * The prompt is the model author's contract: it explains the interview, the
 * one JSON reply shape and the only two things the assistant may do — ask
 * questions and propose a reviewed patch. Everything here is deterministic so
 * a turn can be reproduced from its inputs.
 */

import { BUILTIN_FUNCTIONS, type Model } from "@sourcesink/model";
import { describeModel } from "@sourcesink/explain";
import type { Finding } from "@sourcesink/patch";

import {
  STAGES,
  type ChatMessage,
  type Conversation,
  type Feature,
  type InterviewStage,
} from "./contracts.js";

/** One sentence per stage, in the order the user usually answers them. */
const STAGE_GUIDES: Record<InterviewStage, string> = {
  question: "Ask what the user wants to know and over what time span.",
  boundary: "Ask what is inside the system, what is outside it, and what is held fixed.",
  stocks: "Ask what accumulates, in what units, and at what starting amount.",
  flows: "Ask what fills and drains each stock, and at what rate.",
  feedback: "Ask whether any stock changes its own inflow or outflow.",
  numbers: "Ask for parameter values, their units, and where the numbers come from.",
  "next-steps": "Ask about observations they have and what they are unsure about.",
};

/** When to point the user at each feature. */
const FEATURE_GUIDES: Record<Feature, string> = {
  run: "The model is complete enough to simulate and the user wants to see results.",
  scenarios: "The user asks a what-if question or wants to compare policies or alternatives.",
  calibrate: "The user has observations, measurements or a CSV to fit constant parameters to.",
  sensitivity: "The user is unsure about several parameter values or wants to know which matter most.",
  uncertainty: "The user wants a range or distribution of outcomes rather than one run.",
  describe: "The user wants the model explained, summarized or told as a story.",
};

/** Omit fields that are layout or audit metadata, and internal ids. */
function compactModel(model: Model): Record<string, unknown> {
  const stocks = model.stocks.map((s) => {
    const out: Record<string, unknown> = { name: s.name, equation: s.equation };
    if (s.units) out.units = s.units;
    if (s.documentation) out.documentation = s.documentation;
    if (s.inflows?.length) out.inflows = s.inflows;
    if (s.outflows?.length) out.outflows = s.outflows;
    if (s.nonNegative) out.nonNegative = true;
    if (s.conveyor) out.conveyor = s.conveyor;
    if (s.queue) out.queue = true;
    if (s.oven) out.oven = s.oven;
    return out;
  });
  const flows = model.flows.map((f) => {
    const out: Record<string, unknown> = { name: f.name, equation: f.equation };
    if (f.units) out.units = f.units;
    if (f.documentation) out.documentation = f.documentation;
    if (f.biflow) out.biflow = true;
    if (f.nonNegative) out.nonNegative = true;
    if (f.leak) out.leak = true;
    return out;
  });
  const converters = model.converters.map((c) => {
    const out: Record<string, unknown> = { name: c.name, equation: c.equation };
    if (c.units) out.units = c.units;
    if (c.documentation) out.documentation = c.documentation;
    return out;
  });
  const graphFunctions = model.graphFunctions.map((g) => {
    const out: Record<string, unknown> = {
      name: g.name,
      points: g.points,
      interpolation: g.interpolation,
      extrapolation: g.extrapolation,
    };
    if (g.units) out.units = g.units;
    if (g.documentation) out.documentation = g.documentation;
    return out;
  });
  const connectors = model.connectors.map((c) => {
    const out: Record<string, unknown> = { name: c.name, from: c.from, to: c.to };
    if (c.documentation) out.documentation = c.documentation;
    return out;
  });

  const out: Record<string, unknown> = {
    name: model.name,
    run: model.run,
    stocks,
    flows,
    converters,
    graphFunctions,
    connectors,
  };
  if (model.documentation) out.documentation = model.documentation;
  if (model.dimensions.length) out.dimensions = model.dimensions.map((d) => ({ name: d.name, values: d.values }));
  if (Object.keys(model.arrayed).length) out.arrayed = model.arrayed;
  return out;
}

function isEmptyModel(model: Model): boolean {
  return (
    model.stocks.length === 0 &&
    model.flows.length === 0 &&
    model.converters.length === 0 &&
    model.graphFunctions.length === 0 &&
    model.connectors.length === 0 &&
    model.dimensions.length === 0
  );
}

const PATCH_GRAMMAR = `Patch grammar — a patch is {"ops": [ ... ]} and may include "rationale" (why).
- add:       {"op": "add", "kind": "stock", "element": {"name": "Water", "equation": "100", "units": "m3", "documentation": "Water in the reservoir."}}
- update:    {"op": "update", "name": "loss_rate", "changes": {"equation": "0.2", "units": "1/Day"}}
- rename:    {"op": "rename", "name": "loss_rate", "to": "loss_fraction"}
- remove:    {"op": "remove", "name": "unused_parameter"}
- connect:   {"op": "connect", "from": "Water", "to": "outflow"}
- disconnect:{"op": "disconnect", "from": "Water", "to": "outflow"}
- wire:      {"op": "wire", "flow": "outflow", "from": "Water", "to": null}
- setRun:    {"op": "setRun", "run": {"start": 0, "stop": 30, "dt": 0.25, "saveEvery": 1, "timeUnits": "Day"}}
- setLayout: {"op": "setLayout", "name": "Water", "x": 100, "y": 100}
Kinds for add: "stock", "flow", "converter", "graphFunction". Connectors are made with connect, never add.
Wiring is separate from information: wire moves material; connect only lets a target equation read a source.`;

/** The system prompt: role, stages, reply shape, grammar, dialect, features. */
export function systemPrompt(): string {
  const stages = STAGES.map((stage, i) => `${i + 1}. ${stage} — ${STAGE_GUIDES[stage]}`).join("\n");
  const features = (Object.keys(FEATURE_GUIDES) as Feature[])
    .map((feature) => `- ${feature}: ${FEATURE_GUIDES[feature]}`)
    .join("\n");
  const functions = BUILTIN_FUNCTIONS.map((f) => f.name).join(", ");
  return `You are the SourceSink modeling assistant. You help a user turn a plain-language
description of a system into a stock-and-flow model. You interview them, then propose
small, reviewable model patches. You never claim a change was made until it passes the
validator.

## Interview
Work through these stages, skipping any the user has already answered and returning to
an earlier stage when something new comes up:
${stages}

## Reply format
Reply with one JSON object and nothing else (no prose before or after, no markdown):
{"message": "Plain-language reply for the user.", "questions": ["At most three follow-up questions."], "patch": {"ops": [ ... ]}, "suggestions": [{"feature": "calibrate", "reason": "You mentioned field data.", "elements": ["loss_rate"]}], "stage": "flows"}
"patch" and "suggestions" are optional. "questions" may be [] but is always present.
"suggestions[].feature" must be one of: run, scenarios, calibrate, sensitivity, uncertainty, describe.
"stage" must be one of: ${STAGES.join(", ")}.
"runs" is optional: at most three simulations to run before you answer, e.g.
{"label": "Loading halved", "on": "current", "set": {"loading": 5}, "series": ["DO"], "thresholds": {"DO": 5}}.
"on" is "current" (the model as it is) or "proposal" (after this reply's patch; the default
when a patch is present). "set" overrides constant parameter values only. "series" defaults
to every stock; "thresholds" asks when each named series first crosses a level.

## Patch grammar
${PATCH_GRAMMAR}

## Equation dialect
Write expressions with + - * / ^, parentheses, and comparisons < <= > >= = <>.
Use IF condition THEN value ELSE other_value, or IF(condition, value, other_value).
Combine conditions with AND, OR and NOT. TIME and DT are available.
${functions}
Names are case-insensitive and use letters, digits and underscores (single spaces are
allowed in existing names). Reference an element by its exact name.

## Features to suggest
${features}

## Rules
- Ask at most three questions per turn.
- Propose small patches, one stage at a time. Do not try to build the whole model at once.
- Every stock, flow and converter you add gets units and a one-sentence "documentation".
- Names use letters, digits and underscores only (write "loss_rate", not "loss rate").
- Reference only names that exist in the model or that the same patch adds first.
- Use "runs" whenever the user asks about behavior, timing, thresholds, peaks, or what-if
  changes; the results come back in a follow-up message and you answer from them.
- Never state a simulated number you have not run. At most three runs per reply.
- "set" values must be constants (one number per element), never equations.
- Reply with the JSON object only.

## Worked example 1 — first turn, questions only
{"message": "Let's start with the question you want the model to answer.", "questions": ["What quantity should the model track?", "Over what time span should it run?", "What are the time units?"], "suggestions": [], "stage": "boundary"}

## Worked example 2 — add a stock, its outflow, a rate converter, the connectors and the wiring
{"message": "I added a water stock that loses water at a constant fractional rate.", "questions": ["Is the loss rate constant, or should it change over time?"], "patch": {"rationale": "A one-stock first-order decay model.", "ops": [{"op": "add", "kind": "stock", "element": {"name": "Water", "equation": "100", "units": "m3", "documentation": "Water held in the reservoir."}}, {"op": "add", "kind": "flow", "element": {"name": "outflow", "equation": "Water * loss_rate", "units": "m3/Day", "documentation": "Water leaving the reservoir."}}, {"op": "add", "kind": "converter", "element": {"name": "loss_rate", "equation": "0.1", "units": "1/Day", "documentation": "Fraction of the water lost each day."}}, {"op": "wire", "flow": "outflow", "from": "Water", "to": null}, {"op": "connect", "from": "Water", "to": "outflow"}, {"op": "connect", "from": "loss_rate", "to": "outflow"}, {"op": "setRun", "run": {"start": 0, "stop": 30, "dt": 0.25, "saveEvery": 1, "timeUnits": "Day"}}]}, "suggestions": [{"feature": "run", "reason": "The model is now runnable."}], "stage": "numbers"}

## Worked example 3 — a what-if question answered from two runs
User: "What if loading is halved?"
{"message": "Let us compare the current loading with half of it.", "questions": [], "runs": [{"label": "Current loading"}, {"label": "Loading halved", "set": {"loading": 5}}], "suggestions": [], "stage": "next-steps"}`;
}

/** Messages for one request: system prompt, conversation history, the
 * current model + structural description, then the new user text. The model
 * comes after the history so the latest state sits next to the request
 * instead of being buried under a long conversation. */
export function buildMessages(model: Model, conversation: Conversation, userText: string): ChatMessage[] {
  const modelMessage = isEmptyModel(model)
    ? "The model is empty."
    : `Current model (compact JSON):\n${JSON.stringify(compactModel(model))}\n\nStructural description:\n${describeModel(model).markdown}`;
  return [
    { role: "system", content: systemPrompt() },
    ...conversation.history,
    { role: "user", content: modelMessage },
    { role: "user", content: userText },
  ];
}

/** Ask the model to fix unit warnings in an otherwise valid patch. The turn
 * sends this at most once, then accepts the patch with its warnings. */
export function unitsRepairMessage(findings: Finding[]): string {
  return [
    "Your previous reply passed validation, but its units need fixing.",
    "Problems:",
    ...findings.map((finding) => `- ${finding.message}`),
    "",
    "Reply again with the complete corrected JSON object only (not a fragment), keeping the same change. Give every added or changed element consistent units.",
  ].join("\n");
}

/** A repair request appended after a failed attempt. Quotes every problem
 * exactly and asks for the complete corrected reply, never a fragment. */
export function repairMessage(failure: {
  kind: "parse" | "gauntlet";
  detail: string;
  findings?: Finding[];
}): string {
  const problems = (failure.findings ?? [])
    .filter((finding) => finding.severity === "error")
    .map((finding) => finding.message);
  if (problems.length === 0) problems.push(failure.detail);
  return [
    "Your previous reply could not be accepted.",
    "Problems:",
    ...problems.map((problem) => `- ${problem}`),
    "",
    "Reply again with the complete corrected JSON object only (not a fragment or a patch snippet). Include message, questions, suggestions and stage; include the full patch when one is needed.",
  ].join("\n");
}
