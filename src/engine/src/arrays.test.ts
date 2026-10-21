import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import { expandArrays } from "./arrays.js";
import { simulate } from "./simulate.js";

/** Two regions growing at their own rates; a national total. */
function regional(extra: (m: Model) => void = () => {}): Model {
  const m: Model = {
    ...emptyModel("regions"),
    dimensions: [{ kind: "dimension", id: "Region", name: "Region", values: ["North", "South"] }],
    stocks: [{ kind: "stock", id: "Population", name: "Population", equation: "100", inflows: ["births"] }],
    flows: [{ kind: "flow", id: "births", name: "births", equation: "Population[Region] * rate[Region]" }],
    converters: [
      { kind: "converter", id: "rate", name: "rate", equation: "0.1" },
      { kind: "converter", id: "total", name: "total", equation: "SUM(Population[*])" },
    ],
    arrayed: {
      Population: { dimensions: ["Region"], elements: { South: "50" } },
      births: { dimensions: ["Region"] },
      rate: { dimensions: ["Region"], elements: { South: "0.2" } },
    },
    run: { start: 0, stop: 2, dt: 1, saveEvery: 1 },
  };
  extra(m);
  return m;
}

describe("arrays", () => {
  it("expand each arrayed element into one scalar per label", () => {
    const flat = expandArrays(regional());
    expect(flat.stocks.map((s) => [s.name, s.equation, s.inflows])).toEqual([
      ["Population[North]", "100", ["births[North]"]],
      ["Population[South]", "50", ["births[South]"]],
    ]);
    expect(flat.flows.map((f) => f.equation)).toEqual([
      '"Population[North]" * "rate[North]"',
      '"Population[South]" * "rate[South]"',
    ]);
    expect(flat.converters.find((c) => c.name === "total")!.equation).toBe('SUM("Population[North]", "Population[South]")');
  });

  it("simulate apply-to-all and per-element equations", () => {
    const r = simulate(regional());
    expect(r.series["Population[North]"]).toEqual([100, 110, 121]);
    expect(r.series["Population[South]"].map((x) => Math.round(x * 1e9) / 1e9)).toEqual([50, 60, 72]);
    expect(r.series.total.at(-1)).toBeCloseTo(121 + 72);
  });

  it("read a bare arrayed name as the matching element", () => {
    const r = simulate(regional((m) => (m.flows[0].equation = "Population * rate")));
    expect(r.series["Population[South]"].at(-1)).toBeCloseTo(72);
  });

  it("pick single elements by label, and ARRAYSUM", () => {
    const r = simulate(
      regional((m) => {
        m.converters.push({ kind: "converter", id: "south", name: "south", equation: "Population[South]" });
        m.converters.push({ kind: "converter", id: "t2", name: "t2", equation: "ARRAYSUM(Population[*])" });
      }),
    );
    expect(r.series.south[0]).toBe(50);
    expect(r.series.t2[0]).toBe(150);
  });

  it("handle two dimensions with partial wildcards", () => {
    const m: Model = {
      ...emptyModel("grid"),
      dimensions: [
        { kind: "dimension", id: "Region", name: "Region", values: ["North", "South"] },
        { kind: "dimension", id: "Age", name: "Age", values: ["Young", "Old"] },
      ],
      converters: [
        { kind: "converter", id: "pop", name: "pop", equation: "1" },
        { kind: "converter", id: "north", name: "north", equation: "SUM(pop[North, *])" },
        { kind: "converter", id: "byRegion", name: "byRegion", equation: "SUM(pop[Region, *])" },
      ],
      arrayed: {
        pop: { dimensions: ["Region", "Age"], elements: { "North,Old": "3", "South,Young": "5" } },
        byRegion: { dimensions: ["Region"] },
      },
      run: { start: 0, stop: 0, dt: 1, saveEvery: 1 },
    };
    const r = simulate(m);
    expect(r.series.north[0]).toBe(1 + 3);
    expect(r.series["byRegion[South]"][0]).toBe(5 + 1);
  });

  it("sum arrayed flows into a scalar stock", () => {
    const r = simulate(
      regional((m) => {
        m.stocks.push({ kind: "stock", id: "Nation", name: "Nation", equation: "0", inflows: ["births"] });
      }),
    );
    expect(r.series.Nation[1]).toBeCloseTo(10 + 10);
  });

  it("run arrayed conveyors with per-element transit times", () => {
    const m: Model = {
      ...emptyModel("pipes"),
      dimensions: [{ kind: "dimension", id: "Pipe", name: "Pipe", values: ["A", "B"] }],
      stocks: [
        { kind: "stock", id: "pipe", name: "pipe", equation: "0", conveyor: { transitTime: "lag[Pipe]" }, inflows: ["feed"], outflows: ["out"] },
      ],
      flows: [
        { kind: "flow", id: "feed", name: "feed", equation: "1" },
        { kind: "flow", id: "out", name: "out", equation: "" },
      ],
      converters: [{ kind: "converter", id: "lag", name: "lag", equation: "1" }],
      arrayed: {
        pipe: { dimensions: ["Pipe"] },
        feed: { dimensions: ["Pipe"] },
        out: { dimensions: ["Pipe"] },
        lag: { dimensions: ["Pipe"], elements: { B: "3" } },
      },
      run: { start: 0, stop: 4, dt: 1, saveEvery: 1 },
    };
    const r = simulate(m);
    expect(r.series["out[A]"]).toEqual([0, 1, 1, 1, 1]);
    expect(r.series["out[B]"]).toEqual([0, 0, 0, 1, 1]);
  });

  it("explain mistakes", () => {
    expect(() => simulate(regional((m) => m.converters.push({ kind: "converter", id: "x", name: "x", equation: "Population * 2" })))).toThrow(
      /needs subscripts/,
    );
    expect(() => simulate(regional((m) => (m.converters[1].equation = "Population[North, South]")))).toThrow(/1 dimension/);
    expect(() => simulate(regional((m) => (m.converters[1].equation = "Population[East]")))).toThrow(/not a label/);
    expect(() => simulate(regional((m) => (m.arrayed.rate.dimensions = ["Colour"])))).toThrow(/unknown dimension/);
  });
});
