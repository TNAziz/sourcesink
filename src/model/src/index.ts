export * from "./functions.js";

/**
 * SourceSink — shared model intermediate representation (IR).
 *
 * This is the single source of truth understood by every package: the XMILE
 * reader/writer, the legacy .stm/.itm reader, the simulation engine, and the UI.
 *
 * Design notes (see AGENTS.md, docs/architecture.md):
 *  - Equations are stored as **expression strings** in the SD dialect shared by
 *    XMILE and common system dynamics practice (see `functions.ts` for the built-in catalog). This
 *    keeps the IR isomorphic to XMILE and trivial to evaluate/translate.
 *  - Names are the stable identity for cross-references (models refer by
 *    name); `id` is a document-unique key used by the UI for react-node identity.
 */

/** Where an element or model came from — an audit trail for research use
 * and for anything an AI proposed (see docs/ROADMAP.md, principle 4). */
export interface Provenance {
  author: "human" | "ai" | "import";
  /** Tool or model identifier, e.g. "sourcesink-legacy-import", a model id. */
  agent?: string;
  /** Hash of the prompt that produced an AI-authored element. */
  promptHash?: string;
  /** DOIs, URLs or dataset ids supporting the element. */
  sources?: string[];
  /** 0..1, optional. */
  confidence?: number;
  /** ISO 8601 timestamp. */
  createdAt?: string;
}

/** Model-level metadata. */
export interface ModelMetadata {
  version?: string;
  license?: string;
  intendedUse?: string;
  authors?: string[];
  provenance?: Provenance;
}

/** A named set of overrides on a base model: element name -> new equation
 * (string) or constant (number), plus optional run-spec changes. */
export interface Scenario {
  id: string;
  name: string;
  overrides: Record<string, string | number>;
  run?: Partial<RunSpec>;
  documentation?: string;
}

/** A display/geometry-free element shared by all model primitives. */
export interface Element {
  /** Document-unique key (UI/react identity, not user-visible). */
  id: string;
  name: string;
  /** Optional documentation block attached to the element. */
  documentation?: string;
  /** Unit of measure, e.g. "people", "mg/L". Purely documentary in the IR. */
  units?: string;
  /** Where this element came from. */
  provenance?: Provenance;
  /** Free-form tool annotations (not interpreted by the engine). */
  annotations?: Record<string, unknown>;
}

/** A stock (level/state variable) that accumulates net flow. */
export interface Stock extends Element {
  kind: "stock";
  /** Initial value as an expression, e.g. "100" or "INITIAL_POPULATION". */
  equation: string;
  /** Clamp the stock at zero (a "non-negative" reservoir). */
  nonNegative?: boolean;
  /** ids of flows entering this stock. The only source of flow wiring. */
  inflows?: string[];
  /** ids of flows leaving this stock. */
  outflows?: string[];
  /** A conveyor: material entering travels for `transitTime` before leaving
   * through the (non-leak) outflow, whose value the engine computes. Leak
   * outflows (`Flow.leak`) drain a fraction along the way. `equation` is the
   * initial contents, spread evenly along the conveyor. */
  conveyor?: { transitTime: string };
  /** A queue: first-in first-out; outflows take from it in listed order and
   * never drive it negative. */
  queue?: boolean;
  /** An oven: a batch processor. Its door opens, it fills until `capacity`
   * is reached or `fillTime` has passed (`DT` = take one step's inflow), then
   * cooks for the time given by its single outflow's equation (sampled when
   * the door closes) and empties in one step. */
  oven?: { capacity: string; fillTime: string };
}

/** A flow (rate). Its source/sink stocks are the stocks that list it in
 * `inflows`/`outflows`; an unattached end is a cloud (outside the model). */
export interface Flow extends Element {
  kind: "flow";
  equation: string;
  /** Bidirectional flow (a "biflow") — filters based on sign direction. */
  biflow?: boolean;
  /** Optional non-negative constraint (rate clipped at zero). */
  nonNegative?: boolean;
  /** A conveyor leakage: `equation` is the fraction of entering material that
   * leaks out over the full transit (the flow's value is computed). */
  leak?: boolean;
}

/** A converter (auxiliary/derived variable); has no state. */
export interface Converter extends Element {
  kind: "converter";
  equation: string;
}

/**
 * An information link ("connector") between elements: `to`'s equation may read
 * `from`. Connectors never move material — which flows fill or drain a stock is
 * defined solely by `Stock.inflows` / `Stock.outflows`. A connector into a
 * stock is invalid (stocks are only changed by flows).
 */
export interface Connector extends Element {
  kind: "connector";
  /** name of the source element (stock, flow, converter, or graph function). */
  from: string;
  /** name of the target element. */
  to: string;
}

/** A graphical (lookup) function mapping x -> y via points + interpolation. */
export interface GraphFunction extends Element {
  kind: "graphFunction";
  /** (x, y) points, x monotonic increasing. */
  points: { x: number; y: number }[];
  /** Interpolation between points: "linear" | "held" | "discrete". */
  interpolation: "linear" | "held" | "discrete";
  /** How the domain extrapolates outside [min x, max x]. */
  extrapolation: "clip" | "extend";
}

/** A named subscript range (array dimension), e.g. Region = A,B,C. */
export interface Dimension extends Element {
  kind: "dimension";
  /** Element labels in order. */
  values: string[];
}

