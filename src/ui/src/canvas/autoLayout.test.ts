import { describe, expect, it } from "vitest";
import type { Flow, Model, Stock } from "@sourcesink/model";
import { emptyModel } from "@sourcesink/model";
import { autoLayout } from "./autoLayout";
import { centerOf, dist, SIZES } from "./geometry";

function mkModel(parts: {
  stocks?: Partial<Stock>[];
  flows?: Partial<Flow>[];
  converters?: { id: string; name: string }[];
  connectors?: { from: string; to: string }[];
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
  m.flows = (parts.flows ?? []).map((f, i) => ({
    kind: "flow",
    id: f.id ?? `flow-${i}`,
    name: f.name ?? `flow ${i}`,
    equation: "0",
  }));
  m.converters = (parts.converters ?? []).map((c) => ({
    kind: "converter",
    id: c.id,
    name: c.name,
    equation: "0",
  }));
  m.connectors = (parts.connectors ?? []).map((c, i) => ({
    kind: "connector",
    id: `conn-${i}`,
    name: `${c.from} -> ${c.to}`,
    from: c.from,
    to: c.to,
  }));
  m.layout = parts.layout;
  return m;
}

const closeTo = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

describe("autoLayout", () => {
  it("returns nothing for an empty model", () => {
    expect(autoLayout(emptyModel())).toEqual({});
  });

  it("returns nothing when every element already has a position", () => {
    const m = mkModel({
      stocks: [{ name: "A" }, { name: "B" }],
      layout: { A: { x: 0, y: 0 }, B: { x: 300, y: 0 } },
    });
    expect(autoLayout(m)).toEqual({});
  });

  it("gives each stock chain its own row, ordered along the flow", () => {
    const m = mkModel({
      stocks: [
        { name: "Down", inflows: ["f1"] },
        { name: "Up", outflows: ["f1"] },
        { name: "X", outflows: ["f2"] },
        { name: "Y", inflows: ["f2"], outflows: ["f3"] },
        { name: "Z", inflows: ["f3"] },
      ],
      flows: [
        { id: "f1", name: "a" },
        { id: "f2", name: "b" },
        { id: "f3", name: "c" },
      ],
    });
    const out = autoLayout(m);
    const c = (n: string) => centerOf(out[n], "stock");
    // The longer chain X→Y→Z comes first, left to right.
    expect(c("X").y).toBe(c("Y").y);
    expect(c("Y").y).toBe(c("Z").y);
    expect(c("X").x).toBeLessThan(c("Y").x);
    expect(c("Y").x).toBeLessThan(c("Z").x);
    // Up→Down sits on its own row below, upstream on the left.
    expect(c("Up").y).toBe(c("Down").y);
    expect(c("Up").y).toBeGreaterThan(c("X").y);
    expect(c("Up").x).toBeLessThan(c("Down").x);
  });

  it("places unpositioned stocks in a spread row", () => {
    const m = mkModel({ stocks: [{ name: "A" }, { name: "B" }, { name: "C" }] });
    const out = autoLayout(m);
    const centers = ["A", "B", "C"].map((n) => centerOf(out[n], "stock"));
    expect(centers[0].y).toBe(centers[1].y);
    expect(centers[1].y).toBe(centers[2].y);
    for (let i = 1; i < centers.length; i++) {
      expect(centers[i].x - centers[i - 1].x).toBeGreaterThanOrEqual(200);
    }
  });

  it("puts a flow's valve midway between its stocks", () => {
    const m = mkModel({
      stocks: [
        { name: "A", outflows: ["f1"] },
        { name: "B", inflows: ["f1"] },
      ],
      flows: [{ id: "f1", name: "mid" }],
      layout: { A: { x: 0, y: 0 }, B: { x: 300, y: 0 } },
    });
    const out = autoLayout(m);
    const a = centerOf({ x: 0, y: 0 }, "stock");
    const b = centerOf({ x: 300, y: 0 }, "stock");
    const v = centerOf(out["mid"], "valve");
    expect(closeTo(v.x, (a.x + b.x) / 2)).toBe(true);
    expect(closeTo(v.y, (a.y + b.y) / 2)).toBe(true);
  });

  it("offsets a cloud-ended flow away from its stock", () => {
    const m = mkModel({
      stocks: [{ name: "A", outflows: ["f1"] }],
      flows: [{ id: "f1", name: "out" }],
      layout: { A: { x: 100, y: 50 } },
    });
    const out = autoLayout(m);
    const a = centerOf({ x: 100, y: 50 }, "stock");
    const v = centerOf(out["out"], "valve");
    expect(v.x).toBeGreaterThan(a.x); // outflow → valve to the right of the stock
    expect(closeTo(v.y, a.y)).toBe(true);
  });

  it("offsets an inflow's valve to the left of its stock", () => {
    const m = mkModel({
      stocks: [{ name: "B", inflows: ["f1"] }],
      flows: [{ id: "f1", name: "in" }],
      layout: { B: { x: 300, y: 50 } },
    });
    const out = autoLayout(m);
    const b = centerOf({ x: 300, y: 50 }, "stock");
    const v = centerOf(out["in"], "valve");
    expect(v.x).toBeLessThan(b.x);
  });

  it("places a converter above the flow it feeds", () => {
    const m = mkModel({
      stocks: [{ name: "A", outflows: ["f1"] }],
      flows: [{ id: "f1", name: "rate" }],
      converters: [{ id: "c1", name: "R" }],
      connectors: [{ from: "R", to: "rate" }],
      layout: { A: { x: 0, y: 200 }, rate: { x: 150, y: 200 } },
    });
    const out = autoLayout(m);
    expect(out["R"]).toBeDefined();
    const r = centerOf(out["R"], "converter");
    const f = centerOf({ x: 150, y: 200 }, "valve");
    expect(r.y).toBeLessThan(f.y); // above the target
    expect(closeTo(r.x, f.x)).toBe(true);
  });

  it("spreads several converters feeding the same element", () => {
    const m = mkModel({
      stocks: [{ name: "A", outflows: ["f1"] }],
      flows: [{ id: "f1", name: "rate" }],
      converters: [
        { id: "c1", name: "R1" },
        { id: "c2", name: "R2" },
        { id: "c3", name: "R3" },
      ],
      connectors: [
        { from: "R1", to: "rate" },
        { from: "R2", to: "rate" },
        { from: "R3", to: "rate" },
      ],
      layout: { A: { x: 0, y: 300 }, rate: { x: 150, y: 300 } },
    });
    const out = autoLayout(m);
    const centers = ["R1", "R2", "R3"].map((n) => centerOf(out[n], "converter"));
    // The converter pills never overlap (box test with the drawn sizes).
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const apart =
          Math.abs(centers[i].x - centers[j].x) >= SIZES.converter.w ||
          Math.abs(centers[i].y - centers[j].y) >= SIZES.converter.h;
        expect(apart, `R${i + 1} vs R${j + 1}`).toBe(true);
      }
    }
  });

  it("produces a collision-free layout for a whole model", () => {
    const m = mkModel({
      stocks: [
        { name: "Deer", inflows: ["births"], outflows: ["deaths"] },
      ],
      flows: [
        { id: "births", name: "births" },
        { id: "deaths", name: "deaths" },
      ],
      connectors: [
        { from: "birth rate", to: "births" },
        { from: "death rate", to: "deaths" },
      ],
    });
    m.converters = [
      { kind: "converter", id: "c1", name: "birth rate", equation: "0.3" },
      { kind: "converter", id: "c2", name: "death rate", equation: "0.15" },
    ];
    const out = autoLayout(m);
    const kinds: Record<string, "stock" | "flow" | "converter"> = {
      Deer: "stock",
      births: "flow",
      deaths: "flow",
      "birth rate": "converter",
      "death rate": "converter",
    };
    const centers = Object.keys(kinds).map((n) => {
      const kind = kinds[n] === "flow" ? "valve" : kinds[n] === "converter" ? "converter" : "stock";
      return centerOf(out[n], kind);
    });
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        expect(dist(centers[i], centers[j])).toBeGreaterThanOrEqual(80);
      }
    }
  });

  it("is deterministic", () => {
    const m = mkModel({
      stocks: [{ name: "A" }, { name: "B" }],
      flows: [{ id: "f", name: "f" }],
      connectors: [{ from: "r", to: "f" }],
    });
    m.converters = [{ kind: "converter", id: "c", name: "r", equation: "1" }];
    expect(autoLayout(m)).toEqual(autoLayout(m));
  });

  it("never repositions elements that already have layout entries", () => {
    const m = mkModel({
      stocks: [{ name: "A", outflows: ["f1"] }, { name: "B", inflows: ["f1"] }],
      flows: [{ id: "f1", name: "f" }],
      layout: { A: { x: 500, y: 400 } },
    });
    const out = autoLayout(m);
    expect(out["A"]).toBeUndefined();
    expect(out["B"]).toBeDefined();
    expect(out["f"]).toBeDefined();
    // valve uses A's *given* position, not a default
    const a = centerOf({ x: 500, y: 400 }, "stock");
    const b = centerOf(out["B"], "stock");
    const v = centerOf(out["f"], "valve");
    expect(closeTo(v.x, (a.x + b.x) / 2)).toBe(true);
  });

  it("keeps new stocks clear of existing content", () => {
    const m = mkModel({
      stocks: [{ name: "A" }, { name: "B" }],
      layout: { A: { x: 0, y: 0 } },
    });
    const out = autoLayout(m);
    // B has no layout → new row below A; must be placed and disjoint from A
    expect(out["B"]).toBeDefined();
    const a = centerOf({ x: 0, y: 0 }, "stock");
    const b = centerOf(out["B"], "stock");
    expect(dist(a, b)).toBeGreaterThanOrEqual(80);
  });
});
