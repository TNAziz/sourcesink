/**
 * SourceSink — properties inspector (right panel).
 *
 * Shows a model overview when nothing is selected, and a full element editor
 * when exactly one stock/flow/converter is selected. All state flows through
 * the shared editor store; this module owns only local field drafts.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { BUILTINS, CLOCK_VARIABLES, CONSTANTS, ParseError, parse } from "@sourcesink/engine";
import type { Converter, Flow, Model, Stock } from "@sourcesink/model";

import { elementById, flowEnds, useEditor } from "../state/store";
import {
  applyCompletion,
  matchCompletions,
  tokenAtCursor,
  type Completion,
} from "./autocomplete";
import { analyzeConnections } from "./connections";
import { RunSpecPanel } from "./RunSpecPanel";
import { ArrayFields, DimensionsPanel } from "./ArrayPanels";
import { ProvenanceField } from "./ProvenanceField";
import { UnitWarnings } from "./UnitWarnings";
import { ScenariosPanel } from "./ScenariosPanel";
import { MissingLinksNote, ParametersPanel } from "./ParametersPanel";
import { ArraySuggestionPanel, GroupAsSector, SectorField, SectorsPanel } from "./StructurePanels";
import "./inspector.css";

/** The three element kinds the inspector can edit. */
type Editable = Stock | Flow | Converter;

const KIND_LABEL: Record<Editable["kind"], string> = {
  stock: "Stock",
  flow: "Flow",
  converter: "Converter",
};

const NO_MATCHES: Completion[] = [];
const MAX_MENU_ROWS = 8;

/** Root panel. Rebuilds the whole tree when the selection identity changes. */
export function Inspector() {
  const model = useEditor((s) => s.model);
  const selection = useEditor((s) => s.selection);

  let body: ReactNode;
  if (selection.length > 1) {
    body = <MultiSelection ids={selection} />;
  } else {
    const element = selection.length === 1 ? elementById(model, selection[0]) : undefined;
    body = element ? <ElementEditor key={element.id} el={element} /> : <ModelOverview model={model} />;
  }

  return (
    <aside className="insp" aria-label="Properties">
      {body}
    </aside>
  );
}

function KindDot({ kind }: { kind: Editable["kind"] }) {
  return <span className="insp-dot" style={{ background: `var(--${kind})` }} aria-hidden />;
}

/* ---------------------------------------------------------------------------
 * Nothing selected
 * ------------------------------------------------------------------------- */

function ModelOverview({ model }: { model: Model }) {
  return (
    <div className="insp-panel">
      <section className="insp-block">
        <div className="insp-label">Model</div>
        <h2 className="insp-model-name">{model.name || "Untitled"}</h2>
      </section>

      <section className="insp-block insp-counts">
        <CountChip kind="stock" count={model.stocks.length} />
        <CountChip kind="flow" count={model.flows.length} />
        <CountChip kind="converter" count={model.converters.length} />
      </section>

      {model.documentation ? (
        <section className="insp-block">
          <div className="insp-label">Documentation</div>
          <p className="insp-model-doc">{model.documentation}</p>
        </section>
      ) : null}

      <MissingLinksNote />
      <ArraySuggestionPanel />
      <SectorsPanel />
      <RunSpecPanel />
      <ParametersPanel />
      <DimensionsPanel />
      <ScenariosPanel />
    </div>
  );
}

