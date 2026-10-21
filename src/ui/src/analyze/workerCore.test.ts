import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";
import type { Dataset, ParameterSpec } from "@sourcesink/analysis";

import { handle, latinOverrides, progressStage, type WorkerRequest } from "./workerCore.js";

function decayModel(): Model {
  return {
    ...emptyModel("decay"),
    stocks: [{ id: "s", name: "S", kind: "stock", equation: "100", outflows: ["decay"] }],
    flows: [{ id: "f", name: "decay", kind: "flow", equation: "k * S" }],
    converters: [{ id: "k", name: "k", kind: "converter", equation: "0.1" }],
    run: { start: 0, stop: 10, dt: 0.05, saveEvery: 1, integration: "rk4" },
  };
}

const time = Array.from({ length: 11 }, (_, i) => i);
const observed: Dataset = {
  time,
  series: { S: time.map((t) => 80 * Math.exp(-0.3 * t)) },
};

const params: ParameterSpec[] = [
  { name: "k", min: 0, max: 2, initial: 0.8 },
  { name: "S", min: 0, max: 200, initial: 20 },
];

describe("workerCore.handle", () => {
  it("sweeps a parameter and keeps the requested trajectories", () => {
    const response = handle({
      id: 9,
      kind: "sweep",
      model: decayModel(),
      axes: [{ name: "k", min: 0.1, max: 0.4, steps: 4 }],
      metric: { series: "S", stat: "final" },
      series: ["S"],
    });
    if (response.type !== "result" || response.kind !== "sweep") throw new Error(JSON.stringify(response));
    response.result.axes[0].values.forEach((k, i) =>
      expect(response.result.outputs[i]).toBeCloseTo(100 * Math.exp(-10 * k), 4),
    );
    expect(response.result.traces.S).toHaveLength(4);
    expect(progressStage("sweep")).toBe("Sweeping…");
  });


  it("fits parameters through the calibration request", () => {
    const request: WorkerRequest = {
      id: 1,
      kind: "calibrate",
      model: decayModel(),
      data: observed,
      params,
      options: { maxEvaluations: 2_500, tolerance: 1e-10 },
    };
    const response = handle(request);
    if (response.type !== "result" || response.kind !== "calibrate") {
      throw new Error(`expected a calibration result, got ${JSON.stringify(response)}`);
    }
    expect(Math.abs(response.result.parameters.k - 0.3) / 0.3).toBeLessThan(1e-3);
    expect(Math.abs(response.result.parameters.S - 80) / 80).toBeLessThan(1e-3);
    expect(response.result.alignments[0].series).toBe("S");
    expect(response.result.identifiability.standardErrors.k).toBeGreaterThanOrEqual(0);
  });

  it("runs a Morris screen", () => {
    const request: WorkerRequest = {
      id: 2,
      kind: "morris",
      model: decayModel(),
      params,
      metric: { series: "S", stat: "final" },
      options: { trajectories: 2, seed: 3 },
    };
    const response = handle(request);
    if (response.type !== "result" || response.kind !== "morris") {
      throw new Error(`expected a Morris result, got ${JSON.stringify(response)}`);
    }
    expect(response.result.parameters.map((p) => p.name).sort()).toEqual(["S", "k"]);
    expect(response.result.evaluations).toBe(6);
    expect(response.result.failed).toBe(0);
  });

  it("runs a Sobol decomposition", () => {
    const request: WorkerRequest = {
      id: 3,
      kind: "sobol",
      model: decayModel(),
      params,
      metric: { series: "S", stat: "final" },
      options: { samples: 8, bootstrap: 0, seed: 4 },
    };
    const response = handle(request);
    if (response.type !== "result" || response.kind !== "sobol") {
      throw new Error(`expected a Sobol result, got ${JSON.stringify(response)}`);
    }
    expect(response.result.parameters).toHaveLength(2);
    expect(response.result.evaluations).toBe(32);
    expect(response.result.failed).toBe(0);
  });

  it("runs an uncertainty ensemble and summarizes percentile bands", () => {
    const request: WorkerRequest = {
      id: 4,
      kind: "uncertainty",
      model: decayModel(),
      params,
      runs: 6,
      series: ["S"],
      seed: 5,
    };
    const response = handle(request);
    if (response.type !== "result" || response.kind !== "uncertainty") {
      throw new Error(`expected an uncertainty result, got ${JSON.stringify(response)}`);
    }
    expect(response.result.runs).toBe(6);
    expect(response.result.failed).toBe(0);
    expect(response.result.time.length).toBeGreaterThan(1);
    expect(response.result.stats.S.percentiles[50]).toHaveLength(response.result.time.length);
    expect(response.result.stats.S.percentiles[5][0]).toBeLessThanOrEqual(
      response.result.stats.S.percentiles[95][0],
    );
  });

  it("returns an error response instead of throwing", () => {
    const request: WorkerRequest = {
      id: 5,
      kind: "calibrate",
      model: decayModel(),
      data: observed,
      params: [{ name: "nope", min: 0, max: 1 }],
    };
    const response = handle(request);
    expect(response.type).toBe("error");
    if (response.type === "error") expect(response.error).toMatch(/unknown parameter/);
  });
});

describe("latinOverrides", () => {
  it("is deterministic and maps log parameters into their range", () => {
    const logParams: ParameterSpec[] = [{ name: "k", min: 0.01, max: 1, scale: "log" }];
    const first = latinOverrides(logParams, 8, 12);
    expect(first).toEqual(latinOverrides(logParams, 8, 12));
    for (const sample of first) {
      const value = Number(sample.k);
      expect(value).toBeGreaterThanOrEqual(0.01);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("progressStage", () => {
  it("names every analysis kind", () => {
    expect(progressStage("calibrate")).toMatch(/Fitting/);
    expect(progressStage("morris")).toMatch(/Morris/);
    expect(progressStage("sobol")).toMatch(/Sobol/);
    expect(progressStage("uncertainty")).toMatch(/ensemble/);
  });
});
