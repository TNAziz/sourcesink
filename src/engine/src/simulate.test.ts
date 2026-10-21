import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import { simulate } from "./simulate.js";

function model(base: Partial<Model> = {}): Model {
  return { ...emptyModel("test"), ...base };
}

describe("simulate", () => {
  it("limits outflows of a non-negative stock so material is conserved", () => {
    const m = model({
      stocks: [
        { id: "a", name: "A", kind: "stock", equation: "10", outflows: ["move"], nonNegative: true },
        { id: "b", name: "B", kind: "stock", equation: "0", inflows: ["move"] },
      ],
      flows: [{ id: "move", name: "move", kind: "flow", equation: "4" }],
      converters: [],
      run: { start: 0, stop: 5, dt: 1, saveEvery: 1 },
    });
    const r = simulate(m);
    expect(r.series.A).toEqual([10, 6, 2, 0, 0, 0]);
    expect(r.series.B).toEqual([0, 4, 8, 10, 10, 10]);
    expect(r.series.move).toEqual([4, 4, 2, 0, 0, 0]);
  });

  it("integrates first-order linear decay within 0.01 of the analytical solution", () => {
    const m = model({
      stocks: [
        { id: "population", name: "Population", kind: "stock", equation: "100", outflows: ["decay"] },
      ],
      flows: [{ id: "decay", name: "decay", kind: "flow", equation: "Population * 0.1" }],
      converters: [],
      run: { start: 0, stop: 5, dt: 0.005, saveEvery: 1 },
    });

    const r = simulate(m);
    // Analytical: 100 * exp(-0.1 * t)
    for (const t of [0, 1, 2, 3, 4, 5]) {
      const idx = r.time.indexOf(t);
      expect(idx).toBeGreaterThanOrEqual(0);
      const expected = 100 * Math.exp(-0.1 * t);
      expect(Math.abs(r.series["Population"][idx] - expected)).toBeLessThan(0.01);
    }
  });

  it("SMTH1 step response converges toward the input", () => {
    const m = model({
      converters: [
        { id: "input", name: "input", kind: "converter", equation: "STEP(1, 5)" },
        { id: "out", name: "out", kind: "converter", equation: "SMTH1(input, 3)" },
      ],
      run: { start: 0, stop: 30, dt: 0.25, saveEvery: 1 },
    });

    const r = simulate(m);
    const at5 = r.series["out"][r.time.indexOf(5)];
    const at30 = r.series["out"][r.time.indexOf(30)];
    // Before/at the step the smooth is still near its initial 0; long after it
    // has converged to the input value of 1.
    expect(at30).toBeCloseTo(1, 2);
    expect(at5).toBeLessThan(0.5);
  });

  it("DELAY1 conserves material (cumulative outflow equals cumulative inflow)", () => {
    const m = model({
      converters: [
        { id: "inflow", name: "inflow", kind: "converter", equation: "5" },
        { id: "outflow", name: "outflow", kind: "converter", equation: "DELAY1(inflow, 2)" },
      ],
      run: { start: 0, stop: 40, dt: 0.05, saveEvery: 0.05 },
    });

    const r = simulate(m);
    // In steady state a first-order material delay passes every bit of inflow
    // through: level stays at input*delay, so outflow rate equals inflow rate.
    const overflow = r.series["inflow"];
    const outflow = r.series["outflow"];
    let diff = 0;
    for (let i = 0; i < r.time.length; i += 1) diff += Math.abs(outflow[i] - overflow[i]);
    expect(diff).toBeLessThan(1e-6);
  });

  it("runs a coupled 2-stock predator-prey model with finite values", () => {
    const m = model({
      stocks: [
        { id: "prey", name: "Prey", kind: "stock", equation: "100", inflows: ["birth"], outflows: ["predation"] },
        { id: "predator", name: "Predator", kind: "stock", equation: "20", inflows: ["grow"], outflows: ["death"] },
      ],
      flows: [
        { id: "birth", name: "birth", kind: "flow", equation: "Prey * 0.5" },
        { id: "predation", name: "predation", kind: "flow", equation: "Prey * Predator * 0.02" },
        { id: "grow", name: "grow", kind: "flow", equation: "Predator * Prey * 0.005" },
        { id: "death", name: "death", kind: "flow", equation: "Predator * 0.3" },
      ],
      run: { start: 0, stop: 20, dt: 0.01, saveEvery: 1 },
    });

    const r = simulate(m);
    const prey = r.series["Prey"];
    const predator = r.series["Predator"];
    for (let i = 0; i < r.time.length; i += 1) {
      expect(Number.isFinite(prey[i])).toBe(true);
      expect(Number.isFinite(predator[i])).toBe(true);
    }
    // Oscillating but bounded in a sane range for these parameters.
    expect(Math.max(...prey)).toBeLessThan(500);
    expect(Math.min(...prey)).toBeGreaterThan(0);
    expect(Math.max(...predator)).toBeLessThan(500);
    expect(Math.min(...predator)).toBeGreaterThan(0);
  });
});