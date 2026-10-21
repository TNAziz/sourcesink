/**
 * SourceSink — the live status line while an assistant turn runs.
 *
 * Shows what the turn is doing (thinking, validating, repairing, running a
 * simulation, writing the reply) and the reply text as the bridge streams it.
 */

import type { TurnProgress } from "@sourcesink/assistant";
import { Loader2 } from "lucide-react";

const PHASE_LABELS: Record<TurnProgress["phase"], string> = {
  thinking: "Thinking…",
  validating: "Checking the reply…",
  repairing: "Fixing the reply…",
  running: "Running the model…",
  answering: "Writing the reply…",
};

export function phaseLabel(phase: TurnProgress["phase"]): string {
  return PHASE_LABELS[phase];
}

export function StreamingReply({ progress }: { progress: TurnProgress | null }) {
  const phase = progress?.phase ?? "thinking";
  const partial = progress?.partialMessage ?? "";

  return (
    <div
      className="ast-progress"
      role="status"
      aria-live="polite"
      style={{ flexDirection: "column", alignItems: "flex-start" }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Loader2 size={14} className="ast-spin" aria-hidden />
        {phaseLabel(phase)}
      </span>
      {partial ? (
        <span style={{ whiteSpace: "pre-wrap", textAlign: "left" }}>{partial}</span>
      ) : null}
    </div>
  );
}
