import { describe, expect, it } from "vitest";

import { missingConnectors, withInferredConnectors } from "./wiring.js";
import { logisticModel } from "./test-util.js";

describe("missingConnectors", () => {
  it("lists every link an equation implies when the diagram has none", () => {
    const links = missingConnectors(logisticModel());
    expect(links).toEqual([
      { from: "r", to: "births" },
      { from: "Population", to: "births" },
      { from: "crowding", to: "births" },
      { from: "Population", to: "crowding" },
      { from: "carrying_capacity", to: "crowding" },
    ]);
  });

  it("skips links that are already drawn, matching names loosely", () => {
    const m = logisticModel();
    m.connectors = [{ kind: "connector", id: "c1", name: "r -> births", from: "R", to: "Births" }];
    expect(missingConnectors(m).map((l) => l.from)).not.toContain("r");
  });

  it("never links into stocks or from built-ins and the clock", () => {
    const m = logisticModel();
    m.stocks[0].equation = "carrying_capacity / 10";
    m.converters.push({ kind: "converter", id: "t", name: "t", equation: "SIN(TIME) + DT" });
    const links = missingConnectors(m);
    expect(links.some((l) => l.to === "Population")).toBe(false);
    expect(links.some((l) => l.to === "t")).toBe(false);
  });

  it("ignores unparseable equations", () => {
    const m = logisticModel();
    m.flows[0].equation = "r * (";
    expect(missingConnectors(m).some((l) => l.to === "births")).toBe(false);
  });
});

describe("withInferredConnectors", () => {
  it("adds one connector per missing link, with unique ids", () => {
    const m = withInferredConnectors(logisticModel());
    expect(m.connectors).toHaveLength(5);
    expect(new Set(m.connectors.map((c) => c.id)).size).toBe(5);
    expect(missingConnectors(m)).toEqual([]);
  });

  it("returns the same model when nothing is missing", () => {
    const m = withInferredConnectors(logisticModel());
    expect(withInferredConnectors(m)).toBe(m);
  });
});
