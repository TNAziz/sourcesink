import { describe, expect, it } from "vitest";
import { emptyModel, type Model } from "@sourcesink/model";
import { autoLayout } from "./autoLayout";
import { overlappingPairs } from "./overlaps";

function model(layout: Model["layout"]): Model {
  const m = emptyModel("t");
  m.stocks = [
    { kind: "stock", id: "a", name: "A", equation: "1" },
    { kind: "stock", id: "b", name: "B", equation: "1" },
  ];
  m.converters = [{ kind: "converter", id: "k", name: "k", equation: "1" }];
  m.layout = layout;
  return m;
}

describe("overlappingPairs", () => {
  it("finds shapes drawn on top of each other", () => {
    const pairs = overlappingPairs(model({ A: { x: 0, y: 0 }, B: { x: 40, y: 10 }, k: { x: 600, y: 0 } }));
    expect(pairs).toEqual([["A", "B"]]);
  });

  it("finds none in a well-spaced layout", () => {
    expect(overlappingPairs(model({ A: { x: 0, y: 0 }, B: { x: 400, y: 0 }, k: { x: 0, y: 300 } }))).toEqual([]);
  });

  it("finds none after a tidy-up", () => {
    const m = model({ A: { x: 0, y: 0 }, B: { x: 10, y: 0 }, k: { x: 20, y: 0 } });
    expect(overlappingPairs(m).length).toBeGreaterThan(0);
    expect(overlappingPairs({ ...m, layout: autoLayout({ ...m, layout: {} }) })).toEqual([]);
  });
});
