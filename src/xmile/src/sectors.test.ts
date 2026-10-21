import { describe, expect, it } from "vitest";
import { emptyModel, type Model } from "@sourcesink/model";

import { readXmile, writeXmile } from "./index.js";

function grouped(): Model {
  return {
    ...emptyModel("grouped"),
    stocks: [{ kind: "stock", id: "Tank", name: "Tank", equation: "1", outflows: ["drain"] }],
    flows: [{ kind: "flow", id: "drain", name: "drain", equation: "Tank * k" }],
    converters: [{ kind: "converter", id: "k", name: "k", equation: "0.1" }],
    sectors: [
      { id: "s-tank", name: "Storage", members: ["Tank", "drain"], collapsed: true, documentation: "Where water waits." },
      { id: "s-k", name: "Parameters", members: ["k"] },
    ],
  };
}

describe("sectors in XMILE", () => {
  it("write standard groups and read them back", () => {
    const xml = writeXmile(grouped());
    expect(xml).toContain('<group name="Storage" ss:id="s-tank" ss:collapsed="true">');
    expect(xml).toContain('<entity name="drain"/>');
    expect(readXmile(xml).sectors).toEqual(grouped().sectors);
  });

  it("read groups written by other tools, resolving loose names", () => {
    const xml = writeXmile({ ...grouped(), sectors: undefined }).replace(
      "</variables>",
      '<group name="Plant"><entity name="TANK"/><entity name="Drain"/><entity name="missing"/></group></variables>',
    );
    expect(readXmile(xml).sectors).toEqual([{ id: "sector-1", name: "Plant", members: ["Tank", "drain"] }]);
  });

  it("leave models without groups unchanged", () => {
    expect(readXmile(writeXmile({ ...grouped(), sectors: undefined })).sectors).toBeUndefined();
  });
});
