/**
 * `.stm`/`.itm` -> `@sourcesink/model` importer.
 *
 * Walks the decoded object stream (objects.ts) and maps each `entity_struct`
 * record to an IR element. Field meanings are documented, with evidence, in
 * docs/format/stm.md §9–§11. Anything the IR or engine cannot represent yet
 * (ovens, arrays) is reported in `warnings` rather than guessed.
 */

import type {
  Connector,
  Converter,
  Flow,
  GraphFunction,
  Model,
  Point,
  RunSpec,
  Stock,
} from "@sourcesink/model";
import { emptyModel } from "@sourcesink/model";

import { nativeArrays, type ArrayParent } from "./arrays.js";
import { readObjects, type StmObject } from "./objects.js";
import { parseStm } from "./parse.js";

export interface ImportResult {
  model: Model;
  /** Human-readable notes about anything not imported faithfully. */
  warnings: string[];
}

/** One `entity_struct` record and the child objects serialized after it. */
interface EntityRecord {
  index: number;
  kind: string;
  struct: Uint8Array;
  name: string;
  equation: string;
  inputs: number[];
  inflows: number[];
  outflows: number[];
  xs: number[];
  ys: number[];
  documentation: string;
}

/** Bytes 0x80–0xFF of Mac OS Roman; all model text is in this encoding. */
const MAC_ROMAN =
  "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø" +
  "¿¡¬√ƒ≈∆«»…\u00a0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";

const macRoman = (b: Uint8Array): string => {
  let s = "";
  for (const c of b) {
    if (c === 0) break;
    s += c < 0x80 ? String.fromCharCode(c) : MAC_ROMAN[c - 0x80];
  }
  return s;
};

const int16s = (o: StmObject | undefined): number[] => {
  if (!o || o.type !== "int16_array") return [];
  const out: number[] = [];
  for (let i = 0; i + 1 < o.data.length; i += 2) out.push((o.data[i] << 8) | o.data[i + 1]);
  return out;
};

const doubles = (o: StmObject | undefined): number[] => {
  if (!o || o.type !== "double_array") return [];
  const view = new DataView(o.data.buffer, o.data.byteOffset, o.data.byteLength);
  const out: number[] = [];
  for (let i = 0; i + 8 <= o.data.length; i += 8) out.push(view.getFloat64(i, false));
  return out;
};

const isNull = (o: StmObject) => o.form === 0xc0;
const isRef = (o: StmObject) => o.form === 0xca || o.form === 0xd0;

const isEntity = (o: StmObject) => o.type === "entity_struct" && !isNull(o) && !isRef(o);

/** Split the object stream into entity records (§9). Variables are numbered
 * by slot in the entity array, and deleted variables leave null slots that
 * still take a number. */
function entityRecords(objects: StmObject[]): EntityRecord[] {
  const records: EntityRecord[] = [];
  let slot = -1;
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (o.type === "entity_struct" && !isRef(o)) slot++;
    if (!isEntity(o)) continue;
    let end = i + 1;
    while (end < objects.length && !isEntity(objects[end])) end++;
    const kids = objects.slice(i + 1, end);
    const str = (k: StmObject | undefined) => (k && k.type === "C_String" && !isNull(k) ? macRoman(k.data) : "");
    // Documentation is the string right after the run-handle field (§9.1).
    const rh = kids.findIndex((k) => k.type === "run_handle_array");
    const name = str(kids[0]);
    const equation = str(kids[1]);
    records.push({
      index: slot,
      kind: String.fromCharCode(o.data[0]),
      struct: o.data,
      name,
      equation,
      inputs: int16s(kids[2]),
      inflows: int16s(kids[4]),
      outflows: int16s(kids[5]),
      xs: doubles(kids[6]),
      ys: doubles(kids[7]),
      documentation: rh >= 0 ? str(kids[rh + 1]).trim() : "",
    });
  }
  return records;
}

/** Graph x-axis for a record: explicit xs, else evenly spaced over the
 * struct's [xmin, xmax] (§9.2). */
function graphXs(r: EntityRecord): number[] {
  if (r.xs.length === r.ys.length) return r.xs;
  const view = new DataView(r.struct.buffer, r.struct.byteOffset, r.struct.byteLength);
  const n = view.getUint16(14, false);
  const min = view.getFloat64(16, false);
  const max = view.getFloat64(24, false);
  if (n !== r.ys.length || n < 2) return r.ys.map((_, i) => i);
  return r.ys.map((_, i) => min + ((max - min) * i) / (n - 1));
}

