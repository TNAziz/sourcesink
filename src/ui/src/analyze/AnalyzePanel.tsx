/**
 * SourceSink — Analyze drawer.
 *
 * One side panel with three tabs (Calibrate, Sensitivity, Uncertainty) that
 * share a single parameter list, so the same ranges flow through fitting,
 * screening and ensemble sampling. All heavy work runs in a Web Worker; the
 * panel only owns presentation state.
 *
 * The shell keeps the panel mounted once it has been opened and only hides it
 * when closed, so a long run keeps going (and its results stay) while the
 * user works on the model.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical, X } from "lucide-react";

import { useEditor } from "../state/store.js";
import { CalibrateTab } from "./CalibrateTab.js";
import { SensitivityTab } from "./SensitivityTab.js";
import { UncertaintyTab } from "./UncertaintyTab.js";
import { initialParameterRows, parameterRowFor, type ParameterRow } from "./helpers.js";
import type { AnalyzeWorkerEvents, RunOutcome } from "./useAnalyzeWorker.js";
import "./analyze.css";

export type Tab = "calibrate" | "sensitivity" | "uncertainty";

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

export interface AnalyzePanelProps {
  onClose: () => void;
  /** Hidden panels keep running; defaults to open. */
  open?: boolean;
  /** Tab and parameters to switch to; applied whenever `initialKey` changes. */
  initial?: AnalyzeInitial;
  initialKey?: number;
  /** The tabs with a run in progress, whenever that set changes. */
  onActivity?: (running: Tab[]) => void;
  /** A run finished or failed. */
  onFinished?: (tab: Tab, label: string, outcome: RunOutcome) => void;
}

export function AnalyzePanel({
  onClose,
  open = true,
  initial,
  initialKey,
  onActivity,
  onFinished,
}: AnalyzePanelProps) {
  const model = useEditor((s) => s.model);
  const [tab, setTab] = useState<Tab>(initial?.tab ?? "calibrate");
  const [params, setParams] = useState<ParameterRow[]>(() =>
    initial?.elements
      ? initial.elements.map((name) => parameterRowFor(model, name))
      : initialParameterRows(model),
  );

  // Another panel (the assistant) asked for a specific tab and parameters.
  const appliedKey = useRef(initialKey);
  useEffect(() => {
    if (initialKey === appliedKey.current) return;
    appliedKey.current = initialKey;
    if (!initial) return;
    setTab(initial.tab);
    if (initial.elements) {
      const current = useEditor.getState().model;
      setParams(initial.elements.map((name) => parameterRowFor(current, name)));
    }
  }, [initial, initialKey]);

  const callbacks = useRef({ onActivity, onFinished });
  callbacks.current = { onActivity, onFinished };
  const running = useRef(new Set<Tab>());
  const [busyTabs, setBusyTabs] = useState<Tab[]>([]);
  const events = useMemo(() => {
    const make = (id: Tab): AnalyzeWorkerEvents => ({
      onRunningChange: (busy) => {
        const before = running.current.has(id);
        if (busy === before) return;
        if (busy) running.current.add(id);
        else running.current.delete(id);
        const list = TABS.filter((t) => running.current.has(t.id)).map((t) => t.id);
        setBusyTabs(list);
        callbacks.current.onActivity?.(list);
      },
      onSettle: (outcome) =>
        callbacks.current.onFinished?.(id, TABS.find((t) => t.id === id)!.label, outcome),
    });
    return { calibrate: make("calibrate"), sensitivity: make("sensitivity"), uncertainty: make("uncertainty") };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {open ? <div className="ana-backdrop" onClick={onClose} aria-hidden="true" /> : null}
      <aside
        className={open ? "ana-panel" : "ana-panel ana-panel-hidden"}
        role="dialog"
        aria-label="Analyze"
        aria-modal="true"
        aria-hidden={!open}
      >
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
              {busyTabs.includes(entry.id) ? (
                <span className="ana-tab-busy" title="Running" aria-label="running" />
              ) : null}
            </button>
          ))}
        </nav>

        <div className="ana-body">
          <div className={tab === "calibrate" ? "ana-pane" : "ana-pane ana-pane-hidden"}>
            <CalibrateTab model={model} params={params} onParamsChange={setParams} events={events.calibrate} />
          </div>
          <div className={tab === "sensitivity" ? "ana-pane" : "ana-pane ana-pane-hidden"}>
            <SensitivityTab model={model} params={params} onParamsChange={setParams} events={events.sensitivity} />
          </div>
          <div className={tab === "uncertainty" ? "ana-pane" : "ana-pane ana-pane-hidden"}>
            <UncertaintyTab model={model} params={params} onParamsChange={setParams} events={events.uncertainty} />
          </div>
        </div>
      </aside>
    </>
  );
}
