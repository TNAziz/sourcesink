import { XMLParser, XMLValidator } from "fast-xml-parser";
import type {
  ArraySpec,
  Converter,
  Connector,
  Dimension,
  Flow,
  GraphFunction,
  Model,
  ModelMetadata,
  Point,
  Provenance,
  RunSpec,
  Scenario,
  Stock,
} from "@sourcesink/model";

/** SourceSink's XMILE extension namespace; other tools ignore these elements. */
const SS_NS = "https://sourcesink.dev/xmile/1";

export function readXmile(xml: string): Model {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    const msg = valid.err ? `${valid.err.msg} (line ${valid.err.line}:${valid.err.col})` : "invalid XMILE document";
    throw new Error(`Invalid XMILE: ${msg}`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
  });

  const parsed: any = parser.parse(xml);
  const root: any = parsed?.xmile ?? {};
  const header: any = root.header ?? {};
  const ss: any = root.sim_specs ?? {};

  const run: RunSpec = {
    start: num(ss.start, 0),
    stop: num(ss.stop, 12),
    dt: num(ss.dt, 0.25),
    saveEvery: num(ss.saveper ?? ss.saveEvery, 1),
    integration: methodToIntegration(ss["@_method"]),
    timeUnits: optional(text(ss["@_time_units"])),
  };

  const metadata = readMetadata(header);
  const scenarios = readScenarios(root.model?.["ss:scenarios"]);

  const dimsNode: any = root.dimensions ?? root.model?.dimensions;
  const dimensions: Dimension[] = arr(dimsNode?.dim).map((d: any) => {
    const dname = text(d?.["@_name"]);
    const values = arr(d?.elem)
      .map((e) => text(e?.["@_name"]))
      .filter((s) => s !== "");
    return { kind: "dimension", id: dname, name: dname, values };
  });

  const vars: any = root.model?.variables ?? {};
  const stocks: Stock[] = [];
  const flows: Flow[] = [];
  const converters: Converter[] = [];
  const graphFunctions: GraphFunction[] = [];
  const arrayed: Record<string, ArraySpec> = {};

  const elementEquations = (n: any): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const e of arr(n?.element)) {
      const labels = csv(e?.["@_subscript"]).join(",");
      if (labels) out[labels] = text(e?.eqn);
    }
    return out;
  };

  // Dimensions may arrive in the standard child form, the older
  // `dimensions="A,B"` attribute, or a `name[A,B]` suffix. Keep accepting all
  // three; the child form wins when both are present.
  const register = (node: any): { name: string; elementsOnly: boolean } => {
    const split = splitName(node?.["@_name"]);
    const declared = csv(node?.["@_dimensions"]);
    const childDims = arr(node?.dimensions?.dim)
      .map((d) => text(d?.["@_name"]).trim())
      .filter((d) => d !== "");
    const dims = childDims.length > 0 ? childDims : declared.length > 0 ? declared : (split.dims ?? []);
    const elements = elementEquations(node);
    const overrides = Object.keys(elements);
    if (dims.length > 0) {
      arrayed[split.name] = { dimensions: dims, ...(overrides.length > 0 ? { elements } : {}) };
    }
    // An array defined only by per-element equations has no apply-to-all eqn.
    return { name: split.name, elementsOnly: dims.length > 0 && overrides.length > 0 && text(node?.eqn) === "" };
  };

  const flowNameOf = (v: any): string => {
    const name = v?.["@_name"];
    if (typeof name === "string" && name !== "") return name.trim();
    return text(v).trim();
  };

  // Stock inflow/outflow links appear in XMILE in a few equivalent shapes:
  //   <inflow name="x"/>  <outflow>y</outflow>   <inflows><flow>z</flow></inflows>
  // Accept all of them via inflowNames/outflowNames below.
  const inflowNames = (n: any): string[] => {
    const out: string[] = [];
    for (const v of arr(n?.inflow)) {
      const s = flowNameOf(v);
      if (s) out.push(s);
    }
    for (const v of arr(n?.inflows?.flow)) {
      const s = flowNameOf(v);
      if (s) out.push(s);
    }
    return out;
  };
  const outflowNames = (n: any): string[] => {
    const out: string[] = [];
    for (const v of arr(n?.outflow)) {
      const s = flowNameOf(v);
      if (s) out.push(s);
    }
    for (const v of arr(n?.outflows?.flow)) {
      const s = flowNameOf(v);
      if (s) out.push(s);
    }
    return out;
  };

  for (const node of arr(vars.stock)) {
    const { name, elementsOnly } = register(node);
    stocks.push({
      kind: "stock",
      id: name,
      name,
      documentation: optional(text(node?.doc)),
      units: optional(text(node?.units)),
      equation: elementsOnly ? "" : text(node?.eqn),
      nonNegative: bool(node?.["@_non_negative"]),
      inflows: inflowNames(node),
      outflows: outflowNames(node),
      ...(node?.conveyor !== undefined ? { conveyor: { transitTime: text(node.conveyor?.len) || "1" } } : {}),
      ...(node?.queue !== undefined ? { queue: true } : {}),
      ...(node?.oven !== undefined
        ? { oven: { capacity: text(node.oven?.capacity) || "1", fillTime: text(node.oven?.fill_time) || "INF" } }
        : {}),
      ...elementSs(node),
    });
  }

  for (const node of arr(vars.flow)) {
    const { name, elementsOnly } = register(node);
    flows.push({
      kind: "flow",
      id: name,
      name,
      documentation: optional(text(node?.doc)),
      units: optional(text(node?.units)),
      equation: elementsOnly ? "" : text(node?.eqn),
      biflow: bool(node?.["@_biflow"]),
      nonNegative: bool(node?.["@_non_negative"]),
      ...(node?.leak !== undefined ? { leak: true } : {}),
      ...elementSs(node),
    });
  }

  for (const node of arr(vars.aux)) {
    const { name, elementsOnly } = register(node);
    converters.push({
      kind: "converter",
      id: name,
      name,
      documentation: optional(text(node?.doc)),
      units: optional(text(node?.units)),
      equation: elementsOnly ? "" : text(node?.eqn),
      ...elementSs(node),
    });
  }

  for (const node of arr(vars.gf)) {
    const { name } = register(node);
    const xs = numList(node?.xpts);
    const ys = numList(node?.ypts);
    graphFunctions.push({
      kind: "graphFunction",
      id: name,
      name,
      documentation: optional(text(node?.doc)),
      units: optional(text(node?.units)),
      points: xs.map((x, i) => ({ x, y: ys[i] ?? 0 })),
      interpolation: interp(node?.["@_interpolation"]),
      extrapolation: extrap(node?.["@_extrapolation"]),
      ...elementSs(node),
    });
  }

  // Diagram: <views><view> holds element positions and the connectors
  // (information links). Flow wiring is NOT a connector — it lives on the
  // stock's <inflow>/<outflow>. View names may write spaces as underscores.
  const nameByKey = new Map<string, string>();
  for (const e of [...stocks, ...flows, ...converters, ...graphFunctions]) {
    nameByKey.set(viewKey(e.name), e.name);
  }
  const resolveName = (raw: unknown): string | undefined =>
    nameByKey.get(viewKey(splitName(raw).name));

  const connectors: Connector[] = [];
  const layout: Record<string, Point> = {};
  const seen = new Set<string>();
  for (const view of arr(root.model?.views?.view)) {
    for (const tag of ["stock", "flow", "aux", "gf"]) {
      for (const v of arr(view?.[tag])) {
        const name = resolveName(v?.["@_name"]);
        const x = parseFloat(text(v?.["@_x"]));
        const y = parseFloat(text(v?.["@_y"]));
        if (name && Number.isFinite(x) && Number.isFinite(y)) layout[name] = { x, y };
      }
    }
    for (const c of arr(view?.connector)) {
      const from = resolveName(c?.["@_from"] ?? c?.from);
      const to = resolveName(c?.["@_to"] ?? c?.to);
      if (!from || !to) continue;
      const key = `${from}\u0000${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      connectors.push({ kind: "connector", id: `${from}->${to}`, name: `${from} -> ${to}`, from, to });
    }
  }

  return {
    name: text(header.name) || "Untitled",
    stocks,
    flows,
    converters,
    connectors,
    graphFunctions,
    dimensions,
    arrayed,
    run,
    ...(Object.keys(layout).length > 0 ? { layout } : {}),
    ...(metadata ? { metadata } : {}),
    ...(scenarios ? { scenarios } : {}),
  };
}

/** Name key for matching view references: case-insensitive, `_` ≡ space. */
function viewKey(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "_");
}

export function writeXmile(model: Model): string {
  const flowIdName = new Map(model.flows.map((f) => [f.id, f.name]));
  const out: string[] = [];

  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<xmile version="1.0" xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0" xmlns:ss="${SS_NS}">`);
  out.push(indent(1, "<header>"));
  out.push(indent(2, leaf("name", {}, model.name)));
  out.push(indent(2, leaf("vendor", {}, "SourceSink")));
  out.push(indent(2, leaf("product", { version: "0.1.0" }, "SourceSink")));
  out.push(...metadataLines(model.metadata));
  out.push(indent(1, "</header>"));

  const ssAttrs: Record<string, string> = { method: integrationToMethod(model.run.integration) };
  if (model.run.timeUnits) ssAttrs.time_units = model.run.timeUnits;
  out.push(indent(1, open("sim_specs", ssAttrs)));
  out.push(indent(2, leaf("start", {}, model.run.start)));
  out.push(indent(2, leaf("stop", {}, model.run.stop)));
  out.push(indent(2, leaf("dt", {}, model.run.dt)));
  out.push(indent(2, leaf("saveper", {}, model.run.saveEvery)));
  out.push(indent(1, "</sim_specs>"));

  if (model.dimensions.length > 0) {
    out.push(indent(1, "<dimensions>"));
    for (const d of model.dimensions) {
      out.push(indent(2, open("dim", { name: d.name, size: String(d.values.length) })));
      for (const v of d.values) out.push(indent(3, leaf("elem", { name: v })));
      out.push(indent(2, "</dim>"));
    }
    out.push(indent(1, "</dimensions>"));
  }

  out.push(indent(1, "<model>"));
  out.push(indent(2, "<variables>"));

  for (const s of model.stocks) out.push(...elementLines(s, stockLinks(s, flowIdName), model));
  for (const f of model.flows) out.push(...elementLines(f, [], model));
  for (const c of model.converters) out.push(...elementLines(c, [], model));
  for (const g of model.graphFunctions) out.push(...gfLines(g, model));
  out.push(indent(2, "</variables>"));
  out.push(...scenarioLines(model));
  out.push(...viewLines(model));
  out.push(indent(1, "</model>"));
  out.push("</xmile>");
  return out.join("\n") + "\n";
}

