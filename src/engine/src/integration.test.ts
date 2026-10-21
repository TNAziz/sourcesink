import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import { simulate } from "./simulate.js";

/** S' = -k S, S(0) = 100. */
function decay(dt: number, stop = 1, extra: Partial<Model> = {}): Model {
  return {
    ...emptyModel("decay"),
    stocks: [{ kind: "stock", id: "S", name: "S", equation: "100", outflows: ["out"] }],
    flows: [{ kind: "flow", id: "out", name: "out", equation: "S * 0.1" }],
    run: { start: 0, stop, dt, saveEvery: dt },
    ...extra,
  };
}

describe("integration methods", () => {
  it("one step matches the documented formulas (Euler, Heun RK2, classic RK4)", () => {
    const last = (m: "euler" | "rk2" | "rk4") => simulate(decay(1), { integration: m }).series.S.at(-1)!;
    expect(last("euler")).toBeCloseTo(90, 12);
    expect(last("rk2")).toBeCloseTo(90.5, 12); // F1 = -10, F2 = -9 at x+F1, mean -9.5
    // RK4 reproduces exp(-h) through the h^4 term: 1 - h + h²/2 - h³/6 + h⁴/24
    expect(last("rk4")).toBeCloseTo(100 * (1 - 0.1 + 0.005 - 0.1 ** 3 / 6 + 0.1 ** 4 / 24), 12);
  });

  it("higher orders converge faster", () => {
    const exact = 100 * Math.exp(-0.1 * 10);
    const err = (m: "euler" | "rk2" | "rk4") => Math.abs(simulate(decay(0.5, 10), { integration: m }).series.S.at(-1)! - exact);
    expect(err("rk2")).toBeLessThan(err("euler") / 10);
    expect(err("rk4")).toBeLessThan(err("rk2") / 100);
  });

  it("takes the method from the run spec when not given as an option", () => {
    const m = decay(1);
    m.run.integration = "rk2";
    expect(simulate(m).series.S.at(-1)).toBeCloseTo(90.5, 12);
  });

  it("does not advance random draws in intermediate stages", () => {
    const noisy = (method: "euler" | "rk4") =>
      simulate(
        decay(0.25, 3, {
          converters: [{ kind: "converter", id: "r", name: "r", equation: "RANDOM(0, 1, 7)" }],
        }),
        { integration: method },
      ).series.r;
    expect(noisy("rk4")).toEqual(noisy("euler"));
  });

  it("keeps non-negative stocks at or above zero", () => {
    const m = decay(1, 5);
    m.stocks[0].nonNegative = true;
    m.flows[0].equation = "40";
    const s = simulate(m, { integration: "rk4" }).series.S;
    expect(Math.min(...s)).toBeGreaterThanOrEqual(0);
  });

  it("adaptive RK45 is accurate regardless of a coarse DT", () => {
    const exact = 100 * Math.exp(-0.1 * 10);
    const s = simulate(decay(1, 10), { integration: "rk45" }).series.S.at(-1)!;
    expect(Math.abs(s - exact) / exact).toBeLessThan(1e-6);
  });

  it("adaptive RK45 follows an oscillator through a full period at DT = 0.5", () => {
    const m: Model = {
      ...emptyModel("spring"),
      stocks: [
        { kind: "stock", id: "x", name: "x", equation: "1", inflows: ["v_in"] },
        { kind: "stock", id: "v", name: "v", equation: "0", inflows: ["a_in"] },
      ],
      flows: [
        { kind: "flow", id: "v_in", name: "v_in", equation: "v", biflow: true },
        { kind: "flow", id: "a_in", name: "a_in", equation: "-x", biflow: true },
      ],
      run: { start: 0, stop: 2 * Math.PI, dt: 0.5, saveEvery: 0.5, integration: "rk45" },
    };
    const r = simulate(m);
    expect(r.series.x.at(-1)!).toBeCloseTo(1, 5);
    expect(r.series.v.at(-1)!).toBeCloseTo(0, 5);
  });
});