function CountChip({ kind, count }: { kind: Editable["kind"]; count: number }) {
  return (
    <div className="insp-count">
      <KindDot kind={kind} />
      <span className="insp-count-num">{count}</span>
      <span className="insp-count-word">
        {KIND_LABEL[kind]}
        {count === 1 ? "" : "s"}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Several selected
 * ------------------------------------------------------------------------- */

function MultiSelection({ ids }: { ids: string[] }) {
  const deleteElements = useEditor((s) => s.deleteElements);
  return (
    <div className="insp-panel">
      <p className="insp-multi">{ids.length} elements selected</p>
      <GroupAsSector ids={ids} />
      <button
        type="button"
        className="insp-btn insp-delete"
        onClick={() => deleteElements(ids)}
      >
        Delete {ids.length} elements
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * One element selected
 * ------------------------------------------------------------------------- */

function ElementEditor({ el }: { el: Editable }) {
  const model = useEditor((s) => s.model);
  const updateElement = useEditor((s) => s.updateElement);
  const role = el.kind === "flow" ? conveyorRole(model, el) : null;
  const computedExit = role === "exit" || role === "queue";
  const deleteElements = useEditor((s) => s.deleteElements);

  return (
    <div className="insp-panel">
      <div className="insp-head">
        <span className="insp-badge">
          <KindDot kind={el.kind} />
          {KIND_LABEL[el.kind]}
        </span>
      </div>

      <NameField el={el} />
      {computedExit ? (
        <div className="insp-field">
          <div className="insp-label">Equation</div>
          <span className="insp-muted">
            {role === "queue"
              ? "Computed: a queue passes its contents through, first in, first out."
              : "Computed: material leaves after the conveyor's transit time."}
          </span>
        </div>
      ) : (
        <>
          {role === "oven" ? (
            <span className="insp-muted">This equation is the oven's cook time, sampled when its door closes.</span>
          ) : null}
          <EquationEditor el={el} />
        </>
      )}
      {el.kind !== "stock" && !computedExit ? <InputsCheck el={el} /> : null}
      <ArrayFields el={el} />

      <TextField
        label="Units"
        value={el.units ?? ""}
        placeholder="e.g. people/year"
        onCommit={(units) => updateElement(el.id, { units })}
      />
      <UnitWarnings element={el.name} />
      <SectorField id={el.id} name={el.name} />
      <TextField
        label="Documentation"
        value={el.documentation ?? ""}
        placeholder="Notes about this element"
        multiline
        onCommit={(documentation) => updateElement(el.id, { documentation })} 
      />
      <ProvenanceField provenance={el.provenance} />

      {el.kind === "stock" ? <StockExtras el={el} /> : null}
      {el.kind === "flow" ? <FlowExtras el={el} /> : null}

      <div className="insp-actions">
        <button
          type="button"
          className="insp-btn insp-delete"
          onClick={() => deleteElements([el.id])}
        >
          Delete {KIND_LABEL[el.kind].toLowerCase()}
        </button>
      </div>
    </div>
  );
}

function NameField({ el }: { el: Editable }) {
  const renameElement = useEditor((s) => s.renameElement);
  const [draft, setDraft] = useState(el.name);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(el.name);
    setError(null);
  }, [el.id, el.name]);

  useEffect(() => {
    const focus = () => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    };
    window.addEventListener("sourcesink:focus-name", focus);
    return () => window.removeEventListener("sourcesink:focus-name", focus);
  }, []);

  const commit = () => {
    if (draft === el.name) {
      setError(null);
      return;
    }
    const message = renameElement(el.id, draft);
    if (message) {
      setError(message);
      setDraft(el.name);
    } else {
      setError(null);
    }
  };

  return (
    <div className="insp-field">
      <label className="insp-label" htmlFor={`insp-name-${el.id}`}>
        Name
      </label>
      <input
        id={`insp-name-${el.id}`}
        ref={inputRef}
        className={`insp-input${error ? " insp-invalid" : ""}`}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setDraft(el.name);
            setError(null);
          }
        }}
      />
      <FieldMessage>{error}</FieldMessage>
    </div>
  );
}

