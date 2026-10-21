import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { emptyModel } from "@sourcesink/model";
import { readXmile, writeXmile } from "@sourcesink/xmile";

import { createTools, isToolError } from "./tools.js";

function created(tools = createTools()): { tools: ReturnType<typeof createTools>; id: string } {
  const res = tools.create({ name: "Test model" });
  if (isToolError(res)) throw new Error(res.error.message);
  return { tools, id: res.id };
}

describe("model lifecycle tools", () => {
  it("creates, patches and simulates a model; version and history follow", () => {
    const { tools, id } = created();

    const patch = tools.patch({
      id,
      patch: {
        ops: [
          { op: "add", kind: "stock", element: { name: "Tank", equation: "10" } },
          { op: "add", kind: "flow", element: { name: "drain", equation: "1" } },
          { op: "wire", flow: "drain", from: "Tank", to: null },
        ],
        rationale: "a tank draining at one unit per time",
      },
    });
    if (isToolError(patch)) throw new Error(patch.error.message);
    expect(patch.ok).toBe(true);
    expect(patch.version).toBe(2);
    expect(patch.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(patch.diff).toContain("## Added");
    expect(patch.diff).toContain("**stock** `Tank`");

    const model = tools.get({ id });
    if (isToolError(model)) throw new Error(model.error.message);
    expect(model.stocks[0].provenance).toEqual({ author: "ai" });

    const simulation = tools.simulate({
      id,
      run: { start: 0, stop: 3, dt: 1, saveEvery: 1 },
      series: ["Tank"],
    });
    if (isToolError(simulation)) throw new Error(simulation.error.message);
    expect(simulation.time).toEqual([0, 1, 2, 3]);
    expect(simulation.series.Tank).toEqual([10, 9, 8, 7]);

    const history = tools.history({ id });
    if (isToolError(history)) throw new Error(history.error.message);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      version: 2,
      rationale: "a tank draining at one unit per time",
      provenance: { author: "ai" },
    });
    expect(history[0].patch.ops).toHaveLength(3);

    const validation = tools.validate({ id });
    if (isToolError(validation)) throw new Error(validation.error.message);
    expect(validation.errors).toEqual([]);
  });

  it("does not apply a failing patch and does not bump the version", () => {
    const { tools, id } = created();
    const before = tools.get({ id });

    const result = tools.patch({
      id,
      patch: { ops: [{ op: "add", kind: "converter", element: { name: "broken", equation: "1 +" } }] },
    });
    if (isToolError(result)) throw new Error(result.error.message);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.stage === "parse")).toBe(true);
    expect(result.version).toBe(1);
    expect(tools.get({ id })).toEqual(before);
    expect(tools.history({ id })).toEqual([]);
  });

  it("dryRun reports the diff without changing model or version", () => {
    const { tools, id } = created();
    const result = tools.patch({
      id,
      dryRun: true,
      patch: { ops: [{ op: "add", kind: "stock", element: { name: "Water", equation: "5" } }] },
    });
    if (isToolError(result)) throw new Error(result.error.message);
    expect(result.ok).toBe(true);
    expect(result.diff).toContain("**stock** `Water`");
    expect(result.version).toBe(1);

    const model = tools.get({ id });
    if (isToolError(model)) throw new Error(model.error.message);
    expect(model.stocks).toEqual([]);
    expect(tools.history({ id })).toEqual([]);
  });

  it("returns structured errors for unknown models and bad input", () => {
    const tools = createTools();
    expect(tools.get({ id: "m99" })).toEqual({
      error: { code: "not_found", message: "no model with id 'm99'" },
    });
    const bad = tools.create({});
    if (!isToolError(bad)) throw new Error("expected an error");
    expect(bad.error.code).toBe("invalid_input");
  });

  it("thins simulated rows and limits series on request", () => {
    const { tools, id } = created();
    tools.patch({
      id,
      patch: {
        ops: [
          { op: "add", kind: "stock", element: { name: "A", equation: "10" } },
          { op: "add", kind: "flow", element: { name: "out", equation: "1" } },
          { op: "wire", flow: "out", from: "A" },
          { op: "add", kind: "converter", element: { name: "k", equation: "2" } },
        ],
      },
    });
    const sim = tools.simulate({
      id,
      run: { start: 0, stop: 4, dt: 1, saveEvery: 1 },
      every: 2,
      series: ["A", "k"],
    });
    if (isToolError(sim)) throw new Error(sim.error.message);
    expect(sim.time).toEqual([0, 2, 4]);
    expect(sim.series.A).toEqual([10, 8, 6]);
    expect(sim.series.k).toEqual([2, 2, 2]);
  });
});

