/**
 * SourceSink — Assistant session state.
 *
 * The panel is mounted only while it is open; conversation and any pending
 * proposal live here (module-level, like the canvas toasts) so closing and
 * reopening the panel keeps the session. Nothing is persisted.
 */

import {
  newConversation,
  type Conversation,
  type FeatureSuggestion,
  type RunEvidence,
  type TurnResult,
} from "@sourcesink/assistant";
import type { Model } from "@sourcesink/model";
import type { Finding, ModelDiff, ModelPatch } from "@sourcesink/patch";

export interface PendingProposal {
  model: Model;
  diff: ModelDiff;
  warnings: Finding[];
  /** The patch that produced the proposal; the review rebuilds a subset. */
  patch: ModelPatch;
}

export type ChatEntry =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "note"; text: string }
  | {
      id: number;
      role: "assistant";
      text: string;
      questions: string[];
      suggestions: FeatureSuggestion[];
      cost?: number;
      /** Repair failures reported by the turn. */
      failures: TurnResult["failures"];
      proposal?: PendingProposal;
      /** Set once the user applied or discarded the proposal. */
      resolved?: string;
      /** Simulations run to ground this reply, in request order. */
      evidence?: RunEvidence[];
    };

export interface AssistantSession {
  entries: ChatEntry[];
  conversation: Conversation;
}

let nextId = 1;
let state: AssistantSession = { entries: [], conversation: newConversation() };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getSession(): AssistantSession {
  return state;
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(next: AssistantSession): void {
  state = next;
  emit();
}

/** Start over. Used by tests and never by the app. */
export function resetSession(): void {
  nextId = 1;
  set({ entries: [], conversation: newConversation() });
}

export function appendUser(text: string): void {
  set({ ...state, entries: [...state.entries, { id: nextId++, role: "user", text }] });
}

export function appendNote(text: string): void {
  set({
    entries: [...state.entries, { id: nextId++, role: "note", text }],
    conversation: {
      ...state.conversation,
      history: [...state.conversation.history, { role: "assistant", content: text }],
    },
  });
}

/** Append the assistant's reply and adopt the returned conversation. */
export function appendTurn(result: TurnResult): void {
  const { turn } = result;
  const entry: ChatEntry = {
    id: nextId++,
    role: "assistant",
    text: turn.message,
    questions: turn.questions,
    suggestions: turn.suggestions,
    failures: result.failures,
    ...(result.cost !== undefined ? { cost: result.cost } : {}),
    ...(result.proposal && turn.patch
      ? { proposal: { ...result.proposal, patch: turn.patch } }
      : {}),
    ...(result.evidence ? { evidence: result.evidence } : {}),
  };
  set({ entries: [...state.entries, entry], conversation: result.conversation });
}

/** Mark a proposal resolved, drop it from the review list and tell the next
 * turn (via history) what happened. */
export function resolveProposal(id: number, note: string): void {
  const entries = state.entries.map((entry) =>
    entry.id === id && entry.role === "assistant"
      ? { ...entry, proposal: undefined, resolved: note }
      : entry,
  );
  set({
    entries,
    conversation: {
      ...state.conversation,
      history: [...state.conversation.history, { role: "assistant", content: note }],
    },
  });
}
