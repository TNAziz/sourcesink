import { describe, expect, it } from "vitest";
import { emptyModel, type Model } from "@sourcesink/model";
import { constantConverters, isConstantEquation, withoutConstants } from "./parameters";

function model(): Model {
  const m = emptyModel();
  m.converters = [
    { kind: "converter", id: "a", name: "rate", equation: "0.3" },
    { kind: "converter", id: "b", name: "Cap", equation: " 1e3 " },
    { kind: "converter", id: "c", name: "ratio", equation: "rate * 2" },
  ];
  m.connectors = [
    { kind: "connector", id: "k1", name: "rate -> ratio", from: "rate", to: "ratio" },
  ];
  return m;
}

describe("parameters", () => {
  it("recognises numeric literals only", () => {
    expect(isConstantEquation("-2.5")).toBe(true);
    expect(isConstantEquation("")).toBe(false);
    expect(isConstantEquation("2 * 3")).toBe(false);
    expect(isConstantEquation("TIME")).toBe(false);
  });

  it("lists constants sorted by name", () => {
    expect(constantConverters(model()).map((c) => c.name)).toEqual(["Cap", "rate"]);
  });

  it("leaves arrayed converters to the array panels", () => {
    const m = model();
    m.arrayed = { rate: { dimensions: ["Region"] } };
    expect(constantConverters(m).map((c) => c.name)).toEqual(["Cap"]);
  });

  it("drops constants and their connectors for drawing", () => {
    const shown = withoutConstants(model());
    expect(shown.converters.map((c) => c.name)).toEqual(["ratio"]);
    expect(shown.connectors).toEqual([]);
  });
});
