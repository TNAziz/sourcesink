import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import { CycleError, orderPhases } from "./order.js";
import { simulate } from "./simulate.js";

function model(base: Partial<Model> = {}): Model {
  return { ...emptyModel("test"), run: { start: 0, stop: 2, dt: 1, saveEvery: 1 }, ...base };
}

const conn = (from: string, to: string) => ({
  kind: "connector" as const,
  id: `${from}->${to}`,
  name: `${from} -> ${to}`,
  from,
  to,
});

describe("flow wiring vs information connectors", () => {
  it("a connector from a stock to its inflow is an info link, not an outflow", () => {
    const m = model({
      stocks: [{ id: "P", name: "P", kind: "stock", equation: "100", inflows: ["births"] }],
      flows: [{ id: "births", name: "births", kind: "flow", equation: "P * 0.1" }],
      connectors: [conn("P", "births")],
    });
    expect(simulate(m).series.P).toEqual([100, 110, 121]);
  });

  it("a connector from a flow to a stock does not make it an inflow", () => {
    const m = model({
      stocks: [
        { id: "A", name: "A", kind: "stock", equation: "10", outflows: ["move"] },
        { id: "B", name: "B", kind: "stock", equation: "0" },
      ],
      flows: [{ id: "move", name: "move", kind: "flow", equation: "1" }],
      connectors: [conn("move", "B")],
    });
    const r = simulate(m);
    expect(r.series.A).toEqual([10, 9, 8]);
    expect(r.series.B).toEqual([0, 0, 0]);
  });

  it("stock flow lists may name flows instead of ids", () => {
    const m = model({
      stocks: [{ id: "s1", name: "Tank", kind: "stock", equation: "5", outflows: ["Drain Rate"] }],
      flows: [{ id: "f1", name: "Drain Rate", kind: "flow", equation: "1" }],
    });
    expect(simulate(m).series.Tank).toEqual([5, 4, 3]);
  });
});

describe("initial values", () => {
  it("a stock's initial value may reference a converter", () => {
    const m = model({
      stocks: [{ id: "P", name: "P", kind: "stock", equation: "init_p" }],
      converters: [{ id: "init_p", name: "init_p", kind: "converter", equation: "100" }],
    });
    expect(simulate(m).series.P[0]).toBe(100);
  });

  it("a stock's initial value may reference a stock defined after it", () => {
    const m = model({
      stocks: [
        { id: "A", name: "A", kind: "stock", equation: "B * 2" },
        { id: "B", name: "B", kind: "stock", equation: "base + 1" },
      ],
      converters: [{ id: "base", name: "base", kind: "converter", equation: "4" }],
    });
    const r = simulate(m);
    expect(r.series.A[0]).toBe(10);
    expect(r.series.B[0]).toBe(5);
  });

  it("stateful builtins are evaluated once at t0", () => {
    // PREVIOUS returns its stored value and then stores the new input, so a
    // second evaluation at t0 would already shift the series.
    const m = model({
      converters: [
        { id: "x", name: "x", kind: "converter", equation: "TIME + 1" },
        { id: "p", name: "p", kind: "converter", equation: "PREVIOUS(x)" },
      ],
    });
    expect(simulate(m).series.p).toEqual([1, 1, 2]);
  });

  it("names match case-insensitively with spaces equal to underscores", () => {
    const m = model({
      stocks: [{ id: "s", name: "Water Level", kind: "stock", equation: "initial_level" }],
      converters: [
        { id: "c", name: "Initial Level", kind: "converter", equation: "3" },
        { id: "d", name: "double", kind: "converter", equation: "water_level * 2" },
      ],
    });
    expect(simulate(m).series.double[0]).toBe(6);
  });
});

describe("cycles", () => {
  it("an algebraic loop among converters is an error naming its members", () => {
    const m = model({
      converters: [
        { id: "a", name: "a", kind: "converter", equation: "b + 1" },
        { id: "b", name: "b", kind: "converter", equation: "a * 2" },
        { id: "c", name: "c", kind: "converter", equation: "5" },
      ],
    });
    expect(() => simulate(m)).toThrow(CycleError);
    try {
      orderPhases(m);
    } catch (e) {
      expect((e as CycleError).phase).toBe("perStep");
      expect(new Set((e as CycleError).names)).toEqual(new Set(["a", "b"]));
    }
  });

  it("a converter referencing itself is an algebraic loop", () => {
    const m = model({ converters: [{ id: "a", name: "a", kind: "converter", equation: "a + 1" }] });
    expect(() => simulate(m)).toThrow(/algebraic loop/);
  });

  it("a feedback loop through a stock is fine", () => {
    const m = model({
      stocks: [{ id: "S", name: "S", kind: "stock", equation: "1", inflows: ["growth"] }],
      flows: [{ id: "growth", name: "growth", kind: "flow", equation: "S * rate" }],
      converters: [{ id: "rate", name: "rate", kind: "converter", equation: "1 / S" }],
    });
    expect(simulate(m).series.S).toEqual([1, 2, 3]);
  });

  it("circular initial values are an error", () => {
    const m = model({
      stocks: [
        { id: "A", name: "A", kind: "stock", equation: "B" },
        { id: "B", name: "B", kind: "stock", equation: "A" },
      ],
    });
    expect(() => simulate(m)).toThrow(/circular initial values/);
  });
});

describe("graph functions used as variables", () => {
  const gf = {
    kind: "graphFunction" as const,
    id: "effect",
    name: "effect",
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 100 },
    ],
    interpolation: "linear" as const,
    extrapolation: "clip" as const,
  };

  it("are evaluated before the converters that read them", () => {
    const m = model({
      converters: [
        // Model order puts the reader first; the order must still be input → gf → reader.
        { id: "reader", name: "reader", kind: "converter", equation: "effect + 1" },
        { id: "input", name: "input", kind: "converter", equation: "TIME * 2" },
      ],
      graphFunctions: [gf],
      connectors: [conn("input", "effect")],
    });
    // TIME 0,1,2 → input 0,2,4 → effect 0,20,40 → reader 1,21,41 (same step, no lag).
    expect(simulate(m).series.reader).toEqual([1, 21, 41]);
  });

  it("can still be called as lookup functions", () => {
    const m = model({
      converters: [{ id: "y", name: "y", kind: "converter", equation: "effect(TIME * 5)" }],
      graphFunctions: [gf],
    });
    expect(simulate(m).series.y).toEqual([0, 50, 100]);
  });
});
