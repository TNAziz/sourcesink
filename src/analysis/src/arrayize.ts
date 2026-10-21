/**
 * SourceSink — turning repeated elements into arrays.
 *
 * Models often repeat one structure per site, plant or region by copying
 * elements with a suffix: `Area_1`, `Area_2`, `Area_4`, each with its own
 * `construction_1`, `alpha_1`, … The same model written with arrays has one
 * `Area[Firm]` and is a fraction of the size on the diagram.
 *
 * `findArrayFamilies` suggests the conversion: groups of elements named
 * `<base>_<label>` whose label set is shared by at least two such groups (one
 * group alone is too weak a signal), and whose stock-and-flow wiring an array
 * can express. `convertToArrays` rewrites the model so every equation reads
 * the same values as before — the simulation results are unchanged, with
 * `X_L` now reported as `X[L]`.
 */

import { canonicalName } from "@sourcesink/engine";
import type { Converter, Dimension, Flow, Model, Stock } from "@sourcesink/model";

export interface ArrayFamily {
  base: string;
  kind: "stock" | "flow" | "converter";
  members: { name: string; label: string }[];
}

export interface ArrayDimensionPlan {
  name: string;
  labels: string[];
  families: ArrayFamily[];
}

type Kind = ArrayFamily["kind"];
type AnyEl = Stock | Flow | Converter;

const SUFFIX = /^(.+)[_ ]([A-Za-z0-9]+)$/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A name as a regex, with spaces and underscores interchangeable. */
const namePattern = (name: string) =>
  name
    .trim()
    .split(/[\s_]+/)
    .map(escapeRe)
    .join("[ _]+");

/** How a base name is written in a rewritten equation. */
const token = (base: string) => base.trim().replace(/\s+/g, "_");

const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function elementsOf(m: Model): Array<{ el: AnyEl; kind: Kind }> {
  return [
    ...m.stocks.map((el) => ({ el, kind: "stock" as const })),
    ...m.flows.map((el) => ({ el, kind: "flow" as const })),
    ...m.converters.map((el) => ({ el, kind: "converter" as const })),
  ];
}

function flowByRef(m: Model, ref: string): Flow | undefined {
  return m.flows.find((f) => f.id === ref) ?? m.flows.find((f) => canonicalName(f.name) === canonicalName(ref));
}

/** Stocks that list `flow` on `side` ("outflows" = its source). */
function stocksWith(m: Model, flow: Flow, side: "inflows" | "outflows"): Stock[] {
  return m.stocks.filter((s) => (s[side] ?? []).some((r) => flowByRef(m, r) === flow));
}

function isArrayed(m: Model, name: string): boolean {
  return Object.keys(m.arrayed ?? {}).some((k) => canonicalName(k) === canonicalName(name) && (m.arrayed[k].dimensions?.length ?? 0) > 0);
}

/** Properties every member of a family must share (besides units). */
function signature(el: AnyEl): string {
  if (el.kind === "stock") return JSON.stringify(["stock", !!el.nonNegative]);
  if (el.kind === "flow") return JSON.stringify(["flow", !!el.biflow, !!el.nonNegative]);
  return "converter";
}

/** Stocks and flows whose behaviour depends on more than their equation stay
 * scalar: conveyors, queues, ovens and conveyor leaks. */
function special(el: AnyEl): boolean {
  if (el.kind === "stock") return !!(el.conveyor || el.queue || el.oven);
  if (el.kind === "flow") return !!el.leak;
  return false;
}

