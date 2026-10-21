import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import type { OutputMetric, ParameterSpec, SobolResult } from "./contracts.js";
import { morris, sobol } from "./sensitivity.js";

/** One converter `y` over three parameters; a zero-length run evaluates it
 * exactly once, so `final` is the function value. */
function functionModel(name: string, equation: string): Model {
  return {
    ...emptyModel(name),
    converters: [
      { id: "a", name: "a", kind: "converter", equation: "0" },
      { id: "b", name: "b", kind: "converter", equation: "0" },
      { id: "c", name: "c", kind: "converter", equation: "0" },
      { id: "y", name: "y", kind: "converter", equation },
    ],
    run: { start: 0, stop: 0, dt: 1, saveEvery: 1 },
  };
}

const FINAL: OutputMetric = { series: "y", stat: "final" };
const UNIT: ParameterSpec[] = [
  { name: "a", min: 0, max: 1 },
  { name: "b", min: 0, max: 1 },
  { name: "c", min: 0, max: 1 },
];

function ishigamiParams(): ParameterSpec[] {
  return [
    { name: "a", min: -Math.PI, max: Math.PI },
    { name: "b", min: -Math.PI, max: Math.PI },
    { name: "c", min: -Math.PI, max: Math.PI },
  ];
}

function byName(result: SobolResult, name: string) {
  const row = result.parameters.find((p) => p.name === name);
  if (!row) throw new Error(`missing row ${name}`);
  return row;
}