function EquationEditor({ el }: { el: Editable }) {
  const model = useEditor((s) => s.model);
  const updateElement = useEditor((s) => s.updateElement);

  const [draft, setDraft] = useState(el.equation);
  const [cursor, setCursor] = useState(el.equation.length);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(el.equation);
    setCursor(el.equation.length);
    setOpen(false);
    setActive(0);
  }, [el.id, el.equation]);

  const candidates = useMemo<Completion[]>(() => {
    const elements: Completion[] = [
      ...model.stocks,
      ...model.flows,
      ...model.converters,
      ...model.graphFunctions,
    ]
      .filter((e) => e.id !== el.id)
      .map((e) => ({
        label: e.name,
        insert: e.name.replace(/ /g, "_"),
        kind: "element",
        detail: e.kind === "graphFunction" ? "graph" : e.kind,
      }));

    const builtins: Completion[] = BUILTINS.map((b) => ({
      label: b.name,
      insert: b.name,
      kind: "builtin",
      detail: `${b.min}..${b.max === Number.POSITIVE_INFINITY ? "n" : b.max} args`,
    }));

    const clocks: Completion[] = [...CLOCK_VARIABLES, ...CONSTANTS].map((name) => ({
      label: name,
      insert: name,
      kind: "clock",
      detail: "clock",
    }));

    return [...elements, ...builtins, ...clocks];
  }, [model, el.id]);

  const parseError = useMemo(() => {
    try {
      parse(draft);
      return null;
    } catch (e) {
      return e instanceof ParseError ? e.message : String(e);
    }
  }, [draft]);

  const token = open ? tokenAtCursor(draft, cursor) : null;
  const matches = token
    ? matchCompletions(token.query, candidates).slice(0, MAX_MENU_ROWS)
    : NO_MATCHES;
  const activeIndex = matches.length > 0 ? Math.min(active, matches.length - 1) : -1;

  const commit = () => {
    if (draft !== el.equation) updateElement(el.id, { equation: draft });
  };

  const refresh = (text: string, at: number) => {
    setCursor(at);
    const t = tokenAtCursor(text, at);
    setOpen(t !== null && t.query.length > 0);
    setActive(0);
  };

  const insertCompletion = (item: Completion) => {
    const t = tokenAtCursor(draft, cursor);
    if (!t) return;
    const next = applyCompletion(draft, t, item.insert);
    setDraft(next.text);
    setCursor(next.cursor);
    setOpen(false);
    setActive(0);
    requestAnimationFrame(() => {
      const area = areaRef.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      commit();
      setOpen(false);
      return;
    }
    if (open && matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % matches.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + matches.length) % matches.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertCompletion(matches[activeIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    }
  };

  const label = el.kind === "stock" ? "Initial value" : "Equation";

  return (
    <div className="insp-field insp-eq">
      <label className="insp-label" htmlFor={`insp-eq-${el.id}`}>
        {label}
      </label>
      <div className="insp-eq-wrap">
        <textarea
          id={`insp-eq-${el.id}`}
          ref={areaRef}
          className={`insp-textarea insp-mono${parseError ? " insp-invalid" : ""}`}
          value={draft}
          rows={el.kind === "stock" ? 2 : 3}
          spellCheck={false}
          autoComplete="off"
          placeholder={el.kind === "stock" ? "e.g. 100" : "e.g. Stock * rate"}
          onChange={(e) => {
            const value = e.target.value;
            setDraft(value);
            refresh(value, e.currentTarget.selectionStart ?? value.length);
          }}
          onClick={(e) => refresh(draft, e.currentTarget.selectionStart ?? draft.length)}
          onKeyUp={(e) => {
            if (
              e.key === "ArrowLeft" ||
              e.key === "ArrowRight" ||
              e.key === "Home" ||
              e.key === "End"
            ) {
              refresh(draft, e.currentTarget.selectionStart ?? draft.length);
            }
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setOpen(false);
            commit();
          }}
        />
        {open && matches.length > 0 ? (
          <ul className="insp-menu" role="listbox" aria-label="Names and functions">
            {matches.map((item, index) => (
              <li key={`${item.kind}:${item.insert}`} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  className={`insp-menu-item${index === activeIndex ? " is-active" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertCompletion(item);
                  }}
                  onMouseEnter={() => setActive(index)}
                >
                  <span className="insp-menu-label">{item.label.replace(/ /g, "_")}</span>
                  {item.detail ? <span className="insp-menu-detail">{item.detail}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <FieldMessage variant="error">{parseError}</FieldMessage>
    </div>
  );
}

function InputsCheck({ el }: { el: Editable }) {
  const model = useEditor((s) => s.model);
  const addConnector = useEditor((s) => s.addConnector);
  const [error, setError] = useState<string | null>(null);

  const analysis = useMemo(() => analyzeConnections(model, el.id), [model, el.id]);

  if (analysis.missing.length === 0 && analysis.unused.length === 0) return null;

  return (
    <div className="insp-field insp-inputs">
      <div className="insp-label">Inputs</div>
      {analysis.missing.map((link) => (
        <div key={link.fromId} className="insp-inputs-row">
          <span className="insp-warn">
            Uses <b>{link.fromName}</b> but it isn't connected
          </span>
          <button
            type="button"
            className="insp-btn insp-btn-tiny"
            onClick={() => setError(addConnector(link.fromId, el.id))}
          >
            Connect
          </button>
        </div>
      ))}
      {analysis.unused.map((link) => (
        <div key={link.connectorId} className="insp-inputs-row">
          <span className="insp-muted">
            <b>{link.fromName}</b> isn't used in this equation
          </span>
        </div>
      ))}
      <FieldMessage variant="error">{error}</FieldMessage>
    </div>
  );
}

/** A flow's part in a conveyor or queue it drains: a conveyor's exit or
 * leak, a queue's outflow, or neither. */
function conveyorRole(model: Model, flow: Flow): "exit" | "leak" | "queue" | "oven" | null {
  const source = model.stocks.find((s) => (s.outflows ?? []).includes(flow.id));
  if (source?.queue) return "queue";
  if (source?.oven) return "oven";
  if (!source?.conveyor) return null;
  return flow.leak ? "leak" : "exit";
}

type StockType = "reservoir" | "conveyor" | "queue" | "oven";

function StockExtras({ el }: { el: Stock }) {
  const model = useEditor((s) => s.model);
  const updateElement = useEditor((s) => s.updateElement);
  const flowName = (id: string) => model.flows.find((f) => f.id === id)?.name ?? id;
  const type: StockType = el.conveyor ? "conveyor" : el.queue ? "queue" : el.oven ? "oven" : "reservoir";
  const setType = (t: StockType) =>
    updateElement(el.id, {
      conveyor: t === "conveyor" ? (el.conveyor ?? { transitTime: "1" }) : undefined,
      queue: t === "queue" ? true : undefined,
      oven: t === "oven" ? (el.oven ?? { capacity: "1", fillTime: "INF" }) : undefined,
    });

  return (
    <>
      <div className="insp-field">
        <label className="insp-label" htmlFor={`insp-type-${el.id}`}>
          Type
        </label>
        <select
          id={`insp-type-${el.id}`}
          className="insp-input"
          value={type}
          onChange={(e) => setType(e.target.value as StockType)}
        >
          <option value="reservoir">Reservoir</option>
          <option value="conveyor">Conveyor</option>
          <option value="queue">Queue (first in, first out)</option>
          <option value="oven">Oven (batch processor)</option>
        </select>
      </div>
      {el.conveyor ? (
        <TextField
          label="Transit time"
          value={el.conveyor.transitTime}
          placeholder="e.g. 3 or ride_time"
          onCommit={(transitTime) => updateElement(el.id, { conveyor: { transitTime: transitTime.trim() || "1" } })}
        />
      ) : null}
      {el.oven ? (
        <>
          <TextField
            label="Capacity"
            value={el.oven.capacity}
            placeholder="e.g. 1"
            onCommit={(capacity) => updateElement(el.id, { oven: { ...el.oven!, capacity: capacity.trim() || "1" } })}
          />
          <TextField
            label="Fill time (DT = next in line, INF = until full)"
            value={el.oven.fillTime}
            placeholder="INF"
            onCommit={(fillTime) => updateElement(el.id, { oven: { ...el.oven!, fillTime: fillTime.trim() || "INF" } })}
          />
        </>
      ) : null}
      <Toggle
        label="Non-negative"
        checked={Boolean(el.nonNegative)}
        onChange={(nonNegative) => updateElement(el.id, { nonNegative })}
      />
      <ReadOnlyList label="Inflows" items={(el.inflows ?? []).map(flowName)} />
      <ReadOnlyList label="Outflows" items={(el.outflows ?? []).map(flowName)} />
    </>
  );
}

function FlowExtras({ el }: { el: Flow }) {
  const model = useEditor((s) => s.model);
  const updateElement = useEditor((s) => s.updateElement);
  const ends = flowEnds(model, el.id);
  const endName = (id: string | null) =>
    id ? (model.stocks.find((s) => s.id === id)?.name ?? id) : "cloud";

  return (
    <>
      <div className="insp-field">
        <div className="insp-label">Direction</div>
        <div className="insp-flow-ends">
          <span>{endName(ends.from)}</span>
          <span className="insp-arrow" aria-hidden>
            →
          </span>
          <span>{endName(ends.to)}</span>
        </div>
      </div>
      <Toggle
        label="Uniflow (non-negative)"
        checked={Boolean(el.nonNegative)}
        onChange={(nonNegative) => updateElement(el.id, { nonNegative })}
      />
      <Toggle
        label="Biflow"
        checked={Boolean(el.biflow)}
        onChange={(biflow) => updateElement(el.id, { biflow })}
      />
      {conveyorRole(model, el) === "exit" || conveyorRole(model, el) === "leak" ? (
        <Toggle
          label="Conveyor leak (equation is the fraction leaked over the transit)"
          checked={Boolean(el.leak)}
          onChange={(leak) => updateElement(el.id, { leak })}
        />
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Small form primitives
 * ------------------------------------------------------------------------- */

function ReadOnlyList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="insp-field">
      <div className="insp-label">{label}</div>
      {items.length === 0 ? (
        <span className="insp-muted">None</span>
      ) : (
        <ul className="insp-list">
          {items.map((name, i) => (
            <li key={`${name}-${i}`}>{name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  placeholder,
  multiline = false,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <div className="insp-field">
      <div className="insp-label">{label}</div>
      {multiline ? (
        <textarea
          className="insp-textarea"
          value={draft}
          rows={3}
          spellCheck
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          className="insp-input"
          value={draft}
          spellCheck={false}
          autoComplete="off"
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="insp-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="insp-toggle-label">{label}</span>
    </label>
  );
}

function FieldMessage({
  children,
  variant = "error",
}: {
  children: ReactNode;
  variant?: "error" | "hint";
}) {
  return (
    <div className={`insp-msg insp-msg-${variant}`} aria-live="polite">
      {children}
    </div>
  );
}
