import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import { modelUnitFindings, unitWarningsFor } from "./units";

function wrongFlow(): Model {
  const m = emptyModel("units");
  m.run = { start: 0, stop: 2, dt: 1, saveEvery: 1, timeUnits: "day" };
  m.stocks = [{ kind: "stock", id: "s", name: "S", equation: "10", units: "mg/L", outflows: ["f"] }];
  m.flows = [{ kind: "flow", id: "f", name: "f", equation: "k * S", units: "mg/L" }];
  m.converters = [{ kind: "converter", id: "k", name: "k", equation: "0.1", units: "1/day" }];
  return m;
}

describe("inspector unit warnings", () => {
  it("returns the element's messages and nothing for a clean element", () => {
    const m = wrongFlow();
    expect(unitWarningsFor(m, "f").some((message) => /should be mg\/L\/day/.test(message))).toBe(true);
    expect(unitWarningsFor(m, "k")).toEqual([]);
  });

  it("memoizes the whole-model check per model object", () => {
    const m = wrongFlow();
    expect(modelUnitFindings(m)).toBe(modelUnitFindings(m));
    expect(modelUnitFindings(wrongFlow())).not.toBe(modelUnitFindings(m));
  });
});
