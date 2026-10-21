import { describe, it, expect } from "vitest";
import { validate } from "@sourcesink/model";
import { simulate } from "@sourcesink/engine";

import { importStm } from "./import.js";
import { readObjects } from "./objects.js";
import { parseStm } from "./parse.js";
import { legacySamples } from "./samples.test-util.js";
import { entity, glyph, runSpecs, stmFile, type EntitySpec } from "./stmBuilder.test-util.js";

/** Synthetic S-shaped growth model: two stocks drained by one flow whose rate
 * is looked up from a graph of one stock. Entity indices are list positions. */
const ENTITIES: EntitySpec[] = [
  { kind: "s", name: "Potential", equation: "98", outflows: [1], nonNegative: true },
  { kind: "f", name: "adopting", equation: "Adopters*contact_rate", inputs: [2, 3], documentation: "word of mouth" },
  { kind: "s", name: "Adopters", equation: "2", inflows: [1] },
  { kind: "c", name: "contact_rate", equation: "Potential", inputs: [0], graph: { xmin: 0, xmax: 100, ys: [0, 0.2, 0.4] } },
  { kind: "c", name: "$_per_unit", equation: "IF Adopters ³ 50 THEN 2 ELSE 1 {price step}" },
  { kind: "b", name: "net_change", equation: "$_per_unit*0", inputs: [4] },
];

function synthetic(): Uint8Array {
  return stmFile([
    ...runSpecs(1, 25, 0.25, "Months"),
    ...ENTITIES.flatMap((e, i) => entity(e, i === 0)),
    ...glyph("s", 192, 150, 0, true),
    ...glyph("f", 301, 150, 1, false),
    ...glyph("s", 410, 151, 2, false),
  ]);
}

describe("importStm — synthetic model", () => {
  const { model, warnings } = importStm(synthetic(), "growth");

  it("maps stocks, flows, biflows and converters", () => {
    expect(warnings).toEqual([]);
    expect(model.stocks.map((s) => [s.name, s.equation, s.nonNegative ?? false])).toEqual([
      ["Potential", "98", true],
      ["Adopters", "2", false],
    ]);
    expect(model.flows.map((f) => [f.name, f.nonNegative ?? false, f.biflow ?? false])).toEqual([
      ["adopting", true, false],
      ["net_change", false, true],
    ]);
    expect(model.flows[0].documentation).toBe("word of mouth");
  });

  it("wires flows through the stocks' inflow/outflow lists", () => {
    expect(model.stocks[0].outflows).toEqual(["adopting"]);
    expect(model.stocks[1].inflows).toEqual(["adopting"]);
  });

  it("turns a graph converter with a single input into a graph function", () => {
    expect(model.graphFunctions).toEqual([
      expect.objectContaining({
        name: "contact_rate",
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0.2 },
          { x: 100, y: 0.4 },
        ],
      }),
    ]);
    expect(model.connectors.map((c) => c.name)).toContain("Potential -> contact_rate");
  });

  it("decodes Mac Roman operators, strips comments and quotes odd names", () => {
    const price = model.converters.find((c) => c.name === "$_per_unit")!;
    expect(price.equation).toBe("IF Adopters >= 50 THEN 2 ELSE 1");
    expect(price.documentation).toBe("price step");
    expect(model.flows[1].equation).toBe('"$_per_unit"*0');
  });

  it("reads run specs and diagram positions", () => {
    expect(model.run).toMatchObject({ start: 1, stop: 25, dt: 0.25, timeUnits: "Months" });
    // Glyph positions (192,150), (301,150), (410,151) scaled 2.4x for SourceSink's shapes.
    expect(model.layout).toEqual({
      Potential: { x: 461, y: 360 },
      adopting: { x: 722, y: 360 },
      Adopters: { x: 984, y: 362 },
    });
  });

  it("produces a valid model that simulates", () => {
    expect(validate(model)).toEqual([]);
    const r = simulate(model);
    const potential = r.series.Potential;
    expect(potential[0]).toBe(98);
    expect(potential.at(-1)!).toBeLessThan(98);
    expect(Math.min(...potential)).toBeGreaterThanOrEqual(0);
  });
});

