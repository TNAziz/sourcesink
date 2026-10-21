import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";
import { readXmile } from "@sourcesink/xmile";

import { checkUnits } from "./check.js";

function modelWith(units: { stock: string; flow: string; time: string }): Model {
  const m = emptyModel("flow check");
  m.run = { start: 0, stop: 2, dt: 1, saveEvery: 1, timeUnits: units.time };
  m.stocks = [{ kind: "stock", id: "s", name: "S", equation: "10", units: units.stock, outflows: ["f"] }];
  m.flows = [{ kind: "flow", id: "f", name: "f", equation: "k * S", units: units.flow }];
  m.converters = [{ kind: "converter", id: "k", name: "k", equation: "0.1", units: "1/day" }];
  return m;
}

describe("checkUnits", () => {
  it("accepts a correct Streeter-Phelps model", () => {
    const file = fileURLToPath(new URL("../../../examples/environmental/streeter-phelps.xmile", import.meta.url));
    const model = readXmile(readFileSync(file, "utf8"));
    expect(checkUnits(model)).toEqual([]);
  });

  it("flags a flow declared as a concentration instead of a rate", () => {
    const findings = checkUnits(modelWith({ stock: "mg/L", flow: "mg/L", time: "day" }));
    expect(findings.some((f) => f.element === "f" && /should be mg\/L\/day/.test(f.message))).toBe(true);
  });

  it("flags a per-year rate used in a per-day model, naming the factor", () => {
    const m = modelWith({ stock: "mg/L", flow: "mg/L/day", time: "day" });
    m.converters[0].units = "1/year";
    const findings = checkUnits(m);
    expect(findings.some((f) => f.element === "f" && /factor of 365\.25/.test(f.message))).toBe(true);
  });

  it("flags adding mg and g, naming the missing factor", () => {
    const m = emptyModel("mixed scales");
    m.stocks = [{ kind: "stock", id: "s", name: "S", equation: "1", units: "g" }];
    m.converters = [
      { kind: "converter", id: "a", name: "a", equation: "1", units: "mg" },
      { kind: "converter", id: "b", name: "b", equation: "1", units: "g" },
      { kind: "converter", id: "c", name: "c", equation: "a + b", units: "g" },
    ];
    const findings = checkUnits(m);
    expect(findings.some((f) => f.element === "c" && /factor of 1000/.test(f.message))).toBe(true);
  });

  it("says nothing when the model has no units at all", () => {
    const m = emptyModel("no units");
    m.stocks = [{ kind: "stock", id: "s", name: "S", equation: "10", outflows: ["f"] }];
    m.flows = [{ kind: "flow", id: "f", name: "f", equation: "0.1 * S" }];
    expect(checkUnits(m)).toEqual([]);
  });

  it("reports an unparseable unit string", () => {
    const m = modelWith({ stock: "mg/L", flow: "mg/L/day", time: "day" });
    m.converters[0].units = "mg/";
    const findings = checkUnits(m);
    expect(findings.some((f) => f.element === "k" && /invalid units/.test(f.message))).toBe(true);
  });

  it("checks the base equation of an arrayed element only", () => {
    const m = modelWith({ stock: "mg/L", flow: "mg/L/day", time: "day" });
    m.arrayed = { f: { dimensions: [], elements: { "": "k" } } };
    expect(checkUnits(m).some((f) => f.element === "f")).toBe(false);
  });

  it("produces no findings for the environmental examples", () => {
    const dir = fileURLToPath(new URL("../../../examples/environmental", import.meta.url));
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".xmile"))) {
      const model = readXmile(readFileSync(`${dir}/${file}`, "utf8"));
      expect(checkUnits(model), file).toEqual([]);
    }
  });

  it("never throws over the evaluation corpus", () => {
    const dir = fileURLToPath(new URL("../../../tests/corpus/models", import.meta.url));
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".xmile"))) {
      const model = readXmile(readFileSync(`${dir}/${file}`, "utf8"));
      expect(() => checkUnits(model), file).not.toThrow();
    }
  });
});
