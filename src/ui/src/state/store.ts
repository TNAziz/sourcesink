/**
 * SourceSink — editor state (the contract shared by every UI module).
 *
 * One zustand store holds the model IR, the selection, the active tool, the
 * last simulation result and an undo/redo history. Components read slices with
 * `useEditor(selector)` and mutate only through the actions below, so the
 * canvas, inspector, results and file modules never touch each other directly.
 *
 * Conventions:
 *  - Elements are addressed by `id`. Equations and connectors refer by `name`.
 *  - `model.layout` is keyed by element *name* (that is what XMILE persists).
 *  - Every mutating action pushes one undo step (moves coalesce while dragging).
 */

import { create } from "zustand";
import type { Converter, Flow, Model, Point, Scenario, Sector, Stock } from "@sourcesink/model";
import { emptyModel } from "@sourcesink/model";
import { simulate, type SimulationResult } from "@sourcesink/engine";
import { applyScenario, convertToArrays, type ArrayDimensionPlan } from "@sourcesink/analysis";
import { suggestSectors, withInferredConnectors } from "@sourcesink/explain";

import { uniqueScenarioId, uniqueScenarioName } from "../inspector/scenarios";
import { autoLayout } from "../canvas/autoLayout";
import { placementAt } from "../canvas/sectorLayout";

export type ElementKind = "stock" | "flow" | "converter";
export type Tool = "select" | ElementKind | "connector";

/** Editable fields of a scenario (its id never changes). */
export type ScenarioPatch = Partial<Pick<Scenario, "name" | "overrides" | "run" | "documentation">>;

/** Editable, non-identity fields of a stock/flow/converter. */
export interface ElementPatch {
  equation?: string;
  units?: string;
  documentation?: string;
  nonNegative?: boolean;
  biflow?: boolean;
  /** Stocks: make a conveyor (or `undefined` for an ordinary stock). */
  conveyor?: { transitTime: string };
  queue?: boolean;
  oven?: { capacity: string; fillTime: string };
  /** Flows: a conveyor leakage. */
  leak?: boolean;
}

export interface EditorState {
  model: Model;
  /** File name shown in the title bar; null for an unsaved model. */
  fileName: string | null;
  dirty: boolean;
  selection: string[];
  tool: Tool;
  result: SimulationResult | null;
  runError: string | null;
  /** Element names plotted in the results view (empty → all stocks). */
  plotted: string[];
  /** Scenario applied to the next run (`null` → the base model). */
  activeScenario: string | null;

  past: Model[];
  future: Model[];
  /** Bumped by `tidyLayout` so the canvas can refit the view. */
  layoutVersion: number;
  /** Draw constant converters (plain numbers) on the canvas. When off they
   * are edited in the parameter table instead. A view setting, not a model
   * edit. */
  showConstants: boolean;

  // --- document ---
  loadModel(model: Model, fileName?: string | null): void;
  /** Replace the whole model as one undoable step (e.g. an accepted assistant
   * proposal). Clears the last run because it no longer describes the model. */
  applyModel(model: Model): void;
  /** Re-lay out the whole diagram from scratch (auto-layout), as one undo
   * step. Keeps the last run: positions do not change results. */
  tidyLayout(): void;
  /** Add a connector for every link an equation implies but the diagram
   * lacks, as one undo step; returns how many were added. */
  connectAll(): number;
  setShowConstants(show: boolean): void;

  /** Turn families of repeated elements into arrays (one undo step); the
   * results are unchanged. Returns an error message if the plan cannot be
   * applied. */
  convertToArrays(plans: ArrayDimensionPlan[]): string | null;

