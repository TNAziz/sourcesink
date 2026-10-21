import { describe, expect, it } from "vitest";
import type { Model, Stock } from "@sourcesink/model";
import { emptyModel } from "@sourcesink/model";
import type { SimulationResult } from "@sourcesink/engine";
import { selectionIds, cloudId, edgeElementId, isCloudId, toFlow } from "./toFlow";
import { centerOf, CLOUD_OFFSET, nodeTopLeft, SIZES } from "./geometry";

function mkModel(parts: {
  stocks?: Partial<Stock>[];
  flows?: { id: string; name: string }[];
  converters?: { id: string; name: string }[];
  connectors?: { id: string; from: string; to: string }[];
  layout?: Record<string, { x: number; y: number }>;
}): Model {
  const m = emptyModel();
  m.stocks = (parts.stocks ?? []).map((s, i) => ({
    kind: "stock",
    id: s.id ?? `stock-${i}`,
    name: s.name ?? `Stock ${i}`,
    equation: "0",
    inflows: s.inflows ?? [],
    outflows: s.outflows ?? [],
  }));
  m.flows = (parts.flows ?? []).map((f) => ({ kind: "flow", id: f.id, name: f.name, equation: "0" }));
  m.converters = (parts.converters ?? []).map((c) => ({
    kind: "converter",
    id: c.id,
    name: c.name,
    equation: "0",
  }));
  m.connectors = (parts.connectors ?? []).map((c) => ({
    kind: "connector",
    id: c.id,
    name: `${c.from} -> ${c.to}`,
    from: c.from,
    to: c.to,
  }));
  m.layout = parts.layout;
  return m;
}

const result: SimulationResult = {
  time: [0, 1],
  series: { Deer: [1000, 1234.5678] },
};

