/**
 * One conversation turn: ask the model, validate its reply, repair failures
 * through the gauntlet, run any simulations the reply asks for, and return a
 * reviewable proposal together with the evidence its answer is based on.
 *
 * The language model is injected, so this module is pure apart from `Date`
 * (for provenance) and has no network or file access. No patch reaches the
 * caller without passing `runGauntlet`; repair requests are transient and never
 * enter the returned conversation.
 */

import { canonicalName, diffModels, runGauntlet, type Finding, type ModelPatch } from "@sourcesink/patch";
import type { Model } from "@sourcesink/model";

import {
  type AssistantTurn,
  type ChatMessage,
  type Complete,
  type CompletionResponse,
  type Conversation,
  type RunEvidence,
  type RunRequest,
  type TurnOptions,
  type TurnProgress,
  type TurnResult,
} from "./contracts.js";
import { buildMessages, repairMessage, unitsRepairMessage } from "./prompt.js";
import { evidenceMessage, factsBulletList, runEvidence } from "./evidence.js";
import { partialMessage } from "./partial.js";
import { parseTurn } from "./parse.js";
import { mergeSuggestions, ruleSuggestions } from "./suggest.js";

function abortError(): Error {
  const err = new Error("The assistant turn was aborted.");
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

/** Assistant text as it is kept in visible history: questions numbered. */
function historyText(turn: AssistantTurn): string {
  if (turn.questions.length === 0) return turn.message;
  const questions = turn.questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  return `${turn.message}\n\n${questions}`;
}

/** Internal seam for tests: inject unit findings without a real units pass. */
let gauntletForTurn: typeof runGauntlet = runGauntlet;

export function __setGauntletForTests(next?: typeof runGauntlet): void {
  gauntletForTurn = next ?? runGauntlet;
}

/** Elements a patch adds or changes; unit findings about anything else are
 * not this patch's responsibility. */
function touchedNames(patch: ModelPatch): Set<string> {
  const names = new Set<string>();
  const add = (name: string | null | undefined): void => {
    if (typeof name === "string" && name) names.add(canonicalName(name));
  };
  for (const op of patch.ops) {
    switch (op.op) {
      case "add":
        add(op.element.name);
        break;
      case "update":
      case "remove":
      case "setLayout":
        add(op.name);
        break;
      case "rename":
        add(op.name);
        add(op.to);
        break;
      case "connect":
      case "disconnect":
        add(op.from);
        add(op.to);
        break;
      case "wire":
        add(op.flow);
        add(op.from);
        add(op.to);
        break;
    }
  }
  return names;
}

function unitsWarnings(findings: Finding[], patch: ModelPatch): Finding[] {
  const touched = touchedNames(patch);
  return findings.filter(
    (finding) =>
      (finding.stage as string) === "units" &&
      finding.severity === "warning" &&
      (!finding.element || touched.has(canonicalName(finding.element))),
  );
}

/** The model a run applies to: the proposal when the reply has one and the
 * request does not ask for the current model. */
function runBase(model: Model, proposal: TurnResult["proposal"], request: RunRequest): Model {
  return proposal && request.on !== "current" ? proposal.model : model;
}

/** Run one conversation turn. */
export async function runTurn(
  model: Model,
  conversation: Conversation,
  userText: string,
  complete: Complete,
  options: TurnOptions,
): Promise<TurnResult> {
  throwIfAborted(options.signal);
  const messages = buildMessages(model, conversation, userText);
  const maxRepairs = Math.max(0, options.maxRepairs ?? 3);
  const failures: TurnResult["failures"] = [];
  let cost: number | undefined;
  let turn: AssistantTurn | undefined;
  let acceptedText: string | undefined;
  let proposal: TurnResult["proposal"];
  let lastError = "";
  let unitsRepaired = false;

  const stream = (phase: TurnProgress["phase"]) => (textSoFar: string): void => {
    const partial = partialMessage(textSoFar);
    options.onProgress?.({ phase, ...(partial !== undefined ? { partialMessage: partial } : {}) });
  };

  for (let attempt = 1; attempt <= maxRepairs + 1; attempt += 1) {
    throwIfAborted(options.signal);
    options.onProgress?.({ phase: "thinking" });
    let response: CompletionResponse;
    try {
      response = await complete({
        model: options.model,
        messages,
        signal: options.signal,
        onText: stream("thinking"),
      });
    } catch (err) {
      if (options.signal?.aborted) throw abortError();
      throw err;
    }
    throwIfAborted(options.signal);
    options.onProgress?.({ phase: "validating" });
    if (response.cost !== undefined) cost = (cost ?? 0) + response.cost;

    const parsed = parseTurn(response.text, conversation.stage);
    if (!parsed.ok) {
      lastError = parsed.error;
      const feedback = repairMessage({ kind: "parse", detail: parsed.error });
      failures.push({ attempt, kind: "parse", feedback });
      if (attempt > maxRepairs) break;
      messages.push({ role: "assistant", content: response.text });
      messages.push({ role: "user", content: feedback });
      continue;
    }

    const candidate = parsed.turn;
    if (!candidate.patch) {
      turn = candidate;
      acceptedText = response.text;
      break;
    }

    const patch: ModelPatch = {
      ...candidate.patch,
      provenance: { author: "ai", agent: options.model, createdAt: new Date().toISOString() },
    };
    const result = gauntletForTurn(model, patch);
    if (!result.ok) {
      const errorFindings: Finding[] = result.findings.filter((f) => f.severity === "error");
      const detail = errorFindings.map((f) => f.message).join("; ") || "the patch failed validation";
      lastError = detail;
      const feedback = repairMessage({ kind: "gauntlet", detail, findings: errorFindings });
      failures.push({ attempt, kind: "gauntlet", feedback, findings: errorFindings });
      if (attempt > maxRepairs) break;
      messages.push({ role: "assistant", content: response.text });
      messages.push({ role: "user", content: feedback });
      continue;
    }

    // Unit warnings do not block the patch, but one repair attempt is worth
    // making on the first try; after that the patch is accepted with them.
    const unitProblems = unitsWarnings(result.findings, patch);
    if (!unitsRepaired && unitProblems.length > 0 && attempt === 1 && attempt <= maxRepairs) {
      unitsRepaired = true;
      const feedback = unitsRepairMessage(unitProblems);
      failures.push({ attempt, kind: "gauntlet", feedback, findings: unitProblems });
      options.onProgress?.({ phase: "repairing" });
      messages.push({ role: "assistant", content: response.text });
      messages.push({ role: "user", content: feedback });
      continue;
    }

    turn = { ...candidate, patch };
    acceptedText = response.text;
    proposal = {
      model: result.model!,
      diff: diffModels(model, result.model!),
      warnings: result.findings.filter((f) => f.severity === "warning"),
    };
    break;
  }

  const gaveUp = turn === undefined;
  if (!turn) {
    turn = {
      message: `I could not complete that change after ${maxRepairs} repair attempt${maxRepairs === 1 ? "" : "s"}. The last problem was: "${lastError}". The model was not changed.`,
      questions: [],
      suggestions: [],
      stage: conversation.stage,
    };
  }

  let evidence: RunEvidence[] | undefined;
  const runRequests = (turn.runs ?? []).slice(0, 3);
  if (!gaveUp && acceptedText !== undefined && runRequests.length > 0) {
    options.onProgress?.({ phase: "running" });
    evidence = runRequests.map((request) => runEvidence(runBase(model, proposal, request), request));

    throwIfAborted(options.signal);
    options.onProgress?.({ phase: "answering" });
    const followUp: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: acceptedText },
      {
        role: "user",
        content: `${evidenceMessage(evidence)}\n\nNow answer the user's question from these results. Cite the numbers. Reply with the full JSON object; do not request more runs.`,
      },
    ];
    let answered: CompletionResponse | undefined;
    try {
      answered = await complete({
        model: options.model,
        messages: followUp,
        signal: options.signal,
        onText: stream("answering"),
      });
    } catch (err) {
      if (options.signal?.aborted) throw abortError();
      answered = undefined;
    }
    throwIfAborted(options.signal);
    if (answered?.cost !== undefined) cost = (cost ?? 0) + answered.cost;
    if (answered) options.onProgress?.({ phase: "validating" });

    const parsedAnswer = answered ? parseTurn(answered.text, turn.stage) : undefined;
    if (parsedAnswer?.ok) {
      turn = {
        ...turn,
        message: parsedAnswer.turn.message,
        questions: parsedAnswer.turn.questions,
        suggestions: parsedAnswer.turn.suggestions,
      };
    } else {
      // Keep the first reply, but never hide the results it was meant to use.
      turn = { ...turn, message: `${turn.message}\n\n${factsBulletList(evidence)}` };
    }
  }

  const finalModel = proposal?.model ?? model;
  turn = {
    ...turn,
    suggestions: mergeSuggestions(
      finalModel,
      turn.suggestions,
      ruleSuggestions(finalModel, userText, proposal ? model : undefined),
    ),
  };

  const history: ChatMessage[] = [
    ...conversation.history,
    { role: "user", content: userText },
    { role: "assistant", content: historyText(turn) },
  ];

  return {
    turn,
    ...(proposal ? { proposal } : {}),
    gaveUp,
    failures,
    conversation: { history, stage: turn.stage },
    ...(cost !== undefined ? { cost } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

/** A fresh conversation: empty history, stage "question". */
export function newConversation(): Conversation {
  return { history: [], stage: "question" };
}
