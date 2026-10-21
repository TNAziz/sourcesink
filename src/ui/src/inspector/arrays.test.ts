import { describe, expect, it } from "vitest";
import { emptyModel } from "@sourcesink/model";

import { dimensionErrors, elementKeys, parseLabels } from "./arrays";

describe("array editing helpers", () => {
  it("parses labels from commas or lines, trimming and de-duplicating", () => {
    expect(parseLabels(" North, South ,\nEast,,North")).toEqual(["North", "South", "East"]);
  });

  it("flags bad dimension names, duplicates and empty label lists", () => {
    expect(dimensionErrors([{ name: "Region", values: ["N"] }])).toEqual([]);
    expect(dimensionErrors([{ name: "my dim", values: ["a"] }])[0]).toMatch(/letters, digits/);
    expect(dimensionErrors([{ name: "A", values: ["x"] }, { name: "a", values: ["y"] }])[0]).toMatch(/twice/);
    expect(dimensionErrors([{ name: "Empty", values: [] }])[0]).toMatch(/at least one label/);
  });

  it("lists element keys in row-major order", () => {
    const m = emptyModel();
    m.dimensions = [
      { kind: "dimension", id: "R", name: "R", values: ["N", "S"] },
      { kind: "dimension", id: "A", name: "A", values: ["Y", "O"] },
    ];
    expect(elementKeys(m, ["R", "A"])).toEqual(["N,Y", "N,O", "S,Y", "S,O"]);
  });
});
