import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import { applyPatch } from "./apply.js";
import { PatchError, type ModelPatch } from "./types.js";

const provenance = { author: "ai" as const, agent: "test-model", confidence: 0.8 };

function base(): Model {
  const m = emptyModel("test");
  m.run = { start: 0, stop: 2, dt: 1, saveEvery: 1 };
  m.stocks = [
    { kind: "stock", id: "pop", name: "Population", equation: "100", outflows: ["births"] },
    { kind: "stock", id: "city", name: "City", equation: "10" },
  ];
  m.flows = [{ kind: "flow", id: "births", name: "births", equation: "Population * growth rate" }];
  m.converters = [{ kind: "converter", id: "rate", name: "growth rate", equation: "0.1" }];
  m.connectors = [
    { kind: "connector", id: "p->b", name: "Population -> births", from: "Population", to: "births" },
  ];
  m.layout = { Population: { x: 0, y: 0 }, births: { x: 100, y: 0 } };
  return m;
}

const apply = (patch: ModelPatch, m = base()): Model => applyPatch(m, patch);

describe("applyPatch: element operations", () => {
  it("adds a stock with defaults and provenance", () => {
    const next = apply({ provenance, ops: [{ op: "add", kind: "stock", element: { name: "Water" } }] });
    const stock = next.stocks.find((s) => s.name === "Water")!;
    expect(stock).toMatchObject({ kind: "stock", equation: "0", inflows: [], outflows: [] });
    expect(stock.provenance).toEqual(provenance);
  });

  it("adds every element kind, filling kind-specific defaults", () => {
    const next = apply({
      ops: [
        { op: "add", kind: "flow", element: { name: "spill", equation: "1" } },
        { op: "add", kind: "converter", element: { name: "k" } },
        { op: "add", kind: "graphFunction", element: { name: "lookup" } },
      ],
    });
    expect(next.flows.find((f) => f.name === "spill")).toMatchObject({ equation: "1" });
    expect(next.converters.find((c) => c.name === "k")).toMatchObject({ equation: "0" });
    expect(next.graphFunctions.find((g) => g.name === "lookup")).toMatchObject({
      points: [],
      interpolation: "linear",
      extrapolation: "clip",
    });
  });

  it("rejects a duplicate name and a bad kind", () => {
    expect(() => apply({ ops: [{ op: "add", kind: "stock", element: { name: "Population" } }] })).toThrow(PatchError);
    expect(() =>
      apply({ ops: [{ op: "add", kind: "bogus" as "stock", element: { name: "X" } }] }),
    ).toThrow(/unknown element kind/);
  });

  it("updates fields of any element and stamps provenance", () => {
    const next = apply({
      provenance,
      ops: [{ op: "update", name: "growth rate", changes: { equation: "0.2", units: "1/Year" } }],
    });
    const converter = next.converters[0];
    expect(converter.equation).toBe("0.2");
    expect(converter.units).toBe("1/Year");
    expect(converter.provenance).toEqual(provenance);
  });

  it("rejects updating kind, id, name or a field of another kind", () => {
    for (const changes of [{ name: "x" }, { kind: "flow" }, { id: "z" }, { points: [] }]) {
      expect(() => apply({ ops: [{ op: "update", name: "growth rate", changes }] })).toThrow(PatchError);
    }
  });

  it("renames an element and rewrites equations, connectors, wiring and layout", () => {
    const m = base();
    m.stocks[0].outflows = ["births"];
    m.converters.push({ kind: "converter", id: "uses", name: "uses", equation: "births * 2" });
    const next = apply(
      { provenance, ops: [{ op: "rename", name: "births", to: "births per year" }] },
      m,
    );

    expect(next.flows[0].name).toBe("births per year");
    expect(next.flows[0].provenance).toEqual(provenance);
    expect(next.converters.find((c) => c.name === "uses")!.equation).toBe("births_per_year * 2");
    expect(next.connectors[0]).toMatchObject({ from: "Population", to: "births per year" });
    expect(next.connectors[0].name).toBe("Population -> births per year");
    expect(next.stocks[0].outflows).toEqual(["births per year"]);
    expect(next.layout).toHaveProperty("births per year", { x: 100, y: 0 });
    expect(next.layout).not.toHaveProperty("births");
  });

  it("renames a stock in equations and connectors", () => {
    const next = apply({ ops: [{ op: "rename", name: "Population", to: "pop" }] });
    expect(next.stocks[0].name).toBe("pop");
    expect(next.flows[0].equation).toBe("pop * growth rate");
    expect(next.connectors[0].from).toBe("pop");
  });

  it("rewrites quoted references and leaves longer space-separated names alone", () => {
    const m = base();
    m.converters.push(
      { kind: "converter", id: "quoted", name: "quoted", equation: '"births" * 2' },
      { kind: "converter", id: "long", name: "long", equation: "births total * 3" },
    );
    const next = apply({ ops: [{ op: "rename", name: "births", to: "births rate" }] }, m);
    expect(next.converters.find((c) => c.name === "quoted")!.equation).toBe("births_rate * 2");
    expect(next.converters.find((c) => c.name === "long")!.equation).toBe("births total * 3");
  });

  it("rejects a rename onto an existing name", () => {
    expect(() => apply({ ops: [{ op: "rename", name: "Population", to: "City" }] })).toThrow(
      /duplicate element name/,
    );
  });

  it("removes an element, its connectors and its wiring references", () => {
    const m = base();
    m.stocks[0].outflows = ["births"];
    const next = apply({ ops: [{ op: "remove", name: "births" }] }, m);
    expect(next.flows).toHaveLength(0);
    expect(next.connectors).toHaveLength(0);
    expect(next.stocks[0].outflows).toEqual([]);
    expect(next.layout).not.toHaveProperty("births");
  });
});

