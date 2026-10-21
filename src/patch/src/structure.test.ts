import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import { structuralFindings } from "./structure.js";

function model(): Model {
  const m = emptyModel();
  m.stocks = [{ kind: "stock", id: "s", name: "Tank", equation: "10", inflows: [], outflows: ["drain"] }];
  m.flows = [{ kind: "flow", id: "drain", name: "drain", equation: "Tank * k * scale" }];
  m.converters = [
    { kind: "converter", id: "k", name: "k", equation: "0.1" },
    { kind: "converter", id: "scale", name: "scale", equation: "2" },
  ];
  return m;
}

const linkWarnings = (m: Model) =>
  structuralFindings(m).filter((f) => f.severity === "warning" && /connector/.test(f.message));

describe("structuralFindings — undrawn links", () => {
  it("summarises a model that draws no connectors at all", () => {
    const found = linkWarnings(model());
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/no connectors .* 3 links/);
  });

  it("names the unlinked inputs per element once some links are drawn", () => {
    const m = model();
    m.connectors = [{ kind: "connector", id: "c", name: "k -> drain", from: "k", to: "drain" }];
    const found = linkWarnings(m);
    expect(found).toHaveLength(1);
    expect(found[0].element).toBe("drain");
    expect(found[0].message).toBe("'drain' uses 'Tank', 'scale' without a connector");
  });

  it("is quiet when every link is drawn", () => {
    const m = model();
    m.connectors = ["Tank", "k", "scale"].map((from) => ({
      kind: "connector" as const,
      id: from,
      name: `${from} -> drain`,
      from,
      to: "drain",
    }));
    expect(linkWarnings(m)).toEqual([]);
  });
});
