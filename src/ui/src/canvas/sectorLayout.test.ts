import { describe, expect, it } from "vitest";
import { emptyModel, type Model } from "@sourcesink/model";

import { placementAt, sectorLayout, SECTOR_CARD } from "./sectorLayout";
import { toFlow, sectorCardId } from "./toFlow";

/** Two tanks in two sectors joined by a pipe, each with a rate converter. */
function plant(): Model {
  const m = emptyModel("plant");
  m.stocks = [
    { kind: "stock", id: "A", name: "A", equation: "10", outflows: ["move"] },
    { kind: "stock", id: "B", name: "B", equation: "0", inflows: ["move"], outflows: ["drain"] },
  ];
  m.flows = [
    { kind: "flow", id: "move", name: "move", equation: "A * k" },
    { kind: "flow", id: "drain", name: "drain", equation: "B * j" },
  ];
  m.converters = [
    { kind: "converter", id: "k", name: "k", equation: "0.1" },
    { kind: "converter", id: "j", name: "j", equation: "0.2" },
  ];
  m.connectors = [
    { kind: "connector", id: "c1", name: "k -> move", from: "k", to: "move" },
    { kind: "connector", id: "c2", name: "A -> move", from: "A", to: "move" },
    { kind: "connector", id: "c3", name: "j -> drain", from: "j", to: "drain" },
    { kind: "connector", id: "c4", name: "B -> drain", from: "B", to: "drain" },
  ];
  m.sectors = [
    { id: "up", name: "Upstream", members: ["A", "move", "k"] },
    { id: "down", name: "Downstream", members: ["B", "drain", "j"] },
  ];
  return m;
}

describe("sectorLayout", () => {
  it("packs one non-overlapping block per sector, members inside their frame", () => {
    const { blocks, positions } = sectorLayout(plant());
    expect(blocks.map((b) => b.id)).toEqual(["up", "down"]);
    const [a, b] = blocks;
    const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    expect(apart).toBe(true);
    for (const block of blocks) {
      for (const n of block.members) {
        expect(positions[n].x).toBeGreaterThanOrEqual(block.x);
        expect(positions[n].y).toBeGreaterThanOrEqual(block.y);
        expect(positions[n].x).toBeLessThanOrEqual(block.x + block.w);
      }
    }
  });

  it("keeps saved positions relative to their block", () => {
    const m = plant();
    const before = sectorLayout(m).positions;
    m.layout = { k: { x: 500, y: 500 } };
    const moved = sectorLayout(m);
    expect(moved.positions.k.x - moved.blocks[0].offset!.x).toBe(500);
    expect(Object.keys(before).length).toBe(6);
  });

  it("shrinks a folded sector to a card and hides its members", () => {
    const m = plant();
    m.sectors![0].collapsed = true;
    const { blocks, positions, hiddenBy } = sectorLayout(m);
    expect(blocks[0]).toMatchObject({ w: SECTOR_CARD.w, h: SECTOR_CARD.h });
    expect(positions.A).toBeUndefined();
    expect(hiddenBy.get("move")).toBe("up");
  });

  it("places a new element dropped in a frame into that sector, where it was dropped", () => {
    const m = plant();
    const block = sectorLayout(m).blocks[1];
    const at = { x: block.x + 20, y: block.y + 60 };
    const place = placementAt(m, at);
    expect(place.sectorId).toBe("down");
    expect(place.at.x + block.offset!.x).toBeCloseTo(at.x);
  });
});

describe("toFlow with sectors", () => {
  it("draws frames for open sectors behind their elements", () => {
    const { nodes, offsets } = toFlow(plant());
    expect(nodes.filter((n) => n.type === "sd-sector-frame").map((n) => n.id)).toEqual(["frame:up", "frame:down"]);
    expect(offsets.A).toBeDefined();
  });

  it("replaces a folded sector by a card and reroutes pipes and links to it", () => {
    const m = plant();
    m.sectors![0].collapsed = true;
    const { nodes, edges } = toFlow(m);
    const card = sectorCardId("up");
    expect(nodes.find((n) => n.id === card)?.data).toMatchObject({ name: "Upstream", stocks: 1, flows: 1, converters: 1 });
    for (const hidden of ["A", "move", "k"]) expect(nodes.some((n) => n.id === hidden)).toBe(false);
    // The pipe from the folded sector into B now starts at the card.
    expect(edges.some((e) => e.type === "sd-pipe" && e.source === card && e.target === "B")).toBe(true);
    // Links wholly inside the folded sector disappear.
    expect(edges.some((e) => e.source === card && e.target === card)).toBe(false);
  });
});
