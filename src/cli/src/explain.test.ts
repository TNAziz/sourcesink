import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import { ArgError } from "./args.js";
import {
  explainReport,
  formatExplainReport,
  formatLoopList,
  parseExplainArgs,
} from "./explain.js";

function decayModel(): Model {
  const m = emptyModel("Decay");
  m.stocks = [{ kind: "stock", id: "S", name: "S", equation: "100", outflows: ["drain"] }];
  m.flows = [{ kind: "flow", id: "drain", name: "drain", equation: "k * S" }];
  m.converters = [{ kind: "converter", id: "k", name: "k", equation: "0.1" }];
  return m;
}

describe("parseExplainArgs", () => {
  it("accepts a model with the optional flags", () => {
    expect(parseExplainArgs(["model.xmile"])).toEqual({
      file: "model.xmile",
      loopsOnly: false,
      json: false,
    });
    expect(parseExplainArgs(["model.stm", "--loops"])).toEqual({
      file: "model.stm",
      loopsOnly: true,
      json: false,
    });
    expect(parseExplainArgs(["model.xmile", "--loops", "--json"])).toEqual({
      file: "model.xmile",
      loopsOnly: true,
      json: true,
    });
  });

  it("rejects missing files, extra positionals, unknown flags and valued switches", () => {
    const bad: string[][] = [
      [],
      ["a.xmile", "b.xmile"],
      ["m.xmile", "--nope"],
      ["m.xmile", "--json=1"],
    ];
    for (const args of bad) {
      expect(() => parseExplainArgs(args)).toThrow(ArgError);
    }
  });
});

describe("explain output", () => {
  it("assembles markdown, loops and coverage once", () => {
    const report = explainReport(decayModel());
    expect(report.markdown).toContain("## Stocks");
    expect(report.loops).toHaveLength(1);
    expect(report.loops[0].type).toBe("balancing");
    expect(report.coverage.complete).toBe(true);
  });

  it("prints JSON with the documented keys", () => {
    const report = explainReport(decayModel());
    const parsed = JSON.parse(formatExplainReport(report, { file: "m", loopsOnly: false, json: true }));
    expect(Object.keys(parsed).sort()).toEqual(["coverage", "loops", "markdown"]);
  });

  it("prints only the loop list for --loops", () => {
    const report = explainReport(decayModel());
    const text = formatExplainReport(report, { file: "m", loopsOnly: true, json: false });
    expect(text).toBe(formatLoopList(report.loops));
    expect(text).toContain("B1");
    expect(text).not.toContain("## Stocks");
  });
});
