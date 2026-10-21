import { describe, expect, it } from "vitest";

import { evaluateBuiltin, type BuiltinEnv } from "./builtins.js";

const env = (over: Partial<BuiltinEnv> = {}): BuiltinEnv => ({ time: 0, dt: 1, state: new Map(), seed: 0, ...over });

describe("aggregate built-ins", () => {
  it("SUM adds its arguments and PCT converts a fraction to percent", () => {
    expect(evaluateBuiltin(env(), "SUM", [1, 2, 3.5], "0")).toBe(6.5);
    expect(evaluateBuiltin(env(), "PCT", [0.25], "0")).toBe(25);
  });
});

describe("PULSE with defaults", () => {
  it("fires once at the start time when only the amount is given", () => {
    const at = (time: number) => evaluateBuiltin(env({ time, start: 1 }), "PULSE", [5], "0");
    expect([at(1), at(2), at(3)]).toEqual([5, 0, 0]);
  });
});

describe("DELAY", () => {
  it("returns the input from `delay` time units earlier, initial value before that", () => {
    const e = env({ dt: 0.5 });
    const out = [10, 20, 30, 40, 50].map((x) => evaluateBuiltin(e, "DELAY", [x, 1, -1], "0"));
    expect(out).toEqual([-1, -1, 10, 20, 30]);
  });

  it("defaults the initial value to the first input", () => {
    const e = env();
    const out = [7, 8, 9].map((x) => evaluateBuiltin(e, "DELAY", [x, 2], "0"));
    expect(out).toEqual([7, 7, 7]);
  });
});

describe("seeded random streams", () => {
  it("NORMAL and RANDOM with the same explicit seed repeat across call sites", () => {
    const a = evaluateBuiltin(env(), "NORMAL", [0, 1, 42], "site-a");
    const b = evaluateBuiltin(env(), "NORMAL", [0, 1, 42], "site-b");
    expect(a).toBe(b);
    const r1 = evaluateBuiltin(env(), "RANDOM", [0, 1, 7], "x");
    const r2 = evaluateBuiltin(env(), "RANDOM", [0, 1, 7], "y");
    expect(r1).toBe(r2);
  });

  it("POISSON counts events per DT for a mean of mu per unit time", () => {
    for (const dt of [1, 0.25]) {
      const e = env({ dt });
      const draws = Array.from({ length: 4000 }, () => evaluateBuiltin(e, "POISSON", [4, 1], "p"));
      expect(draws.every((k) => Number.isInteger(k) && k >= 0)).toBe(true);
      const perTime = draws.reduce((s, k) => s + k, 0) / (draws.length * dt);
      expect(perTime).toBeGreaterThan(3.7);
      expect(perTime).toBeLessThan(4.3);
    }
  });
});

describe("COUNTER", () => {
  it("starts at `start` at the start time, rises one per time unit and wraps at `end`", () => {
    const at = (time: number) => evaluateBuiltin(env({ time, start: 1 }), "COUNTER", [1, 8], "0");
    expect([1, 2.5, 7.75, 8, 9, 15].map(at)).toEqual([1, 2.5, 7.75, 1, 2, 1]);
  });
});

describe("REWORK", () => {
  it("returns the per-pass fraction that reworks the given percentage in total", () => {
    const f = evaluateBuiltin(env(), "REWORK", [10], "0");
    expect(f).toBeCloseTo(0.1 / 1.1);
    // f + f^2 + f^3 + … = 10%
    expect(f / (1 - f)).toBeCloseTo(0.1);
  });
});

/** Run a built-in once per step from `start`, returning each step's value. */
function series(name: string, argsAt: (t: number) => number[], steps: number, dt = 1, start = 0): number[] {
  const e = env({ dt, start });
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    e.time = start + i * dt;
    out.push(evaluateBuiltin(e, name, argsAt(e.time), "s"));
  }
  return out;
}

