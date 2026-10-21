import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import { runGauntlet } from "./gauntlet.js";
import type { ModelPatch } from "./types.js";

function base(): Model {
  const m = emptyModel("test");
  m.run = { start: 0, stop: 2, dt: 1, saveEvery: 1 };
  m.stocks = [{ kind: "stock", id: "pop", name: "Population", equation: "100", outflows: ["births"] }];
  m.flows = [{ kind: "flow", id: "births", name: "births", equation: "Population * growth rate" }];
  m.converters = [{ kind: "converter", id: "rate", name: "growth rate", equation: "0.1" }];
  return m;
}

const empty = (m: Model): ModelPatch => ({ ops: [] });

describe("runGauntlet", () => {
  it("returns ok and the patched model for a valid patch", () => {
    const result = runGauntlet(base(), {
      ops: [{ op: "update", name: "growth rate", changes: { equation: "0.2" } }],
    });
    expect(result.ok).toBe(true);
    expect(result.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(result.model!.converters[0].equation).toBe("0.2");
  });

  it("stops at the schema stage on a malformed op", () => {
    const result = runGauntlet(base(), {
      ops: [{ op: "remove", name: "x", extra: true } as never],
    });
    expect(result.ok).toBe(false);
    expect(result.model).toBeUndefined();
    expect(result.findings[0].stage).toBe("schema");
    expect(result.findings[0].message).toMatch(/unknown field 'extra'/);
  });

  it("stops at the apply stage on an unknown name", () => {
    const result = runGauntlet(base(), { ops: [{ op: "remove", name: "nope" }] });
    expect(result.ok).toBe(false);
    expect(result.findings[0].stage).toBe("apply");
    expect(result.findings[0].message).toMatch(/unknown element 'nope'/);
    expect(result.model).toBeUndefined();
  });

  it("stops at the parse stage on a truncated equation", () => {
    const result = runGauntlet(base(), {
      ops: [{ op: "update", name: "growth rate", changes: { equation: "x +" } }],
    });
    expect(result.ok).toBe(false);
    expect(result.findings[0].stage).toBe("parse");
    expect(result.findings[0].element).toBe("growth rate");
    expect(result.model).toBeDefined();
  });

  it("catches a reference to an unknown variable", () => {
    const result = runGauntlet(base(), {
      ops: [{ op: "update", name: "growth rate", changes: { equation: "unknown_var + 1" } }],
    });
    expect(result.ok).toBe(false);
    const finding = result.findings.find((f) => f.stage === "structure")!;
    expect(finding.message).toMatch(/unknown name 'unknown_var'/);
  });

  it("catches a connector into a stock", () => {
    const m = base();
    m.stocks.push({ kind: "stock", id: "city", name: "City", equation: "10" });
    m.connectors = [{ kind: "connector", id: "c", name: "City -> Population", from: "City", to: "Population" }];
    const result = runGauntlet(m, empty(m));
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.stage === "structure" && /points into stock/.test(f.message))).toBe(true);
  });

  it("catches a flow wired as an inflow by two stocks", () => {
    const m = base();
    m.stocks = [
      { kind: "stock", id: "a", name: "A", equation: "10", inflows: ["move"] },
      { kind: "stock", id: "b", name: "B", equation: "0", inflows: ["move"] },
    ];
    m.flows = [{ kind: "flow", id: "move", name: "move", equation: "1" }];
    const result = runGauntlet(m, empty(m));
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => /more than one stock/.test(f.message))).toBe(true);
  });

  it("catches a non-finite smoke run", () => {
    const m = emptyModel("nan");
    m.run = { start: 0, stop: 1, dt: 1, saveEvery: 1 };
    m.stocks = [{ kind: "stock", id: "a", name: "A", equation: "1/0*0" }];
    const result = runGauntlet(m, empty(m));
    expect(result.ok).toBe(false);
    const finding = result.findings.find((f) => f.stage === "smoke")!;
    expect(finding.element).toBe("A");
    expect(finding.message).toMatch(/non-finite/);
  });

  it("warns (without failing) for an unused converter", () => {
    const m = base();
    m.converters.push({ kind: "converter", id: "dead", name: "dead", equation: "1" });
    const result = runGauntlet(m, empty(m));
    expect(result.ok).toBe(true);
    expect(result.findings.some((f) => f.severity === "warning" && /not used/.test(f.message))).toBe(true);
  });

  it("reports a unit mismatch as a warning without failing the patch", () => {
    const m = base();
    m.run.timeUnits = "day";
    m.stocks[0].units = "mg/L";
    m.flows[0].units = "mg/L";
    const result = runGauntlet(m, empty(m));
    expect(result.ok).toBe(true);
    expect(result.findings.some((f) => f.stage === "units" && f.severity === "warning")).toBe(true);
  });

  it("does not parse a queue outflow's unused equation", () => {
    const m = emptyModel("queue");
    m.run = { start: 0, stop: 1, dt: 1, saveEvery: 1 };
    m.stocks = [{ kind: "stock", id: "q", name: "Q", equation: "5", queue: true, outflows: ["unload"] }];
    m.flows = [{ kind: "flow", id: "unload", name: "unload", equation: "" }];
    const result = runGauntlet(m, empty(m));
    expect(result.ok).toBe(true);
    expect(result.findings.some((f) => f.stage === "parse")).toBe(false);
  });
});
