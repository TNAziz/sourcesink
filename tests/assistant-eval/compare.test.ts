import { describe, expect, it } from "vitest";

import { emptyModel, type Flow, type Model, type Stock } from "@sourcesink/model";

import { compareModels } from "./compare.js";

interface StockSpec {
  name: string;
  equation: string;
  inflows?: string[];
  outflows?: string[];
}

interface FlowSpec {
  name: string;
  equation: string;
}

interface RunSpecPatch {
  start?: number;
  stop?: number;
  dt?: number;
  saveEvery?: number;
}

/** Build a small model from names; flow ids are derived from flow names. */
function build(
  stocks: StockSpec[],
  flows: FlowSpec[],
  run: RunSpecPatch = {},
): Model {
  const model = emptyModel();
  model.run = { ...model.run, start: 0, stop: 10, dt: 0.1, saveEvery: 1, ...run };
  model.flows = flows.map(
    (flow): Flow => ({ kind: "flow", id: `flow:${flow.name}`, name: flow.name, equation: flow.equation }),
  );
  model.stocks = stocks.map(
    (stock): Stock => ({
      kind: "stock",
      id: `stock:${stock.name}`,
      name: stock.name,
      equation: stock.equation,
      ...(stock.inflows?.length ? { inflows: stock.inflows.map((name) => `flow:${name}`) } : {}),
      ...(stock.outflows?.length ? { outflows: stock.outflows.map((name) => `flow:${name}`) } : {}),
    }),
  );
  return model;
}

function linear(inflow = "2", stop = 10): Model {
  return build(
    [{ name: "Storage", equation: "10", inflows: ["Inflow"] }],
    [{ name: "Inflow", equation: inflow }],
    { stop },
  );
}

describe("compareModels", () => {
  it("passes identical models, including a feedback loop", () => {
    const original = build(
      [{ name: "Algae", equation: "50", inflows: ["Growth"] }],
      [{ name: "Growth", equation: "0.2 * Algae" }],
      { dt: 0.01 },
    );
    const comparison = compareModels(original, structuredClone(original));

    expect(comparison.stocks).toEqual({ matched: 1, expected: 1, extra: 0 });
    expect(comparison.flows).toEqual({ matched: 1, expected: 1, extra: 0 });
    expect(comparison.loops).toEqual({ matched: 1, expected: 1 });
    expect(comparison.nrmse.Algae).toBeCloseTo(0, 12);
    expect(comparison.pass).toBe(true);
  });

  it("passes a model whose elements were renamed but keep the same structure", () => {
    const original = build(
      [{ name: "Algae", equation: "50", inflows: ["Growth"] }],
      [{ name: "Growth", equation: "0.2 * Algae" }],
      { dt: 0.01 },
    );
    const renamed = build(
      [{ name: "Algae_biomass", equation: "50", inflows: ["Growth_rate"] }],
      [{ name: "Growth_rate", equation: "0.2 * Algae_biomass" }],
      { dt: 0.01 },
    );

    expect(compareModels(original, renamed).pass).toBe(true);
    expect(compareModels(original, renamed).loops).toEqual({ matched: 1, expected: 1 });
  });

  it("matches a stock by its connections when the name shares no tokens", () => {
    const original = linear();
    const rebuilt = build(
      [{ name: "Pond", equation: "10", inflows: ["Inflow"] }],
      [{ name: "Inflow", equation: "2" }],
    );

    const comparison = compareModels(original, rebuilt);
    expect(comparison.stocks).toEqual({ matched: 1, expected: 1, extra: 0 });
    expect(comparison.pass).toBe(true);
  });

  it("matches a flow by the stocks it connects when the name shares no tokens", () => {
    const original = linear();
    const rebuilt = build(
      [{ name: "Storage", equation: "10", inflows: ["diversion"] }],
      [{ name: "diversion", equation: "2" }],
    );

    const comparison = compareModels(original, rebuilt);
    expect(comparison.flows).toEqual({ matched: 1, expected: 1, extra: 0 });
    expect(comparison.pass).toBe(true);
  });

  it("does not match a flow that runs the other way", () => {
    const original = linear();
    const rebuilt = build(
      [{ name: "Storage", equation: "10", outflows: ["diversion"] }],
      [{ name: "diversion", equation: "-2" }],
    );

    expect(compareModels(original, rebuilt).flows.matched).toBe(0);
  });

  it("fails when a stock and its flow are missing", () => {
    const original = build(
      [
        { name: "Alpha", equation: "10", inflows: ["Fill_alpha"] },
        { name: "Beta", equation: "10", inflows: ["Fill_beta"] },
      ],
      [
        { name: "Fill_alpha", equation: "1" },
        { name: "Fill_beta", equation: "1" },
      ],
    );
    const rebuilt = build(
      [{ name: "Alpha", equation: "10", inflows: ["Fill_alpha"] }],
      [{ name: "Fill_alpha", equation: "1" }],
    );

    const comparison = compareModels(original, rebuilt);
    expect(comparison.stocks).toEqual({ matched: 1, expected: 2, extra: 0 });
    expect(comparison.pass).toBe(false);
  });

  it("fails when the rebuilt model has an extra flow", () => {
    const original = linear();
    const rebuilt = build(
      [{ name: "Storage", equation: "10", inflows: ["Inflow"] }],
      [
        { name: "Inflow", equation: "2" },
        { name: "Unexpected", equation: "1" },
      ],
    );

    const comparison = compareModels(original, rebuilt);
    expect(comparison.flows).toEqual({ matched: 1, expected: 1, extra: 1 });
    expect(comparison.pass).toBe(false);
  });

  it("fails a wrong rate constant through NRMSE", () => {
    const comparison = compareModels(linear("2"), linear("4"));

    expect(comparison.stocks).toEqual({ matched: 1, expected: 1, extra: 0 });
    expect(comparison.flows).toEqual({ matched: 1, expected: 1, extra: 0 });
    expect(comparison.nrmse.Storage).toBeGreaterThanOrEqual(0.05);
    expect(comparison.pass).toBe(false);
  });

  it("reports NaN for a rebuilt model that does not simulate", () => {
    const original = build(
      [{ name: "Contaminant", equation: "100", outflows: ["Decay"] }],
      [{ name: "Decay", equation: "0.1 * Contaminant" }],
      { stop: 20, dt: 0.01 },
    );
    const rebuilt = build(
      [{ name: "Contaminant", equation: "100", outflows: ["Decay"] }],
      [{ name: "Decay", equation: "0.1 * Missing_parameter" }],
      { stop: 20, dt: 0.01 },
    );

    const comparison = compareModels(original, rebuilt);
    expect(comparison.stocks.matched).toBe(1);
    expect(Number.isNaN(comparison.nrmse.Contaminant)).toBe(true);
    expect(comparison.pass).toBe(false);
  });
});