describe("model.open / model.export", () => {
  it("opens a .xmile file and round-trips it through export", () => {
    const dir = mkdtempSync(join(tmpdir(), "sourcesink-mcp-"));
    try {
      const source = emptyModel("Opened");
      source.stocks = [{ kind: "stock", id: "p", name: "P", equation: "3" }];
      source.run = { start: 0, stop: 4, dt: 1, saveEvery: 1 };
      const path = join(dir, "opened.xmile");
      writeFileSync(path, writeXmile(source));

      const tools = createTools();
      const opened = tools.open({ path });
      if (isToolError(opened)) throw new Error(opened.error.message);
      expect(opened.version).toBe(1);
      expect(opened.warnings).toEqual([]);

      const xmile = tools.export({ id: opened.id, format: "xmile" });
      if (isToolError(xmile) || typeof xmile !== "string") throw new Error("export failed");
      const roundTripped = readXmile(xmile);
      expect(roundTripped.name).toBe("Opened");
      expect(roundTripped.stocks.map((s) => s.name)).toEqual(["P"]);

      const json = tools.export({ id: opened.id, format: "json" });
      if (isToolError(json) || typeof json !== "string") throw new Error("export failed");
      expect(JSON.parse(json).name).toBe("Opened");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a missing file as an io error", () => {
    const tools = createTools();
    const result = tools.open({ path: "/definitely/not/here.xmile" });
    if (!isToolError(result)) throw new Error("expected an error");
    expect(result.error.code).toBe("io");
  });
});

describe("model ensemble / explain", () => {
  function ensembleModel() {
    const { tools, id } = created();
    const result = tools.patch({
      id,
      patch: {
        ops: [
          { op: "add", kind: "stock", element: { name: "P", equation: "100" } },
          { op: "add", kind: "converter", element: { name: "k", equation: "0.1" } },
          { op: "add", kind: "flow", element: { name: "growth", equation: "P * k" } },
          { op: "wire", flow: "growth", from: null, to: "P" },
          { op: "setRun", run: { start: 0, stop: 2, dt: 1, saveEvery: 1 } },
        ],
      },
    });
    if (isToolError(result)) throw new Error(result.error.message);
    expect(result.ok).toBe(true);
    return { tools, id };
  }

  it("summarizes a two-value grid", () => {
    const { tools, id } = ensembleModel();
    const result = tools.ensemble({ id, grid: { k: [0.1, 0.2] }, series: ["P"] });
    if (isToolError(result)) throw new Error(result.error.message);
    expect(result.failed).toBe(0);
    expect(result.time).toEqual([0, 1, 2]);
    expect(result.summary.P.mean[2]).toBeCloseTo((121 + 144) / 2, 10);
    expect(result.summary.P.min[2]).toBeCloseTo(121, 10);
    expect(result.summary.P.max[2]).toBeCloseTo(144, 10);
  });

  it("explains a simple model with complete coverage", () => {
    const { tools, id } = created();
    tools.patch({
      id,
      patch: {
        ops: [
          { op: "add", kind: "stock", element: { name: "Water", equation: "10" } },
          { op: "add", kind: "flow", element: { name: "leak", equation: "1" } },
          { op: "wire", flow: "leak", from: "Water" },
        ],
      },
    });
    const result = tools.explain({ id });
    if (isToolError(result)) throw new Error(result.error.message);
    expect(result.markdown).toContain("## Overview");
    expect(result.markdown).toContain("Water");
    expect(result.coverage.complete).toBe(true);
    expect(result.loops).toEqual([]);
  });
});

const DECAY_XMILE = `<?xml version="1.0" encoding="UTF-8"?>
<xmile version="1.0">
  <header><name>Decay</name></header>
  <sim_specs method="Euler" time_units="day">
    <start>0</start><stop>10</stop><dt>0.0625</dt><saveEvery>1</saveEvery>
  </sim_specs>
  <model>
    <variables>
      <stock name="S">
        <eqn>10</eqn>
        <outflows><flow>loss</flow></outflows>
      </stock>
      <flow name="loss"><eqn>k * S</eqn></flow>
      <aux name="k"><eqn>0.3</eqn></aux>
    </variables>
  </model>
</xmile>`;

describe("model.calibrate / model.sensitivity", () => {
  function decay() {
    const tools = createTools();
    const created = tools.create({ xmile: DECAY_XMILE });
    if (isToolError(created)) throw new Error(created.error.message);
    return { tools, id: created.id };
  }

  it("fits a parameter, applies it as a patch and records provenance", () => {
    const { tools, id } = decay();
    const sim = tools.simulate({ id, series: ["S"] });
    if (isToolError(sim)) throw new Error(sim.error.message);

    const fit = tools.calibrate({
      id,
      data: { time: sim.time, series: { S: sim.series.S } },
      params: [{ name: "k", min: 0.1, max: 0.5 }],
      options: { method: "nelder-mead", maxEvaluations: 2000 },
      apply: true,
    });
    if (isToolError(fit)) throw new Error(fit.error.message);

    expect(fit.converged).toBe(true);
    expect(fit.applied).toBe(true);
    expect(fit.version).toBe(2);
    expect(fit.parameters.k).toBeCloseTo(0.3, 3);
    expect(fit.metrics.S.n).toBe(sim.time.length);

    const history = tools.history({ id });
    if (isToolError(history)) throw new Error(history.error.message);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      version: 2,
      provenance: { author: "ai", agent: "sourcesink-calibrate" },
    });

    const model = tools.get({ id });
    if (isToolError(model)) throw new Error(model.error.message);
    const k = model.converters.find((c) => c.name === "k");
    expect(Number(k?.equation)).toBeCloseTo(0.3, 3);
    expect(k?.provenance).toEqual({ author: "ai", agent: "sourcesink-calibrate" });
  });

  it("accepts CSV data and does not apply without apply=true", () => {
    const { tools, id } = decay();
    const fit = tools.calibrate({
      id,
      data: { csv: "day,S\n0,10\n1,8\n2,6\n" },
      params: [{ name: "k", min: 0.1, max: 0.5 }],
      options: { maxEvaluations: 500 },
    });
    if (isToolError(fit)) throw new Error(fit.error.message);
    expect(fit.applied).toBeUndefined();
    expect(fit.version).toBeUndefined();
    expect(tools.history({ id })).toEqual([]);
  });

  it("ranks parameters with Morris and runs Sobol'", () => {
    const { tools, id } = decay();
    const morrisResult = tools.sensitivity({
      id,
      params: [{ name: "k", min: 0.1, max: 0.5 }],
      metric: { series: "S", stat: "final" },
      trajectories: 4,
    });
    if (isToolError(morrisResult)) throw new Error(morrisResult.error.message);
    expect(morrisResult.parameters[0].name).toBe("k");
    expect(Number.isFinite(morrisResult.parameters[0].muStar)).toBe(true);
    expect(morrisResult.evaluations).toBe(8);

    const sobolResult = tools.sensitivity({
      id,
      params: [{ name: "k", min: 0.1, max: 0.5 }],
      metric: { series: "S", stat: "final" },
      method: "sobol",
      samples: 16,
      seed: 3,
    });
    if (isToolError(sobolResult)) throw new Error(sobolResult.error.message);
    expect(sobolResult.parameters[0].name).toBe("k");
    expect(sobolResult.evaluations).toBe(16 * 3);
  });

  it("returns structured schema and name errors", () => {
    const { tools, id } = decay();

    const emptyParams = tools.calibrate({ id, data: { csv: "t,S\n0,1\n" }, params: [] });
    if (!isToolError(emptyParams)) throw new Error("expected an error");
    expect(emptyParams.error.code).toBe("invalid_input");
    expect(emptyParams.error.message).toContain("params");

    const badRange = tools.calibrate({
      id,
      data: { csv: "t,S\n0,1\n" },
      params: [{ name: "k", min: 2, max: 1 }],
    });
    if (!isToolError(badRange)) throw new Error("expected an error");
    expect(badRange.error.code).toBe("invalid_input");
    expect(badRange.error.message).toContain("max");

    const badMetric = tools.sensitivity({
      id,
      params: [{ name: "k", min: 0.1, max: 0.5 }],
      metric: { series: "S", stat: "at" },
    });
    if (!isToolError(badMetric)) throw new Error("expected an error");
    expect(badMetric.error.code).toBe("invalid_input");

    const unknownSeries = tools.sensitivity({
      id,
      params: [{ name: "k", min: 0.1, max: 0.5 }],
      metric: { series: "Q", stat: "final" },
    });
    if (!isToolError(unknownSeries)) throw new Error("expected an error");
    expect(unknownSeries.error.code).toBe("invalid_input");
    expect(unknownSeries.error.message).toContain("unknown series");
  });
});
