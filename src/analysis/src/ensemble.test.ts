import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import { simulateEnsemble } from "./ensemble.js";

function decayModel(): Model {
  return {
    ...emptyModel("decay"),
    stocks: [{ id: "s", name: "S", kind: "stock", equation: "100", outflows: ["decay"] }],
    flows: [{ id: "f", name: "decay", kind: "flow", equation: "S * k" }],
    converters: [{ id: "c", name: "k", kind: "converter", equation: "0.1" }],
    run: { start: 0, stop: 10, dt: 0.01, saveEvery: 1 },
  };
}

function randomModel(): Model {
  return {
    ...emptyModel("random"),
    converters: [{ id: "c", name: "noise", kind: "converter", equation: "RANDOM(0, 1)" }],
    run: { start: 0, stop: 1, dt: 0.1, saveEvery: 0.5 },
  };
}

describe("simulateEnsemble", () => {
  it("runs exponential decay for each k and matches the analytical solution", () => {
    const result = simulateEnsemble({
      base: decayModel(),
      samples: [{ k: 0.1 }, { k: 0.2 }],
    });

    expect(result.runs).toHaveLength(2);
    expect(result.time[result.time.length - 1]).toBe(10);
    for (const [i, k] of [0.1, 0.2].entries()) {
      const run = result.runs[i];
      expect(run.error).toBeUndefined();
      expect(run.index).toBe(i);
      expect(run.seed).toBe(0);
      const series = run.result!.series.S;
      const final = series[series.length - 1];
      const expected = 100 * Math.exp(-k * 10);
      expect(Math.abs(final - expected) / expected).toBeLessThan(0.01);
    }
  });

  it("records an invalid run without throwing and keeps the others", () => {
    const result = simulateEnsemble({
      base: decayModel(),
      samples: [{ k: 0.1 }, { k: "1 +" }, { k: 0.2 }],
    });

    expect(result.runs).toHaveLength(3);
    expect(result.runs[0].result).toBeDefined();
    expect(result.runs[1].result).toBeUndefined();
    expect(result.runs[1].error).toBeTruthy();
    expect(result.runs[2].result).toBeDefined();
    expect(result.time.length).toBeGreaterThan(0);
  });

  it("uses one base run when samples is empty", () => {
    const result = simulateEnsemble({ base: decayModel(), samples: [] });
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].overrides).toEqual({});
    expect(result.runs[0].result).toBeDefined();
  });

  it("takes the shared time axis from the first successful run", () => {
    const result = simulateEnsemble({ base: decayModel(), samples: [{ nope: 1 }, {}] });
    expect(result.runs[0].error).toMatch(/unknown element/);
    expect(result.runs[1].result).toBeDefined();
    expect(result.time).toEqual(result.runs[1].result!.time);
  });

  it("cycles seeds across runs", () => {
    const result = simulateEnsemble({ base: decayModel(), samples: [{}, {}, {}], seeds: [4, 9] });
    expect(result.runs.map((r) => r.seed)).toEqual([4, 9, 4]);
  });

  it("passes the seed through to RANDOM: equal seeds agree, different seeds differ", () => {
    const same = simulateEnsemble({ base: randomModel(), samples: [{}, {}], seeds: [7, 7] });
    expect(same.runs[0].result!.series.noise).toEqual(same.runs[1].result!.series.noise);

    const different = simulateEnsemble({ base: randomModel(), samples: [{}, {}], seeds: [7, 8] });
    expect(different.runs[0].result!.series.noise).not.toEqual(different.runs[1].result!.series.noise);
    expect(different.runs[0].result!.series.noise).toEqual(
      simulateEnsemble({ base: randomModel(), samples: [{}], seeds: [7] }).runs[0].result!.series.noise,
    );
  });

  it("applies run-spec changes to every run", () => {
    const result = simulateEnsemble({ base: decayModel(), samples: [{}, {}], run: { stop: 2 } });
    for (const run of result.runs) expect(run.result!.time[run.result!.time.length - 1]).toBe(2);
  });
});