describe("applyPatch: graph operations", () => {
  it("connects two elements with a new information connector", () => {
    const next = apply({
      provenance,
      ops: [{ op: "connect", from: "City", to: "growth rate" }],
    });
    const connector = next.connectors.find((c) => c.from === "City")!;
    expect(connector).toMatchObject({ to: "growth rate", kind: "connector" });
    expect(connector.provenance).toEqual(provenance);
  });

  it("refuses connectors into a stock and duplicates", () => {
    expect(() => apply({ ops: [{ op: "connect", from: "City", to: "Population" }] })).toThrow(
      /into a stock/,
    );
    expect(() =>
      apply({ ops: [{ op: "connect", from: "Population", to: "births" }] }),
    ).toThrow(/already connected/);
  });

  it("disconnects an existing connector", () => {
    const next = apply({ ops: [{ op: "disconnect", from: "Population", to: "births" }] });
    expect(next.connectors).toHaveLength(0);
    expect(() =>
      apply({ ops: [{ op: "disconnect", from: "Population", to: "births" }] }, next),
    ).toThrow(/no connector/);
  });

  it("wires a flow's ends and clears one end to a cloud", () => {
    const m = base();
    m.stocks[0].outflows = [];
    m.flows[0].equation = "1";

    const wired = apply({ ops: [{ op: "wire", flow: "births", from: "Population", to: "City" }] }, m);
    expect(wired.stocks.find((s) => s.name === "Population")!.outflows).toEqual(["births"]);
    expect(wired.stocks.find((s) => s.name === "City")!.inflows).toEqual(["births"]);

    const clouded = apply({ ops: [{ op: "wire", flow: "births", from: null }] }, wired);
    expect(clouded.stocks.find((s) => s.name === "Population")!.outflows).toEqual([]);
    expect(clouded.stocks.find((s) => s.name === "City")!.inflows).toEqual(["births"]);

    const sinkCleared = apply({ ops: [{ op: "wire", flow: "births", to: null }] }, wired);
    expect(sinkCleared.stocks.find((s) => s.name === "City")!.inflows).toEqual([]);
    expect(sinkCleared.stocks.find((s) => s.name === "Population")!.outflows).toEqual(["births"]);
  });

  it("refuses wiring to a non-stock and from a stock into itself", () => {
    expect(() =>
      apply({ ops: [{ op: "wire", flow: "births", from: "growth rate" }] }),
    ).toThrow(/not a known stock/);
    expect(() =>
      apply({ ops: [{ op: "wire", flow: "births", from: "City", to: "City" }] }),
    ).toThrow(/back into itself/);
  });

  it("sets run-spec fields", () => {
    const next = apply({ ops: [{ op: "setRun", run: { stop: 10, dt: 0.5 } }] });
    expect(next.run).toMatchObject({ start: 0, stop: 10, dt: 0.5, saveEvery: 1 });
  });

  it("rejects unknown run fields", () => {
    expect(() =>
      apply({ ops: [{ op: "setRun", run: { bogus: 1 } as never }] }),
    ).toThrow(/unknown field 'bogus'/);
  });

  it("sets an element's layout position", () => {
    const next = apply({ ops: [{ op: "setLayout", name: "growth rate", x: 42, y: 7 }] });
    expect(next.layout).toHaveProperty("growth rate", { x: 42, y: 7 });
  });
});

describe("applyPatch: copy-on-write and errors", () => {
  it("does not mutate the input model", () => {
    const m = base();
    apply({ ops: [{ op: "update", name: "growth rate", changes: { equation: "9" } }] }, m);
    expect(m.converters[0].equation).toBe("0.1");
  });

  it("reports the failing operation index", () => {
    try {
      apply({
        ops: [
          { op: "setRun", run: { dt: 1 } },
          { op: "remove", name: "missing" },
        ],
      });
      throw new Error("expected applyPatch to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PatchError);
      expect((err as PatchError).opIndex).toBe(1);
    }
  });
});
