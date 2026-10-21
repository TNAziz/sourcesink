import { describe, expect, it } from "vitest";

import { simulate } from "@sourcesink/engine";
import { emptyModel, type Model } from "@sourcesink/model";

import { convertToArrays, findArrayFamilies, type ArrayDimensionPlan } from "./arrayize.js";
import { applyOverrides, applyScenario } from "./overrides.js";

/** Three plants build capacity toward their own targets; plants 1 and 2 ship
 * output into a shared warehouse. Written the long way, one copy per plant. */
function plants(): Model {
  const m = emptyModel("plants");
  m.run = { start: 0, stop: 10, dt: 0.25, saveEvery: 1 };
  const stock = (name: string, inflows: string[] = [], outflows: string[] = [], equation = "0") => ({
    kind: "stock" as const,
    id: name,
    name,
    equation,
    inflows,
    outflows,
  });
  const flow = (name: string, equation: string, units?: string) => ({ kind: "flow" as const, id: name, name, equation, units });
  const conv = (name: string, equation: string, units?: string) => ({ kind: "converter" as const, id: name, name, equation, units });
  m.stocks = [
    stock("Capacity_1", ["build_1"]),
    stock("Capacity_2", ["build_2"]),
    stock("Capacity_3", ["build_3"], [], "5"),
    stock("Warehouse", ["output_1", "output_2"], ["dispatch"]),
  ];
  m.flows = [
    flow("build_1", "(target_1 - Capacity_1) / build_time"),
    flow("build_2", "(target_2 - Capacity_2) / build_time"),
    flow("build_3", "STEP(1, 2) * (target_3 - Capacity_3) / build_time"),
    flow("output_1", "yield_1 * Capacity_1 * MIN(1, Capacity_3 / 10)"),
    flow("output_2", "yield_2 * Capacity_2 * MIN(1, Capacity_3 / 10)"),
    flow("dispatch", "Warehouse * 0.1"),
  ];
  m.converters = [
    conv("target_1", "40", "t"),
    conv("target_2", "30", "t"),
    conv("target_3", "20", "t"),
    conv("build_time", "3"),
    conv("rate_1", "2"),
    conv("rate_2", "2"),
    conv("rate_3", "4"),
    conv("demand_1", "rate_1 * Capacity_1"),
    conv("demand_2", "rate_2 * Capacity_2"),
    conv("demand_3", "rate_3 * Capacity_3"),
    conv("yield_1", "0.5"),
    conv("yield_2", "0.25"),
    conv("share_1", "IF total_output > 0 THEN output_1 / total_output ELSE 0"),
    conv("share_2", "IF total_output > 0 THEN output_2 / total_output ELSE 0"),
    conv("total_output", "output_1 + output_2"),
    conv("total_demand", "demand_1 + demand_2 + demand_3"),
    conv("net", "100 - demand_1 + demand_2 + demand_3"),
    conv("scaled", "(demand_1 + demand_2 + demand_3) * 2"),
  ];
  m.connectors = [
    { kind: "connector", id: "c1", name: "target_1 -> build_1", from: "target_1", to: "build_1" },
    { kind: "connector", id: "c2", name: "target_2 -> build_2", from: "target_2", to: "build_2" },
    { kind: "connector", id: "c3", name: "rate_1 -> demand_1", from: "rate_1", to: "demand_1" },
  ];
  m.layout = { Capacity_1: { x: 10, y: 20 }, Capacity_2: { x: 300, y: 20 }, Warehouse: { x: 0, y: 400 } };
  m.scenarios = [
    { id: "s1", name: "Bigger plant 2", overrides: { target_2: 50, rate_1: "rate_3 * 2", build_time: 2 } },
  ];
  return m;
}

function named(plans: ArrayDimensionPlan[], names: string[]): ArrayDimensionPlan[] {
  return plans.map((p, i) => ({ ...p, name: names[i] }));
}

/** Every series of `original` matches the converted run (`X_L` → `X[L]`). */
function expectSameResults(original: Model, converted: Model): void {
  const a = simulate(original);
  const b = simulate(converted);
  for (const [name, series] of Object.entries(a.series)) {
    const m = /^(.+)_([A-Za-z0-9]+)$/.exec(name);
    const other = b.series[name] ?? (m ? b.series[`${m[1]}[${m[2]}]`] : undefined);
    expect(other, `missing series for ${name}`).toBeDefined();
    series.forEach((v, i) => expect(other![i]).toBeCloseTo(v, 12));
  }
}

