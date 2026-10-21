import { describe, expect, it } from "vitest";
import { emptyModel } from "@sourcesink/model";
import type { Model } from "@sourcesink/model";

import { analyzeConnections } from "./connections";

/** A model with a converter that reads two names, one wired and one not. */
function buildModel(): Model {
  const m = emptyModel("wiring");
  m.stocks.push({
    kind: "stock",
    id: "s-deer",
    name: "Deer",
    equation: "100",
    inflows: [],
    outflows: [],
  });
  m.converters.push(
    { kind: "converter", id: "c-birth", name: "birth rate", equation: "Deer * rate", units: "1/year" },
    { kind: "converter", id: "c-rate", name: "rate", equation: "0.2" },
    { kind: "converter", id: "c-spare", name: "spare", equation: "1" },
  );
  m.connectors.push({
    kind: "connector",
    id: "k-spare",
    name: "spare -> birth rate",
    from: "spare",
    to: "birth rate",
  });
  return m;
}

describe("analyzeConnections", () => {
  it("flags referenced-but-unconnected names and unused connectors", () => {
    const result = analyzeConnections(buildModel(), "c-birth");
    expect(result.missing.map((x) => x.fromName)).toEqual(["Deer", "rate"]);
    expect(result.missing.map((x) => x.fromId)).toEqual(["s-deer", "c-rate"]);
    expect(result.unused.map((x) => x.fromName)).toEqual(["spare"]);
  });

  it("does not flag a reference once a connector into it exists", () => {
    const m = buildModel();
    m.connectors.push({
      kind: "connector",
      id: "k-rate",
      name: "rate -> birth rate",
      from: "rate",
      to: "birth rate",
    });
    const result = analyzeConnections(m, "c-birth");
    expect(result.missing.map((x) => x.fromName)).toEqual(["Deer"]);
    expect(result.unused.map((x) => x.fromName)).toEqual(["spare"]);
  });

  it("ignores built-ins, the clock and constants", () => {
    const m = buildModel();
    m.converters.find((c) => c.id === "c-birth")!.equation =
      "SMTH1(Deer, TIME) * PI * rate";
    const result = analyzeConnections(m, "c-birth");
    expect(result.missing.map((x) => x.fromName)).toEqual(["Deer", "rate"]);
  });

  it("matches names written with underscores against spaced element names", () => {
    const m = buildModel();
    m.converters.push({ kind: "converter", id: "c-feed", name: "feed rate", equation: "1" });
    m.converters.find((c) => c.id === "c-birth")!.equation = "feed_rate * rate";
    m.connectors.push({
      kind: "connector",
      id: "k-feed",
      name: "feed rate -> birth rate",
      from: "feed rate",
      to: "birth rate",
    });
    const result = analyzeConnections(m, "c-birth");
    expect(result.missing.map((x) => x.fromName)).toEqual(["rate"]);
  });

  it("never treats the element's own name as a missing input", () => {
    const m = buildModel();
    m.converters.find((c) => c.id === "c-birth")!.equation = "birth rate * 5";
    expect(analyzeConnections(m, "c-birth").missing).toEqual([]);
  });

  it("returns nothing for an unparseable equation", () => {
    const m = buildModel();
    m.converters.find((c) => c.id === "c-birth")!.equation = "Deer *";
    expect(analyzeConnections(m, "c-birth")).toEqual({ missing: [], unused: [] });
  });

  it("returns nothing for an unknown element", () => {
    expect(analyzeConnections(buildModel(), "nope")).toEqual({ missing: [], unused: [] });
  });
});