  // --- sectors (named groups drawn as folding frames) ---
  /** Replace every sector at once (one undo step). */
  setSectors(sectors: Sector[]): void;
  /** Group the model into suggested sectors, laid out afresh; returns how
   * many sectors were made. */
  suggestSectors(): number;
  /** Fold or unfold one sector. */
  toggleSector(id: string): void;
  /** Fold (true) or unfold every sector, and refit the view. */
  setAllSectorsCollapsed(collapsed: boolean): void;
  /** Make a sector of `ids` (taking them out of any other); returns its id. */
  addSector(name: string, ids: string[]): string;
  /** Move elements into a sector (`null` = no sector). */
  moveToSector(ids: string[], sectorId: string | null): void;
  /** Returns an error message if the name is empty or taken. */
  renameSector(id: string, name: string): string | null;
  /** Remove the sector; its elements stay, ungrouped. */
  deleteSector(id: string): void;
  newModel(): void;
  markSaved(fileName: string): void;

  // --- editing ---
  setTool(tool: Tool): void;
  select(ids: string[]): void;
  /** Create an element at `at`; returns its id. Name is auto-generated. */
  addElement(kind: ElementKind, at: Point): string;
  /** Patch fields of a stock/flow/converter (not its name — use rename). */
  updateElement(id: string, patch: ElementPatch): void;
  /** Rename and rewrite references in equations, connectors and layout.
   * Returns an error message if the name is empty or taken. */
  renameElement(id: string, newName: string): string | null;
  deleteElements(ids: string[]): void;
  moveElement(id: string, to: Point, coalesce?: boolean): void;
  /** Create a flow wired `from → to` (stock ids, `null` = cloud) with its
   * valve at `at`, as a single undo step; returns its id. */
  addFlow(fromStockId: string | null, toStockId: string | null, at: Point): string;
  /** Re-wire a flow's ends. `null` means a cloud. */
  setFlowEnds(flowId: string, fromStockId: string | null, toStockId: string | null): void;
  /** Add an info link `from → to` (by id). Rejects links into stocks. */
  addConnector(fromId: string, toId: string): string | null;
  setRunSpec(patch: Partial<Model["run"]>): void;
  /** Replace the model's dimensions (name + labels). Elements lose any
   * dimension that no longer exists. */
  setDimensions(dimensions: Array<{ name: string; values: string[] }>): void;
  /** Make an element arrayed over `dimensions` (empty = scalar again). */
  setElementDimensions(id: string, dimensions: string[]): void;
  /** Give one array element its own equation (`null` clears it). `key` is
   * the comma-joined labels, e.g. "North,Old". */
  setElementEquation(id: string, key: string, equation: string | null): void;
  /** Add a scenario with a unique name/id; returns its id. */
  addScenario(name: string): string;
  updateScenario(id: string, patch: ScenarioPatch): void;
  deleteScenario(id: string): void;
  /** Choose the scenario the next run applies. Not a model edit. */
  setActiveScenario(id: string | null): void;
  undo(): void;
  redo(): void;

  // --- simulation / results ---
  run(): void;
  setPlotted(names: string[]): void;
}

const HISTORY_LIMIT = 200;
let lastCoalesceKey: string | null = null;

type AnyEl = Stock | Flow | Converter;

function findEl(m: Model, id: string): AnyEl | undefined {
  return (
    m.stocks.find((e) => e.id === id) ??
    m.flows.find((e) => e.id === id) ??
    m.converters.find((e) => e.id === id)
  );
}

function allNames(m: Model): Set<string> {
  const s = new Set<string>();
  for (const e of [...m.stocks, ...m.flows, ...m.converters, ...m.graphFunctions]) {
    s.add(e.name.toLowerCase());
  }
  return s;
}

