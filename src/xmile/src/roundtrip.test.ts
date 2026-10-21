import { describe, expect, it } from "vitest";
import { emptyModel, validate, type Model } from "@sourcesink/model";
import { readXmile, writeXmile } from "./index.ts";

const mins = (m: Model) => ({
  name: m.name,
  stocks: m.stocks.map((s) => ({ name: s.name, equation: s.equation })),
  flows: m.flows.map((f) => ({ name: f.name, equation: f.equation })),
  converters: m.converters.map((c) => ({ name: c.name, equation: c.equation })),
  connectors: m.connectors.map((c) => `${c.from}->${c.to}`).sort(),
  run: { ...m.run },
});

describe("writeXmile -> readXmile round-trip", () => {
  it("preserves names, equations, connectors and run spec", () => {
    const model: Model = {
      name: "Test Model",
      stocks: [
        {
          kind: "stock",
          id: "Population",
          name: "Population",
          equation: "100",
          units: "people",
          inflows: ["births"],
          outflows: ["deaths"],
        },
      ],
      flows: [
        { kind: "flow", id: "births", name: "births", equation: "Population * birth_fraction" },
        { kind: "flow", id: "deaths", name: "deaths", equation: "Population * death_fraction" },
      ],
      converters: [
        { kind: "converter", id: "birth_fraction", name: "birth_fraction", equation: "0.02" },
      ],
      connectors: [
        { kind: "connector", id: "b", name: "Population -> births", from: "Population", to: "births" },
        { kind: "connector", id: "d", name: "Population -> deaths", from: "Population", to: "deaths" },
      ],
      graphFunctions: [],
      dimensions: [],
      arrayed: {},
      run: { start: 0, stop: 12, dt: 0.25, saveEvery: 1, integration: "euler", timeUnits: "Year" },
    };

    const xml = writeXmile(model);
    const out = readXmile(xml);

    expect(out.name).toBe("Test Model");
    expect(mins(model)).toEqual(mins(out));
    expect(out.stocks[0].units).toBe("people");
    expect(out.stocks[0].inflows).toEqual(["births"]);
    expect(out.stocks[0].outflows).toEqual(["deaths"]);
    expect(validate(out)).toEqual([]);
  });

  it("round-trips graphical functions and dimensions", () => {
    const model: Model = {
      name: "Arrayed",
      stocks: [],
      flows: [],
      converters: [],
      connectors: [],
      graphFunctions: [
        {
          kind: "graphFunction",
          id: "seasonal",
          name: "seasonal",
          points: [
            { x: 0, y: 1 },
            { x: 6, y: 0.8 },
            { x: 12, y: 1.2 },
          ],
          interpolation: "linear",
          extrapolation: "clip",
        },
      ],
      dimensions: [
        { kind: "dimension", id: "Region", name: "Region", values: ["North", "South", "East"] },
      ],
      arrayed: {},
      run: { start: 0, stop: 12, dt: 0.25, saveEvery: 1 },
    };

    const out = readXmile(writeXmile(model));

    expect(out.graphFunctions).toHaveLength(1);
    expect(out.graphFunctions[0].name).toBe("seasonal");
    expect(out.graphFunctions[0].points).toEqual([
      { x: 0, y: 1 },
      { x: 6, y: 0.8 },
      { x: 12, y: 1.2 },
    ]);
    expect(out.graphFunctions[0].interpolation).toBe("linear");
    expect(out.graphFunctions[0].extrapolation).toBe("clip");
    expect(out.dimensions).toHaveLength(1);
    expect(out.dimensions[0].name).toBe("Region");
    expect(out.dimensions[0].values).toEqual(["North", "South", "East"]);
    expect(validate(out)).toEqual([]);
  });
});
describe("conveyors, queues and leaks", () => {
  it("round-trip through <conveyor><len>, <queue/> and <leak/>", () => {
    const model: Model = {
      ...emptyModel("Pipeline"),
      stocks: [
        { kind: "stock", id: "line", name: "line", equation: "5", queue: true, outflows: ["load"] },
        {
          kind: "stock",
          id: "belt",
          name: "belt",
          equation: "8",
          conveyor: { transitTime: "ride_time * 2" },
          inflows: ["load"],
          outflows: ["unload", "spill"],
        },
      ],
      flows: [
        { kind: "flow", id: "load", name: "load", equation: "4" },
        { kind: "flow", id: "unload", name: "unload", equation: "" },
        { kind: "flow", id: "spill", name: "spill", equation: "0.1", leak: true },
      ],
      converters: [{ kind: "converter", id: "ride_time", name: "ride_time", equation: "3" }],
    };
    const xml = writeXmile(model);
    expect(xml).toContain("<len>ride_time * 2</len>");
    const back = readXmile(xml);
    expect(back.stocks.map((s) => [s.name, s.queue ?? false, s.conveyor?.transitTime])).toEqual([
      ["line", true, undefined],
      ["belt", false, "ride_time * 2"],
    ]);
    expect(readXmile(writeXmile({ ...model, stocks: [{ ...model.stocks[0], queue: undefined, oven: { capacity: "3", fillTime: "DT" } }] })).stocks[0].oven).toEqual({
      capacity: "3",
      fillTime: "DT",
    });
    expect(back.flows.map((f) => [f.name, f.leak ?? false])).toEqual([
      ["load", false],
      ["unload", false],
      ["spill", true],
    ]);
  });
});

describe("views: layout and information connectors", () => {
  const xml = `<?xml version="1.0"?>
<xmile version="1.0" xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0">
  <header><name>v</name></header>
  <sim_specs><start>0</start><stop>1</stop><dt>1</dt></sim_specs>
  <model>
    <variables>
      <stock name="Water Level"><eqn>1</eqn><inflow>rain</inflow></stock>
      <flow name="rain"><eqn>rate * Water_Level</eqn></flow>
      <aux name="rate"><eqn>0.5</eqn></aux>
    </variables>
    <views><view type="stock_flow">
      <stock name="Water_Level" x="100" y="50"/>
      <flow name="rain" x="20" y="50"/>
      <aux name="rate" x="20" y="120"/>
      <connector uid="1"><from>rate</from><to>rain</to></connector>
      <connector from="Water_Level" to="rain"/>
    </view></views>
  </model>
</xmile>`;

  it("reads positions and connectors, matching view names to elements", () => {
    const m = readXmile(xml);
    expect(m.layout).toEqual({
      "Water Level": { x: 100, y: 50 },
      rain: { x: 20, y: 50 },
      rate: { x: 20, y: 120 },
    });
    expect(m.connectors.map((c) => `${c.from}->${c.to}`)).toEqual([
      "rate->rain",
      "Water Level->rain",
    ]);
    expect(m.stocks[0].inflows).toEqual(["rain"]);
    expect(m.stocks[0].outflows).toEqual([]);
  });

  it("round-trips positions and connectors without turning them into flows", () => {
    const m = readXmile(writeXmile(readXmile(xml)));
    expect(m.layout?.["Water Level"]).toEqual({ x: 100, y: 50 });
    expect(m.connectors).toHaveLength(2);
    expect(m.stocks[0].inflows).toEqual(["rain"]);
    expect(m.stocks[0].outflows).toEqual([]);
  });
});
