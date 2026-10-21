/**
 * SourceSink — run settings panel (start/stop/DT/save interval/method).
 *
 * Numeric fields are edited as text so a partial value is never clobbered; the
 * draft is validated on every keystroke but only committed on blur/Enter, and
 * only when every field is valid.
 */

import { useEffect, useMemo, useState } from "react";

import type { RunSpec } from "@sourcesink/model";

import { useEditor } from "../state/store";
import {
  runToDraft,
  validateRunDraft,
  type RunDraft,
  type RunField,
} from "./runspec";
import "./inspector.css";

export function RunSpecPanel() {
  const run = useEditor((s) => s.model.run);
  const setRunSpec = useEditor((s) => s.setRunSpec);

  const [draft, setDraft] = useState<RunDraft>(() => runToDraft(run));
  const [timeUnits, setTimeUnits] = useState(run.timeUnits ?? "");

  useEffect(() => {
    setDraft(runToDraft(run));
  }, [run.start, run.stop, run.dt, run.saveEvery]);

  useEffect(() => {
    setTimeUnits(run.timeUnits ?? "");
  }, [run.timeUnits]);

  const { errors, values, valid } = useMemo(() => validateRunDraft(draft), [draft]);

  const setField = (field: RunField, value: string) =>
    setDraft((prev) => ({ ...prev, [field]: value }));

  const commitNumbers = () => {
    if (valid) setRunSpec(values);
  };

  return (
    <div className="insp-panel insp-runspec">
      <div className="insp-section-title">Run settings</div>

      <div className="insp-grid">
        <NumberField
          label="Start"
          value={draft.start}
          error={errors.start}
          onChange={(v) => setField("start", v)}
          onCommit={commitNumbers}
        />
        <NumberField
          label="Stop"
          value={draft.stop}
          error={errors.stop}
          onChange={(v) => setField("stop", v)}
          onCommit={commitNumbers}
        />
        <NumberField
          label="DT"
          value={draft.dt}
          error={errors.dt}
          onChange={(v) => setField("dt", v)}
          onCommit={commitNumbers}
        />
        <NumberField
          label="Save every"
          value={draft.saveEvery}
          error={errors.saveEvery}
          onChange={(v) => setField("saveEvery", v)}
          onCommit={commitNumbers}
        />
      </div>

      <label className="insp-field">
        <span className="insp-label">Time units</span>
        <input
          className="insp-input"
          value={timeUnits}
          spellCheck={false}
          autoComplete="off"
          placeholder="e.g. Year"
          onChange={(e) => setTimeUnits(e.target.value)}
          onBlur={() => setRunSpec({ timeUnits })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setRunSpec({ timeUnits });
            }
          }}
        />
      </label>

      <label className="insp-field">
        <span className="insp-label">Method</span>
        <select
          className="insp-select"
          value={run.integration ?? "euler"}
          onChange={(e) =>
            setRunSpec({ integration: e.target.value as RunSpec["integration"] })
          }
        >
          <option value="euler">Euler</option>
          <option value="rk2">Runge-Kutta 2</option>
          <option value="rk4">Runge-Kutta 4</option>
          <option value="rk45">Adaptive (RK45)</option>
        </select>
      </label>
    </div>
  );
}

function NumberField({
  label,
  value,
  error,
  onChange,
  onCommit,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <label className="insp-field insp-field-narrow">
      <span className="insp-label">{label}</span>
      <input
        className={`insp-input${error ? " insp-invalid" : ""}`}
        value={value}
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          }
        }}
      />
      <span className="insp-msg insp-msg-error">{error ?? ""}</span>
    </label>
  );
}