describe("findArrayFamilies", () => {
  it("finds one dimension per shared label set, leaving stray suffixes alone", () => {
    const plans = findArrayFamilies(plants());
    expect(plans.map((p) => [p.name, p.labels])).toEqual([
      ["Group A", ["1", "2", "3"]],
      ["Group B", ["1", "2"]],
    ]);
    expect(plans[0].families.map((f) => `${f.kind}:${f.base}`)).toEqual([
      "stock:Capacity",
      "flow:build",
      "converter:target",
      "converter:rate",
      "converter:demand",
    ]);
    expect(plans[1].families.map((f) => `${f.kind}:${f.base}`)).toEqual([
      "flow:output",
      "converter:yield",
      "converter:share",
    ]);
    // build_time is not part of the build family.
    expect(plans[0].families[1].members.map((m) => m.name)).toEqual(["build_1", "build_2", "build_3"]);
  });

  it("returns nothing for a model without repeated elements", () => {
    const m = emptyModel();
    m.converters = [{ kind: "converter", id: "a", name: "growth_rate", equation: "1" }];
    expect(findArrayFamilies(m)).toEqual([]);
  });

  it("leaves out families whose units or wiring an array cannot express", () => {
    const m = plants();
    m.converters.find((c) => c.name === "target_3")!.units = "kt";
    // Capacity_2 also drains into the warehouse: no longer the same shape.
    m.flows.push({ kind: "flow", id: "spill", name: "spill_2", equation: "0" });
    m.stocks.find((s) => s.name === "Capacity_2")!.outflows = ["spill"];
    const plans = findArrayFamilies(m);
    const bases = plans.flatMap((p) => p.families.map((f) => f.base));
    expect(bases).not.toContain("target");
    expect(bases).not.toContain("Capacity");
    expect(bases).toContain("rate");
  });

  it("drops a flow family split across different scalar stocks", () => {
    const m = plants();
    m.stocks.push({ kind: "stock", id: "Other", name: "Other", equation: "0", inflows: ["output_2"], outflows: [] });
    m.stocks.find((s) => s.name === "Warehouse")!.inflows = ["output_1"];
    const bases = findArrayFamilies(m).flatMap((p) => p.families.map((f) => f.base));
    expect(bases).not.toContain("output");
  });
});

describe("convertToArrays", () => {
  it("preserves every simulated series", () => {
    const original = plants();
    const converted = convertToArrays(original, named(findArrayFamilies(original), ["Plant", "Line"]));
    expect(converted.stocks.map((s) => s.name)).toEqual(["Capacity", "Warehouse"]);
    expect(converted.flows.map((f) => f.name)).toEqual(["build", "output", "dispatch"]);
    expect(converted.dimensions.map((d) => [d.name, d.values])).toEqual([
      ["Plant", ["1", "2", "3"]],
      ["Line", ["1", "2"]],
    ]);
    expectSameResults(original, converted);
  });

  it("writes readable equations", () => {
    const m = convertToArrays(plants(), named(findArrayFamilies(plants()), ["Plant", "Line"]));
    const eq = (name: string) => [...m.flows, ...m.converters].find((e) => e.name === name)!.equation;
    // Same dimension and label: a bare name; identical equations → apply to all.
    expect(eq("demand")).toBe("rate * Capacity");
    expect(m.arrayed.demand).toEqual({ dimensions: ["Plant"] });
    // Different per element: one equation each.
    expect(m.arrayed.build.elements?.["3"]).toBe("STEP(1, 2) * (target - Capacity) / build_time");
    // Another dimension: explicit labels.
    expect(m.arrayed.output.elements?.["1"]).toBe("yield * Capacity[1] * MIN(1, Capacity[3] / 10)");
    // A sum over every label becomes SUM; other arithmetic stays explicit.
    expect(eq("total_output")).toBe("SUM(output[*])");
    expect(eq("total_demand")).toBe("SUM(demand[*])");
    expect(eq("scaled")).toBe("(SUM(demand[*])) * 2");
    expect(eq("net")).toBe("100 - demand[1] + demand[2] + demand[3]");
    // The shared stock lists the merged flow once.
    expect(m.stocks.find((s) => s.name === "Warehouse")!.inflows).toEqual(["output_1"]);
  });

  it("merges connectors, layout and units", () => {
    const m = convertToArrays(plants(), named(findArrayFamilies(plants()), ["Plant", "Line"]));
    expect(m.connectors.map((c) => `${c.from}->${c.to}`)).toEqual(["target->build", "rate->demand"]);
    expect(m.layout).toEqual({ Capacity: { x: 10, y: 20 }, Warehouse: { x: 0, y: 400 } });
    expect(m.converters.find((c) => c.name === "target")!.units).toBe("t");
  });

  it("rewrites scenario overrides and keeps their results", () => {
    const original = plants();
    const converted = convertToArrays(original, named(findArrayFamilies(original), ["Plant", "Line"]));
    expect(converted.scenarios![0].overrides).toEqual({ "target[2]": 50, "rate[1]": "rate[3] * 2", build_time: 2 });
    expectSameResults(applyScenario(original, original.scenarios![0]), applyScenario(converted, converted.scenarios![0]));
  });

  it("refuses names that are already taken", () => {
    const plans = named(findArrayFamilies(plants()), ["Plant", "Line"]);
    expect(() => convertToArrays(plants(), named(plans, ["Warehouse", "Line"]))).toThrow(/already used by an element/);
    expect(() => convertToArrays(plants(), named(plans, ["Plant", "Plant"]))).toThrow(/already exists/);
    const m = plants();
    m.converters.push({ kind: "converter", id: "rate", name: "rate", equation: "1" });
    expect(() => convertToArrays(m, plans)).toThrow(/already the name of an element/);
  });

  it("returns the model unchanged for an empty plan", () => {
    const m = plants();
    expect(convertToArrays(m, [])).toBe(m);
  });
});

describe("applyOverrides — array elements", () => {
  it("overrides one element by label", () => {
    const m = convertToArrays(plants(), named(findArrayFamilies(plants()), ["Plant", "Line"]));
    const o = applyOverrides(m, { "demand[2]": 7 });
    expect(o.arrayed.demand.elements).toEqual({ "2": "7" });
    expect(simulate(o).series["demand[2]"][0]).toBe(7);
    expect(() => applyOverrides(m, { "demand[9]": 1 })).toThrow(/not a label/);
    expect(() => applyOverrides(m, { "Warehouse[1]": 1 })).toThrow(/not arrayed/);
  });
});
