/**
 * SourceSink — structure panels of the model overview: turning repeated
 * elements into arrays, and grouping the model into sectors.
 */

import { useEffect, useMemo, useState } from "react";
import { findArrayFamilies, type ArrayDimensionPlan } from "@sourcesink/analysis";
import type { Sector } from "@sourcesink/model";

import { useEditor } from "../state/store";

/** Suggests arrays for families of suffixed copies (`Area_1`, `Area_2`, …).
 * Hidden when the model has none. */
export function ArraySuggestionPanel() {
  const model = useEditor((s) => s.model);
  const convert = useEditor((s) => s.convertToArrays);
  const found = useMemo(() => findArrayFamilies(model), [model]);
  const [names, setNames] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setNames(found.map((p) => p.name));
    setSkipped(new Set());
    setError(null);
  }, [found]);

  if (found.length === 0) return null;
  const familyCount = found.reduce((n, p) => n + p.families.length, 0);
  const memberCount = found.reduce((n, p) => n + p.families.reduce((k, f) => k + f.members.length, 0), 0);
  const key = (p: number, base: string) => `${p}:${base}`;

  const apply = () => {
    const plans: ArrayDimensionPlan[] = found
      .map((p, i) => ({
        ...p,
        name: (names[i] ?? p.name).trim() || p.name,
        families: p.families.filter((f) => !skipped.has(key(i, f.base))),
      }))
      .filter((p) => p.families.length > 0);
    setError(convert(plans));
  };

  return (
    <div className="insp-panel">
      <div className="insp-section-title">Repeated elements</div>
      <span className="insp-muted">
        {memberCount} elements are copies of {familyCount} patterns. As arrays they become {familyCount} elements, and
        results stay the same.
      </span>
      {found.map((p, i) => (
        <div key={p.labels.join(",")} className="insp-array-plan">
          <label className="insp-field">
            <span className="insp-label">Dimension over {p.labels.join(", ")}</span>
            <input
              className="insp-input"
              value={names[i] ?? p.name}
              onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))}
            />
          </label>
          <div className="insp-array-families">
            {p.families.map((f) => (
              <label key={f.base} className="insp-toggle" title={f.members.map((m) => m.name).join(", ")}>
                <input
                  type="checkbox"
                  checked={!skipped.has(key(i, f.base))}
                  onChange={(e) => {
                    const next = new Set(skipped);
                    if (e.target.checked) next.delete(key(i, f.base));
                    else next.add(key(i, f.base));
                    setSkipped(next);
                  }}
                />
                <span>{f.base}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
      {error ? <span className="insp-error">{error}</span> : null}
      <button type="button" className="insp-btn" onClick={apply}>
        Convert to arrays
      </button>
    </div>
  );
}

/** Sectors: suggest a grouping, fold or unfold, rename and remove. */
export function SectorsPanel() {
  const sectors = useEditor((s) => s.model.sectors) ?? NO_SECTORS;
  const elementCount = useEditor((s) => s.model.stocks.length + s.model.flows.length + s.model.converters.length);
  const suggest = useEditor((s) => s.suggestSectors);
  const setAll = useEditor((s) => s.setAllSectorsCollapsed);

  if (sectors.length === 0 && elementCount < 12) return null;
  const allFolded = sectors.length > 0 && sectors.every((s) => s.collapsed);
  return (
    <div className="insp-panel">
      <div className="insp-section-title">Sectors</div>
      {sectors.length === 0 ? (
        <span className="insp-muted">
          Group the model into sectors that fold into single boxes, for an overview you can read at a glance.
        </span>
      ) : (
        <>
          {sectors.map((s) => (
            <SectorRow key={s.id} sector={s} />
          ))}
          <button type="button" className="insp-btn" onClick={() => setAll(!allFolded)}>
            {allFolded ? "Unfold all" : "Fold all (overview)"}
          </button>
        </>
      )}
      <button type="button" className="insp-btn" onClick={() => suggest()}>
        {sectors.length === 0 ? "Suggest sectors" : "Suggest again"}
      </button>
    </div>
  );
}

const NO_SECTORS: Sector[] = [];

function SectorRow({ sector }: { sector: Sector }) {
  const rename = useEditor((s) => s.renameSector);
  const toggle = useEditor((s) => s.toggleSector);
  const remove = useEditor((s) => s.deleteSector);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== sector.name) setError(rename(sector.id, draft));
    setDraft(null);
  };
  return (
    <div className="insp-sector-row">
      <input
        className="insp-input"
        aria-label="Sector name"
        value={draft ?? sector.name}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
      />
      <span className="insp-sector-count" title="Elements">
        {sector.members.length}
      </span>
      <button type="button" className="insp-btn insp-btn-small" onClick={() => toggle(sector.id)}>
        {sector.collapsed ? "Unfold" : "Fold"}
      </button>
      <button
        type="button"
        className="insp-btn insp-btn-small"
        aria-label={`Remove sector ${sector.name}`}
        title="Remove the sector (its elements stay)"
        onClick={() => remove(sector.id)}
      >
        ×
      </button>
      {error ? <span className="insp-error">{error}</span> : null}
    </div>
  );
}

/** Element inspector: which sector the element is in. */
export function SectorField({ id, name }: { id: string; name: string }) {
  const sectors = useEditor((s) => s.model.sectors) ?? NO_SECTORS;
  const moveToSector = useEditor((s) => s.moveToSector);
  if (sectors.length === 0) return null;
  const current = sectors.find((s) => s.members.includes(name));
  return (
    <label className="insp-field">
      <span className="insp-label">Sector</span>
      <select
        className="insp-select"
        value={current?.id ?? ""}
        onChange={(e) => moveToSector([id], e.target.value || null)}
      >
        <option value="">None</option>
        {sectors.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Several elements selected: put them in a new sector. */
export function GroupAsSector({ ids }: { ids: string[] }) {
  const addSector = useEditor((s) => s.addSector);
  const count = useEditor((s) => s.model.sectors?.length ?? 0);
  const [name, setName] = useState("");
  return (
    <div className="insp-inputs">
      <input
        className="insp-input"
        placeholder={`Sector ${count + 1}`}
        aria-label="New sector name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button
        type="button"
        className="insp-btn"
        onClick={() => {
          addSector(name.trim() || `Sector ${count + 1}`, ids);
          setName("");
        }}
      >
        Group as sector
      </button>
    </div>
  );
}
