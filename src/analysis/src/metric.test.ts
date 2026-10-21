import { describe, expect, it } from "vitest";

import type { SimulationResult } from "@sourcesink/engine";

import { evaluateMetric } from "./metric.js";

function result(time: number[], values: number[]): SimulationResult {
  return { time, series: { y: values } };
}

describe("evaluateMetric", () => {
  const r = result([0, 1, 2, 3], [1, 3, 2, 5]);

  it("takes final, max and min", () => {
    expect(evaluateMetric(r, { series: "y", stat: "final" })).toBe(5);
    expect(evaluateMetric(r, { series: "y", stat: "max" })).toBe(5);
    expect(evaluateMetric(r, { series: "y", stat: "min" })).toBe(1);
  });

  it("integrates and averages by the trapezoid rule", () => {
    // (1+3)/2 + (3+2)/2 + (2+5)/2 = 2 + 2.5 + 3.5 = 8
    expect(evaluateMetric(r, { series: "y", stat: "integral" })).toBeCloseTo(8, 12);
    expect(evaluateMetric(r, { series: "y", stat: "mean" })).toBeCloseTo(8 / 3, 12);
  });

  it("interpolates at an arbitrary time", () => {
    expect(evaluateMetric(r, { series: "y", stat: "at", time: 1.5 })).toBeCloseTo(2.5, 12);
    expect(evaluateMetric(r, { series: "y", stat: "at", time: 2 })).toBe(2);
    expect(evaluateMetric(r, { series: "y", stat: "at", time: 3.5 })).toBeNaN();
  });

  it("uses elapsed time rather than row count for the mean", () => {
    const uneven = result([0, 1, 4], [0, 2, 2]);
    // integral = 1 + 6 = 7 over 4 time units
    expect(evaluateMetric(uneven, { series: "y", stat: "integral" })).toBeCloseTo(7, 12);
    expect(evaluateMetric(uneven, { series: "y", stat: "mean" })).toBeCloseTo(7 / 4, 12);
  });

  it("handles a single saved point", () => {
    const single = result([0], [42]);
    expect(evaluateMetric(single, { series: "y", stat: "final" })).toBe(42);
    expect(evaluateMetric(single, { series: "y", stat: "integral" })).toBe(0);
    expect(evaluateMetric(single, { series: "y", stat: "mean" })).toBe(42);
  });

  it("throws for an unknown series", () => {
    expect(() => evaluateMetric(r, { series: "nope", stat: "final" })).toThrow(/unknown series 'nope'/);
  });
});
