import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import { applyOverrides, applyScenario } from "./overrides.js";

function decayModel(): Model {
  return {
    ...emptyModel("decay"),
    stocks: [{ id: "s", name: "Stock", kind: "stock", equation: "100", outflows: ["decay"] }],
    flows: [{ id: "f", name: "decay", kind: "flow", equation: "Stock * rate" }],
    converters: [{ id: "c", name: "rate", kind: "converter", equation: "0.1" }],
    graphFunctions: [
      {
        id: "g",
        name: "demand curve",
        kind: "graphFunction",
        points: [
          { x: 0, y: 1 },
          { x: 1, y: 0.5 },
        ],
        interpolation: "linear",
        extrapolation: "clip",
      },
    ],
    run: { start: 0, stop: 12, dt: 0.25, saveEvery: 1 },
  };
}

describe("applyOverrides", () => {
  it("changes a converter equation", () => {
    const m = applyOverrides(decayModel(), { rate: 0.2 });
    expect(m.converters[0].equation).toBe("0.2");
  });

  it("treats a stock equation as its initial value", () => {
    const m = applyOverrides(decayModel(), { stock: 42 });
    expect(m.stocks[0].equation).toBe("42");
  });

  it("matches names case-insensitively with spaces ≡ underscores", () => {
    const base = decayModel();
    base.converters.push({ id: "c2", name: "alpha beta", kind: "converter", equation: "1" });
    const m = applyOverrides(base, { ALPHA_BETA: 2 });
    expect(m.converters[1].equation).toBe("2");
  });

  it("overrides a flow equation", () => {
    const m = applyOverrides(decayModel(), { decay: "Stock * 0.05" });
    expect(m.flows[0].equation).toBe("Stock * 0.05");
  });

  it("applies run-spec changes without touching other run fields", () => {
    const m = applyOverrides(decayModel(), {}, { stop: 30, dt: 0.1 });
    expect(m.run.stop).toBe(30);
    expect(m.run.dt).toBe(0.1);
    expect(m.run.start).toBe(0);
    expect(m.run.saveEvery).toBe(1);
  });

  it("does not mutate the original model", () => {
    const base = decayModel();
    const m = applyOverrides(base, { rate: 0.2, stock: 5 }, { stop: 1 });
    expect(base.converters[0].equation).toBe("0.1");
    expect(base.stocks[0].equation).toBe("100");
    expect(base.run.stop).toBe(12);
    expect(m).not.toBe(base);
    expect(m.converters).not.toBe(base.converters);
  });

  it("throws for an unknown name", () => {
    expect(() => applyOverrides(decayModel(), { nope: 1 })).toThrow(/unknown element 'nope'/);
  });

  it("throws for a graph function", () => {
    expect(() => applyOverrides(decayModel(), { "demand curve": "1" })).toThrow(
      /cannot override graph function/,
    );
  });
});

describe("applyScenario", () => {
  it("applies the scenario's overrides and run changes", () => {
    const model = decayModel();
    model.scenarios = [
      {
        id: "fast",
        name: "Fast decay",
        overrides: { rate: 0.5 },
        run: { stop: 5 },
      },
    ];
    const m = applyScenario(model, model.scenarios[0]);
    expect(m.converters[0].equation).toBe("0.5");
    expect(m.run.stop).toBe(5);
    expect(model.converters[0].equation).toBe("0.1");
  });
});