describe("importStm — provenance stamping", () => {
  const { model } = importStm(synthetic(), "growth");
  const stamp = { author: "import", agent: "sourcesink-legacy-import" };

  it("stamps the model metadata", () => {
    expect(model.metadata).toEqual({ provenance: stamp });
  });

  it("stamps every imported element", () => {
    const elements = [
      ...model.stocks,
      ...model.flows,
      ...model.converters,
      ...model.graphFunctions,
      ...model.connectors,
    ];
    expect(elements.length).toBeGreaterThan(0);
    for (const e of elements) expect(e.provenance, e.name).toEqual(stamp);
  });
});

describe("importStm — conveyors and queues", () => {
  // 0 line (queue) -u-> 2 belt (conveyor) -m-> 4 done ; belt -k-> spill
  const ents: EntitySpec[] = [
    { kind: "q", name: "Line", equation: "6", inflows: [], outflows: [1] },
    { kind: "u", name: "boarding", equation: "2" },
    { kind: "l", name: "Belt", equation: "1,1,1", inflows: [1], outflows: [3, 5] },
    { kind: "m", name: "arriving", equation: "ride_time" },
    { kind: "s", name: "Done", equation: "0", inflows: [3] },
    { kind: "k", name: "spilling", equation: ".1" },
    { kind: "c", name: "ride_time", equation: "3" },
    { kind: "c", name: "in_transit_target", equation: "boarding*TRANSTIME(Belt)" },
  ];
  const { model, warnings } = importStm(stmFile([...runSpecs(0, 12, 1, "Minutes"), ...ents.flatMap((e, i) => entity(e, i === 0))]));

  it("maps conveyor transit time, leak and queue", () => {
    expect(warnings).toEqual([]);
    const belt = model.stocks.find((s) => s.name === "Belt")!;
    expect(belt).toMatchObject({ conveyor: { transitTime: "ride_time" }, equation: "1,1,1", outflows: ["arriving", "spilling"] });
    expect(model.stocks.find((s) => s.name === "Line")!.queue).toBe(true);
    expect(model.flows.find((f) => f.name === "boarding")!.equation).toBe("");
    expect(model.flows.find((f) => f.name === "arriving")!.equation).toBe("");
    expect(model.flows.find((f) => f.name === "spilling")).toMatchObject({ leak: true, equation: ".1" });
  });

  it("keeps TRANSTIME(conveyor) for the engine to evaluate", () => {
    expect(model.converters.find((c) => c.name === "in_transit_target")!.equation).toBe("boarding*TRANSTIME(Belt)");
  });

  it("simulates with material conserved", () => {
    const r = simulate(model);
    const last = r.time.length - 1;
    const total = (i: number) => ["Line", "Belt", "Done"].reduce((a, n) => a + r.series[n][i], 0);
    const spilled = r.series.spilling.slice(0, last).reduce((a, x) => a + x, 0);
    expect(total(last) + spilled).toBeCloseTo(total(0));
  });

  it("keeps an uneven initial list as contents per time unit", () => {
    const uneven = ents.map((e) => (e.name === "Belt" ? { ...e, equation: "0,1,0,1" } : e));
    const imp = importStm(stmFile([...runSpecs(0, 1, 1, "x"), ...uneven.flatMap((e, i) => entity(e, i === 0))]));
    expect(imp.warnings).toEqual([]);
    expect(imp.model.stocks.find((x) => x.name === "Belt")!.equation).toBe("0,1,0,1");
  });
});

describe("importStm — legacy function defaults", () => {
  it("spells out PULSE's every-DT default interval and start-time first pulse", () => {
    const ents: EntitySpec[] = [
      { kind: "c", name: "a", equation: "PULSE(5)" },
      { kind: "c", name: "b", equation: "2*PULSE(x, 3) + PULSE(1, 2, 0)" },
      { kind: "c", name: "x", equation: "MAX(1, 2)" },
    ];
    const { model } = importStm(stmFile([...runSpecs(0, 1, 1, "x"), ...ents.flatMap((e, i) => entity(e, i === 0))]));
    const eq = (n: string) => model.converters.find((c) => c.name === n)!.equation;
    expect(eq("a")).toBe("PULSE(5, STARTTIME, DT)");
    expect(eq("b")).toBe("2*PULSE(x, 3, DT) + PULSE(1, 2, 0)");
  });
});

