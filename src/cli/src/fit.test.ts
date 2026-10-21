import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyOverrides, calibrate, parseCsv, type FitResult } from "@sourcesink/analysis";
import { simulate } from "@sourcesink/engine";
import { emptyModel, type Model } from "@sourcesink/model";
import { readXmile, writeXmile } from "@sourcesink/xmile";

import { ArgError } from "./args.js";
import {
  fittedModel,
  formatFitReport,
  matchUnitHeaders,
  parseFitArgs,
  parseFitParam,
  parseRename,
  withError,
} from "./fit.js";

/** First-order decay S' = −k·S, observed exactly at the save points. */
function decayModel(initialK = 0.05): Model {
  const model = emptyModel("Decay");
  model.run = { start: 0, stop: 5, dt: 0.0625, saveEvery: 1, integration: "euler" };
  model.stocks = [{ kind: "stock", id: "s", name: "S", equation: "10", outflows: ["loss"] }];
  model.flows = [{ kind: "flow", id: "loss", name: "loss", equation: "k * S" }];
  model.converters = [{ kind: "converter", id: "c", name: "k", equation: String(initialK) }];
  return model;
}

function fitDecay(): { model: Model; result: FitResult } {
  const model = decayModel();
  const truth = simulate(applyOverrides(model, { k: 0.25 }));
  const csv = ["day,S", ...truth.time.map((t, i) => `${t},${truth.series.S[i]}`)].join("\n");
  const result = calibrate(model, parseCsv(csv), [{ name: "k", min: 0.02, max: 0.5 }], {
    maxEvaluations: 2000,
  });
  return { model, result };
}

describe("parseFitParam", () => {
  it("parses linear and log ranges", () => {
    expect(parseFitParam("kd=0.05:1:log")).toEqual({ name: "kd", min: 0.05, max: 1, scale: "log" });
    expect(parseFitParam("ka = 0.1 : 2")).toEqual({ name: "ka", min: 0.1, max: 2 });
  });

  it("rejects malformed ranges", () => {
    for (const arg of ["kd", "kd=1", "kd=a:2", "kd=1:0", "kd=1:2:linear", "=1:2"]) {
      expect(() => parseFitParam(arg), arg).toThrow(ArgError);
    }
  });
});

describe("parseRename", () => {
  it("splits a header from its element name", () => {
    expect(parseRename("BOD (mg/L)=BOD")).toEqual({ header: "BOD (mg/L)", element: "BOD" });
  });

  it("rejects a missing or empty side", () => {
    for (const arg of ["BOD", "=BOD", "BOD="]) {
      expect(() => parseRename(arg), arg).toThrow(ArgError);
    }
  });
});

describe("parseFitArgs", () => {
  it("parses every fit option", () => {
    const options = parseFitArgs([
      "model.xmile",
      "--data",
      "obs.csv",
      "--param",
      "kd=0.05:1:log",
      "--param",
      "ka=0.1:2",
      "--rename",
      "BOD (mg/L)=BOD",
      "--method",
      "de",
      "--starts",
      "4",
      "--objective",
      "wsse",
      "--seed",
      "7",
      "--json",
      "--write",
      "fitted.xmile",
    ]);
    expect(options).toMatchObject({
      file: "model.xmile",
      data: "obs.csv",
      params: [
        { name: "kd", min: 0.05, max: 1, scale: "log" },
        { name: "ka", min: 0.1, max: 2 },
      ],
      rename: { "BOD (mg/L)": "BOD" },
      method: "differential-evolution",
      starts: 4,
      objective: "wsse",
      seed: 7,
      json: true,
      write: "fitted.xmile",
    });
  });

  it("rejects bad command lines with ArgError", () => {
    const cases: string[][] = [
      [],
      ["model.xmile"],
      ["model.xmile", "--data", "obs.csv"],
      ["model.xmile", "--data", "obs.csv", "--param", "k=1"],
      ["model.xmile", "--data", "obs.csv", "--param", "K=1:2", "--param", "k=3:4"],
      ["model.xmile", "--data", "obs.csv", "--param", "k=1:2", "--method", "simplex"],
      ["model.xmile", "--data", "obs.csv", "--param", "k=1:2", "--objective", "mae"],
      ["model.xmile", "--data", "obs.csv", "--param", "k=1:2", "--starts", "0"],
      ["model.xmile", "--data", "obs.csv", "--param", "k=1:2", "--seed", "1.5"],
      ["model.xmile", "--data", "obs.csv", "--param", "k=1:2", "--rename", "broken"],
      ["model.xmile", "--data", "obs.csv", "--param", "k=1:2", "--bogus"],
    ];
    for (const args of cases) {
      expect(() => parseFitArgs(args), args.join(" ")).toThrow(ArgError);
    }
  });
});

describe("formatFitReport", () => {
  it("prints the recovered value, metrics and identifiability", () => {
    const { result } = fitDecay();
    expect(result.parameters.k).toBeCloseTo(0.25, 2);

    const report = formatFitReport(result);
    expect(Number(report.match(/k\s+= ([\d.]+)/)![1])).toBeCloseTo(0.25, 6);
    expect(report).toContain("±");
    expect(report).toContain("Objective:");
    expect(report).toContain("Converged: yes");
    expect(report).toContain("Series metrics:");
    expect(report).toMatch(/series\s+points\s+RMSE\s+NSE\s+R²\s+bias/);
    expect(report).toMatch(/\n  S\s+6\s/);
    expect(report).toContain("Identifiability warnings:");
  });
});

describe("fittedModel", () => {
  it("writes fitted constants that re-read from XMILE", () => {
    const { model, result } = fitDecay();
    const directory = mkdtempSync(join(tmpdir(), "sourcesink-fit-"));
    try {
      const path = join(directory, "fitted.xmile");
      writeFileSync(path, writeXmile(fittedModel(model, result)));
      const reread = readXmile(readFileSync(path, "utf8"));
      const k = reread.converters.find((c) => c.name === "k");
      expect(Number(k?.equation)).toBeCloseTo(result.parameters.k, 12);
      expect(model.converters[0].equation).toBe("0.05");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("withError", () => {
  it("shows a value to the precision its standard error supports", () => {
    expect(withError(0.34401, 0.0041226)).toBe("0.3440 ± 0.0041");
    expect(withError(1234.5, 87)).toBe("1235 ± 87");
    expect(withError(2, Number.POSITIVE_INFINITY)).toBe("2 ± inf");
  });
});

describe("matchUnitHeaders", () => {
  it("maps unit-suffixed headers onto model elements and leaves the rest", () => {
    const data = { time: [0], series: { "S (mg/L)": [1], "k [1/day]": [2], other: [3], "loss (x)": [4] } };
    expect(Object.keys(matchUnitHeaders(data, decayModel()).series)).toEqual(["S", "k", "other", "loss"]);
  });
});
