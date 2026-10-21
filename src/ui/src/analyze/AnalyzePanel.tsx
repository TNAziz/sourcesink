/**
 * SourceSink — Analyze drawer.
 *
 * One side panel with three tabs (Calibrate, Sensitivity, Uncertainty) that
 * share a single parameter list, so the same ranges flow through fitting,
 * screening and ensemble sampling. All heavy work runs in a Web Worker; the
 * panel only owns presentation state.
 */

import { useEffect, useState } from "react";
import { FlaskConical, X } from "lucide-react";

import { useEditor } from "../state/store.js";
import { CalibrateTab } from "./CalibrateTab.js";
import { SensitivityTab } from "./SensitivityTab.js";
import { UncertaintyTab } from "./UncertaintyTab.js";
import { initialParameterRows, parameterRowFor, type ParameterRow } from "./helpers.js";
import "./analyze.css";

type Tab = "calibrate" | "sensitivity" | "uncertainty";

/** Starting tab and parameters when another panel (the assistant) opens this one. */
export interface AnalyzeInitial {
  tab: Tab;
  elements?: string[];
}

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: "calibrate", label: "Calibrate", hint: "Fit parameters to observations" },
  { id: "sensitivity", label: "Sensitivity", hint: "Rank parameters with Morris or Sobol" },
  { id: "uncertainty", label: "Uncertainty", hint: "Ensemble median and percentile bands" },
];

export function AnalyzePanel({ onClose, initial }: { onClose: () => void; initial?: AnalyzeInitial }) {
  const model = useEditor((s) => s.model);
  const [tab, setTab] = useState<Tab>(initial?.tab ?? "calibrate");
  const [params, setParams] = useState<ParameterRow[]>(() =>
    initial?.elements
      ? initial.elements.map((name) => parameterRowFor(model, name))
      : initialParameterRows(model),
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="ana-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="ana-panel" role="dialog" aria-label="Analyze" aria-modal="true">
        <header className="ana-head">
          <span className="ana-title">
            <FlaskConical size={15} aria-hidden />
            Analyze
          </span>
          <span className="ana-model" title={model.name}>
            {model.name || "Untitled"}
          </span>
          <button type="button" className="ana-close" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <nav className="ana-tabs" role="tablist" aria-label="Analysis">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              title={entry.hint}
              className={tab === entry.id ? "ana-tab ana-tab-on" : "ana-tab"}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="ana-body">
          <div className={tab === "calibrate" ? "ana-pane" : "ana-pane ana-pane-hidden"}>
            <CalibrateTab model={model} params={params} onParamsChange={setParams} />
          </div>
          <div className={tab === "sensitivity" ? "ana-pane" : "ana-pane ana-pane-hidden"}>
            <SensitivityTab model={model} params={params} onParamsChange={setParams} />
          </div>
          <div className={tab === "uncertainty" ? "ana-pane" : "ana-pane ana-pane-hidden"}>
            <UncertaintyTab model={model} params={params} onParamsChange={setParams} />
          </div>
        </div>
      </aside>
    </>
  );
}
