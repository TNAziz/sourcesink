import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";
import type { Dataset, SummaryStats } from "@sourcesink/analysis";

import {
  addParameterRow,
  buildBandSeries,
  buildMappedDataset,
  calibrateRequest,
  formatEstimate,
  initialParameterRows,
  makeOutputMetric,
  matchColumns,
  morrisRequest,
  parameterRowFor,
  sobolRequest,
  suggestedBounds,
  uncertaintyRequest,
  validateParameterRows,
  type ParameterRow,
  withoutUnits,
} from "./helpers.js";

function testModel(): Model {
  return {
    ...emptyModel("test"),
    stocks: [{ id: "s", name: "S", kind: "stock", equation: "80", outflows: ["decay"] }],
    flows: [{ id: "f", name: "decay", kind: "flow", equation: "k * S" }],
    converters: [
      { id: "k", name: "k", kind: "converter", equation: "0.3" },
      { id: "two", name: "two", kind: "converter", equation: "2" },
      { id: "neg", name: "neg", kind: "converter", equation: "-2" },
    ],
  };
}

const data: Dataset = {
  time: [0, 1],
  series: { s: [80, 60], K: [0.3, 0.3], decay: [24, 18], extra: [1, 2] },
};

describe("matchColumns", () => {
  it("matches by canonical name and leaves unknown columns unmapped", () => {
    expect(matchColumns(data, testModel())).toEqual([
      { column: "s", target: "S" },
      { column: "K", target: "k" },
      { column: "decay", target: "decay" },
      { column: "extra", target: null },
    ]);
  });

  it("treats spaces and underscores as equivalent", () => {
    const model = testModel();
    model.stocks[0].name = "Initial Stock";
    const renamed: Dataset = { time: [0], series: { "initial_stock": [1] } };
    expect(matchColumns(renamed, model)[0].target).toBe("Initial Stock");
  });
});

describe("validateParameterRows", () => {
  const row = (name: string, min: string, max: string, log = false): ParameterRow => ({
    name,
    min,
    max,
    log,
  });

  it("returns specs for valid rows", () => {
    const result = validateParameterRows([row("k", "0", "1"), row("two", "-5", "5")], testModel());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.specs).toEqual([
      { name: "k", min: 0, max: 1 },
      { name: "two", min: -5, max: 5 },
    ]);
  });

  it("requires min < max", () => {
    const result = validateParameterRows([row("k", "1", "1")], testModel());
    expect(result.ok).toBe(false);
    expect(result.perRow[0]).toMatch(/less than maximum/);
  });

  it("requires a positive minimum for log scale", () => {
    const result = validateParameterRows([row("k", "0", "1", true)], testModel());
    expect(result.ok).toBe(false);
    expect(result.perRow[0]).toMatch(/Log scale/);
  });

  it("reports unknown elements", () => {
    const result = validateParameterRows([row("nope", "0", "1")], testModel());
    expect(result.ok).toBe(false);
    expect(result.perRow[0]).toMatch(/not a stock, flow or converter/);
  });

  it("reports duplicate parameters", () => {
    const result = validateParameterRows([row("k", "0", "1"), row("K", "0", "2")], testModel());
    expect(result.ok).toBe(false);
    expect(result.perRow[1]).toMatch(/already used/);
  });

  it("requires at least one parameter", () => {
    const result = validateParameterRows([], testModel());
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/Add at least one parameter/);
  });
});

describe("parameter bounds", () => {
  it("uses ×0.1…×10 of a numeric equation", () => {
    expect(suggestedBounds(testModel(), "two")).toEqual({ min: "0.2", max: "20" });
    expect(suggestedBounds(testModel(), "neg")).toEqual({ min: "-20", max: "-0.2" });
    expect(suggestedBounds(testModel(), "k")).toEqual({ min: "0.03", max: "3" });
  });

  it("falls back to −1…1 for a non-constant equation", () => {
    expect(suggestedBounds(testModel(), "decay")).toEqual({ min: "-1", max: "1" });
    expect(parameterRowFor(testModel(), "decay")).toEqual({
      name: "decay",
      min: "-1",
      max: "1",
      log: false,
    });
  });

  it("starts with the first numeric element and appends unused constants first", () => {
    const rows = initialParameterRows(testModel());
    expect(rows.map((r) => r.name)).toEqual(["S"]);
    let next = rows;
    for (let i = 0; i < 4; i++) next = addParameterRow(testModel(), next);
    expect(next.map((r) => r.name)).toEqual(["S", "k", "two", "neg", "decay"]);
  });
});