describe("importStm — arrays and ovens", () => {
  const build = (ents: EntitySpec[], arrays: "native" | "flatten" = "native") =>
    importStm(stmFile([...runSpecs(0, 6, 1, "Days"), ...ents.flatMap((e, i) => entity(e, i === 0))]), "m", { arrays });
  const STOCK_ARRAY: EntitySpec[] = [
    { kind: "s", name: "Stock", equation: " { Place initial value here… }" },
    { kind: "s", name: "Stock[A]", equation: "1" },
    { kind: "s", name: "Stock[B]", equation: "2" },
    { kind: "c", name: "total", equation: "ARRAYSUM(Stock[*])" },
    { kind: "c", name: "double_a", equation: "Stock[A]*2" },
  ];

  it("imports arrays as arrayed variables with per-element equations", () => {
    const { model, warnings } = build(STOCK_ARRAY);
    expect(warnings).toEqual([]);
    expect(model.stocks.map((s) => s.name)).toEqual(["Stock"]);
    expect(model.dimensions.map((d) => [d.name, d.values])).toEqual([["Dim1", ["A", "B"]]]);
    expect(model.arrayed.Stock).toEqual({ dimensions: ["Dim1"], elements: { A: "1", B: "2" } });
    expect(simulate(model).series.total[0]).toBe(3);
  });

  it("can flatten arrays into their elements, expanding ARRAYSUM", () => {
    const { model, warnings } = build(STOCK_ARRAY, "flatten");
    expect(model.stocks.map((s) => s.name)).toEqual(["Stock[A]", "Stock[B]"]);
    const eq = (n: string) => model.converters.find((c) => c.name === n)!.equation;
    expect(eq("total")).toBe('SUM("Stock[A]", "Stock[B]")');
    expect(eq("double_a")).toBe('"Stock[A]"*2');
    expect(warnings).toEqual(["1 array imported as 2 separate elements (e.g. Stock[A])"]);
    const r = simulate(model);
    expect(r.series.total[0]).toBe(3);
  });

  it("imports ovens with their capacity, fill time and cook-time outflow", () => {
    const { model, warnings } = build([
      { kind: "q", name: "Line", equation: "5", outflows: [1] },
      { kind: "u", name: "boarding", equation: "0" },
      { kind: "z", name: "Agent", equation: "0", inflows: [1], outflows: [3], oven: { capacity: 2, fillTime: 0 } },
      { kind: "y", name: "finishing", equation: "2" },
    ]);
    expect(warnings).toEqual([]);
    expect(model.stocks.find((s) => s.name === "Agent")!.oven).toEqual({ capacity: "2", fillTime: "DT" });
    expect(model.flows.find((f) => f.name === "finishing")!.equation).toBe("2");
    const r = simulate(model);
    expect(Math.max(...r.series.finishing)).toBe(2); // batches of 2 leave in one step
  });
});

// --- corpus checks (only when local legacy sample files are present) --------

const CORPUS = legacySamples();
const hasCorpus = CORPUS.length > 0;

describe.skipIf(!hasCorpus)("importStm — sample-model corpus", () => {
  it("tokenizes every sample model byte-for-byte to end of file", () => {
    for (const { name, bytes } of CORPUS) {
      const p = parseStm(bytes);
      const names = new Map(p.sections.map((s) => [s.typeId, s.name]));
      expect(() => readObjects(bytes, p.bodyOffset, names), name).not.toThrow();
    }
  });

  it("imports and simulates every sample model with only finite values", () => {
    for (const { name, bytes } of CORPUS) {
      const { model } = importStm(bytes, name);
      expect(validate(model), name).toEqual([]);
      const r = simulate(model);
      const bad = Object.entries(r.series).filter(([, v]) => v.some((x) => !Number.isFinite(x))).map(([k]) => k);
      expect(bad, name).toEqual([]);
    }
  });

  it("native arrays give exactly the flattened results for every sample model", () => {
    for (const { name, bytes } of CORPUS) {
      const native = importStm(bytes, name).model;
      if (!Object.keys(native.arrayed).length) continue;
      const flat = simulate(importStm(bytes, name, { arrays: "flatten" }).model);
      const nat = simulate(native);
      for (const [series, values] of Object.entries(flat.series)) {
        expect(nat.series[series], `${name}: ${series}`).toEqual(values);
      }
    }
  });
});