describe("documented builtin behaviour", () => {
  it("PULSE moves its volume in one DT (value volume/DT), in the step holding the pulse time", () => {
    expect(series("PULSE", () => [10, 2], 6, 0.5)).toEqual([0, 0, 0, 0, 20, 0]);
    expect(series("PULSE", () => [1, 2.1], 12, 0.25)[8]).toBe(4); // 2.1 falls in [2, 2.25)
    expect(series("PULSE", () => [3, 1, 2], 7)).toEqual([0, 3, 0, 3, 0, 3, 0]);
    expect(series("PULSE", () => [3, 1, 0], 4)).toEqual([0, 3, 0, 0]);
  });

  it("RAMP(slope) starts at the start time; RAMP(1,10) starts at 10", () => {
    expect(series("RAMP", () => [2], 3, 1, 5)).toEqual([0, 2, 4]);
    expect(series("RAMP", () => [1, 10], 13).slice(10)).toEqual([0, 1, 2]);
    expect(series("RAMP", () => [1, 1, 3], 6)).toEqual([0, 0, 1, 2, 2, 2]);
  });

  it("INT is the largest integer <= x", () => {
    expect(evaluateBuiltin(env(), "INT", [8.9], "0")).toBe(8);
    expect(evaluateBuiltin(env(), "INT", [-8.9], "0")).toBe(-9);
  });

  it("SMTH1 behaves as a stock: initial value first, then a DT-lagged approach", () => {
    // input steps to 10 at t=0 from an initial smooth of 0, averaging time 2
    expect(series("SMTH1", () => [10, 2, 0], 4)).toEqual([0, 5, 7.5, 8.75]);
    // without an initial value the smooth starts at the input
    expect(series("SMTH1", () => [10, 2], 2)).toEqual([10, 10]);
  });

  it("SMTH3 / SMTHN cascade smooths of averaging time / n", () => {
    const s3 = series("SMTH3", () => [1, 3, 0], 4);
    const sn = series("SMTHN", () => [1, 3, 3, 0], 4);
    expect(sn).toEqual(s3);
    expect(s3.slice(0, 3)).toEqual([0, 0, 0]); // three stocks deep: 2 DTs before any response
    expect(s3[3]).toBeCloseTo(1);
  });

  it("TREND starts at its initial value and measures fractional growth; FORCST extrapolates it", () => {
    const grow = (t: number) => [100 * Math.pow(1.1, t), 1, 0.1];
    const tr = series("TREND", grow, 40, 0.25);
    expect(tr[0]).toBeCloseTo(0.1);
    expect(tr[39]).toBeGreaterThan(0.08);
    const fc = series("FORCST", (t) => [100, 2, 5], 3);
    expect(fc).toEqual([100, 100, 100]); // flat input, zero trend
  });

  it("DERIVN is 0 at the start, then backward differences", () => {
    expect(series("DERIVN", (t) => [t * t, 1], 4)).toEqual([0, 1, 3, 5]);
    expect(series("DERIVN", (t) => [t * t, 2], 4)).toEqual([0, 1, 2, 2]);
    expect(series("DERIVN", () => [1, 0], 2)).toEqual([1, 1]);
  });

  it("CGROWTH gives the same per-period growth at any DT", () => {
    for (const dt of [1, 0.25, 0.0625]) {
      let stock = 100;
      for (let t = 0; t < 1 - 1e-9; t += dt) stock += stock * evaluateBuiltin(env({ dt }), "CGROWTH", [10], "0") * dt;
      expect(stock).toBeCloseTo(110);
    }
  });

  it("SWITCH and SOUND are indicators", () => {
    expect(evaluateBuiltin(env(), "SWITCH", [3, 2], "0")).toBe(1);
    expect(evaluateBuiltin(env(), "SWITCH", [2, 2], "0")).toBe(0);
    expect(evaluateBuiltin(env(), "SOUND", [-1], "0")).toBe(0);
    expect(evaluateBuiltin(env(), "SOUND", [0.5], "0")).toBe(1);
  });

  it("MONTECARLO fires with probability% per time unit; EXPRND has the given mean", () => {
    const mc = series("MONTECARLO", () => [20, 1577], 20000, 0.5);
    expect(mc.every((x) => x === 0 || x === 1)).toBe(true);
    const perTime = mc.reduce((a, b) => a + b, 0) / (20000 * 0.5);
    expect(perTime).toBeGreaterThan(0.18);
    expect(perTime).toBeLessThan(0.22);
    const ex = series("EXPRND", () => [2, 456], 20000);
    expect(ex.reduce((a, b) => a + b, 0) / ex.length).toBeCloseTo(2, 0);
  });

  it("SINWAVE / COSWAVE use |amplitude| and start at the start time", () => {
    expect(series("SINWAVE", () => [-5, 4], 3).map((x) => Math.round(x * 1e9) / 1e9)).toEqual([0, 5, 0]);
    expect(series("COSWAVE", () => [10, 4], 1)).toEqual([10]);
  });

  it("PV, FV and PMT follow the cash-flow sign convention", () => {
    expect(evaluateBuiltin(env(), "PMT", [0.01, 12, 1000, 0], "0")).toBeCloseTo(-88.8488, 3);
    expect(evaluateBuiltin(env(), "FV", [0.01, 12, -100, 0], "0")).toBeCloseTo(1268.25, 2);
    expect(evaluateBuiltin(env(), "PV", [0.01, 12, -100, 0], "0")).toBeCloseTo(1125.51, 2);
  });

  it("NPV accumulates the discounted input from the start", () => {
    expect(series("NPV", () => [10, 0], 4)).toEqual([0, 10, 20, 30]);
    const npv = series("NPV", () => [10, 0.05], 3);
    expect(npv[2]).toBeCloseTo(10 + 10 / 1.05);
  });

  it("DELAY fixes a variable duration at its initial value", () => {
    const out = series("DELAY", (t) => [t, t < 1 ? 2 : 5], 6);
    expect(out).toEqual([0, 0, 0, 1, 2, 3]);
  });
});
