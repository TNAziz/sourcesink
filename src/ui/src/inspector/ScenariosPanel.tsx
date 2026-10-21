/**
 * SourceSink — model scenarios: named equation overrides plus optional run
 * changes, and which one (if any) the next run applies.
 *
 * Edits are committed through the store as undoable model steps; the active
 * selection is view state and never dirties the model.
 */

import { useEffect, useState } from "react";

import type { Scenario } from "@sourcesink/model";

import { useEditor } from "../state/store";
import {
  overridesToRows,
  parseOverrideValue,
  rowsToOverrides,
  uniqueScenarioName,
  type OverrideRow,
} from "./scenarios";
import "./inspector.css";

/** Stable empty list: a selector must not return a new array each call, or
 * React re-renders forever. */
const NO_SCENARIOS: Scenario[] = [];

export function ScenariosPanel() {
  const scenarios = useEditor((s) => s.model.scenarios) ?? NO_SCENARIOS;
  const activeScenario = useEditor((s) => s.activeScenario);
  const addScenario = useEditor((s) => s.addScenario);
  const setActiveScenario = useEditor((s) => s.setActiveScenario);

  return (
    <div className="insp-panel">
      <div className="insp-section-title">Scenarios</div>

      <label className="insp-field">
        <span className="insp-label">Active scenario</span>
        <select
          className="insp-select"
          value={activeScenario ?? ""}
          onChange={(e) => setActiveScenario(e.target.value || null)}
        >
          <option value="">None</option>
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {scenarios.length === 0 ? (
        <span className="insp-muted">
          None yet. A scenario overrides element equations (and optionally the stop time) for one run.
        </span>
      ) : null}

      {scenarios.map((scenario) => (
        <ScenarioCard key={scenario.id} scenario={scenario} />
      ))}

      <button type="button" className="insp-btn" onClick={() => addScenario(uniqueScenarioName(scenarios))}>
        Add scenario
      </button>
    </div>
  );
}

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const model = useEditor((s) => s.model);
  const updateScenario = useEditor((s) => s.updateScenario);
  const deleteScenario = useEditor((s) => s.deleteScenario);

  const elements = [...model.stocks, ...model.flows, ...model.converters].map((e) => e.name);
  const rows = overridesToRows(scenario.overrides);
  const commitRows = (next: OverrideRow[]) =>
    updateScenario(scenario.id, { overrides: rowsToOverrides(next) });

  return (
    <div className="insp-inputs insp-scenario">
      <div className="insp-scenario-head">
        <ScenarioName scenario={scenario} />
        <span className="insp-muted">
          {rows.length} override{rows.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          className="insp-btn insp-icon-btn"
          aria-label={`Delete ${scenario.name}`}
          onClick={() => deleteScenario(scenario.id)}
        >
          ×
        </button>
      </div>

      <div className="insp-field">
        <div className="insp-label">Overrides</div>
        {rows.map((row, index) => (
          <OverrideRowView
            key={`${scenario.id}:${index}:${row.name}`}
            name={row.name}
            value={row.value}
            elements={elements}
            onRename={(name) => commitRows(rows.map((r, i) => (i === index ? { ...r, name } : r)))}
            onValue={(value) => commitRows(rows.map((r, i) => (i === index ? { ...r, value: String(value) } : r)))}
            onDelete={() => commitRows(rows.filter((_, i) => i !== index))}
          />
        ))}
        <button
          type="button"
          className="insp-btn insp-btn-tiny"
          disabled={elements.length === 0}
          onClick={() => {
            const name = elements.find((n) => !rows.some((r) => r.name === n)) ?? elements[0];
            if (name) commitRows([...rows, { name, value: "0" }]);
          }}
        >
          Add override
        </button>
      </div>

      <ScenarioStop scenario={scenario} />
    </div>
  );
}

/** The scenario's name; edits are made unique against the other scenarios. */
function ScenarioName({ scenario }: { scenario: Scenario }) {
  const scenarios = useEditor((s) => s.model.scenarios) ?? NO_SCENARIOS;
  const updateScenario = useEditor((s) => s.updateScenario);
  const [draft, setDraft] = useState(scenario.name);

  useEffect(() => setDraft(scenario.name), [scenario.name]);

  const commit = () => {
    const name = draft.trim();
    if (!name || name === scenario.name) {
      setDraft(scenario.name);
      return;
    }
    const unique = uniqueScenarioName(
      scenarios.filter((s) => s.id !== scenario.id),
      name,
    );
    updateScenario(scenario.id, { name: unique });
    setDraft(unique);
  };

  return (
    <input
      className="insp-input"
      value={draft}
      aria-label="Scenario name"
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          setDraft(scenario.name);
        }
      }}
    />
  );
}

function OverrideRowView({
  name,
  value,
  elements,
  onRename,
  onValue,
  onDelete,
}: {
  name: string;
  value: string;
  elements: string[];
  onRename: (name: string) => void;
  onValue: (value: string | number) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  return (
    <div className="insp-override-row">
      <select
        className="insp-select"
        value={name}
        aria-label={`Element overridden by ${name}`}
        onChange={(e) => onRename(e.target.value)}
      >
        {elements.map((element) => (
          <option key={element} value={element}>
            {element}
          </option>
        ))}
        {elements.includes(name) ? null : <option value={name}>{name}</option>}
      </select>
      <input
        className="insp-input insp-mono"
        value={draft}
        aria-label={`${name} value`}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onValue(parseOverrideValue(draft))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onValue(parseOverrideValue(draft));
          }
        }}
      />
      <button type="button" className="insp-btn insp-icon-btn" aria-label={`Remove override ${name}`} onClick={onDelete}>
        ×
      </button>
    </div>
  );
}

/** Optional stop time; blank removes the override and keeps the model's. */
function ScenarioStop({ scenario }: { scenario: Scenario }) {
  const updateScenario = useEditor((s) => s.updateScenario);
  const stop = scenario.run?.stop;
  const [draft, setDraft] = useState(stop === undefined ? "" : String(stop));

  useEffect(() => setDraft(stop === undefined ? "" : String(stop)), [stop]);

  const commit = () => {
    const text = draft.trim();
    const run = { ...(scenario.run ?? {}) };
    if (text === "") {
      delete run.stop;
    } else {
      const n = Number(text);
      if (!Number.isFinite(n)) {
        setDraft(stop === undefined ? "" : String(stop));
        return;
      }
      run.stop = n;
    }
    updateScenario(scenario.id, { run: Object.keys(run).length > 0 ? run : undefined });
  };

  return (
    <label className="insp-field insp-field-narrow">
      <span className="insp-label">Stop time (optional)</span>
      <input
        className="insp-input"
        value={draft}
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        placeholder="model stop"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}
