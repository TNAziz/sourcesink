import { describe, expect, it } from "vitest";

import type { SimulationResult } from "@sourcesink/engine";

import type { EnsembleResult, EnsembleRun } from "./ensemble.js";
import { summarize } from "./summarize.js";

function run(index: number, series: Record<string, number[]>, time: number[]): EnsembleRun {
  const result: SimulationResult = { time, series };
  return { index, overrides: {}, seed: 0, result };
}

function threeRuns(): EnsembleResult {
  const time = [0, 1];
  return {
    time,
    runs: [
      run(0, { X: [1, 10] }, time),
      run(1, { X: [2, 20] }, time),
      run(2, { X: [3, 30] }, time),
    ],
  };
}

describe("summarize", () => {
  it("computes mean, min, max and population sd across runs", () => {
    const s = summarize(threeRuns(), ["X"]).X;
    expect(s.mean).toEqual([2, 20]);
    expect(s.min).toEqual([1, 10]);
    expect(s.max).toEqual([3, 30]);
    expect(s.sd[0]).toBeCloseTo(Math.sqrt(2 / 3), 12);
    expect(s.sd[1]).toBeCloseTo(Math.sqrt(200 / 3), 12);
  });

  it("computes default percentiles with linear interpolation", () => {
    const s = summarize(threeRuns(), ["X"]).X;
    expect(s.percentiles[5][0]).toBeCloseTo(1.1, 12);
    expect(s.percentiles[50]).toEqual([2, 20]);
    expect(s.percentiles[95][0]).toBeCloseTo(2.9, 12);
    expect(s.percentiles[95][1]).toBeCloseTo(29, 12);
  });

  it("honours custom percentiles", () => {
    const s = summarize(threeRuns(), ["X"], [0, 100]).X;
    expect(s.percentiles[0]).toEqual([1, 10]);
    expect(s.percentiles[100]).toEqual([3, 30]);
  });

  it("ignores failed runs", () => {
    const data = threeRuns();
    data.runs.push({ index: 3, overrides: {}, seed: 0, error: "boom" });
    const s = summarize(data, ["X"]).X;
    expect(s.mean).toEqual([2, 20]);
    expect(s.max).toEqual([3, 30]);
  });

  it("throws for a series that no successful run has", () => {
    expect(() => summarize(threeRuns(), ["Y"])).toThrow(/no successful run has series 'Y'/);
  });
});
