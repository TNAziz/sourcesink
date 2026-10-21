import { describe, expect, it } from "vitest";

import { gridSamples, simulateEnsemble, summarize, uniformSamples } from "@sourcesink/analysis";
import { emptyModel, type Model } from "@sourcesink/model";

import { formatMonteCarloCsv, formatNumber, formatSweepCsv } from "./format.js";

/** Exponential decay S' = -K S with S(0) = `initial`; both are converters so
 * a 2x2 grid can vary the rate and the initial value. */
function decayModel(): Model {
  return {
    ...emptyModel("decay"),
    stocks: [
      { id: "p", name: "Population", kind: "stock", equation: "initial", outflows: ["decay"] },
    ],
    flows: [{ id: "d", name: "decay", kind: "flow", equation: "Population * K" }],
    converters: [
      { id: "k", name: "K", kind: "converter", equation: "0.1" },
      { id: "i", name: "initial", kind: "converter", equation: "100" },
    ],
    run: { start: 0, stop: 2, dt: 0.01, saveEvery: 1 },
  };
}

describe("formatNumber", () => {
  it("prints integers plain and other values with six decimals", () => {
    expect(formatNumber(3)).toBe("3");
    expect(formatNumber(0.1)).toBe("0.100000");
    expect(formatNumber(Number.NaN)).toBe("NaN");
  });
});

describe("formatSweepCsv", () => {
  it("writes one row per grid point with parameter values and final column values", () => {
    const model = decayModel();
    const samples = gridSamples({ K: [0.1, 0.2], initial: [100, 50] });
    const result = simulateEnsemble({ base: model, samples });
    const csv = formatSweepCsv(result, ["K", "initial"], ["Population"]);

    const [header, ...rows] = csv.split("\n");
    expect(header).toBe("K,initial,Population final");
    expect(rows).toHaveLength(4);

    const seen = new Set<string>();
    for (const row of rows) {
      const [k, initial, final] = row.split(",").map(Number);
      seen.add(`${k},${initial}`);
      const expected = initial * Math.exp(-k * 2);
      expect(Math.abs(final - expected) / expected).toBeLessThan(0.01);
    }
    expect(seen).toEqual(new Set(["0.1,100", "0.1,50", "0.2,100", "0.2,50"]));
  });

  it("keeps a row for a failed run, with NaN finals", () => {
    const result = simulateEnsemble({ base: decayModel(), samples: [{ K: 0.1 }, { K: "1 +" }] });
    const rows = formatSweepCsv(result, ["K"], ["Population"]).split("\n");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatch(/^0\.100000,/);
    expect(rows[2]).toBe("NaN,NaN");
  });
});

describe("formatMonteCarloCsv", () => {
  function monteCarlo(seed: number): string {
    const model = decayModel();
    const samples = uniformSamples({ K: [0.05, 0.2] }, 20, seed);
    const result = simulateEnsemble({ base: model, samples, seeds: [seed] });
    const summary = summarize(result, ["Population"], [5, 50, 95]);
    return formatMonteCarloCsv(result.time, summary, ["Population"], [5, 50, 95]);
  }

  it("writes time then mean, sd and each percentile for every column", () => {
    const model = decayModel();
    const samples = uniformSamples({ K: [0.05, 0.2] }, 20, 7);
    const result = simulateEnsemble({ base: model, samples, seeds: [7] });
    const summary = summarize(result, ["Population"], [5, 50, 95]);
    const rows = formatMonteCarloCsv(result.time, summary, ["Population"], [5, 50, 95]).split("\n");

    expect(rows[0]).toBe("time,Population mean,Population sd,Population p5,Population p50,Population p95");
    expect(rows).toHaveLength(result.time.length + 1);
    for (const row of rows.slice(1)) {
      expect(row.split(",")).toHaveLength(6);
      for (const field of row.split(",").slice(1)) expect(Number.isFinite(Number(field))).toBe(true);
    }
  });

  it("is identical for the same seed and differs across seeds", () => {
    expect(monteCarlo(7)).toBe(monteCarlo(7));
    expect(monteCarlo(7)).not.toBe(monteCarlo(8));
  });
});