describe("buildMappedDataset", () => {
  it("renames mapped columns and drops ignored ones", () => {
    const result = buildMappedDataset(data, [
      { column: "s", target: "S" },
      { column: "K", target: "k" },
      { column: "extra", target: null },
    ]);
    expect(result.error).toBeNull();
    expect(result.dataset).toEqual({
      time: [0, 1],
      series: { S: [80, 60], k: [0.3, 0.3] },
    });
  });

  it("rejects an empty mapping", () => {
    const result = buildMappedDataset(data, [{ column: "s", target: null }]);
    expect(result.dataset).toBeNull();
    expect(result.error).toMatch(/Map at least one column/);
  });

  it("rejects duplicate targets", () => {
    const result = buildMappedDataset(data, [
      { column: "s", target: "S" },
      { column: "extra", target: "S" },
    ]);
    expect(result.dataset).toBeNull();
    expect(result.error).toMatch(/Two columns/);
  });
});

describe("formatEstimate", () => {
  it("formats values with finite, infinite and missing standard errors", () => {
    expect(formatEstimate(0.3, 0.01)).toBe("0.300 ± 0.010");
    expect(formatEstimate(0.34627, 0.002297)).toBe("0.3463 ± 0.0023");
    expect(formatEstimate(1.23456, Number.POSITIVE_INFINITY)).toBe("1.235 ± ∞");
    expect(formatEstimate(2, Number.NaN)).toBe("2 ± —");
    expect(formatEstimate(Number.NaN, undefined)).toBe("—");
  });
});

describe("buildBandSeries", () => {
  it("pulls the requested percentiles and nulls non-finite values", () => {
    const stats: SummaryStats = {
      mean: [],
      min: [],
      max: [],
      sd: [],
      percentiles: {
        5: [1, 2],
        25: [3, 4],
        50: [5, Number.NaN],
        75: [7, 8],
        95: [9, 10],
      },
    };
    expect(buildBandSeries([0, 1], stats)).toEqual({
      time: [0, 1],
      p5: [1, 2],
      p25: [3, 4],
      median: [5, null],
      p75: [7, 8],
      p95: [9, 10],
    });
  });
});

describe("worker requests", () => {
  it("builds calibration, Morris, Sobol and uncertainty requests", () => {
    const params = [{ name: "k", min: 0, max: 1 }];
    const metric = { series: "S", stat: "final" as const };
    expect(calibrateRequest(1, testModel(), { data, params }).kind).toBe("calibrate");
    expect(morrisRequest(2, testModel(), params, metric, { trajectories: 4 }).kind).toBe("morris");
    expect(sobolRequest(3, testModel(), params, metric, { samples: 16 }).kind).toBe("sobol");
    const uncertainty = uncertaintyRequest(4, testModel(), params, 25, ["S"], 7);
    expect(uncertainty).toMatchObject({ kind: "uncertainty", runs: 25, series: ["S"], seed: 7 });
  });

  it("builds output metrics for plain and time-point statistics", () => {
    expect(makeOutputMetric("S", "max")).toEqual({ series: "S", stat: "max" });
    expect(makeOutputMetric("S", "at", "2.5")).toEqual({ series: "S", stat: "at", time: 2.5 });
  });
});

describe("unit-suffixed headers", () => {
  it("strip a trailing unit before matching", () => {
    expect(withoutUnits("DO deficit (mg/L)")).toBe("DO deficit");
    expect(withoutUnits("flow [m3/s]")).toBe("flow");
    expect(withoutUnits("(mg/L)")).toBe("(mg/L)");
  });
});
