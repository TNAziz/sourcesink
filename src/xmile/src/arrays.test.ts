import { describe, expect, it } from "vitest";
import { emptyModel, type Model } from "@sourcesink/model";
import { simulate } from "@sourcesink/engine";
import { readXmile, writeXmile } from "./index.ts";

function twoDimensional(): Model {
  return {
    ...emptyModel("Regional population"),
    dimensions: [
      { kind: "dimension", id: "Region", name: "Region", values: ["North", "South"] },
      { kind: "dimension", id: "Age", name: "Age", values: ["Young", "Old"] },
    ],
    stocks: [{ kind: "stock", id: "Population", name: "Population", equation: "100", inflows: ["births"] }],
    flows: [
      { kind: "flow", id: "births", name: "births", equation: "Population[Region,Age] * rate[Region,Age]" },
    ],
    converters: [{ kind: "converter", id: "rate", name: "rate", equation: "0.1" }],
    arrayed: {
      Population: { dimensions: ["Region", "Age"], elements: { "North,Old": "50" } },
      births: { dimensions: ["Region", "Age"] },
      rate: { dimensions: ["Region", "Age"], elements: { "North,Old": "0.2", "South,Young": "0.3" } },
    },
    run: { start: 0, stop: 2, dt: 1, saveEvery: 1 },
  };
}

const equations = (m: Model) => ({
  stocks: m.stocks.map((s) => [s.name, s.equation]),
  flows: m.flows.map((f) => [f.name, f.equation]),
  converters: m.converters.map((c) => [c.name, c.equation]),
});

describe("arrays in XMILE", () => {
  it("round-trips a 2-D arrayed model with apply-to-all and element overrides", () => {
    const model = twoDimensional();
    const xml = writeXmile(model);
    const out = readXmile(xml);

    expect(out.dimensions).toEqual(model.dimensions);
    expect(out.arrayed).toEqual(model.arrayed);
    expect(equations(out)).toEqual(equations(model));

    const before = simulate(model);
    const after = simulate(out);
    expect(Object.keys(after.series).sort()).toEqual(Object.keys(before.series).sort());
    for (const key of Object.keys(before.series)) expect(after.series[key]).toEqual(before.series[key]);
  });

  it("writes the standard dimensions child form and subscripted element equations", () => {
    const xml = writeXmile(twoDimensional());
    expect(xml).toContain("<dimensions>");
    expect(xml).toMatch(/<stock name="Population">\s*<dimensions>\s*<dim name="Region"\/>\s*<dim name="Age"\/>\s*<\/dimensions>/);
    expect(xml).toMatch(/<element subscript="North, Old">\s*<eqn>0\.2<\/eqn>\s*<\/element>/);
    expect(xml).not.toContain('dimensions="Region,Age"');
  });

  it("reads a hand-written standard-form snippet and simulates it", () => {
    const xml = `<?xml version="1.0"?>
<xmile version="1.0" xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0">
  <header><name>Standard arrays</name></header>
  <sim_specs><start>0</start><stop>2</stop><dt>1</dt></sim_specs>
  <dimensions>
    <dim name="Region" size="2"><elem name="North"/><elem name="South"/></dim>
  </dimensions>
  <model>
    <variables>
      <aux name="rate">
        <dimensions><dim name="Region"/></dimensions>
        <eqn>0.1</eqn>
        <element subscript="North"><eqn>0.2</eqn></element>
      </aux>
      <aux name="total"><eqn>SUM(rate[*])</eqn></aux>
    </variables>
  </model>
</xmile>`;
    const model = readXmile(xml);
    expect(model.arrayed.rate).toEqual({ dimensions: ["Region"], elements: { North: "0.2" } });
    expect(model.converters.find((c) => c.name === "rate")!.equation).toBe("0.1");
    const r = simulate(model);
    expect(r.series["rate[North]"]).toEqual([0.2, 0.2, 0.2]);
    expect(r.series["rate[South]"]).toEqual([0.1, 0.1, 0.1]);
    for (const x of r.series.total) expect(x).toBeCloseTo(0.3);
  });

  it("sets an empty apply-to-all equation when an array has only element children", () => {
    const xml = `<xmile version="1.0" xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0">
  <sim_specs><start>0</start><stop>1</stop><dt>1</dt></sim_specs>
  <dimensions><dim name="Region"><elem name="North"/><elem name="South"/></dim></dimensions>
  <model><variables>
    <aux name="base">
      <dimensions><dim name="Region"/></dimensions>
      <element subscript="North"><eqn>1</eqn></element>
      <element subscript="South"><eqn>2</eqn></element>
    </aux>
  </variables></model>
</xmile>`;
    const model = readXmile(xml);
    expect(model.converters[0].equation).toBe("");
    expect(model.arrayed.base).toEqual({
      dimensions: ["Region"],
      elements: { North: "1", South: "2" },
    });
    expect(simulate(model).series["base[South]"]).toEqual([2, 2]);
  });

  it("still reads the old dimensions attribute and name[A,B] forms", () => {
    const xml = `<xmile version="1.0" xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0">
  <sim_specs><start>0</start><stop>1</stop><dt>1</dt></sim_specs>
  <dimensions>
    <dim name="Region"><elem name="North"/><elem name="South"/></dim>
    <dim name="Age"><elem name="Young"/><elem name="Old"/></dim>
  </dimensions>
  <model><variables>
    <aux name="rate" dimensions="Region"><eqn>0.1</eqn></aux>
    <aux name="pop[Region,Age]"><eqn>1</eqn></aux>
  </variables></model>
</xmile>`;
    const model = readXmile(xml);
    expect(model.arrayed.rate).toEqual({ dimensions: ["Region"] });
    expect(model.arrayed.pop).toEqual({ dimensions: ["Region", "Age"] });
    expect(model.converters.map((c) => c.name)).toEqual(["rate", "pop"]);
    const r = simulate(model);
    expect(r.series["pop[South,Old]"]).toEqual([1, 1]);
  });
});
