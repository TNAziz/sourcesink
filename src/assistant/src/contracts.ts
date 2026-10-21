/**
 * SourceSink — modeling assistant contracts.
 *
 * Shared types between the conversation core (`turn.ts` and friends), the
 * language-model bridge (`node/`), and the editor's Assistant panel. The
 * assistant never edits a model directly: it proposes a `ModelPatch`, which
 * must pass `runGauntlet` before the user is shown it.
 */

import type { Model } from "@sourcesink/model";
import type { Finding, ModelDiff, ModelPatch } from "@sourcesink/patch";

/** One message of the conversation, as sent to the language model. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  /** Provider/model id, e.g. "openrouter/deepseek/deepseek-v4.1-flash-1017". */
  model: string;
  messages: ChatMessage[];
  /** Abort the call (the bridge kills the child process). */
  signal?: AbortSignal;
  /** Streaming: called with the full reply text received so far, each time
   * more arrives. Bridges that cannot stream simply never call it. */
  onText?: (textSoFar: string) => void;
}

export interface CompletionResponse {
  /** The model's reply text (all text parts joined). */
  text: string;
  /** USD, when the provider reports it. */
  cost?: number;
  /** Total tokens, when reported. */
  tokens?: number;
}

/** The one function the core needs from a language model. Injected, so the
 * core is pure and tests use a scripted fake. */
export type Complete = (request: CompletionRequest) => Promise<CompletionResponse>;

/** Interview stages, in their usual order (see docs/assistant.md). */
export const STAGES = [
  "question",
  "boundary",
  "stocks",
  "flows",
  "feedback",
  "numbers",
  "next-steps",
] as const;
export type InterviewStage = (typeof STAGES)[number];

/** Features the assistant can point the user to. */
export type Feature =
  | "run"
  | "scenarios"
  | "calibrate"
  | "sensitivity"
  | "uncertainty"
  | "describe";

export interface FeatureSuggestion {
  feature: Feature;
  /** One sentence shown on the button's tooltip / under it. */
  reason: string;
  /** Element names to pre-fill (e.g. parameters to calibrate or vary). */
  elements?: string[];
}

/** A simulation the assistant asks for so it can answer from results
 * rather than from guesswork (e.g. "when does DO fall below 5 mg/L?"). */
export interface RunRequest {
  /** Short label shown to the user, e.g. "Farm loading halved". */
  label: string;
  /** Run the model as it is ("current") or with this turn's patch applied
   * ("proposal"). Default: "proposal" when the turn has a patch, else "current". */
  on?: "current" | "proposal";
  /** What-if overrides: element name -> constant value. */
  set?: Record<string, number>;
  /** Series to report; default: every stock. */
  series?: string[];
  /** Report when each series first crosses these levels. */
  thresholds?: Record<string, number>;
}

/** The outcome of one RunRequest, computed locally by SourceSink. */
export interface RunEvidence {
  request: RunRequest;
  ok: boolean;
  error?: string;
  timeUnits?: string;
  time: number[];
  /** Reported series (empty when !ok). */
  series: Record<string, number[]>;
  /** Plain statements of fact derived from the run, e.g.
   * "DO_deficit peaks at 5.63 mg/L at day 2.0". Sent back to the model. */
  facts: string[];
}

/** Turn progress, for a responsive panel. */
export interface TurnProgress {
  phase: "thinking" | "validating" | "repairing" | "running" | "answering";
  /** The reply's "message" text streamed so far, when the bridge streams. */
  partialMessage?: string;
}

/** The JSON object every model reply must be (validated by `parseTurn`). */
export interface AssistantTurn {
  /** Plain-language reply shown to the user. */
  message: string;
  /** At most three follow-up questions. */
  questions: string[];
  /** Proposed model change, if any. */
  patch?: ModelPatch;
  suggestions: FeatureSuggestion[];
  /** The stage the conversation is in after this reply. */
  stage: InterviewStage;
  /** Simulations to run before answering (see RunRequest). At most 3. */
  runs?: RunRequest[];
}

/** Conversation state kept by the panel and passed back in on every turn. */
export interface Conversation {
  /** Visible history: user messages and the assistant's `message` text
   * (with its questions appended), oldest first. No system prompt. */
  history: ChatMessage[];
  stage: InterviewStage;
}

export interface TurnOptions {
  /** Language-model id passed through to `Complete`. */
  model: string;
  /** Repair attempts after the first reply fails to parse or validate. Default 3. */
  maxRepairs?: number;
  signal?: AbortSignal;
  /** Progress callback (phase changes and streamed message text). */
  onProgress?: (progress: TurnProgress) => void;
}

/** One failed attempt inside a turn, kept for the panel's "details" view. */
export interface AttemptFailure {
  attempt: number;
  kind: "parse" | "gauntlet";
  /** What was sent back to the model as the repair instruction. */
  feedback: string;
  findings?: Finding[];
}

export interface TurnResult {
  /** The accepted reply, or a fallback reply explaining what failed. */
  turn: AssistantTurn;
  /** Present when `turn.patch` passed the gauntlet: the patched model and
   * its diff against the input model, ready for review. */
  proposal?: { model: Model; diff: ModelDiff; warnings: Finding[] };
  /** True when every attempt failed; `turn.patch` is then absent. */
  gaveUp: boolean;
  failures: AttemptFailure[];
  /** Updated conversation (history extended, stage advanced). */
  conversation: Conversation;
  /** Sum over attempts, when reported. */
  cost?: number;
  /** Simulations run this turn, in request order, for the panel to chart. */
  evidence?: RunEvidence[];
}