interface Link {
  tag: "inflow" | "outflow";
  name: string;
}

type Writable =
  | Pick<
      Stock,
      | "kind"
      | "name"
      | "equation"
      | "documentation"
      | "units"
      | "nonNegative"
      | "conveyor"
      | "queue"
      | "oven"
      | "provenance"
      | "annotations"
    >
  | Pick<
      Flow,
      "kind" | "name" | "equation" | "documentation" | "units" | "nonNegative" | "biflow" | "leak" | "provenance" | "annotations"
    >
  | Pick<Converter, "kind" | "name" | "equation" | "documentation" | "units" | "provenance" | "annotations">;

function tagFor(v: Writable): string {
  return v.kind === "stock" ? "stock" : v.kind === "flow" ? "flow" : "aux";
}

/** Standard XMILE array dimensions of one element: `<dimensions><dim name=…/>`. */
function dimensionLines(level: number, spec: ArraySpec | undefined): string[] {
  if (!spec || spec.dimensions.length === 0) return [];
  const out = [indent(level, "<dimensions>")];
  for (const d of spec.dimensions) out.push(indent(level + 1, leaf("dim", { name: d })));
  out.push(indent(level, "</dimensions>"));
  return out;
}

function elementLines(v: Writable, links: Link[], model: Model): string[] {
  const out: string[] = [];
  const attrs: Record<string, string> = { name: v.name };
  const ds = model.arrayed[v.name];
  const arrayed = ds !== undefined && ds.dimensions.length > 0;
  if (v.kind === "stock") {
    if (v.nonNegative) attrs.non_negative = "true";
  } else if (v.kind === "flow") {
    if (v.biflow) attrs.biflow = "true";
    if (v.nonNegative) attrs.non_negative = "true";
  }
  out.push(indent(3, open(tagFor(v), attrs)));
  out.push(...dimensionLines(4, ds));
  // A purely per-element array has no apply-to-all equation.
  if (!(arrayed && v.equation === "")) out.push(indent(4, leaf("eqn", {}, v.equation)));
  for (const [key, equation] of Object.entries(ds?.elements ?? {})) {
    out.push(indent(4, open("element", { subscript: key.split(",").join(", ") })));
    out.push(indent(5, leaf("eqn", {}, equation)));
    out.push(indent(4, "</element>"));
  }
  for (const l of links) out.push(indent(4, leaf(l.tag, {}, l.name)));
  if (v.kind === "stock" && v.conveyor) {
    out.push(indent(4, "<conveyor>"), indent(5, leaf("len", {}, v.conveyor.transitTime)), indent(4, "</conveyor>"));
  }
  if (v.kind === "stock" && v.queue) out.push(indent(4, "<queue/>"));
  if (v.kind === "stock" && v.oven) {
    out.push(
      indent(4, "<oven>"),
      indent(5, leaf("capacity", {}, v.oven.capacity)),
      indent(5, leaf("fill_time", {}, v.oven.fillTime)),
      indent(4, "</oven>"),
    );
  }
  if (v.kind === "flow" && v.leak) out.push(indent(4, "<leak/>"));
  if (v.documentation) out.push(indent(4, leaf("doc", {}, v.documentation)));
  if (v.units) out.push(indent(4, leaf("units", {}, v.units)));
  out.push(...ssElementLines(4, v));
  out.push(indent(3, `</${tagFor(v)}>`));
  return out;
}