/** Strip `{ ... }` comments, normalise line breaks and spell the Mac
 * comparison glyphs as ASCII operators (§9.3). */
function cleanEquation(raw: string): { equation: string; comment?: string } {
  const comments: string[] = [];
  const equation = raw
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/≠/g, "<>")
    .replace(/\{([^}]*)\}/g, (_, c: string) => {
      comments.push(c.trim());
      return " ";
    })
    .replace(/[\r\n]+/g, " ")
    .trim();
  const comment = comments.filter(Boolean).join("\n");
  return comment ? { equation, comment } : { equation };
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Legacy models repeat a PULSE every DT when its interval is omitted (and starts
 * at the start time without a first-pulse time); SourceSink, like XMILE,
 * fires once. Spell the legacy defaults out so behaviour is kept.
 */
function expandPulseDefaults(eq: string): string {
  let out = "";
  let i = 0;
  const re = /\bPULSE\s*\(/gi;
  for (let m = re.exec(eq); m; m = re.exec(eq)) {
    // find the matching ")" and split top-level arguments
    let depth = 1;
    let j = m.index + m[0].length;
    const args: string[] = [];
    let argStart = j;
    for (; j < eq.length && depth > 0; j++) {
      const c = eq[j];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      if ((c === "," && depth === 1) || depth === 0) {
        args.push(eq.slice(argStart, j));
        argStart = j + 1;
      }
    }
    if (depth !== 0) break;
    if (args.length === 1) args.push("STARTTIME");
    if (args.length === 2) args.push("DT");
    out += eq.slice(i, m.index) + `PULSE(${args.map((a) => a.trim()).join(", ")})`;
    i = j;
    re.lastIndex = j;
  }
  return out + eq.slice(i);
}

/** Quote a name for an equation when it is not a plain identifier. */
const ref = (name: string) => (IDENT.test(name) ? name : `"${name}"`);

/** Wrap every mention of a non-identifier name (e.g. `$_per_pro`) in quotes so
 * the equation parser reads it as one name. */
function quoteNames(equation: string, special: string[]): string {
  let out = equation;
  for (const name of special) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![A-Za-z0-9_"])${escaped}(?![A-Za-z0-9_])`, "gi"), `"${name}"`);
  }
  return out;
}

/** Read the first Run_Specs object (§10). */
function runSpec(objects: StmObject[]): RunSpec | undefined {
  const o = objects.find((x) => x.type === "Run_Specs" && !isNull(x) && !isRef(x));
  if (!o || o.data.length < 64) return undefined;
  const view = new DataView(o.data.buffer, o.data.byteOffset, o.data.byteLength);
  const start = view.getFloat64(0, false);
  const stop = view.getFloat64(8, false);
  const dt = view.getFloat64(16, false);
  const timeUnits = macRoman(o.data.subarray(64)).trim();
  return {
    start,
    stop,
    dt,
    saveEvery: dt,
    integration: "euler",
    ...(timeUnits ? { timeUnits } : {}),
  };
}

/** Diagram positions keyed by entity index (§11). */
function positions(objects: StmObject[]): Map<number, Point> {
  const out = new Map<number, Point>();
  for (const o of objects) {
    if (o.type !== "diagram_struct" || isNull(o) || isRef(o) || o.data.length < 19) continue;
    const view = new DataView(o.data.buffer, o.data.byteOffset, o.data.byteLength);
    const glyph = String.fromCharCode(o.data[0]);
    if (!"sfcb".includes(glyph)) continue;
    const entity = view.getInt16(17, false);
    if (entity < 0 || out.has(entity)) continue;
    out.set(entity, { x: view.getInt16(3, false), y: view.getInt16(1, false) });
  }
  return out;
}

/** Legacy diagrams were drawn for small icons (a stock and its valve sit
 * ~60 units apart); SourceSink's cards and chips need ~2.4x the room. One
 * uniform factor keeps the original arrangement while giving every shape
 * clear space. */
const LEGACY_LAYOUT_SCALE = 2.4;

function scaled(p: Point): Point {
  return { x: Math.round(p.x * LEGACY_LAYOUT_SCALE), y: Math.round(p.y * LEGACY_LAYOUT_SCALE) };
}

/** Struct byte whose bit 0 is the stock's "non-negative" option (§9.2). */
const STOCK_FLAGS = 283;

/** Kinds (§9.2): `l` conveyor, `q` queue, `z` oven, `m` conveyor exit, `k`
 * conveyor leak, `u` queue outflow, `y` oven outflow. */
const STOCK_KINDS = "slqz";
const FLOW_KINDS = "fbmkuy";
const SKIPPED_KINDS: Record<string, string> = {
  g: "sector frame",
  S: "sector frame",
};

/** Struct doubles holding a discrete stock's dialog settings (§9.5): the
 * capacity (ovens; conveyors default to INF) and an oven's fill time. */
const CAPACITY_AT = 160;
const FILL_TIME_AT = 176;

const settingText = (x: number) => (x === Number.POSITIVE_INFINITY ? "INF" : String(x));

/** Every element and the model itself is stamped as machine-imported so an
 * audit trail distinguishes it from human- or AI-authored work. */
const IMPORT_PROVENANCE = { author: "import", agent: "sourcesink-legacy-import" } as const;

/**
 * Import a legacy `.stm`/`.itm` model file. `name` is used as the model name
 * (typically the file name without extension).
 */
export interface ImportOptions {
  /** "native" (default): arrays become arrayed variables where exact;
   * "flatten": every array element is its own variable. */
  arrays?: "native" | "flatten";
}

export function importStm(bytes: Uint8Array, name = "Imported model", options: ImportOptions = {}): ImportResult {
  const parsed = parseStm(bytes);
  const typeNames = new Map(parsed.sections.map((s) => [s.typeId, s.name]));
  const objects = readObjects(bytes, parsed.bodyOffset, typeNames);
  const records = entityRecords(objects);
  const warnings: string[] = [];

  const model = emptyModel(name);
  model.metadata = { provenance: IMPORT_PROVENANCE };
  const run = runSpec(objects);
  if (run) model.run = run;
  else warnings.push("no run specs found; using defaults");

  // Arrays are flattened: every element has its own record with a resolved
  // equation and wiring (`Prey[South,Hares]`), so elements import as ordinary
  // variables and the generic parent record (`Prey`) is dropped.
  const elementBase = (n: string) => (n.includes("[") ? n.slice(0, n.indexOf("[")) : undefined);
  const arrayParents = new Set(records.map((r) => elementBase(r.name)).filter((n): n is string => !!n));
  const kept = new Map<number, EntityRecord>();
  const skipped = new Map<string, number>();
  for (const r of records) {
    if (arrayParents.has(r.name)) continue;
    const why = SKIPPED_KINDS[r.kind];
    if (why) {
      skipped.set(why, (skipped.get(why) ?? 0) + 1);
      continue;
    }
    if (!STOCK_KINDS.includes(r.kind) && !FLOW_KINDS.includes(r.kind) && r.kind !== "c") {
      warnings.push(`'${r.name}': unknown element kind '${r.kind}', skipped`);
      continue;
    }
    if (!r.name) continue;
    kept.set(r.index, r);
  }
  const elementNames = [...kept.values()].map((r) => r.name).filter((n) => n.includes("["));
  const elementCount = elementNames.length;
  for (const [why, n] of skipped) {
    warnings.push(`${n} ${why}${n === 1 ? "" : "s"} not imported (not yet supported)`);
  }

  const nameOf = (i: number) => kept.get(i)?.name;
  const taken = new Set([...kept.values()].map((r) => r.name));
  const uniqueName = (base: string) => {
    let n = base;
    for (let k = 2; taken.has(n); k++) n = `${base}_${k}`;
    taken.add(n);
    return n;
  };

  const special = [...taken].filter((n) => !IDENT.test(n)).sort((a, b) => b.length - a.length);
  const canonical = (n: string) => n.trim().toLowerCase().replace(/[\s_]+/g, "_");
  const keptByCanonical = new Map([...kept.values()].map((r) => [canonical(r.name), r.name]));
  const empty: string[] = [];
  const byNameRaw = new Map([...kept.values()].map((r) => [r.name, r.equation]));
  /** ARRAYSUM / ARRAYMEAN / ARRAYSTDDEV over `x[*]`-style patterns become
   * SUM / MEAN / STDDEV of the matching elements. */
  const expandArrayFunctions = (eq: string) =>
    eq.replace(/\bARRAY(SUM|MEAN|STDDEV)\s*\(\s*([A-Za-z_][^\[()]*)\[([^\]]*)\]\s*\)/gi, (m, fn: string, base: string, pat: string) => {
      const want = pat.split(",").map((p) => canonical(p));
      const hits = elementNames.filter((n) => {
        if (canonical(elementBase(n)!) !== canonical(base)) return false;
        const subs = n.slice(n.indexOf("[") + 1, -1).split(",").map((p) => canonical(p));
        return subs.length === want.length && subs.every((x, i) => want[i] === "*" || want[i] === x);
      });
      return hits.length ? `${fn.toUpperCase()}(${hits.join(", ")})` : m;
    });
  const prepare = (raw: string) => quoteNames(expandArrayFunctions(cleanEquation(raw).equation), special);

  // A conveyor's transit time is stored as the equation of its exit flow (§9.2).
  const transitOf = new Map<number, string>();
  const exitFlows = new Set<number>();
  const leakFlows = new Set<number>();
  for (const r of kept.values()) {
    if (r.kind !== "l") continue;
    const exit = r.outflows.find((i) => kept.get(i)?.kind === "m");
    if (exit === undefined) continue;
    transitOf.set(r.index, prepare(kept.get(exit)!.equation) || "1");
    exitFlows.add(exit);
    for (const i of r.outflows) if (kept.get(i)?.kind === "k") leakFlows.add(i);
  }
  // Flows out of a queue are computed by the engine (a queue passes its
  // contents through); their stored equations are placeholders.
  const queueOutflows = new Set<number>();
  for (const r of kept.values()) if (r.kind === "q") for (const i of r.outflows) queueOutflows.add(i);

  const stocks = new Map<number, Stock>();
  const flowNames = new Set<string>();
  for (const r of kept.values()) {
    const cleaned = cleanEquation(r.equation);
    const raw = cleaned.equation;
    const equation = raw ? expandPulseDefaults(quoteNames(expandArrayFunctions(raw), special)) : (empty.push(r.name), "0");
    const docText = [r.documentation, cleaned.comment].filter(Boolean).join("\n\n");
    const doc = docText ? { documentation: docText } : {};

    if (STOCK_KINDS.includes(r.kind)) {
      // A conveyor's initial value may be a list (contents per time unit);
      // the engine reads it as written.
      let eq = equation;
      const transit = transitOf.get(r.index);
      if (r.kind === "l" && transit === undefined) {
        warnings.push(`'${r.name}': conveyor without an exit flow imported as an ordinary stock`);
        const parts = eq.split(",");
        if (parts.length > 1) eq = parts.map((p) => `(${p.trim()})`).join("+");
      }
      const s: Stock = {
        kind: "stock",
        id: r.name,
        name: r.name,
        equation: eq,
        ...(r.struct[STOCK_FLAGS] & 1 ? { nonNegative: true } : {}),
        ...(transit !== undefined ? { conveyor: { transitTime: transit } } : {}),
        ...(r.kind === "q" ? { queue: true } : {}),
        ...(r.kind === "z" ? { oven: ovenSettings(r) } : {}),
        ...doc,
        provenance: IMPORT_PROVENANCE,
      };
      stocks.set(r.index, s);
      model.stocks.push(s);
      continue;
    }

    let eq = equation;
    if (r.ys.length > 0) {
      const points = graphXs(r).map((x, i) => ({ x, y: r.ys[i] }));
      const input = keptByCanonical.get(canonical(raw));
      if (r.kind === "c" && input && input !== r.name) {
        // A graph converter fed by one variable maps directly onto the IR's
        // graph function (input = its incoming connector).
        model.graphFunctions.push(gf(r.name, points, doc));
        continue;
      }
      const gfName = uniqueName(`${r.name}_graph`);
      model.graphFunctions.push(gf(gfName, points, {}));
      eq = `${ref(gfName)}(${raw ? eq : "TIME"})`;
    }

    if (FLOW_KINDS.includes(r.kind)) {
      const exit = exitFlows.has(r.index) || queueOutflows.has(r.index);
      const leak = leakFlows.has(r.index);
      if ((r.kind === "m" && !exit) || (r.kind === "k" && !leak)) {
        warnings.push(`'${r.name}': conveyor ${r.kind === "m" ? "outflow" : "leakage"} without its conveyor imported as an ordinary flow`);
      }
      const f: Flow = {
        kind: "flow",
        id: r.name,
        name: r.name,
        // Conveyor exits and queue outflows are computed by the engine (a
        // conveyor exit's stored equation was its transit time).
        equation: exit ? "" : eq,
        ...(r.kind === "b" ? { biflow: true } : { nonNegative: true }),
        ...(leak ? { leak: true } : {}),
        ...doc,
        provenance: IMPORT_PROVENANCE,
      };
      model.flows.push(f);
      flowNames.add(r.name);
    } else {
      const c: Converter = {
        kind: "converter",
        id: r.name,
        name: r.name,
        equation: eq,
        ...doc,
        provenance: IMPORT_PROVENANCE,
      };
      model.converters.push(c);
    }
  }

  if (empty.length) {
    const placeholder = empty.every((n) => /place .* here/i.test(byNameRaw.get(n) ?? ""));
    warnings.push(
      placeholder
        ? `${empty.length} element${empty.length === 1 ? " still has" : "s still have"} the "place equation here" placeholder (an unfinished model); set to 0: ${empty.join(", ")}`
        : `${empty.length} element${empty.length === 1 ? " has" : "s have"} no equation; set to 0: ${empty.join(", ")}`,
    );
  }

  // Flow wiring lives on the stocks (§9.1: children 4/5 are inflows/outflows).
  for (const [index, s] of stocks) {
    const r = kept.get(index)!;
    const names = (ix: number[]) => ix.map(nameOf).filter((n): n is string => !!n && flowNames.has(n));
    const inflows = names(r.inflows);
    const outflows = names(r.outflows);
    if (inflows.length) s.inflows = inflows;
    if (outflows.length) s.outflows = outflows;
  }

  // Information links: every input of a non-stock element (§9.1 child 2).
  const seen = new Set<string>();
  const connectors: Connector[] = [];
  for (const r of kept.values()) {
    if (STOCK_KINDS.includes(r.kind)) continue;
    for (const i of r.inputs) {
      const from = nameOf(i);
      if (!from || from === r.name) continue;
      const key = `${from}\u0000${r.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      connectors.push({
        kind: "connector",
        id: `${from}->${r.name}`,
        name: `${from} -> ${r.name}`,
        from,
        to: r.name,
        provenance: IMPORT_PROVENANCE,
      });
    }
  }
  model.connectors = connectors;

  const layout: Record<string, Point> = {};
  const glyphs = positions(objects);
  for (const [index, p] of glyphs) {
    const n = nameOf(index);
    if (n) layout[n] = scaled(p);
  }
  // Array elements have no glyph of their own: fan them out from the parent's.
  const parentPos = new Map<string, Point>();
  for (const r of records) {
    const p = glyphs.get(r.index);
    if (p && arrayParents.has(r.name)) parentPos.set(r.name, p);
  }
  const fanned = new Map<string, number>();
  for (const r of kept.values()) {
    const base = elementBase(r.name);
    const p = base ? parentPos.get(base) : undefined;
    if (!p || layout[r.name]) continue;
    const k = fanned.get(base!) ?? 0;
    fanned.set(base!, k + 1);
    layout[r.name] = scaled({ x: p.x + 24 * k, y: p.y + 24 * k });
  }
  if (Object.keys(layout).length) model.layout = layout;

  if (options.arrays === "flatten" || arrayParents.size === 0) {
    if (elementCount) {
      warnings.unshift(
        `${arrayParents.size} array${arrayParents.size === 1 ? "" : "s"} imported as ${elementCount} separate elements (e.g. ${elementNames[0]})`,
      );
    }
    return { model, warnings };
  }

  // Regroup array elements into arrayed variables where that is exact.
  const parents = new Map<string, ArrayParent>();
  for (const r of records) {
    if (!arrayParents.has(r.name)) continue;
    const { equation } = cleanEquation(r.equation);
    parents.set(r.name, {
      equation: equation ? quoteNames(expandArrayFunctions(equation), special) : "",
      ...(r.documentation ? { documentation: r.documentation } : {}),
      ...(parentPos.has(r.name) ? { position: scaled(parentPos.get(r.name)!) } : {}),
    });
  }
  const native = nativeArrays(model, parents, records.map((r) => r.equation));
  if (native.flattened.length) {
    warnings.unshift(
      `${native.flattened.length} array${native.flattened.length === 1 ? "" : "s"} kept as separate elements (conveyors, queues, ovens or graphs): ${native.flattened.join(", ")}`,
    );
  }
  return { model: native.model, warnings };
}

/** An oven's capacity and fill time; a stored fill time of 0 is the "DT"
 * option (take one step's inflow, i.e. the next in line). */
function ovenSettings(r: EntityRecord): { capacity: string; fillTime: string } {
  const view = new DataView(r.struct.buffer, r.struct.byteOffset, r.struct.byteLength);
  const capacity = view.getFloat64(CAPACITY_AT, false);
  const fill = view.getFloat64(FILL_TIME_AT, false);
  return { capacity: settingText(capacity), fillTime: fill === 0 ? "DT" : settingText(fill) };
}

function gf(
  name: string,
  points: { x: number; y: number }[],
  extra: { documentation?: string },
): GraphFunction {
  return {
    kind: "graphFunction",
    id: name,
    name,
    points,
    interpolation: "linear",
    extrapolation: "clip",
    provenance: IMPORT_PROVENANCE,
    ...extra,
  };
}
