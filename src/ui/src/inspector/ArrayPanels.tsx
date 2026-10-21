/**
 * SourceSink — array editing: the model's dimensions, and an element's
 * dimensions with optional per-element equations.
 */

import { useEffect, useState } from "react";

import type { Converter, Flow, Stock } from "@sourcesink/model";

import { useEditor } from "../state/store";
import { dimensionErrors, elementKeys, MAX_LISTED_ELEMENTS, parseLabels } from "./arrays";
import "./inspector.css";

interface DraftDim {
  name: string;
  labels: string;
}

/** Model-level dimensions: add, rename, relabel, remove. Committed on blur
 * when the whole list is valid. */
export function DimensionsPanel() {
  const dimensions = useEditor((s) => s.model.dimensions);
  const setDimensions = useEditor((s) => s.setDimensions);
  const toDraft = () => dimensions.map((d) => ({ name: d.name, labels: d.values.join(", ") }));
  const [draft, setDraft] = useState<DraftDim[]>(toDraft);

  useEffect(() => setDraft(toDraft()), [dimensions]);

  const parsed = draft.map((d) => ({ name: d.name.trim(), values: parseLabels(d.labels) }));
  const errors = dimensionErrors(parsed);
  const commit = (next = draft) => {
    const dims = next.map((d) => ({ name: d.name.trim(), values: parseLabels(d.labels) }));
    if (dimensionErrors(dims).length === 0) setDimensions(dims);
  };
  const update = (i: number, patch: Partial<DraftDim>) => setDraft(draft.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <div className="insp-panel">
      <div className="insp-section-title">Dimensions (arrays)</div>
      {draft.length === 0 ? (
        <span className="insp-muted">None. Add a dimension, such as Region with North, South, to array elements over it.</span>
      ) : null}
      {draft.map((d, i) => (
        <div key={i} className="insp-dim-row">
          <input
            className="insp-input insp-dim-name"
            value={d.name}
            placeholder="Region"
            aria-label="Dimension name"
            spellCheck={false}
            onChange={(e) => update(i, { name: e.target.value })}
            onBlur={() => commit()}
          />
          <input
            className="insp-input"
            value={d.labels}
            placeholder="North, South"
            aria-label={`${d.name || "Dimension"} labels`}
            spellCheck={false}
            onChange={(e) => update(i, { labels: e.target.value })}
            onBlur={() => commit()}
          />
          <button
            type="button"
            className="insp-btn insp-icon-btn"
            aria-label={`Remove ${d.name || "dimension"}`}
            onClick={() => {
              const next = draft.filter((_, j) => j !== i);
              setDraft(next);
              commit(next);
            }}
          >
            ×
          </button>
        </div>
      ))}
      {errors.length ? <div className="insp-msg insp-msg-error">{errors[0]}</div> : null}
      <button
        type="button"
        className="insp-btn"
        onClick={() => setDraft([...draft, { name: `Dim${draft.length + 1}`, labels: "" }])}
      >
        Add dimension
      </button>
    </div>
  );
}

/** An element's dimensions (checkboxes) and per-element equations. */
export function ArrayFields({ el }: { el: Stock | Flow | Converter }) {
  const model = useEditor((s) => s.model);
  const setElementDimensions = useEditor((s) => s.setElementDimensions);
  const setElementEquation = useEditor((s) => s.setElementEquation);
  if (model.dimensions.length === 0) return null;

  const spec = model.arrayed[el.name];
  const dims = spec?.dimensions ?? [];
  const toggle = (name: string, on: boolean) => {
    const next = model.dimensions.map((d) => d.name).filter((n) => (n === name ? on : dims.includes(n)));
    setElementDimensions(el.id, next);
  };
  const keys = dims.length ? elementKeys(model, dims) : [];

  return (
    <div className="insp-field">
      <div className="insp-label">Arrayed over</div>
      <div className="insp-dim-checks">
        {model.dimensions.map((d) => (
          <label key={d.name} className="insp-toggle">
            <input type="checkbox" checked={dims.includes(d.name)} onChange={(e) => toggle(d.name, e.target.checked)} />
            <span className="insp-toggle-label">
              {d.name} <span className="insp-muted">({d.values.length})</span>
            </span>
          </label>
        ))}
      </div>
      {dims.length ? (
        <>
          <span className="insp-muted">
            The equation above applies to all {keys.length} elements; use {dims.map((d) => `[${d}]`).join("")} to refer to
            the element being computed. Give individual elements their own equation below.
          </span>
          {keys.length <= MAX_LISTED_ELEMENTS ? (
            <div className="insp-elements">
              {keys.map((k) => (
                <ElementEquation
                  key={k}
                  label={`${el.name}[${k}]`}
                  value={spec?.elements?.[k] ?? ""}
                  onCommit={(v) => setElementEquation(el.id, k, v)}
                />
              ))}
            </div>
          ) : (
            <span className="insp-muted">{keys.length} elements — too many to list here.</span>
          )}
        </>
      ) : null}
    </div>
  );
}

function ElementEquation({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string | null) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="insp-element-row">
      <span className="insp-element-label">{label}</span>
      <input
        className="insp-input"
        value={draft}
        placeholder="apply to all"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(draft.trim() ? draft : null)}
      />
    </label>
  );
}