/** Suggest dimensions and the families that can move onto them. */
export function findArrayFamilies(model: Model): ArrayDimensionPlan[] {
  const taken = new Set(
    [...elementsOf(model).map((e) => e.el.name), ...model.graphFunctions.map((g) => g.name), ...model.dimensions.map((d) => d.name)].map(
      canonicalName,
    ),
  );

  // 1. Candidate families: same kind and base, ≥ 2 distinct labels.
  const groups = new Map<string, { base: string; kind: Kind; members: { el: AnyEl; label: string }[] }>();
  for (const { el, kind } of elementsOf(model)) {
    const match = SUFFIX.exec(el.name.trim());
    if (!match || special(el) || isArrayed(model, el.name)) continue;
    const key = `${kind}:${canonicalName(match[1])}`;
    const g = groups.get(key) ?? { base: match[1].trim(), kind, members: [] };
    g.members.push({ el, label: match[2] });
    groups.set(key, g);
  }

  interface Candidate {
    family: ArrayFamily;
    els: AnyEl[];
    labelKey: string;
  }
  const keyOf = (labels: string[]) => labels.map(canonicalName).sort(naturalSort).join("\u0000");
  const raw = [...groups.values()].filter((g) => {
    const labels = g.members.map((m) => canonicalName(m.label));
    return g.members.length >= 2 && new Set(labels).size === labels.length && !taken.has(canonicalName(g.base));
  });
  // A group may carry a stray member (`construction_time` beside
  // `construction_1/2/4`): when its full label set is unique but a label set
  // shared by other groups fits inside it, keep just those members.
  const fullCount = new Map<string, number>();
  for (const g of raw) {
    const k = keyOf(g.members.map((m) => m.label));
    fullCount.set(k, (fullCount.get(k) ?? 0) + 1);
  }
  const shared = [...fullCount].filter(([, n]) => n >= 2).map(([k]) => k.split("\u0000"));
  let candidates: Candidate[] = [];
  for (const g of raw) {
    let members = g.members;
    if ((fullCount.get(keyOf(members.map((m) => m.label))) ?? 0) < 2) {
      const own = new Set(members.map((m) => canonicalName(m.label)));
      const fit = shared.filter((s) => s.every((l) => own.has(l))).sort((a, b) => b.length - a.length)[0];
      if (!fit) continue;
      members = members.filter((m) => fit.includes(canonicalName(m.label)));
    }
    members = [...members].sort((a, b) => naturalSort(a.label, b.label));
    candidates.push({
      family: { base: g.base, kind: g.kind, members: members.map((m) => ({ name: m.el.name, label: m.label })) },
      els: members.map((m) => m.el),
      labelKey: keyOf(members.map((m) => m.label)),
    });
  }
  // Two kinds sharing one base would merge into the same name: drop both.
  const baseCount = new Map<string, number>();
  for (const c of candidates) baseCount.set(canonicalName(c.family.base), (baseCount.get(canonicalName(c.family.base)) ?? 0) + 1);
  candidates = candidates.filter((c) => baseCount.get(canonicalName(c.family.base)) === 1);

  // 2. Keep families that agree with each other until nothing changes.
  const memberOf = (name: string, current: Candidate[]): { c: Candidate; label: string } | undefined => {
    for (const c of current) {
      const i = c.els.findIndex((e) => canonicalName(e.name) === canonicalName(name));
      if (i >= 0) return { c, label: canonicalName(c.family.members[i].label) };
    }
    return undefined;
  };

  const valid = (c: Candidate, current: Candidate[]): boolean => {
    const units = new Set(c.els.map((e) => (e.units ?? "").trim()));
    const sigs = new Set(c.els.map(signature));
    if (units.size !== 1 || sigs.size !== 1) return false;

    if (c.family.kind === "flow") {
      for (const side of ["outflows", "inflows"] as const) {
        const classes = new Set<string>();
        for (let i = 0; i < c.els.length; i++) {
          const stocks = stocksWith(model, c.els[i] as Flow, side);
          if (stocks.length > 1) return false;
          if (stocks.length === 0) {
            classes.add("cloud");
            continue;
          }
          const s = stocks[0];
          const owner = memberOf(s.name, current);
          if (owner) {
            if (owner.c.labelKey !== c.labelKey || owner.c.family.kind !== "stock") return false;
            if (owner.label !== canonicalName(c.family.members[i].label)) return false;
            classes.add(`family:${canonicalName(owner.c.family.base)}`);
          } else {
            if (special(s)) return false;
            classes.add(`scalar:${s.id}`);
          }
        }
        if (classes.size !== 1) return false;
      }
    }

    if (c.family.kind === "stock") {
      const shapes = new Set<string>();
      for (let i = 0; i < c.els.length; i++) {
        const s = c.els[i] as Stock;
        const shape: string[] = [];
        for (const side of ["inflows", "outflows"] as const) {
          for (const ref of s[side] ?? []) {
            const f = flowByRef(model, ref);
            const owner = f && memberOf(f.name, current);
            if (!owner || owner.c.labelKey !== c.labelKey || owner.label !== canonicalName(c.family.members[i].label)) return false;
            shape.push(`${side}:${canonicalName(owner.c.family.base)}`);
          }
        }
        shapes.add(shape.sort().join("|"));
      }
      if (shapes.size !== 1) return false;
    }
    return true;
  };

  for (let changed = true; changed; ) {
    changed = false;
    const perSet = new Map<string, number>();
    for (const c of candidates) perSet.set(c.labelKey, (perSet.get(c.labelKey) ?? 0) + 1);
    const next = candidates.filter((c) => (perSet.get(c.labelKey) ?? 0) >= 2 && valid(c, candidates));
    if (next.length !== candidates.length) {
      candidates = next;
      changed = true;
    }
  }

  // 3. One dimension per label set, in model order.
  const plans: ArrayDimensionPlan[] = [];
  const byKey = new Map<string, ArrayDimensionPlan>();
  for (const c of candidates) {
    let plan = byKey.get(c.labelKey);
    if (!plan) {
      plan = { name: "", labels: c.family.members.map((m) => m.label), families: [] };
      byKey.set(c.labelKey, plan);
      plans.push(plan);
    }
    plan.families.push(c.family);
  }
  plans.forEach((p, i) => (p.name = `Group ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ""}`));
  return plans;
}

