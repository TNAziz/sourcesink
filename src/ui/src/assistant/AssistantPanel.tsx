/**
 * SourceSink — the Assistant panel.
 *
 * A side panel in the same shape as Analyze/Describe: pick a language model,
 * chat with the assistant, review the proposed model change and apply only the
 * parts you accept. Every model change still goes through `runGauntlet` and the
 * store's single `applyModel` undo step.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, MessageSquare, RotateCw, Send, Square, X } from "lucide-react";
import {
  runTurn,
  STAGES,
  type FeatureSuggestion,
  type InterviewStage,
  type TurnProgress,
} from "@sourcesink/assistant";
import type { Finding } from "@sourcesink/patch";
import { runGauntlet } from "@sourcesink/patch";

import { useEditor } from "../state/store.js";
import { assistantClient, type AssistantClient } from "./client.js";
import { EvidenceBlock } from "./EvidenceBlock.js";
import { StreamingReply } from "./StreamingReply.js";
import {
  appliedNote,
  buildSubsetPatch,
  DEFAULT_MODEL,
  diffRows,
  errorFindings,
  EXAMPLE_PROMPTS,
  formatCost,
  formatFieldValue,
  groupDiff,
  MODEL_STORAGE_KEY,
  SETUP_ADVICE,
  stageLabel,
  suggestionLabel,
  type DiffRow,
} from "./logic.js";
import {
  appendNote,
  appendTurn,
  appendUser,
  getSession,
  resolveProposal,
  subscribeSession,
  type ChatEntry,
} from "./session.js";
import "./assistant.css";

function loadModelName(): string {
  try {
    const saved = localStorage.getItem(MODEL_STORAGE_KEY);
    if (saved) return saved;
  } catch {
    /* private mode etc. — fall back to the default */
  }
  return DEFAULT_MODEL;
}

