import { describe, expect, it } from "vitest";
import { emptyModel, validate, type Model } from "@sourcesink/model";

import { sectorTitle, suggestSectors } from "./sectors.js";

/** Two separate subsystems, each a tank with its parameters. */
function twoPlants(): Model {
  const m = emptyModel("two plants");
  for (const p of ["North", "South"]) {
    m.stocks.push({ kind: "stock", id: `${p}_tank`, name: `${p}_tank`, equation: "1", inflows: [`${p}_fill`], outflows: [`${p}_drain`] });
    m.flows.push({ kind: "flow", id: `${p}_fill`, name: `${p}_fill`, equation: `${p}_supply` });
    m.flows.push({ kind: "flow", id: `${p}_drain`, name: `${p}_drain`, equation: `${p}_tank / ${p}_time` });
    m.converters.push({ kind: "converter", id: `${p}_supply`, name: `${p}_supply`, equation: "3" });
    m.converters.push({ kind: "converter", id: `${p}_time`, name: `${p}_time`, equation: "4" });
  }
  m.converters.push({ kind: "converter", id: "total", name: "total", equation: "North_tank + South_tank" });
  return m;
}

describe("suggestSectors", () => {
  it("groups each subsystem with its parameters and covers every element once", () => {
    const m = twoPlants();
    const sectors = suggestSectors(m);
    expect(sectors.map((s) => s.name)).toEqual(["North tank", "South tank"]);
    expect(sectors[0].members).toEqual(expect.arrayContaining(["North_tank", "North_fill", "North_drain", "North_supply", "North_time"]));
    expect(sectors.flatMap((s) => s.members).sort()).toEqual(
      [...m.stocks, ...m.flows, ...m.converters].map((e) => e.name).sort(),
    );
    expect(validate({ ...m, sectors })).toEqual([]);
  });

  it("is deterministic", () => {
    expect(suggestSectors(twoPlants())).toEqual(suggestSectors(twoPlants()));
  });

  it("titles sectors in plain words", () => {
    expect(sectorTitle("Byproduct_buffer")).toBe("Byproduct buffer");
  });
});
