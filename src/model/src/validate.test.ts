import { describe, expect, it } from "vitest";

import { emptyModel, validate, type Model } from "./index.js";

function twoTanks(): Model {
  return {
    ...emptyModel("tanks"),
    stocks: [
      { kind: "stock", id: "A", name: "A", equation: "10", outflows: ["move"] },
      { kind: "stock", id: "B", name: "B", equation: "0", inflows: ["move"] },
    ],
    flows: [{ kind: "flow", id: "move", name: "move", equation: "A * 0.1" }],
    connectors: [{ kind: "connector", id: "c", name: "A -> move", from: "A", to: "move" }],
  };
}

describe("validate", () => {
  it("accepts a well-formed model", () => {
    expect(validate(twoTanks())).toEqual([]);
  });

  it("rejects a connector into a stock", () => {
    const m = twoTanks();
    m.connectors.push({ kind: "connector", id: "x", name: "move -> B", from: "move", to: "B" });
    expect(validate(m)).toEqual(["connector 'move -> B' points into stock 'B' (only flows change a stock)"]);
  });

  it("rejects a flow that fills, or drains, two stocks", () => {
    const m = twoTanks();
    m.stocks.push({ kind: "stock", id: "C", name: "C", equation: "0", inflows: ["move"], outflows: ["move"] });
    expect(validate(m)).toEqual([
      "flow 'move' is an inflow of both 'B' and 'C'",
      "flow 'move' is an outflow of both 'A' and 'C'",
    ]);
  });

  it("accepts connectors that name single elements of an array", () => {
    const m = twoTanks();
    m.dimensions = [{ kind: "dimension", id: "R", name: "R", values: ["N", "S"] }];
    m.converters = [{ kind: "converter", id: "k", name: "k", equation: "1" }];
    m.arrayed = { k: { dimensions: ["R"] } };
    m.connectors.push({ kind: "connector", id: "y", name: "k[S] -> move", from: "k[S]", to: "move" });
    expect(validate(m)).toEqual([]);
    m.connectors.push({ kind: "connector", id: "z", name: "k[E] -> move", from: "k[E]", to: "move" });
    expect(validate(m)).toEqual(["connector 'k[E] -> move' references unknown 'k[E]'"]);
  });
});
