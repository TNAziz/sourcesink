import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validate } from "@sourcesink/model";
import { readXmile } from "./index.ts";

const fixture = readFileSync(new URL("../tests/fixtures/basic.xmile", import.meta.url), "utf8");

describe("readXmile fixture parsing", () => {
  const model = readXmile(fixture);

  it("parses the header name", () => {
    expect(model.name).toBe("Rabbit Population");
  });

  it("parses sim_specs into a run spec", () => {
    expect(model.run).toEqual({
      start: 0,
      stop: 24,
      dt: 0.5,
      saveEvery: 0.5,
      integration: "rk4",
      timeUnits: "Months",
    });
  });

  it("parses stocks with equations, units, doc and flow links", () => {
    expect(model.stocks).toHaveLength(1);
    const rabbits = model.stocks[0];
    expect(rabbits.name).toBe("rabbits");
    expect(rabbits.equation).toBe("1000");
    expect(rabbits.units).toBe("rabbits");
    expect(rabbits.documentation).toBe("Total rabbit population");
    expect(rabbits.inflows).toEqual(["births"]);
    expect(rabbits.outflows).toEqual(["deaths"]);
  });

  it("parses flows with equations", () => {
    expect(model.flows.map((f) => f.name)).toEqual(["births", "deaths"]);
    expect(model.flows[0].equation).toBe("rabbits * birth_fraction");
    expect(model.flows[1].equation).toBe("rabbits * death_fraction");
  });

  it("parses aux into converters", () => {
    expect(model.converters).toHaveLength(1);
    expect(model.converters[0].name).toBe("birth_fraction");
    expect(model.converters[0].equation).toBe("0.02");
    expect(model.converters[0].units).toBe("1/Month");
  });

  it("keeps flow wiring on the stock, not as connectors", () => {
    const rabbits = model.stocks.find((s) => s.name === "rabbits")!;
    expect(rabbits.inflows).toEqual(["births"]);
    expect(rabbits.outflows).toEqual(["deaths"]);
    // The fixture has no <views>, so it declares no information links.
    expect(model.connectors).toEqual([]);
  });

  it("parses graphical functions", () => {
    expect(model.graphFunctions).toHaveLength(1);
    const gf = model.graphFunctions[0];
    expect(gf.name).toBe("seasonal_factor");
    expect(gf.points).toEqual([
      { x: 0, y: 1 },
      { x: 6, y: 0.8 },
      { x: 12, y: 1.2 },
      { x: 18, y: 0.9 },
      { x: 24, y: 1 },
    ]);
    expect(gf.interpolation).toBe("linear");
    expect(gf.extrapolation).toBe("clip");
  });

  it("parses dimensions and their elements", () => {
    expect(model.dimensions).toHaveLength(1);
    expect(model.dimensions[0].name).toBe("Region");
    expect(model.dimensions[0].values).toEqual(["North", "South", "East"]);
  });

  it("produces a valid model", () => {
    expect(validate(model)).toEqual([]);
  });
});