function storeModelName(name: string): void {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, name);
  } catch {
    /* private mode etc. — the choice just won't persist */
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type Status =
  | { state: "checking" }
  | { state: "available" }
  | { state: "unavailable"; reason: string };

export interface AssistantPanelProps {
  onClose: () => void;
  /** Called for a suggestion button; App decides which panel to open. */
  onSuggestion?: (suggestion: FeatureSuggestion) => void;
  /** Test seam; defaults to the browser/desktop client. */
  client?: AssistantClient;
}

export function AssistantPanel({ onClose, onSuggestion, client }: AssistantPanelProps) {
  const api = useMemo(() => client ?? assistantClient(), [client]);
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  const [modelName, setModelName] = useState(loadModelName);
  const [models, setModels] = useState<string[] | null>(null);
  const [status, setStatus] = useState<Status>({ state: "checking" });
  const [checkSeq, setCheckSeq] = useState(0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<TurnProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const panelRef = useRef<HTMLElement | null>(null);

  // Escape closes the panel only when focus is inside it; on the canvas
  // Escape belongs to the editor (deselect, cancel a tool).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && panelRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    void api
      .models()
      .then((list) => {
        if (alive && list.length > 0) setModels(list);
      })
      .catch(() => {
        /* fall back to the free-text input */
      });
    return () => {
      alive = false;
    };
  }, [api]);

  useEffect(() => {
    let alive = true;
    setStatus({ state: "checking" });
    void api
      .status()
      .then((result) => {
        if (!alive) return;
        setStatus(
          result.available
            ? { state: "available" }
            : { state: "unavailable", reason: result.reason ?? "OpenCode is not installed." },
        );
      })
      .catch((err: unknown) => {
        if (alive) setStatus({ state: "unavailable", reason: messageOf(err) });
      });
    return () => {
      alive = false;
    };
  }, [api, checkSeq]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const chooseModel = (name: string) => {
    setModelName(name);
    storeModelName(name);
  };

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setDraft("");
    setError(null);
    setBusy(true);
    setProgress({ phase: "thinking" });
    appendUser(text);

    const conversation = getSession().conversation;
    void runTurn(useEditor.getState().model, conversation, text, api.complete, {
      model: modelName,
      signal: controller.signal,
      onProgress: setProgress,
    })
      .then((result) => appendTurn(result))
      .catch((err: unknown) => {
        const message = messageOf(err);
        if ((err as { name?: string }).name === "AbortError") {
          appendNote("Turn cancelled.");
        } else {
          setError(message);
          appendNote(`The assistant could not be reached: ${message}`);
        }
      })
      .finally(() => {
        setBusy(false);
        setProgress(null);
        abortRef.current = null;
      });
  }, [api, busy, draft, modelName]);

  const cancel = () => abortRef.current?.abort();

  const useExample = (prompt: string) => {
    setDraft(prompt);
    textareaRef.current?.focus();
  };

  const applySelected = (id: number, selected: ReadonlySet<string>): Finding[] => {
    const entry = getSession().entries.find((e) => e.id === id);
    if (!entry || entry.role !== "assistant" || !entry.proposal) return [];

    const current = useEditor.getState().model;
    const subset = buildSubsetPatch(entry.proposal.patch, current, selected);
    if (subset.ops.length === 0) {
      return [{ stage: "schema", severity: "error", message: "Select at least one change." }];
    }

    const result = runGauntlet(current, subset);
    if (!result.ok || !result.model) {
      const errors = errorFindings(result.findings);
      return errors.length > 0
        ? errors
        : [{ stage: "smoke", severity: "error", message: "The changes did not pass validation." }];
    }

    useEditor.getState().applyModel(result.model);
    resolveProposal(id, appliedNote(subset));
    return [];
  };

  let lastAssistant: number | null = null;
  for (const entry of session.entries) if (entry.role === "assistant") lastAssistant = entry.id;

  return (
    <>
      {/* Non-modal on purpose: the user should watch the model take shape on
          the canvas while the conversation goes on. */}
      <aside ref={panelRef} className="ast-panel" role="complementary" aria-label="Assistant">
        <header className="ast-head">
          <span className="ast-title">
            <MessageSquare size={15} aria-hidden />
            Assistant
          </span>
          <ModelPicker model={modelName} models={models} onChange={chooseModel} />
          <button type="button" className="ast-close" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        {status.state === "unavailable" ? (
          <div className="ast-status" role="status">
            <AlertTriangle size={18} aria-hidden />
            <div>
              <p className="ast-status-title">The assistant is not available.</p>
              <p className="ast-status-reason">{status.reason}</p>
              <p className="ast-muted">{SETUP_ADVICE}</p>
              <button
                type="button"
                className="ast-btn"
                onClick={() => setCheckSeq((n) => n + 1)}
              >
                <RotateCw size={14} />
                Check again
              </button>
            </div>
          </div>
        ) : (
          <>
            <StageStrip stage={session.conversation.stage} />

            <div className="ast-body">
              {session.entries.length === 0 ? (
                <div className="ast-empty">
                  <p className="ast-empty-lead">
                    Describe a system in ordinary language. The assistant asks follow-up questions,
                    drafts the model, and points you to the analysis that answers your question.
                  </p>
                  <p className="ast-muted">Try one of these:</p>
                  <div className="ast-examples">
                    {EXAMPLE_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        className="ast-example"
                        onClick={() => useExample(prompt)}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {session.entries.map((entry) => (
                <ChatEntryView
                  key={entry.id}
                  entry={entry}
                  isLatestAssistant={entry.id === lastAssistant}
                  onSuggestion={onSuggestion}
                  onApply={applySelected}
                  onDiscard={(id) => resolveProposal(id, "Discarded the proposal.")}
                />
              ))}

              {busy ? <StreamingReply progress={progress} /> : null}
            </div>

            {error ? <p className="ast-error">{error}</p> : null}

            <form
              className="ast-composer"
              onSubmit={(event) => {
                event.preventDefault();
                send();
              }}
            >
              <textarea
                ref={textareaRef}
                className="ast-textarea"
                value={draft}
                placeholder="Describe the system you want to model…"
                aria-label="Message the assistant"
                rows={3}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
              />
              <div className="ast-composer-row">
                <span className="ast-hint">Enter sends · Shift+Enter for a new line</span>
                {busy ? (
                  <button type="button" className="ast-btn" onClick={cancel}>
                    <Square size={13} />
                    Cancel
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="ast-btn ast-btn-primary"
                    disabled={draft.trim() === ""}
                  >
                    <Send size={14} />
                    Send
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </aside>
    </>
  );
}

function ModelPicker({
  model,
  models,
  onChange,
}: {
  model: string;
  models: string[] | null;
  onChange: (name: string) => void;
}) {
  if (models === null) {
    return (
      <input
        className="ast-input ast-model-input"
        value={model}
        aria-label="Assistant model"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  const options = models.includes(model) ? models : [model, ...models];
  return (
    <select
      className="ast-select ast-model-input"
      value={model}
      aria-label="Assistant model"
      title={model}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

function StageStrip({ stage }: { stage: InterviewStage }) {
  const current = STAGES.indexOf(stage);
  return (
    <nav className="ast-stages" aria-label="Interview stage">
      {STAGES.map((name, index) => (
        <span
          key={name}
          className={`ast-stage${index === current ? " ast-stage-on" : ""}${
            index < current ? " ast-stage-done" : ""
          }`}
          aria-current={index === current ? "step" : undefined}
          title={stageLabel(name)}
        >
          {stageLabel(name)}
        </span>
      ))}
    </nav>
  );
}

function ChatEntryView({
  entry,
  isLatestAssistant,
  onSuggestion,
  onApply,
  onDiscard,
}: {
  entry: ChatEntry;
  isLatestAssistant: boolean;
  onSuggestion?: (suggestion: FeatureSuggestion) => void;
  onApply: (id: number, selected: ReadonlySet<string>) => Finding[];
  onDiscard: (id: number) => void;
}) {
  if (entry.role === "user") {
    return (
      <div className="ast-msg ast-msg-user">
        <p className="ast-text">{entry.text}</p>
      </div>
    );
  }
  if (entry.role === "note") {
    return <p className="ast-note">{entry.text}</p>;
  }

  return (
    <div className="ast-msg ast-msg-assistant">
      {entry.text ? <p className="ast-text">{entry.text}</p> : null}

      {entry.questions.length > 0 ? (
        <ol className="ast-questions">
          {entry.questions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ol>
      ) : null}

      {entry.evidence ? <EvidenceBlock evidence={entry.evidence} /> : null}

      {entry.cost !== undefined ? (
        <div className="ast-cost">Turn cost {formatCost(entry.cost)}</div>
      ) : null}

      {entry.failures.length > 0 ? (
        <details className="ast-details">
          <summary>Details ({entry.failures.length} repair attempt{entry.failures.length === 1 ? "" : "s"})</summary>
          <ul>
            {entry.failures.map((failure) => (
              <li key={failure.attempt}>
                Attempt {failure.attempt} ({failure.kind}): {failure.feedback}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {entry.proposal ? (
        <ProposalReview
          entryId={entry.id}
          proposal={entry.proposal}
          onApply={onApply}
          onDiscard={onDiscard}
        />
      ) : null}

      {entry.resolved ? <p className="ast-resolved">{entry.resolved}</p> : null}

      {isLatestAssistant && entry.suggestions.length > 0 ? (
        <div className="ast-suggestions">
          {entry.suggestions.map((suggestion) => (
            <button
              key={suggestion.feature}
              type="button"
              className="ast-suggestion"
              title={suggestion.reason}
              onClick={() => onSuggestion?.(suggestion)}
            >
              {suggestionLabel(suggestion)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProposalReview({
  entryId,
  proposal,
  onApply,
  onDiscard,
}: {
  entryId: number;
  proposal: NonNullable<Extract<ChatEntry, { role: "assistant" }>["proposal"]>;
  onApply: (id: number, selected: ReadonlySet<string>) => Finding[];
  onDiscard: (id: number) => void;
}) {
  const sections = useMemo(() => groupDiff(proposal.diff), [proposal.diff]);
  const rows = useMemo(() => diffRows(proposal.diff), [proposal.diff]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(rows.map((row) => row.key)),
  );
  const [findings, setFindings] = useState<Finding[]>([]);

  const toggle = (key: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section className="ast-proposal" aria-label="Proposed model change">
      <h4 className="ast-proposal-title">Proposed changes</h4>

      {sections.map((section) => (
        <div key={section.id} className="ast-diff-group">
          <div className="ast-diff-head">{section.title}</div>
          {section.rows.map((row) => (
            <label key={row.key} className="ast-diff-row">
              <input
                type="checkbox"
                checked={selected.has(row.key)}
                onChange={() => toggle(row.key)}
              />
              <span className="ast-diff-kind">{row.elementKind ?? "connector"}</span>
              <span className="ast-diff-name">{row.name}</span>
              <DiffFields row={row} />
            </label>
          ))}
        </div>
      ))}

      {proposal.warnings.length > 0 ? (
        <ul className="ast-warnings">
          {proposal.warnings.map((warning, index) => (
            <li key={`${warning.stage}:${index}:${warning.message}`}>{warning.message}</li>
          ))}
        </ul>
      ) : null}

      {findings.length > 0 ? (
        <ul className="ast-alert">
          {findings.map((finding, index) => (
            <li key={`${finding.stage}:${index}:${finding.message}`}>{finding.message}</li>
          ))}
        </ul>
      ) : null}

      <div className="ast-proposal-actions">
        <button
          type="button"
          className="ast-btn ast-btn-primary"
          disabled={rows.length > 0 && selected.size === 0}
          onClick={() => setFindings(onApply(entryId, selected))}
        >
          Apply selected
        </button>
        <button type="button" className="ast-btn" onClick={() => onDiscard(entryId)}>
          Discard
        </button>
      </div>
    </section>
  );
}

function DiffFields({ row }: { row: DiffRow }) {
  if (row.fields.length === 0) return <span className="ast-diff-meta">{row.change}</span>;
  return (
    <span className="ast-diff-fields">
      {row.fields.map((field) => (
        <span key={field.field} className="ast-diff-field">
          <span className="ast-diff-field-name">{field.field}</span>
          <FieldValue
            before={field.before}
            after={field.after}
            change={row.change}
          />
        </span>
      ))}
    </span>
  );
}

function FieldValue({
  before,
  after,
  change,
}: {
  before: unknown;
  after: unknown;
  change: DiffRow["change"];
}) {
  if (change === "changed") {
    return (
      <span className="ast-eq">
        <code>{formatFieldValue(before)}</code> → <code>{formatFieldValue(after)}</code>
      </span>
    );
  }
  return <code className="ast-eq">{formatFieldValue(change === "added" ? after : before)}</code>;
}
