/**
 * SourceSink — the parameter table (model overview).
 *
 * Every constant converter in one sortable, filterable list with its value
 * editable in place, so a large model's knobs can be tuned without hunting
 * for them on the canvas (where they can be hidden).
 */

import { useMemo, useState } from "react";
import { missingConnectors } from "@sourcesink/explain";
import type { Converter } from "@sourcesink/model";

import { useEditor } from "../state/store";
import { constantConverters } from "./parameters";

export function ParametersPanel() {
  const model = useEditor((s) => s.model);
  const showConstants = useEditor((s) => s.showConstants);
  const setShowConstants = useEditor((s) => s.setShowConstants);
  const [filter, setFilter] = useState("");

  const constants = useMemo(() => constantConverters(model), [model]);
  const q = filter.trim().toLowerCase();
  const rows = q ? constants.filter((c) => c.name.toLowerCase().includes(q)) : constants;

  if (constants.length === 0) return null;
  return (
    <div className="insp-panel">
      <div className="insp-section-title">Parameters ({constants.length})</div>
      <label className="insp-toggle">
        <input
          type="checkbox"
          checked={showConstants}
          onChange={(e) => setShowConstants(e.target.checked)}
        />
        <span>Show on canvas</span>
      </label>
      {constants.length > 8 ? (
        <input
          className="insp-input"
          type="search"
          placeholder="Filter parameters"
          aria-label="Filter parameters"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      ) : null}
      <table className="insp-params">
        <tbody>
          {rows.map((c) => (
            <ParameterRow key={c.id} c={c} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ParameterRow({ c }: { c: Converter }) {
  const select = useEditor((s) => s.select);
  const updateElement = useEditor((s) => s.updateElement);
  const [draft, setDraft] = useState<string | null>(null);
  const commitDraft = () => {
    if (draft !== null && draft.trim() !== "" && draft.trim() !== c.equation.trim()) {
      updateElement(c.id, { equation: draft.trim() });
    }
    setDraft(null);
  };
  return (
    <tr>
      <th scope="row">
        <button type="button" className="insp-param-name" title={c.documentation || c.name} onClick={() => select([c.id])}>
          {c.name}
        </button>
      </th>
      <td>
        <input
          className="insp-input insp-mono"
          aria-label={`${c.name} value`}
          value={draft ?? c.equation}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDraft();
            if (e.key === "Escape") setDraft(null);
          }}
        />
      </td>
      <td className="insp-param-units">{c.units ?? ""}</td>
    </tr>
  );
}

/** A note when equations use names the diagram draws no link for. */
export function MissingLinksNote() {
  const model = useEditor((s) => s.model);
  const connectAll = useEditor((s) => s.connectAll);
  const count = useMemo(() => missingConnectors(model).length, [model]);
  if (count === 0) return null;
  return (
    <div className="insp-panel">
      <span className="insp-muted">
        {count === 1
          ? "One link used by an equation isn't drawn."
          : `${count} links used by equations aren't drawn.`}
      </span>
      <button type="button" className="insp-btn" onClick={() => connectAll()}>
        Connect all
      </button>
    </div>
  );
}