describe("sobol", () => {
  it("reproduces the analytic indices of the Ishigami function", () => {
    const model = functionModel("ishigami", "sin(a) + 7*sin(b)^2 + 0.1*c^4*sin(a)");
    const result = sobol(model, ishigamiParams(), FINAL, { samples: 4096, seed: 1 });

    expect(result.failed).toBe(0);
    expect(result.evaluations).toBe(4096 * 5);

    const analytic = [
      { name: "a", first: 0.3139, total: 0.5576 },
      { name: "b", first: 0.4424, total: 0.4424 },
      { name: "c", first: 0, total: 0.2437 },
    ];
    for (const expected of analytic) {
      const row = byName(result, expected.name);
      expect(Math.abs(row.first - expected.first)).toBeLessThan(0.03);
      expect(Math.abs(row.total - expected.total)).toBeLessThan(0.03);
      expect(row.firstCI[0]).toBeLessThanOrEqual(expected.first);
      expect(row.firstCI[1]).toBeGreaterThanOrEqual(expected.first);
      expect(row.totalCI[0]).toBeLessThanOrEqual(expected.total);
      expect(row.totalCI[1]).toBeGreaterThanOrEqual(expected.total);
    }
  });

  it("splits a linear model's variance in proportion to its coefficients", () => {
    const model = functionModel("linear", "2*a + b");
    const result = sobol(model, UNIT.slice(0, 2), FINAL, { samples: 2048, seed: 2, bootstrap: 100 });

    const a = byName(result, "a");
    const b = byName(result, "b");
    expect(a.first).toBeCloseTo(0.8, 1);
    expect(b.first).toBeCloseTo(0.2, 1);
    expect(a.total).toBeCloseTo(a.first, 1);
    expect(b.total).toBeCloseTo(b.first, 1);
    expect(result.parameters.map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("drops every row when the metric names an unknown series", () => {
    const model = functionModel("linear", "2*a + b");
    const result = sobol(model, UNIT.slice(0, 2), { series: "missing", stat: "final" }, {
      samples: 8,
      bootstrap: 0,
    });
    expect(result.failed).toBe(8);
    expect(result.evaluations).toBe(8 * 4);
    expect(result.parameters.every((p) => Number.isNaN(p.first))).toBe(true);
  });

  it("is deterministic for a fixed seed", () => {
    const model = functionModel("linear", "2*a + b");
    const options = { samples: 64, seed: 7, bootstrap: 20 };
    expect(sobol(model, UNIT.slice(0, 2), FINAL, options)).toEqual(
      sobol(model, UNIT.slice(0, 2), FINAL, options),
    );
  });
});

describe("morris", () => {
  it("ranks parameters by mu* on a linear function", () => {
    const model = functionModel("morris", "10*a + b + 0*c");
    const result = morris(model, UNIT, FINAL, { trajectories: 20, levels: 4, seed: 1 });

    expect(result.parameters.map((p) => p.name)).toEqual(["a", "b", "c"]);
    expect(result.parameters[0].muStar).toBeCloseTo(10, 6);
    expect(result.parameters[1].muStar).toBeCloseTo(1, 6);
    expect(result.parameters[2].muStar).toBe(0);
    expect(result.evaluations).toBe(20 * 4);
    expect(result.failed).toBe(0);
  });

  it("computes mu and sigma of the elementary effects", () => {
    const model = functionModel("morris", "10*a + b");
    const result = morris(model, UNIT.slice(0, 2), FINAL, { trajectories: 10, seed: 3 });
    const a = result.parameters.find((p) => p.name === "a")!;
    // A linear function has the same effect on every trajectory.
    expect(a.mu).toBeCloseTo(10, 6);
    expect(a.sigma).toBeCloseTo(0, 6);
  });

  it("counts failed runs and reports NaN when every run fails", () => {
    const model = functionModel("morris", "10*a + b");
    const result = morris(model, UNIT.slice(0, 2), { series: "missing", stat: "final" }, {
      trajectories: 3,
      seed: 1,
    });
    expect(result.failed).toBe(3 * 3);
    expect(result.evaluations).toBe(3 * 3);
    expect(result.parameters.every((p) => Number.isNaN(p.muStar))).toBe(true);
  });

  it("is deterministic for a fixed seed", () => {
    const model = functionModel("morris", "10*a + b");
    const options = { trajectories: 12, seed: 5 };
    expect(morris(model, UNIT.slice(0, 2), FINAL, options)).toEqual(
      morris(model, UNIT.slice(0, 2), FINAL, options),
    );
  });

  it("rejects a log-scaled parameter whose min is not positive", () => {
    const model = functionModel("morris", "10*a");
    expect(() =>
      morris(model, [{ name: "a", min: 0, max: 10, scale: "log" }], FINAL),
    ).toThrow(/log scale/);
  });

  it("Morris maps points onto each parameter's range (Ishigami: x3 matters)", () => {
    const ish = {
      ...emptyModel("ishigami"),
      converters: ["x1", "x2", "x3"].map((n) => ({ kind: "converter" as const, id: n, name: n, equation: "0" })).concat([
        { kind: "converter" as const, id: "y", name: "y", equation: "SIN(x1) + 7*SIN(x2)^2 + 0.1*x3^4*SIN(x1)" },
      ]),
      run: { start: 0, stop: 0, dt: 1, saveEvery: 1 },
    };
    const P = ["x1", "x2", "x3"].map((name) => ({ name, min: -Math.PI, max: Math.PI }));
    const r = morris(ish, P, { series: "y", stat: "final" }, { trajectories: 200, seed: 5 });
    const muStar = Object.fromEntries(r.parameters.map((p) => [p.name, p.muStar]));
    // On the 4-level grid: x2 has |EE| = 7.875 always; x3 has 12.5 half the time.
    expect(muStar.x2).toBeCloseTo(7.875, 6);
    expect(muStar.x3).toBeGreaterThan(4);
    expect(muStar.x3).toBeLessThan(8.5);
    expect(muStar.x1).toBeGreaterThan(muStar.x3);
  });

  it("Morris effects are in unit space: y = a over [10, 20] gives mu* = 10", () => {
    const m = {
      ...emptyModel("linear"),
      converters: [
        { kind: "converter" as const, id: "a", name: "a", equation: "0" },
        { kind: "converter" as const, id: "y", name: "y", equation: "a" },
      ],
      run: { start: 0, stop: 0, dt: 1, saveEvery: 1 },
    };
    const r = morris(m, [{ name: "a", min: 10, max: 20 }], { series: "y", stat: "final" }, { trajectories: 5, seed: 1 });
    expect(r.parameters[0].muStar).toBeCloseTo(10, 9);
  });
});