describe("toFlow", () => {
  it("projects stocks as rounded-rectangle nodes with final value after a run", () => {
    const m = mkModel({
      stocks: [{ id: "deer", name: "Deer" }],
      layout: { Deer: { x: 10, y: 20 } },
    });
    const noRun = toFlow(m);
    const deer = noRun.nodes[0];
    expect(deer.id).toBe("deer");
    expect(deer.type).toBe("sd-stock");
    // The layout entry fixes the stock's center; the drawn card is centered on it.
    expect(deer.position).toEqual(nodeTopLeft(centerOf({ x: 10, y: 20 }, "stock"), "stock"));
    expect(deer.data).toMatchObject({ name: "Deer", final: null });

    const afterRun = toFlow(m, { result });
    expect(afterRun.nodes[0].data).toMatchObject({ name: "Deer", final: "1235" }); // 4 sig digits
  });

  it("draws a flow as two straight pipe edges meeting at the valve", () => {
    const m = mkModel({
      stocks: [
        { id: "a", name: "A", outflows: ["f1"] },
        { id: "b", name: "B", inflows: ["f1"] },
      ],
      flows: [{ id: "f1", name: "mid" }],
      layout: { A: { x: 0, y: 0 }, B: { x: 300, y: 0 }, mid: { x: 150, y: 0 } },
    });
    const { nodes, edges } = toFlow(m);
    expect(nodes.map((n) => n.type).sort()).toEqual(["sd-stock", "sd-stock", "sd-valve"]);
    const valve = nodes.find((n) => n.id === "f1")!;
    expect(valve.data).toMatchObject({ name: "mid", biflow: false });
    expect(edges).toHaveLength(2);
    const a = edges.find((e) => e.id === "pipe:f1:a")!;
    const b = edges.find((e) => e.id === "pipe:f1:b")!;
    expect(a.source).toBe("a");
    expect(a.target).toBe("f1");
    expect(a.type).toBe("sd-pipe");
    expect(a.style).toMatchObject({ stroke: "var(--pipe)", strokeWidth: 3 });
    // no arrow at the source; the sink segment carries the arrowhead
    expect(a.markerEnd).toBeUndefined();
    expect(b.source).toBe("f1");
    expect(b.target).toBe("b");
    expect(b.type).toBe("sd-pipe");
    expect(b.markerEnd).toMatchObject({
      type: "arrowclosed",
      color: "var(--pipe)",
      width: 4,
      height: 4,
    });
    // stock on the left → leave right handle, enter valve from the left
    expect(a.sourceHandle).toBe("s-r");
    expect(a.targetHandle).toBe("t-l");
    expect(b.sourceHandle).toBe("s-r");
    expect(b.targetHandle).toBe("t-l");
  });

  it("adds derived cloud nodes at the stock-less ends, ~120px from the valve", () => {
    const m = mkModel({
      stocks: [{ id: "a", name: "A", outflows: ["f1"] }],
      flows: [{ id: "f1", name: "out" }],
      layout: { A: { x: 0, y: 0 }, out: { x: 200, y: 0 } },
    });
    const { nodes, edges } = toFlow(m);
    const cloud = nodes.find((n) => n.id === cloudId("snk", "f1"));
    expect(cloud).toBeDefined();
    expect(cloud!.selectable).toBe(false);
    expect(cloud!.draggable).toBe(false);
    const vc = centerOf({ x: 200, y: 0 }, "valve");
    const cc = { x: cloud!.position.x + SIZES.cloud.w / 2, y: cloud!.position.y + SIZES.cloud.h / 2 };
    expect(Math.abs(cc.x - (vc.x + CLOUD_OFFSET))).toBeLessThanOrEqual(1);
    const snkEdge = edges.find((e) => e.id === "pipe:f1:b")!;
    expect(snkEdge.target).toBe(cloudId("snk", "f1"));
    // no source cloud (stock attached)
    expect(nodes.find((n) => n.id === cloudId("src", "f1"))).toBeUndefined();
  });

  it("renders a cloud-to-cloud flow when a flow has no stocks", () => {
    const m = mkModel({
      flows: [{ id: "f9", name: "lone" }],
      layout: { lone: { x: 100, y: 100 } },
    });
    const { nodes, edges } = toFlow(m);
    expect(nodes.find((n) => n.id === cloudId("src", "f9"))).toBeDefined();
    expect(nodes.find((n) => n.id === cloudId("snk", "f9"))).toBeDefined();
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => !e.animated)).toBe(true);
  });

  it("keeps pipes still, before and after a run (a calm canvas)", () => {
    const m = mkModel({
      stocks: [
        { id: "a", name: "A", outflows: ["f1"] },
        { id: "b", name: "B", inflows: ["f1"] },
      ],
      flows: [{ id: "f1", name: "mid" }],
      layout: { A: { x: 0, y: 0 }, B: { x: 300, y: 0 }, mid: { x: 150, y: 0 } },
    });
    expect(toFlow(m).edges.every((e) => !e.animated)).toBe(true);
    expect(toFlow(m, { result }).edges.every((e) => !e.animated)).toBe(true);
  });

  it("draws connectors as thin curved arrows between element nodes", () => {
    const m = mkModel({
      stocks: [{ id: "a", name: "A", outflows: ["f1"] }],
      flows: [{ id: "f1", name: "rate" }],
      converters: [{ id: "r", name: "R" }],
      connectors: [{ id: "c1", from: "R", to: "rate" }],
      layout: { A: { x: 0, y: 100 }, rate: { x: 160, y: 100 }, R: { x: 160, y: 0 } },
    });
    const { edges } = toFlow(m);
    const conn = edges.find((e) => e.id === "conn:c1");
    expect(conn).toBeDefined();
    expect(conn!.source).toBe("r");
    expect(conn!.target).toBe("f1");
    expect(conn!.type).toBe("sd-bow"); // curved arc, never hugging the pipes
    expect(conn!.style).toMatchObject({ stroke: "var(--connector)", strokeWidth: 1.5, strokeDasharray: "5 4" });
    expect(conn!.markerEnd).toMatchObject({
      type: "arrowclosed",
      color: "var(--connector)",
      width: 10,
      height: 10,
    });
    // downward link → leaves the converter's bottom, enters the valve's top
    expect(conn!.sourceHandle).toBe("s-b");
    expect(conn!.targetHandle).toBe("t-t");
    // gentle clockwise bow: min(30, 15% of the ~61px boundary-to-boundary run)
    expect((conn!.data as { bow: number }).bow).toBeCloseTo(9.21, 2);
  });

  it("bows a connector clear when its straight run would hug its own pipe", () => {
    const m = mkModel({
      stocks: [
        { id: "a", name: "A", outflows: ["f1"] },
        { id: "b", name: "B", inflows: ["f1"] },
      ],
      flows: [{ id: "f1", name: "mid" }],
      connectors: [{ id: "c1", from: "A", to: "mid" }],
      layout: { A: { x: 0, y: 0 }, B: { x: 400, y: 0 }, mid: { x: 200, y: 0 } },
    });
    const { edges } = toFlow(m);
    const conn = edges.find((e) => e.id === "conn:c1")!;
    // the A→valve connector chord lies on the A→valve pipe → hard bow, clockwise
    expect((conn.data as { bow: number }).bow).toBeCloseTo(24, 2);
  });

  it("skips connectors that reference elements without nodes", () => {
    const m = mkModel({
      stocks: [{ id: "a", name: "A" }],
      converters: [{ id: "r", name: "R" }],
      connectors: [{ id: "c1", from: "R", to: "some graph fn" }],
      layout: { A: { x: 0, y: 0 }, R: { x: 0, y: 200 } },
    });
    expect(toFlow(m).edges).toHaveLength(0);
  });

  it("marks selected elements on nodes and their edges", () => {
    const m = mkModel({
      stocks: [
        { id: "a", name: "A", outflows: ["f1"] },
        { id: "b", name: "B", inflows: ["f1"] },
      ],
      flows: [{ id: "f1", name: "mid" }],
      converters: [{ id: "r", name: "R" }],
      connectors: [{ id: "c1", from: "R", to: "mid" }],
      layout: {
        A: { x: 0, y: 0 },
        B: { x: 300, y: 0 },
        mid: { x: 150, y: 0 },
        R: { x: 150, y: 150 },
      },
    });
    const { nodes, edges } = toFlow(m, { selection: ["a", "f1", "c1"] });
    expect(nodes.find((n) => n.id === "a")!.selected).toBe(true);
    expect(nodes.find((n) => n.id === "b")!.selected).toBe(false);
    expect(nodes.find((n) => n.id === "f1")!.selected).toBe(true);
    // both pipe segments + the connector edge light up with their element
    expect(edges.find((e) => e.id === "pipe:f1:a")!.selected).toBe(true);
    expect(edges.find((e) => e.id === "pipe:f1:b")!.selected).toBe(true);
    expect(edges.find((e) => e.id === "conn:c1")!.selected).toBe(true);
  });

  it("fills in positions for elements missing from the layout", () => {
    const m = mkModel({
      stocks: [{ id: "a", name: "A", outflows: ["f1"] }],
      flows: [{ id: "f1", name: "mid" }],
      layout: { A: { x: 0, y: 0 } },
    });
    const { nodes } = toFlow(m);
    const valve = nodes.find((n) => n.id === "f1")!;
    expect(valve.position.x).toBeGreaterThan(0); // offset right of the stock, not the (0,0) default
    expect(valve.position.y).toBeGreaterThan(-1);
  });

  it("marks AI-proposed stocks and converters, but not imports", () => {
    const m = mkModel({
      stocks: [{ id: "ai-stock", name: "AI stock" }],
      converters: [
        { id: "ai-aux", name: "AI aux" },
        { id: "imported-aux", name: "Imported aux" },
      ],
    });
    m.stocks[0].provenance = { author: "ai" };
    m.converters[0].provenance = { author: "ai", agent: "assistant" };
    m.converters[1].provenance = { author: "import", agent: "sourcesink-legacy-import" };
    const { nodes } = toFlow(m);
    expect(nodes.find((n) => n.id === "ai-stock")!.data).toMatchObject({ proposedByAi: true });
    expect(nodes.find((n) => n.id === "ai-aux")!.data).toMatchObject({ proposedByAi: true });
    expect(nodes.find((n) => n.id === "imported-aux")!.data).toMatchObject({ proposedByAi: false });
  });

  it("maps edge ids back to element ids and detects cloud ids", () => {
    expect(edgeElementId("pipe:flow-abc:a")).toBe("flow-abc");
    expect(edgeElementId("pipe:flow-abc:b")).toBe("flow-abc");
    expect(edgeElementId("conn:conn-xyz")).toBe("conn-xyz");
    expect(edgeElementId("whatever")).toBeNull();
    expect(isCloudId(cloudId("src", "f1"))).toBe(true);
    expect(isCloudId("stock-1")).toBe(false);
  });
});

describe("selectionIds", () => {
  it("lists a selected flow once even though its pipes are selected too", () => {
    expect(selectionIds(["f1"], ["pipe:f1:a", "pipe:f1:b"])).toEqual(["f1"]);
  });
});