function uniqueName(m: Model, base: string): string {
  const taken = allNames(m);
  for (let i = 1; ; i += 1) {
    const n = `${base}_${i}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
}

function newId(kind: string): string {
  return `${kind}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Replace whole-word, case-insensitive references to `from` with `to`. */
function replaceRef(eq: string, from: string, to: string): string {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return eq.replace(new RegExp(`(?<![A-Za-z0-9_])${esc}(?![A-Za-z0-9_])`, "gi"), to);
}

const clone = (m: Model): Model => structuredClone(m);

/** Put element `name` into sector `sectorId` (or none), out of any other. */
function joinSector(d: Model, name: string, sectorId: string | null): void {
  for (const sector of d.sectors ?? []) {
    sector.members = sector.members.filter((n) => n !== name);
    if (sector.id === sectorId) sector.members.push(name);
  }
}

function uniqueSectorId(m: Model): string {
  const taken = new Set((m.sectors ?? []).map((s) => s.id));
  for (let i = 1; ; i += 1) if (!taken.has(`sector-${i}`)) return `sector-${i}`;
}

export const useEditor = create<EditorState>()((set, get) => {
  /** Apply `fn` to a copy of the model as one undoable step. */
  const commit = (fn: (m: Model) => void, coalesceKey: string | null = null): void => {
    const { model, past } = get();
    const next = clone(model);
    fn(next);
    const merge = coalesceKey !== null && coalesceKey === lastCoalesceKey;
    lastCoalesceKey = coalesceKey;
    set({
      model: next,
      past: merge ? past : [...past, model].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
    });
  };

  return {
    model: emptyModel(),
    fileName: null,
    dirty: false,
    selection: [],
    tool: "select",
    result: null,
    runError: null,
    plotted: [],
    activeScenario: null,
    past: [],
    future: [],
    layoutVersion: 0,
    showConstants: true,

    loadModel(model, fileName = null) {
      lastCoalesceKey = null;
      // A model saved without any connectors (hand-written or generated) is
      // drawn with the links its equations imply, so converters have
      // something to sit beside. Models that draw some links are left alone.
      const wired = model.connectors.length === 0 ? withInferredConnectors(model) : model;
      set({
        model: clone(wired),
        fileName,
        dirty: false,
        selection: [],
        result: null,
        runError: null,
        plotted: [],
        activeScenario: null,
        past: [],
        future: [],
      });
    },
    newModel() {
      get().loadModel(emptyModel(), null);
    },
    tidyLayout() {
      const { model: current, past, layoutVersion } = get();
      const layout = autoLayout({ ...current, layout: {} });
      lastCoalesceKey = null;
      set({
        model: { ...clone(current), layout },
        past: [...past, current].slice(-HISTORY_LIMIT),
        future: [],
        dirty: true,
        layoutVersion: layoutVersion + 1,
      });
    },
    connectAll() {
      const before = get().model;
      const after = withInferredConnectors(before);
      const added = after.connectors.length - before.connectors.length;
      if (added > 0) commit((d) => {
        d.connectors = structuredClone(after.connectors);
      });
      return added;
    },
    setShowConstants(show) {
      set({ showConstants: show });
    },

    convertToArrays(plans) {
      const before = get().model;
      let after: Model;
      try {
        after = convertToArrays(before, plans);
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
      // Sector members follow their family into the merged element.
      const merged = new Map<string, string>();
      for (const plan of plans) {
        for (const fam of plan.families) for (const mem of fam.members) merged.set(mem.name, fam.base);
      }
      if (after.sectors) {
        after = {
          ...after,
          sectors: after.sectors.map((sector) => ({
            ...sector,
            members: [...new Set(sector.members.map((n) => merged.get(n) ?? n))],
          })),
        };
      }
      get().applyModel(after);
      set({ layoutVersion: get().layoutVersion + 1 });
      return null;
    },

    setSectors(sectors) {
      commit((d) => {
        d.sectors = structuredClone(sectors);
        if (d.sectors.length === 0) delete d.sectors;
      });
    },
    suggestSectors() {
      const sectors = suggestSectors(get().model);
      // A new grouping starts from a fresh layout inside each sector.
      commit((d) => {
        d.sectors = sectors;
        d.layout = {};
      });
      set({ layoutVersion: get().layoutVersion + 1 });
      return sectors.length;
    },
    toggleSector(id) {
      commit((d) => {
        const sector = d.sectors?.find((s) => s.id === id);
        if (!sector) return;
        if (sector.collapsed) delete sector.collapsed;
        else sector.collapsed = true;
      });
    },
    setAllSectorsCollapsed(collapsed) {
      commit((d) => {
        for (const sector of d.sectors ?? []) {
          if (collapsed) sector.collapsed = true;
          else delete sector.collapsed;
        }
      });
      set({ layoutVersion: get().layoutVersion + 1 });
    },
    addSector(name, ids) {
      const m = get().model;
      const id = uniqueSectorId(m);
      const names = ids.map((x) => findEl(m, x)?.name).filter((n): n is string => Boolean(n));
      commit((d) => {
        for (const sector of d.sectors ?? []) sector.members = sector.members.filter((n) => !names.includes(n));
        d.sectors = [...(d.sectors ?? []).filter((s) => s.members.length > 0), { id, name, members: names }];
        // Positions were relative to the old blocks; re-place in the new one.
        if (d.layout) for (const n of names) delete d.layout[n];
      });
      return id;
    },
    moveToSector(ids, sectorId) {
      const m = get().model;
      const names = ids.map((x) => findEl(m, x)?.name).filter((n): n is string => Boolean(n));
      commit((d) => {
        for (const n of names) {
          joinSector(d, n, sectorId);
          if (d.layout) delete d.layout[n];
        }
        if (d.sectors) d.sectors = d.sectors.filter((s) => s.members.length > 0);
      });
    },
    renameSector(id, name) {
      const trimmed = name.trim();
      if (!trimmed) return "A sector needs a name";
      const sectors = get().model.sectors ?? [];
      if (sectors.some((s) => s.id !== id && s.name.toLowerCase() === trimmed.toLowerCase())) {
        return "Another sector already has that name";
      }
      commit((d) => {
        const sector = d.sectors?.find((s) => s.id === id);
        if (sector) sector.name = trimmed;
      }, `rename-sector:${id}`);
      return null;
    },
    deleteSector(id) {
      commit((d) => {
        const sector = d.sectors?.find((s) => s.id === id);
        if (!sector) return;
        if (d.layout) for (const n of sector.members) delete d.layout[n];
        d.sectors = d.sectors!.filter((s) => s.id !== id);
        if (d.sectors.length === 0) delete d.sectors;
      });
    },
    applyModel(model) {
      const { model: current, past } = get();
      lastCoalesceKey = null;
      set({
        model: clone(model),
        past: [...past, current].slice(-HISTORY_LIMIT),
        future: [],
        dirty: true,
        result: null,
        runError: null,
      });
    },
    markSaved(fileName) {
      set({ fileName, dirty: false });
    },

    setTool(tool) {
      set({ tool });
    },
    select(ids) {
      set({ selection: ids });
    },

    addElement(kind, at) {
      const m = get().model;
      const id = newId(kind);
      const base = kind === "stock" ? "Stock" : kind === "flow" ? "flow" : "converter";
      const name = uniqueName(m, base);
      const place = placementAt(m, at);
      commit((d) => {
        if (kind === "stock") {
          d.stocks.push({ kind, id, name, equation: "0", inflows: [], outflows: [] });
        } else if (kind === "flow") {
          d.flows.push({ kind, id, name, equation: "0" });
        } else {
          d.converters.push({ kind, id, name, equation: "0" });
        }
        d.layout = { ...(d.layout ?? {}), [name]: place.at };
        joinSector(d, name, place.sectorId);
      });
      set({ selection: [id], tool: "select" });
      return id;
    },

    addFlow(fromStockId, toStockId, at) {
      const id = newId("flow");
      const name = uniqueName(get().model, "flow");
      const place = placementAt(get().model, at);
      commit((d) => {
        d.flows.push({ kind: "flow", id, name, equation: "0" });
        for (const st of d.stocks) {
          if (st.id === fromStockId) st.outflows = [...(st.outflows ?? []), id];
          if (st.id === toStockId) st.inflows = [...(st.inflows ?? []), id];
        }
        d.layout = { ...(d.layout ?? {}), [name]: place.at };
        joinSector(d, name, place.sectorId);
      });
      set({ selection: [id], tool: "select" });
      return id;
    },

    updateElement(id, patch) {
      commit((d) => {
        const el = findEl(d, id);
        if (!el) return;
        Object.assign(el, patch);
      });
    },

    renameElement(id, newName) {
      const name = newName.trim();
      const m = get().model;
      const el = findEl(m, id);
      if (!el) return "unknown element";
      if (!/^[A-Za-z_][A-Za-z0-9_ ]*$/.test(name)) {
        return "Names start with a letter or _ and use letters, digits, _ or spaces";
      }
      if (name.toLowerCase() !== el.name.toLowerCase() && allNames(m).has(name.toLowerCase())) {
        return `'${name}' is already used`;
      }
      const old = el.name;
      if (old === name) return null;
      commit((d) => {
        const e = findEl(d, id)!;
        e.name = name;
        // Equations may use spaces or underscores interchangeably for a name.
        const oldForms = [old, old.replace(/ /g, "_")];
        const newRef = name.replace(/ /g, "_");
        for (const x of [...d.stocks, ...d.flows, ...d.converters]) {
          for (const f of oldForms) x.equation = replaceRef(x.equation, f, newRef);
        }
        for (const c of d.connectors) {
          if (c.from === old) c.from = name;
          if (c.to === old) c.to = name;
          c.name = `${c.from} -> ${c.to}`;
        }
        if (d.layout && old in d.layout) {
          d.layout[name] = d.layout[old];
          delete d.layout[old];
        }
        for (const sector of d.sectors ?? []) {
          sector.members = sector.members.map((n) => (n === old ? name : n));
        }
        if (old in d.arrayed) {
          d.arrayed[name] = d.arrayed[old];
          delete d.arrayed[old];
        }
      });
      set({ plotted: get().plotted.map((p) => (p === old ? name : p)) });
      return null;
    },

    deleteElements(ids) {
      if (ids.length === 0) return;
      const drop = new Set(ids);
      commit((d) => {
        const names = new Set(
          [...d.stocks, ...d.flows, ...d.converters]
            .filter((e) => drop.has(e.id))
            .map((e) => e.name),
        );
        d.stocks = d.stocks.filter((e) => !drop.has(e.id));
        d.flows = d.flows.filter((e) => !drop.has(e.id));
        d.converters = d.converters.filter((e) => !drop.has(e.id));
        d.connectors = d.connectors.filter(
          (c) => !drop.has(c.id) && !names.has(c.from) && !names.has(c.to),
        );
        for (const s of d.stocks) {
          s.inflows = (s.inflows ?? []).filter((f) => !drop.has(f));
          s.outflows = (s.outflows ?? []).filter((f) => !drop.has(f));
        }
        if (d.layout) for (const n of names) delete d.layout[n];
        if (d.sectors) {
          for (const sector of d.sectors) sector.members = sector.members.filter((n) => !names.has(n));
          d.sectors = d.sectors.filter((sector) => sector.members.length > 0);
        }
      });
      set({ selection: get().selection.filter((s) => !drop.has(s)) });
    },

    moveElement(id, to, coalesce = true) {
      const el = findEl(get().model, id);
      if (!el) return;
      commit((d) => {
        d.layout = { ...(d.layout ?? {}), [el.name]: { x: to.x, y: to.y } };
      }, coalesce ? `move:${id}` : null);
    },

    setFlowEnds(flowId, fromStockId, toStockId) {
      commit((d) => {
        for (const s of d.stocks) {
          s.inflows = (s.inflows ?? []).filter((f) => f !== flowId);
          s.outflows = (s.outflows ?? []).filter((f) => f !== flowId);
          if (s.id === fromStockId) s.outflows.push(flowId);
          if (s.id === toStockId) s.inflows.push(flowId);
        }
      });
    },

    addConnector(fromId, toId) {
      const m = get().model;
      const from = findEl(m, fromId);
      const to = findEl(m, toId);
      if (!from || !to) return "unknown element";
      if (fromId === toId) return "An element cannot connect to itself";
      if (to.kind === "stock") return "Connectors cannot point into a stock — use a flow";
      if (m.connectors.some((c) => c.from === from.name && c.to === to.name)) {
        return "Those elements are already connected";
      }
      commit((d) => {
        d.connectors.push({
          kind: "connector",
          id: newId("connector"),
          name: `${from.name} -> ${to.name}`,
          from: from.name,
          to: to.name,
        });
      });
      return null;
    },

    setRunSpec(patch) {
      commit((d) => {
        Object.assign(d.run, patch);
      });
    },

    setDimensions(dimensions) {
      commit((d) => {
        d.dimensions = dimensions.map((x) => ({ kind: "dimension", id: x.name, name: x.name, values: x.values }));
        const names = new Set(dimensions.map((x) => x.name));
        for (const [el, spec] of Object.entries(d.arrayed)) {
          const kept = spec.dimensions.filter((n) => names.has(n));
          if (kept.length === 0) delete d.arrayed[el];
          else if (kept.length !== spec.dimensions.length) d.arrayed[el] = { dimensions: kept };
        }
      });
    },

    setElementDimensions(id, dimensions) {
      commit((d) => {
        const el = findEl(d, id);
        if (!el) return;
        if (dimensions.length === 0) {
          delete d.arrayed[el.name];
          return;
        }
        const old = d.arrayed[el.name];
        const same = old && old.dimensions.join("\u0000") === dimensions.join("\u0000");
        d.arrayed[el.name] = { dimensions, ...(same && old.elements ? { elements: old.elements } : {}) };
      });
    },

    setElementEquation(id, key, equation) {
      commit((d) => {
        const el = findEl(d, id);
        const spec = el && d.arrayed[el.name];
        if (!spec) return;
        const elements = { ...(spec.elements ?? {}) };
        if (equation === null || equation.trim() === "") delete elements[key];
        else elements[key] = equation;
        d.arrayed[el.name] = Object.keys(elements).length ? { ...spec, elements } : { dimensions: spec.dimensions };
      });
    },

    addScenario(name) {
      const scenarios = get().model.scenarios ?? [];
      const unique = uniqueScenarioName(scenarios, name);
      const id = uniqueScenarioId(scenarios, unique);
      commit((d) => {
        d.scenarios = [...(d.scenarios ?? []), { id, name: unique, overrides: {} }];
      });
      return id;
    },

    updateScenario(id, patch) {
      commit((d) => {
        const scenario = d.scenarios?.find((s) => s.id === id);
        if (scenario) Object.assign(scenario, patch);
      });
    },

    deleteScenario(id) {
      commit((d) => {
        d.scenarios = (d.scenarios ?? []).filter((s) => s.id !== id);
      });
      if (get().activeScenario === id) set({ activeScenario: null });
    },

    setActiveScenario(id) {
      set({ activeScenario: id });
    },

    undo() {
      const { past, model, future } = get();
      if (past.length === 0) return;
      lastCoalesceKey = null;
      set({
        model: past[past.length - 1],
        past: past.slice(0, -1),
        future: [model, ...future],
        dirty: true,
      });
    },
    redo() {
      const { past, model, future } = get();
      if (future.length === 0) return;
      lastCoalesceKey = null;
      set({ model: future[0], past: [...past, model], future: future.slice(1), dirty: true });
    },

    run() {
      try {
        const { model, activeScenario } = get();
        const scenario = activeScenario ? model.scenarios?.find((s) => s.id === activeScenario) : undefined;
        set({ result: simulate(scenario ? applyScenario(model, scenario) : model), runError: null });
      } catch (e) {
        set({ runError: e instanceof Error ? e.message : String(e) });
      }
    },
    setPlotted(names) {
      set({ plotted: names });
    },
  };
});

/** Convenience: the element with this id, if any. */
export function elementById(m: Model, id: string): AnyEl | undefined {
  return findEl(m, id);
}

/** A flow's (source stock id, sink stock id); `null` is a cloud. */
export function flowEnds(m: Model, flowId: string): { from: string | null; to: string | null } {
  let from: string | null = null;
  let to: string | null = null;
  for (const s of m.stocks) {
    if ((s.outflows ?? []).includes(flowId)) from = s.id;
    if ((s.inflows ?? []).includes(flowId)) to = s.id;
  }
  return { from, to };
}