interface MemberInfo {
  base: string;
  dim: string;
  label: string;
  family: ArrayFamily;
}

/** Rewrite the model so each planned family becomes one arrayed element. */
export function convertToArrays(model: Model, plans: ArrayDimensionPlan[]): Model {
  const live = plans.filter((p) => p.families.length > 0);
  if (live.length === 0) return model;

  const byName = new Map(elementsOf(model).map((e) => [canonicalName(e.el.name), e] as const));
  const members = new Map<string, MemberInfo>();
  const bases = new Set<string>();
  const dimNames = new Set<string>();

  for (const plan of live) {
    const dimKey = canonicalName(plan.name);
    if (!plan.name.trim()) throw new Error("a dimension needs a name");
    if (dimNames.has(dimKey) || model.dimensions.some((d) => canonicalName(d.name) === dimKey)) {
      throw new Error(`dimension '${plan.name}' already exists`);
    }
    if (byName.has(dimKey) || model.graphFunctions.some((g) => canonicalName(g.name) === dimKey)) {
      throw new Error(`dimension name '${plan.name}' is already used by an element`);
    }
    dimNames.add(dimKey);
    const labelKeys = plan.labels.map(canonicalName);
    for (const family of plan.families) {
      const baseKey = canonicalName(family.base);
      if (byName.has(baseKey) || bases.has(baseKey) || model.graphFunctions.some((g) => canonicalName(g.name) === baseKey)) {
        throw new Error(`'${family.base}' is already the name of an element`);
      }
      bases.add(baseKey);
      const seen = new Set<string>();
      for (const m of family.members) {
        const entry = byName.get(canonicalName(m.name));
        if (!entry) throw new Error(`unknown element '${m.name}'`);
        if (entry.kind !== family.kind) throw new Error(`'${m.name}' is not a ${family.kind}`);
        const li = labelKeys.indexOf(canonicalName(m.label));
        if (li < 0) throw new Error(`'${m.label}' is not a label of ${plan.name}`);
        seen.add(labelKeys[li]);
        members.set(canonicalName(m.name), { base: family.base, dim: dimKey, label: plan.labels[li], family });
      }
      if (seen.size !== labelKeys.length || family.members.length !== labelKeys.length) {
        throw new Error(`'${family.base}' needs exactly one element for each label of ${plan.name}`);
      }
      if (dimNames.has(baseKey)) throw new Error(`'${family.base}' is also a dimension name`);
    }
  }
  for (const b of bases) if (dimNames.has(b)) throw new Error(`'${b}' is both an element and a dimension`);

  // One pass over every member name (longest first), quoted or bare.
  const names = [...members.keys()]
    .map((k) => byName.get(k)!.el.name)
    .sort((a, b) => b.length - a.length);
  const alternation = names.map(namePattern).join("|");
  const refRe = new RegExp(`"(${alternation})"|(?<![A-Za-z0-9_"])(${alternation})(?![A-Za-z0-9_"\\[])`, "gi");

  const sums = live.flatMap((plan) =>
    plan.families.map((f) => {
      const t = escapeRe(token(f.base));
      const run = plan.labels.map((l) => `${t}\\s*\\[\\s*${escapeRe(l)}\\s*\\]`).join("\\s*\\+\\s*");
      return {
        re: new RegExp(
          `(?<=^|[(,+<>=]|\\b(?:THEN|ELSE|IF|AND|OR|NOT)\\s)(\\s*)${run}(?=\\s*(?:$|[),+\\-<>=]|(?:THEN|ELSE|AND|OR)\\b))`,
          "gi",
        ),
        out: `SUM(${token(f.base)}[*])`,
      };
    }),
  );

  /** `owner` is the member whose equation this is (null for scalars). */
  const rewrite = (equation: string, owner: MemberInfo | null): string => {
    let eq = equation.replace(refRe, (whole: string, quoted?: string, bare?: string) => {
      const info = members.get(canonicalName(quoted ?? bare ?? whole));
      if (!info) return whole;
      if (owner && owner.dim === info.dim && canonicalName(owner.label) === canonicalName(info.label)) return token(info.base);
      return `${token(info.base)}[${info.label}]`;
    });
    for (const s of sums) eq = eq.replace(s.re, (_m, lead: string) => `${lead}${s.out}`);
    return eq;
  };

  const out: Model = structuredClone(model);
  out.dimensions = [
    ...out.dimensions,
    ...live.map((p): Dimension => ({ kind: "dimension", id: p.name, name: p.name, values: [...p.labels] })),
  ];
  out.arrayed = { ...(out.arrayed ?? {}) };

  // Existing arrayed elements: their per-element equations are scalar here.
  for (const spec of Object.values(out.arrayed)) {
    if (spec.elements) {
      spec.elements = Object.fromEntries(Object.entries(spec.elements).map(([k, v]) => [k, rewrite(v, null)]));
    }
  }

  // Flow ids: every member id/name → the merged flow's id.
  const mergedFlowId = new Map<string, string>();
  for (const plan of live) {
    for (const family of plan.families) {
      if (family.kind !== "flow") continue;
      const first = byName.get(canonicalName(family.members[0].name))!.el;
      for (const m of family.members) {
        const el = byName.get(canonicalName(m.name))!.el;
        mergedFlowId.set(el.id, first.id);
        mergedFlowId.set(canonicalName(el.name), first.id);
      }
    }
  }
  const mapFlowRefs = (refs: string[] | undefined): string[] | undefined => {
    if (!refs) return refs;
    const outRefs: string[] = [];
    for (const r of refs) {
      const mapped = mergedFlowId.get(r) ?? mergedFlowId.get(canonicalName(r)) ?? r;
      if (!outRefs.includes(mapped)) outRefs.push(mapped);
    }
    return outRefs;
  };

  const rewriteList = <T extends AnyEl>(list: T[]): T[] => {
    const result: T[] = [];
    for (const el of list) {
      const info = members.get(canonicalName(el.name));
      if (!info) {
        const copy = { ...el, equation: rewrite(el.equation, null) } as T;
        if (copy.kind === "stock") {
          const s = copy as Stock;
          s.inflows = mapFlowRefs(s.inflows);
          s.outflows = mapFlowRefs(s.outflows);
          if (s.conveyor) s.conveyor = { transitTime: rewrite(s.conveyor.transitTime, null) };
          if (s.oven) s.oven = { capacity: rewrite(s.oven.capacity, null), fillTime: rewrite(s.oven.fillTime, null) };
        }
        result.push(copy);
        continue;
      }
      if (canonicalName(info.family.members[0].name) !== canonicalName(el.name)) continue; // merged into the first
      const plan = live.find((p) => canonicalName(p.name) === info.dim)!;
      const memberEls = info.family.members.map((m) => {
        const e = byName.get(canonicalName(m.name))!.el as T;
        return { el: e, info: members.get(canonicalName(m.name))! };
      });
      const byLabel = new Map(memberEls.map((x) => [canonicalName(x.info.label), x]));
      const equations = plan.labels.map((l) => {
        const x = byLabel.get(canonicalName(l))!;
        return rewrite(x.el.equation, x.info);
      });
      const docs = [...new Set(memberEls.map((x) => x.el.documentation?.trim()).filter((d): d is string => !!d))];
      const merged = { ...el, name: info.base, equation: equations[0] } as T;
      if (docs.length) merged.documentation = docs.join("\n\n");
      else delete merged.documentation;
      if (merged.kind === "stock") {
        const s = merged as Stock;
        s.inflows = mapFlowRefs(s.inflows);
        s.outflows = mapFlowRefs(s.outflows);
      }
      const uniform = equations.every((e) => e === equations[0]);
      const dimName = plan.name;
      out.arrayed[info.base] = uniform
        ? { dimensions: [dimName] }
        : { dimensions: [dimName], elements: Object.fromEntries(plan.labels.map((l, i) => [l, equations[i]])) };
      result.push(merged);
    }
    return result;
  };

  out.stocks = rewriteList(out.stocks);
  out.flows = rewriteList(out.flows);
  out.converters = rewriteList(out.converters);

  // Connectors: member names → bases, deduplicated, no self-links.
  const nameOf = (n: string) => members.get(canonicalName(n))?.base ?? n;
  const seenLinks = new Set<string>();
  out.connectors = out.connectors.flatMap((c) => {
    const from = nameOf(c.from);
    const to = nameOf(c.to);
    const key = `${canonicalName(from)}\u0000${canonicalName(to)}`;
    if (canonicalName(from) === canonicalName(to) || seenLinks.has(key)) return [];
    seenLinks.add(key);
    return [{ ...c, from, to, name: from === c.from && to === c.to ? c.name : `${from} -> ${to}` }];
  });

  if (out.layout) {
    const layout: NonNullable<Model["layout"]> = {};
    for (const [name, pos] of Object.entries(out.layout)) {
      const info = members.get(canonicalName(name));
      if (!info) layout[name] = pos;
      else if (canonicalName(info.family.members[0].name) === canonicalName(name)) layout[info.base] = pos;
    }
    out.layout = layout;
  }

  if (out.scenarios) {
    out.scenarios = out.scenarios.map((s) => ({
      ...s,
      overrides: Object.fromEntries(
        Object.entries(s.overrides).map(([key, value]) => {
          const info = members.get(canonicalName(key));
          const v = typeof value === "string" ? rewrite(value, info ?? null) : value;
          return [info ? `${info.base}[${info.label}]` : key, v];
        }),
      ),
    }));
  }

  return out;
}
