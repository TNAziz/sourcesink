import { describe, expect, it } from "vitest";

import { morris, sobol } from "@sourcesink/analysis";
import { emptyModel, type Model } from "@sourcesink/model";

import { ArgError } from "./args.js";
import {
  formatMorrisReport,
  formatSensitivityReport,
  formatSobolReport,
  parseMetric,
  parseSensitivityArgs,
} from "./sensitivity.js";

function decayModel(): Model {
  const model = emptyModel("Decay");
  model.run = { start: 0, stop: 5, dt: 0.0625, saveEvery: 1, integration: "euler" };
  model.stocks = [{ kind: "stock", id: "s", name: "S", equation: "10", outflows: ["loss"] }];
  model.flows = [{ kind: "flow", id: "loss", name: "loss", equation: "k * S" }];
  model.converters = [{ kind: "converter", id: "c", name: "k", equation: "0.2" }];
  return model;
}

const PARAMS = [{ name: "k", min: 0.05, max: 0.5 }];
const METRIC = { series: "S", stat: "final" as const };

describe("parseMetric", () => {
  it("parses plain statistics and at@TIME", () => {
    expect(parseMetric("S:mean")).toEqual({ series: "S", stat: "mean" });
    expect(parseMetric("DO deficit:at@2.5")).toEqual({ series: "DO deficit", stat: "at", time: 2.5 });
  });

  it("rejects malformed metrics", () => {
    for (const arg of ["S", ":final", "S:median", "S:at", "S:at@x", "S:final@3"]) {
      expect(() => parseMetric(arg), arg).toThrow(ArgError);
    }
  });
});

describe("parseSensitivityArgs", () => {
  it("defaults to Morris and parses log parameters", () => {
    const options = parseSensitivityArgs([
      "model.xmile",
      "--param",
      "kd=0.01:1:log",
      "--metric",
      "DO:at@5",
    ]);
    expect(options).toMatchObject({
      file: "model.xmile",
      params: [{ name: "kd", min: 0.01, max: 1, scale: "log" }],
      metric: { series: "DO", stat: "at", time: 5 },
      method: "morris",
      json: false,
    });
  });

  it("parses a Sobol run with its sampling options", () => {
    const options = parseSensitivityArgs([
      "model.xmile",
      "--param",
      "k=0.1:2",
      "--metric",
      "S:final",
      "--method",
      "sobol",
      "--samples",
      "64",
      "--trajectories",
      "8",
      "--seed",
      "3",
      "--json",
    ]);
    expect(options).toMatchObject({ method: "sobol", samples: 64, trajectories: 8, seed: 3, json: true });
  });

  it("rejects bad command lines with ArgError", () => {
    const cases: string[][] = [
      [],
      ["model.xmile", "--metric", "S:final"],
      ["model.xmile", "--param", "k=0.1:2"],
      ["model.xmile", "--param", "k=1:2", "--metric", "S:median"],
      ["model.xmile", "--param", "k=1:2", "--metric", "S:final", "--method", "fast"],
      ["model.xmile", "--param", "k=1:2", "--metric", "S:final", "--trajectories", "0"],
      ["model.xmile", "--param", "k=1:2", "--metric", "S:final", "--samples", "1.5"],
      ["model.xmile", "--param", "K=1:2", "--param", "k=3:4", "--metric", "S:final"],
      ["model.xmile", "--param", "k=0:2:log", "--metric", "S:final"],
      ["model.xmile", "--param", "k=2:1", "--metric", "S:final"],
    ];
    for (const args of cases) {
      expect(() => parseSensitivityArgs(args), args.join(" ")).toThrow(ArgError);
    }
  });
});

describe("sensitivity reports", () => {
  it("prints a ranked Morris table", () => {
    const result = morris(decayModel(), PARAMS, METRIC, { trajectories: 4, seed: 1 });
    const report = formatMorrisReport(result);
    expect(report).toContain("Morris screening (metric S:final)");
    expect(report).toContain("Evaluations: 8");
    expect(report).toMatch(/parameter\s+mu\*\s+mu\s+sigma/);
    expect(report).toMatch(/\nk\s+/);
  });

  it("prints Sobol' indices with confidence intervals", () => {
    const result = sobol(decayModel(), PARAMS, METRIC, { samples: 16, seed: 2 });
    const report = formatSobolReport(result);
    expect(report).toContain("Sobol' indices (metric S:final)");
    expect(report).toMatch(/S1 \[95% CI\]\s+ST \[95% CI\]/);
    expect(report).toMatch(/\nk\s+/);
    expect(report).toContain("[");
  });

  it("dispatches on the method and prints at@TIME metrics", () => {
    const metric = { series: "S", stat: "at" as const, time: 5 };
    const morrisResult = morris(decayModel(), PARAMS, metric, { trajectories: 2, seed: 0 });
    const sobolResult = sobol(decayModel(), PARAMS, metric, { samples: 8, seed: 0, bootstrap: 0 });
    expect(formatSensitivityReport(morrisResult, "morris")).toContain("S:at@5");
    expect(formatSensitivityReport(sobolResult, "sobol")).toContain("S:at@5");
  });
});