/** Dimensions applied to an element ("arrayed" / subscripted elements).
 * The element's own `equation` applies to every element of the array
 * ("apply to all"); in it a dimension name used as a subscript stands for the
 * element being computed, e.g. `births[Region] = Population[Region] * r`.
 * `elements` overrides the equation for specific elements. */
export interface ArraySpec {
  /** Dimension names applying to this element. */
  dimensions: string[];
  /** Per-element equations keyed by comma-joined labels, e.g. "North,Deer". */
  elements?: Record<string, string>;
}

/** Run/simulation control parameters. */
export interface RunSpec {
  /** Simulation start time. */
  start: number;
  /** Simulation stop time. */
  stop: number;
  /** Integration time step (DT). */
  dt: number;
  /** Save/report interval (SAVEPER / "Save every"). */
  saveEvery: number;
  /** Integration method (informational; engine selects the default). */
  /** "rk45": adaptive Dormand-Prince 5(4) sub-steps within each DT. */
  integration?: "euler" | "rk2" | "rk4" | "rk45";
  /** Time unit label, e.g. "Year", "Month", "Day". */
  timeUnits?: string;
  /** Units of DT (informational). */
  dtUnits?: string;
}

/** A complete system-dynamics model. */
export interface Model {
  name: string;
  /** Optional top-level description. */
  documentation?: string;
  stocks: Stock[];
  flows: Flow[];
  converters: Converter[];
  connectors: Connector[];
  graphFunctions: GraphFunction[];
  /** Subscript dimensions (empty when the model is not arrayed). */
  dimensions: Dimension[];
  /** Per-element array specs, keyed by element name. */
  arrayed: Record<string, ArraySpec>;
  run: RunSpec;
  /** Diagram positions keyed by element name (stocks, flows' valves,
   * converters, graph functions). Optional: absent means "auto-layout". */
  layout?: Record<string, Point>;
  metadata?: ModelMetadata;
  scenarios?: Scenario[];
}

/** A diagram coordinate (XMILE view units, y grows downward). */
export interface Point {
  x: number;
  y: number;
}

/** Create an empty model with sensible run defaults. */
export function emptyModel(name = "Untitled"): Model {
  return {
    name,
    stocks: [],
    flows: [],
    converters: [],
    connectors: [],
    graphFunctions: [],
    dimensions: [],
    arrayed: {},
    run: { start: 0, stop: 12, dt: 0.25, saveEvery: 1, integration: "euler", timeUnits: "Year" },
  };
}

/** A kind discriminator for generic element traversal. */
export type ElementKind =
  | Stock["kind"]
  | Flow["kind"]
  | Converter["kind"]
  | Connector["kind"]
  | GraphFunction["kind"]
  | Dimension["kind"];

/** Any graph element (excludes run spec, dimensions, and array metadata). */
export type AnyElement = Stock | Flow | Converter | Connector | GraphFunction | Dimension;

/** Collect every element of a model into a flattened list. */
export function allElements(m: Model): AnyElement[] {
  return [...m.stocks, ...m.flows, ...m.converters, ...m.connectors, ...m.graphFunctions, ...m.dimensions];
}

/** Index elements by name (names are the cross-reference identity). */
export function byName(m: Model): Map<string, AnyElement> {
  const out = new Map<string, AnyElement>();
  for (const e of allElements(m)) out.set(e.name, e);
  return out;
}

/** Diagnose structural problems (returns empty list when valid). */
export function validate(m: Model): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const e of allElements(m)) {
    if (!e.name.trim()) errors.push(`${e.kind} has empty name`);
    if (seen.has(e.name)) errors.push(`duplicate element name: ${e.name}`);
    seen.add(e.name);
  }
  // Connectors may also name single elements of an array, e.g. `Prey[North]`.
  const names = new Set(seen);
  for (const [el, spec] of Object.entries(m.arrayed ?? {})) {
    const labels = spec.dimensions.map((d) => m.dimensions.find((x) => x.name === d)?.values ?? []);
    for (const combo of labels.reduce<string[][]>((acc, ls) => acc.flatMap((c) => ls.map((l) => [...c, l])), [[]])) {
      if (combo.length) names.add(`${el}[${combo.join(",")}]`);
    }
  }
  const stockNames = new Set(m.stocks.map((x) => x.name));
  for (const c of m.connectors) {
    if (!names.has(c.from)) errors.push(`connector '${c.name}' references unknown '${c.from}'`);
    if (!names.has(c.to)) errors.push(`connector '${c.name}' references unknown '${c.to}'`);
    if (stockNames.has(c.to)) errors.push(`connector '${c.name}' points into stock '${c.to}' (only flows change a stock)`);
  }
  // A flow moves material from one place to one place.
  const into = new Map<string, string>();
  const outOf = new Map<string, string>();
  for (const st of m.stocks) {
    for (const [list, seenBy, verb] of [
      [st.inflows, into, "an inflow"],
      [st.outflows, outOf, "an outflow"],
    ] as const) {
      for (const f of list ?? []) {
        const other = seenBy.get(f);
        if (other && other !== st.name) errors.push(`flow '${f}' is ${verb} of both '${other}' and '${st.name}'`);
        seenBy.set(f, st.name);
      }
    }
  }
  const r = m.run;
  if (r.dt <= 0) errors.push("run.dt must be > 0");
  if (r.stop < r.start) errors.push("run.stop must be >= run.start");
  if (r.saveEvery <= 0) errors.push("run.saveEvery must be > 0");
  return errors;
}