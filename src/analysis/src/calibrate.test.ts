import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import { calibrate } from "./calibrate.js";
import type { Dataset, ParameterSpec } from "./contracts.js";

function decayModel(k = "0.1", s0 = "100"): Model {
  return {
    ...emptyModel("decay"),
    stocks: [{ id: "s", name: "S", kind: "stock", equation: s0, outflows: ["decay"] }],
    flows: [{ id: "f", name: "decay", kind: "flow", equation: "k * S" }],
    converters: [{ id: "c", name: "k", kind: "converter", equation: k }],
    run: { start: 0, stop: 10, dt: 0.05, saveEvery: 1, integration: "rk4" },
  };
}

/** Exact exponential decay observed every integer time in [0, 10]. */
function decayData(k = 0.3, s0 = 80): Dataset {
  const time = Array.from({ length: 11 }, (_, i) => i);
  return { time, series: { S: time.map((t) => s0 * Math.exp(-k * t)) } };
}

/** mulberry32 so the pseudo-noise is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noisyData(k: number, s0: number, seed: number, amplitude = 0.01): Dataset {
  const data = decayData(k, s0);
  const rand = mulberry32(seed);
  return {
    time: data.time,
    series: { S: data.series.S.map((v) => v * (1 + amplitude * (2 * rand() - 1))) },
  };
}

const PARAMS_KS: ParameterSpec[] = [
  { name: "k", min: 0, max: 2, initial: 0.8 },
  { name: "S", min: 0, max: 200, initial: 20 },
];

describe("calibrate — Nelder-Mead", () => {
  it("recovers k and S0 from wrong starts on noiseless data", () => {
    const fit = calibrate(decayModel("0.8", "20"), decayData(), PARAMS_KS, {
      method: "nelder-mead",
      maxEvaluations: 10_000,
      tolerance: 1e-12,
    });

    expect(fit.method).toBe("nelder-mead");
    expect(fit.converged).toBe(true);
    expect(Math.abs(fit.parameters.k - 0.3) / 0.3).toBeLessThan(1e-3);
    expect(Math.abs(fit.parameters.S - 80) / 80).toBeLessThan(1e-3);
    expect(fit.objective).toBeLessThan(1e-4);
    expect(fit.history).toHaveLength(1);
    expect(fit.evaluations).toBeGreaterThan(0);
    expect(fit.alignments[0].series).toBe("S");
    expect(fit.metrics.S.nse).toBeGreaterThan(0.9999);
  });

  it("uses restarts from seeded Latin-hypercube points and keeps the best", () => {
    const fit = calibrate(decayModel("0.8", "20"), decayData(), PARAMS_KS, {
      starts: 3,
      seed: 5,
      maxEvaluations: 10_000,
      tolerance: 1e-12,
    });
    expect(fit.history).toHaveLength(3);
    expect(fit.history[2]).toBeLessThanOrEqual(fit.history[0]);
    expect(Math.abs(fit.parameters.k - 0.3) / 0.3).toBeLessThan(1e-3);
  });

  it("recovers parameters from deterministic noisy data with finite standard errors", () => {
    const fit = calibrate(decayModel(), noisyData(0.3, 80, 17), PARAMS_KS, {
      starts: 3,
      seed: 9,
      maxEvaluations: 20_000,
      tolerance: 1e-12,
    });

    expect(Math.abs(fit.parameters.k - 0.3) / 0.3).toBeLessThan(0.05);
    expect(Math.abs(fit.parameters.S - 80) / 80).toBeLessThan(0.05);
    expect(fit.metrics.S.nse).toBeGreaterThan(0.95);
    expect(fit.identifiability.standardErrors.k).toBeGreaterThan(0);
    expect(Number.isFinite(fit.identifiability.standardErrors.k)).toBe(true);
    expect(Number.isFinite(fit.identifiability.standardErrors.S)).toBe(true);
    expect(fit.identifiability.standardErrors.k).toBeLessThan(2);
    expect(fit.identifiability.standardErrors.S).toBeLessThan(200);
  });
});

describe("calibrate — differential evolution", () => {
  it("recovers k and S0 from wrong starts on noiseless data", () => {
    const fit = calibrate(decayModel("0.8", "20"), decayData(), PARAMS_KS, {
      method: "differential-evolution",
      maxEvaluations: 40_000,
      tolerance: 1e-10,
      seed: 11,
    });

    expect(fit.method).toBe("differential-evolution");
    expect(Math.abs(fit.parameters.k - 0.3) / 0.3).toBeLessThan(1e-3);
    expect(Math.abs(fit.parameters.S - 80) / 80).toBeLessThan(1e-3);
    expect(fit.history.length).toBeGreaterThan(1);
  });

  it("is reproducible for a given seed", () => {
    const options = {
      method: "differential-evolution" as const,
      maxEvaluations: 2_000,
      seed: 31,
    };
    const first = calibrate(decayModel(), decayData(), PARAMS_KS, options);
    const second = calibrate(decayModel(), decayData(), PARAMS_KS, options);
    expect(second.parameters).toEqual(first.parameters);
    expect(second.objective).toBe(first.objective);
  });
});

describe("calibrate — identifiability", () => {
  it("warns when two parameters are perfectly confounded", () => {
    const model: Model = {
      ...emptyModel("growth"),
      stocks: [{ id: "s", name: "Population", kind: "stock", equation: "100", inflows: ["growth"] }],
      flows: [{ id: "f", name: "growth", kind: "flow", equation: "a * b * Population" }],
      converters: [
        { id: "a", name: "a", kind: "converter", equation: "0.05" },
        { id: "b", name: "b", kind: "converter", equation: "0.1" },
      ],
      run: { start: 0, stop: 10, dt: 0.05, saveEvery: 1, integration: "rk4" },
    };
    const data: Dataset = { time: decayData().time, series: { Population: decayData(0.005, 100).series.S } };

    const fit = calibrate(
      model,
      data,
      [
        { name: "a", min: 0.001, max: 1, initial: 0.2 },
        { name: "b", min: 0.001, max: 1, initial: 0.2 },
      ],
      { maxEvaluations: 5_000, tolerance: 1e-12 },
    );

    expect(Math.abs(fit.identifiability.correlation[0][1])).toBeGreaterThan(0.95);
    expect(fit.identifiability.warnings.some((w) => /correlated/.test(w))).toBe(true);
  });

  it("warns when a parameter has no effect on the fit", () => {
    const model = decayModel("0.3", "80");
    model.converters.push({ id: "t", name: "theta", kind: "converter", equation: "1" });

    const fit = calibrate(model, decayData(), [{ name: "theta", min: 0, max: 10 }], {
      maxEvaluations: 2_000,
    });

    expect(fit.identifiability.warnings.some((w) => /poorly identified/.test(w))).toBe(true);
    expect(fit.identifiability.standardErrors.theta).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("calibrate — parameter handling", () => {
  it("recovers a log-scaled parameter over a wide range", () => {
    const fit = calibrate(decayModel("0.1", "80"), decayData(0.3, 80), [
      { name: "k", min: 1e-3, max: 10, scale: "log" },
    ]);

    expect(Math.abs(fit.parameters.k - 0.3) / 0.3).toBeLessThan(1e-2);
  });

  it("uses the element's constant equation as the default starting point", () => {
    const fit = calibrate(decayModel("0.3", "80"), decayData(0.3, 80), [
      { name: "k", min: 0, max: 2 },
    ]);
    expect(fit.parameters.k).toBeCloseTo(0.3, 5);
  });

  it("rejects an unknown parameter name", () => {
    expect(() =>
      calibrate(decayModel(), decayData(), [{ name: "nope", min: 0, max: 1 }]),
    ).toThrow(/unknown parameter 'nope'/);
  });

  it("rejects an observed series that is not in the model", () => {
    const data: Dataset = { time: [0, 1], series: { Y: [1, 2] } };
    expect(() => calibrate(decayModel(), data, [])).toThrow(/observed series 'Y'/);
  });
});