/** A stock's flow wiring, from its own inflow/outflow lists (flow ids; a flow
 * name is accepted too). Connectors never contribute. */
function stockLinks(s: Stock, flowIdName: Map<string, string>): Link[] {
  const names = (refs: string[] | undefined): string[] => {
    const known = new Set(flowIdName.values());
    const out = new Set<string>();
    for (const r of refs ?? []) {
      const n = flowIdName.get(r) ?? (known.has(r) ? r : undefined);
      if (n) out.add(n);
    }
    return [...out];
  };
  return [
    ...names(s.inflows).map((name) => ({ tag: "inflow" as const, name })),
    ...names(s.outflows).map((name) => ({ tag: "outflow" as const, name })),
  ];
}

/** <views>: positions (from model.layout) and connectors. */
function viewLines(model: Model): string[] {
  const layout = model.layout ?? {};
  if (Object.keys(layout).length === 0 && model.connectors.length === 0) return [];
  const out: string[] = [indent(2, "<views>"), indent(3, '<view type="stock_flow">')];
  const placed: [string, { name: string }[]][] = [
    ["stock", model.stocks],
    ["flow", model.flows],
    ["aux", model.converters],
    ["gf", model.graphFunctions],
  ];
  for (const [tag, els] of placed) {
    for (const e of els) {
      const p = layout[e.name];
      if (p) out.push(indent(4, leaf(tag, { name: e.name, x: round(p.x), y: round(p.y) })));
    }
  }
  for (const c of model.connectors) {
    out.push(indent(4, leaf("connector", { from: c.from, to: c.to })));
  }
  out.push(indent(3, "</view>"), indent(2, "</views>"));
  return out;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function gfLines(g: GraphFunction, model: Model): string[] {
  const out: string[] = [];
  const attrs: Record<string, string> = { name: g.name };
  attrs.interpolation = g.interpolation;
  attrs.extrapolation = g.extrapolation;
  out.push(indent(3, open("gf", attrs)));
  out.push(...dimensionLines(4, model.arrayed[g.name]));
  out.push(indent(4, leaf("xpts", {}, g.points.map((p) => p.x).join(","))));
  out.push(indent(4, leaf("ypts", {}, g.points.map((p) => p.y).join(","))));
  if (g.documentation) out.push(indent(4, leaf("doc", {}, g.documentation)));
  if (g.units) out.push(indent(4, leaf("units", {}, g.units)));
  out.push(...ssElementLines(4, g));
  out.push(indent(3, "</gf>"));
  return out;
}

interface SsFields {
  provenance?: Provenance;
  annotations?: Record<string, unknown>;
}

/** SourceSink-only children of one element: provenance, then annotations. */
function ssElementLines(level: number, v: SsFields): string[] {
  const out: string[] = [];
  if (v.provenance) out.push(...provenanceLines(level, v.provenance));
  if (v.annotations && Object.keys(v.annotations).length > 0) {
    out.push(indent(level, leaf("ss:annotations", {}, JSON.stringify(v.annotations))));
  }
  return out;
}

function metadataLines(md: ModelMetadata | undefined): string[] {
  if (!md) return [];
  const out: string[] = [];
  if (md.version) out.push(indent(2, leaf("version", {}, md.version)));
  for (const author of md.authors ?? []) out.push(indent(2, leaf("author", {}, author)));
  if (md.license || md.intendedUse) {
    out.push(indent(2, leaf("ss:metadata", { license: md.license, intended_use: md.intendedUse })));
  }
  if (md.provenance) out.push(...provenanceLines(2, md.provenance));
  return out;
}

function provenanceLines(level: number, p: Provenance): string[] {
  const attrs: Record<string, string> = { author: p.author };
  if (p.agent) attrs.agent = p.agent;
  if (p.promptHash) attrs.prompt_hash = p.promptHash;
  if (p.confidence !== undefined) attrs.confidence = String(p.confidence);
  if (p.createdAt) attrs.created_at = p.createdAt;
  const sources = p.sources ?? [];
  if (sources.length === 0) return [indent(level, leaf("ss:provenance", attrs))];
  const out = [indent(level, open("ss:provenance", attrs))];
  for (const s of sources) out.push(indent(level + 1, leaf("ss:source", {}, s)));
  out.push(indent(level, "</ss:provenance>"));
  return out;
}

function scenarioLines(model: Model): string[] {
  const scenarios = model.scenarios ?? [];
  if (scenarios.length === 0) return [];
  const out = [indent(2, "<ss:scenarios>")];
  for (const s of scenarios) {
    out.push(indent(3, open("ss:scenario", { id: s.id, name: s.name })));
    for (const [name, value] of Object.entries(s.overrides)) {
      out.push(indent(4, leaf("ss:override", { name }, value)));
    }
    if (s.run) out.push(indent(4, leaf("ss:run", scenarioRunAttrs(s.run))));
    if (s.documentation) out.push(indent(4, leaf("ss:doc", {}, s.documentation)));
    out.push(indent(3, "</ss:scenario>"));
  }
  out.push(indent(2, "</ss:scenarios>"));
  return out;
}

function scenarioRunAttrs(run: Partial<RunSpec>): Record<string, string | number> {
  const attrs: Record<string, string | number> = {};
  if (run.start !== undefined) attrs.start = run.start;
  if (run.stop !== undefined) attrs.stop = run.stop;
  if (run.dt !== undefined) attrs.dt = run.dt;
  if (run.saveEvery !== undefined) attrs.saveper = run.saveEvery;
  if (run.integration !== undefined) attrs.method = integrationToMethod(run.integration);
  if (run.timeUnits !== undefined) attrs.time_units = run.timeUnits;
  return attrs;
}

function readMetadata(header: any): ModelMetadata | undefined {
  const md = header?.["ss:metadata"];
  const version = optional(text(header?.version));
  const authors = arr(header?.author)
    .map((a) => text(a).trim())
    .filter((a) => a !== "");
  const license = optional(text(md?.["@_license"]));
  const intendedUse = optional(text(md?.["@_intended_use"]));
  const provenance = readProvenance(header?.["ss:provenance"]);
  if (!version && authors.length === 0 && !license && !intendedUse && !provenance) return undefined;
  return {
    ...(version ? { version } : {}),
    ...(authors.length > 0 ? { authors } : {}),
    ...(license ? { license } : {}),
    ...(intendedUse ? { intendedUse } : {}),
    ...(provenance ? { provenance } : {}),
  };
}

function readScenarios(node: any): Scenario[] | undefined {
  const out: Scenario[] = [];
  for (const s of arr(node?.["ss:scenario"])) {
    const id = text(s?.["@_id"]);
    if (!id) continue;
    const name = text(s?.["@_name"]) || id;
    const overrides: Record<string, string | number> = {};
    for (const o of arr(s?.["ss:override"])) {
      const key = text(o?.["@_name"]);
      if (!key) continue;
      const raw = text(o).trim();
      const n = Number(raw);
      overrides[key] = raw !== "" && Number.isFinite(n) ? n : raw;
    }
    const run = readScenarioRun(s?.["ss:run"]);
    const documentation = optional(text(s?.["ss:doc"]));
    out.push({
      id,
      name,
      overrides,
      ...(run ? { run } : {}),
      ...(documentation ? { documentation } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

function readScenarioRun(node: any): Partial<RunSpec> | undefined {
  if (!node) return undefined;
  const run: Partial<RunSpec> = {};
  const number = (name: string): number | undefined => {
    const n = parseFloat(text(node[`@_${name}`]));
    return Number.isFinite(n) ? n : undefined;
  };
  const start = number("start");
  const stop = number("stop");
  const dt = number("dt");
  const saveEvery = number("saveper") ?? number("saveEvery") ?? number("save_every");
  const integration = methodToIntegration(node["@_method"]);
  const timeUnits = optional(text(node["@_time_units"]));
  if (start !== undefined) run.start = start;
  if (stop !== undefined) run.stop = stop;
  if (dt !== undefined) run.dt = dt;
  if (saveEvery !== undefined) run.saveEvery = saveEvery;
  if (integration !== undefined) run.integration = integration;
  if (timeUnits !== undefined) run.timeUnits = timeUnits;
  return Object.keys(run).length > 0 ? run : undefined;
}

function readProvenance(node: any): Provenance | undefined {
  const author = text(node?.["@_author"]);
  if (author !== "human" && author !== "ai" && author !== "import") return undefined;
  const agent = optional(text(node?.["@_agent"]));
  const promptHash = optional(text(node?.["@_prompt_hash"]));
  const sources = arr(node?.["ss:source"])
    .map((s) => text(s).trim())
    .filter((s) => s !== "");
  const confidence = parseFloat(text(node?.["@_confidence"]));
  const createdAt = optional(text(node?.["@_created_at"]));
  return {
    author,
    ...(agent ? { agent } : {}),
    ...(promptHash ? { promptHash } : {}),
    ...(sources.length > 0 ? { sources } : {}),
    ...(Number.isFinite(confidence) ? { confidence } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}

function readAnnotations(node: any): Record<string, unknown> | undefined {
  const raw = text(node?.["ss:annotations"]).trim();
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Malformed extension data is ignored rather than failing the whole file.
  }
  return undefined;
}

function elementSs(node: any): SsFields {
  const provenance = readProvenance(node?.["ss:provenance"]);
  const annotations = readAnnotations(node);
  return {
    ...(provenance ? { provenance } : {}),
    ...(annotations ? { annotations } : {}),
  };
}

function optional(s: string): string | undefined {
  return s === "" ? undefined : s;
}

function indent(level: number, s: string): string {
  return "  ".repeat(level) + s;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function open(name: string, attrs: Record<string, string>): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join("");
  return `<${name}${a}>`;
}

function leaf(name: string, attrs: Record<string, string | number | undefined>, text?: string | number): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join("");
  const body = text === undefined || text === "" ? "" : esc(String(text));
  if (body === "") return `<${name}${a}/>`;
  return `<${name}${a}>${body}</${name}>`;
}

function text(v: any): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    const t = v["#text"];
    return t === undefined || t === null ? "" : String(t);
  }
  return String(v);
}

function arr(v: any): any[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function num(v: unknown, fallback: number): number {
  const n = parseFloat(text(v));
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const s = text(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function splitName(raw: unknown): { name: string; dims?: string[] } {
  const s = text(raw).trim();
  const m = /^([^\[\]]+)\[([^\[\]]+)\]$/.exec(s);
  if (m) {
    return {
      name: m[1].trim(),
      dims: m[2]
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x !== ""),
    };
  }
  return { name: s };
}

function csv(v: unknown): string[] {
  return text(v)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function numList(v: unknown): number[] {
  return text(v)
    .split(/[\s,]+/)
    .filter((s) => s !== "")
    .map((s) => parseFloat(s))
    .filter((n) => Number.isFinite(n));
}

function methodToIntegration(m: unknown): RunSpec["integration"] {
  switch (text(m).toUpperCase()) {
    case "RK4":
      return "rk4";
    case "RK45":
      return "rk45";
    case "RK2":
      return "rk2";
    case "EULER":
      return "euler";
    default:
      return undefined;
  }
}

function integrationToMethod(i: RunSpec["integration"]): string {
  switch (i) {
    case "rk4":
      return "RK4";
    case "rk45":
      return "RK45";
    case "rk2":
      return "RK2";
    default:
      return "Euler";
  }
}

function interp(v: unknown): GraphFunction["interpolation"] {
  const s = text(v).toLowerCase();
  if (s === "held" || s === "step") return "held";
  if (s === "discrete") return "discrete";
  return "linear";
}

function extrap(v: unknown): GraphFunction["extrapolation"] {
  return text(v).toLowerCase() === "extend" ? "extend" : "clip";
}