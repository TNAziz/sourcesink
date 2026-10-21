import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import { curveFeatures, surfaceFeatures, sweep, sweepLevels } from "./sweep.js";

/** Converters a, b and y = equation; a zero-length run evaluates y once. */
function functionModel(equation: string): Model {
  return {
    ...emptyModel("f"),
    converters: [
      { id: "a", name: "a", kind: "converter", equation: "0" },
      { id: "b", name: "b", kind: "converter", equation: "0" },
      { id: "y", name: "y", kind: "converter", equation },
    ],
    run: { start: 0, stop: 0, dt: 1, saveEvery: 1 },
  };
}

/** dX/dt = -k X from X(0) = 1 over 0..2. */
function decayModel(): Model {
  return {
    ...emptyModel("decay"),
    stocks: [{ id: "X", name: "X", kind: "stock", equation: "1", inflows: [], outflows: ["out"] }],
    flows: [{ id: "out", name: "out", kind: "flow", equation: "k * X" }],
    converters: [{ id: "k", name: "k", kind: "converter", equation: "1" }],
    run: { start: 0, stop: 2, dt: 0.01, saveEvery: 0.5, integration: "rk4" },
  };
}

describe("sweepLevels", () => {
  it("spaces levels linearly or in log10, ends included", () => {
    expect(sweepLevels({ name: "a", min: 0, max: 1, steps: 5 })).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const log = sweepLevels({ name: "a", min: 0.1, max: 10, steps: 3, scale: "log" });
    expect(log[0]).toBeCloseTo(0.1, 12);
    expect(log[1]).toBeCloseTo(1, 12);
    expect(log[2]).toBe(10);
  });

  it("rejects bad ranges", () => {
    expect(() => sweepLevels({ name: "a", min: 1, max: 1, steps: 5 })).toThrow(/greater/);
    expect(() => sweepLevels({ name: "a", min: 0, max: 1, steps: 1 })).toThrow(/2 steps/);
    expect(() => sweepLevels({ name: "a", min: 0, max: 1, steps: 3, scale: "log" })).toThrow(/log/);
  });
});

describe("sweep", () => {
  it("evaluates the metric at every level of one axis", () => {
    const result = sweep(functionModel("a * a"), {
      axes: [{ name: "a", min: 0, max: 2, steps: 3 }],
      metric: { series: "y", stat: "final" },
    });
    expect(result.axes[0].values).toEqual([0, 1, 2]);
    expect(result.outputs).toEqual([0, 1, 4]);
    expect(result.failed).toBe(0);
  });

  it("fills a row-major grid for two axes", () => {
    const result = sweep(functionModel("10 * a + b"), {
      axes: [
        { name: "a", min: 0, max: 1, steps: 2 },
        { name: "b", min: 0, max: 2, steps: 3 },
      ],
      metric: { series: "y", stat: "final" },
    });
    expect(result.outputs).toEqual([0, 1, 2, 10, 11, 12]);
  });

  it("keeps trajectories and matches the analytic decay", () => {
    const result = sweep(decayModel(), {
      axes: [{ name: "k", min: 0.5, max: 2, steps: 4 }],
      metric: { series: "X", stat: "final" },
      series: ["X"],
    });
    result.axes[0].values.forEach((k, i) => expect(result.outputs[i]).toBeCloseTo(Math.exp(-2 * k), 6));
    expect(result.time).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(result.traces.X).toHaveLength(4);
    expect(result.traces.X[0]?.[0]).toBe(1);
  });

  it("records failed runs as NaN instead of aborting", () => {
    const result = sweep(functionModel("a"), {
      axes: [{ name: "a", min: 0, max: 1, steps: 3 }],
      metric: { series: "nope", stat: "final" },
    });
    expect(result.outputs.every(Number.isNaN)).toBe(true);
    expect(result.failed).toBe(3);
    expect(result.firstError).toMatch(/nope/);
  });

  it("refuses the same element on both axes", () => {
    expect(() =>
      sweep(functionModel("a"), {
        axes: [
          { name: "a", min: 0, max: 1, steps: 2 },
          { name: "a", min: 0, max: 1, steps: 2 },
        ],
        metric: { series: "y", stat: "final" },
      }),
    ).toThrow(/different/);
  });
});

describe("curveFeatures", () => {
  const xs = Array.from({ length: 21 }, (_, i) => i / 20);

  it("finds a threshold and where the curve levels off", () => {
    const ys = xs.map((x) => (x < 0.3 ? 100 : 5 + 2 * Math.exp(-20 * (x - 0.3))));
    const f = curveFeatures(xs, ys)!;
    expect(f.trend).toBe("down");
    expect(f.threshold).toBe(true);
    expect(f.steepest?.from).toBeCloseTo(0.25, 12);
    expect(f.steepest?.to).toBeCloseTo(0.3, 12);
    expect(f.levelsOff?.side).toBe("high");
  });

  it("finds an interior optimum", () => {
    const f = curveFeatures(xs, xs.map((x) => -((x - 0.4) ** 2)))!;
    expect(f.trend).toBe("mixed");
    expect(f.interior).toEqual({ kind: "peak", at: 0.4, value: -0 });
    expect(f.threshold).toBe(false);
  });

  it("reports a flat response and skips failed points", () => {
    const f = curveFeatures([1, 2, 3, 4], [5, Number.NaN, 5, 5])!;
    expect(f.trend).toBe("flat");
    expect(f.steepest).toBeUndefined();
    expect(curveFeatures([1, 2], [Number.NaN, 1])).toBeNull();
  });
});

describe("surfaceFeatures", () => {
  it("names the axis the output depends on more", () => {
    const a = [0, 1, 2];
    const b = [0, 1, 2];
    const outputs = a.flatMap((x) => b.map((y) => 10 * x + y));
    const f = surfaceFeatures(a, b, outputs)!;
    expect(f.max).toEqual({ at: [2, 2], value: 22 });
    expect(f.min.value).toBe(0);
    expect(f.dominant).toBe(0);
    expect(f.spread[0]).toBe(20);
    expect(f.spread[1]).toBe(2);
  });
});
