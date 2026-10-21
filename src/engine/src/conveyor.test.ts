import { describe, expect, it } from "vitest";

import { emptyModel, type Flow, type Model, type Stock } from "@sourcesink/model";

import { simulate } from "./simulate.js";

const stock = (id: string, equation: string, extra: Partial<Stock> = {}): Stock => ({
  kind: "stock",
  id,
  name: id,
  equation,
  ...extra,
});
const flow = (id: string, equation: string, extra: Partial<Flow> = {}): Flow => ({
  kind: "flow",
  id,
  name: id,
  equation,
  ...extra,
});
const model = (m: Partial<Model>): Model => ({ ...emptyModel("t"), ...m });
const at = (r: ReturnType<typeof simulate>, name: string, t: number) => r.series[name][r.time.indexOf(t)];

describe("conveyors", () => {
  it("delay inflowing material by exactly the transit time", () => {
    const r = simulate(
      model({
        stocks: [stock("belt", "0", { conveyor: { transitTime: "2" }, inflows: ["load"], outflows: ["unload"] })],
        flows: [flow("load", "10"), flow("unload", "")],
        run: { start: 0, stop: 5, dt: 0.5, saveEvery: 0.5 },
      }),
    );
    expect([0, 1, 1.5].map((t) => at(r, "unload", t))).toEqual([0, 0, 0]);
    expect([2, 3, 5].map((t) => at(r, "unload", t))).toEqual([10, 10, 10]);
    expect(at(r, "belt", 5)).toBeCloseTo(20);
  });

  it("spread initial contents evenly, so they drain out at a constant rate", () => {
    const r = simulate(
      model({
        stocks: [stock("transit", "8", { conveyor: { transitTime: "2" }, outflows: ["arrivals"] })],
        flows: [flow("arrivals", "")],
        run: { start: 0, stop: 3, dt: 0.25, saveEvery: 0.25 },
      }),
    );
    expect(at(r, "arrivals", 0)).toBeCloseTo(4);
    expect(at(r, "arrivals", 1.75)).toBeCloseTo(4);
    expect(at(r, "arrivals", 2)).toBeCloseTo(0);
    expect(at(r, "transit", 1)).toBeCloseTo(4);
    expect(at(r, "transit", 2)).toBeCloseTo(0);
  });

  it("leak a fraction of entering material over the transit, conserving the rest", () => {
    const r = simulate(
      model({
        stocks: [
          stock("source", "1000", { outflows: ["load"] }),
          stock("belt", "0", { conveyor: { transitTime: "4" }, inflows: ["load"], outflows: ["exit", "spill"] }),
          stock("done", "0", { inflows: ["exit"] }),
          stock("lost", "0", { inflows: ["spill"] }),
        ],
        flows: [flow("load", "10"), flow("exit", ""), flow("spill", "0.25", { leak: true })],
        run: { start: 0, stop: 20, dt: 1, saveEvery: 1 },
      }),
    );
    expect(at(r, "exit", 20)).toBeCloseTo(7.5);
    expect(at(r, "spill", 20)).toBeCloseTo(2.5);
    const total = ["source", "belt", "done", "lost"].reduce((a, n) => a + at(r, n, 20), 0);
    expect(total).toBeCloseTo(1000);
  });

  it("lay out leaking initial contents as a steady state, conserving material", () => {
    const r = simulate(
      model({
        stocks: [
          stock("belt", "90", { conveyor: { transitTime: "5" }, outflows: ["exit", "spill"] }),
          stock("done", "0", { inflows: ["exit"] }),
          stock("lost", "0", { inflows: ["spill"] }),
        ],
        flows: [flow("exit", ""), flow("spill", "1", { leak: true })],
        run: { start: 0, stop: 8, dt: 1, saveEvery: 1 },
      }),
    );
    // Everything leaks: nothing reaches the exit, and with no new inflow the
    // leak falls linearly (5, 4, 3, … slats still leaking) to zero.
    expect(r.series.exit.every((x) => Math.abs(x) < 1e-9)).toBe(true);
    const spill = [0, 1, 2, 3, 4, 5].map((t) => at(r, "spill", t));
    for (let k = 0; k < 6; k++) expect(spill[k]).toBeCloseTo((spill[0] * (5 - k)) / 5);
    for (const t of r.time) expect(at(r, "belt", t) + at(r, "done", t) + at(r, "lost", t)).toBeCloseTo(90);
    expect(at(r, "belt", 8)).toBeCloseTo(0);
  });
});

describe("rework through a leaking conveyor", () => {
  it("REWORK(10) sends back 10% of the work in total, despite repeat passes", () => {
    const r = simulate(
      model({
        stocks: [
          stock("backlog", "100", { inflows: ["failing"], outflows: ["entering"], nonNegative: true }),
          stock("inspection", "0", { conveyor: { transitTime: "2" }, inflows: ["entering"], outflows: ["passing", "failing"] }),
          stock("done", "0", { inflows: ["passing"] }),
        ],
        flows: [flow("entering", "backlog/2"), flow("passing", ""), flow("failing", "REWORK(10)", { leak: true })],
        run: { start: 0, stop: 200, dt: 0.25, saveEvery: 0.25 },
      }),
    );
    const reworked = r.series.failing.slice(0, -1).reduce((a, x) => a + x * 0.25, 0);
    expect(reworked).toBeCloseTo(10, 1);
    expect(at(r, "done", 200)).toBeCloseTo(100, 1);
  });
});

describe("queues", () => {
  it("pass their contents and inflow straight through, ignoring outflow equations", () => {
    const r = simulate(
      model({
        stocks: [
          stock("line", "5", { queue: true, inflows: ["arrive"], outflows: ["first", "second"] }),
          stock("served", "0", { inflows: ["first"] }),
        ],
        flows: [flow("arrive", "4"), flow("first", "0"), flow("second", "0")],
        run: { start: 0, stop: 3, dt: 1, saveEvery: 1 },
      }),
    );
    expect(r.series.first).toEqual([9, 4, 4, 4]); // 5 waiting + 4 arriving, then 4/step
    expect(r.series.second).toEqual([0, 0, 0, 0]);
    expect(r.series.line).toEqual([5, 0, 0, 0]);
    expect(r.series.served).toEqual([0, 9, 13, 17]);
  });

  it("into another queue, pass one element per DT", () => {
    const r = simulate(
      model({
        stocks: [
          stock("a", "0", { queue: true, inflows: ["arrive"], outflows: ["move"] }),
          stock("b", "0", { queue: true, inflows: ["move"], outflows: ["leave"] }),
        ],
        flows: [flow("arrive", "IF TIME < 1 THEN 3 ELSE 0"), flow("move", ""), flow("leave", "")],
        converters: [{ kind: "converter", id: "n", name: "n", equation: "QLEN(a)" }],
        run: { start: 0, stop: 3, dt: 1, saveEvery: 1 },
      }),
    );
    expect(r.series.move).toEqual([3, 0, 0, 0]);
    expect(r.series.leave).toEqual([3, 0, 0, 0]);
  });
});

describe("conveyor details", () => {
  it("take a comma list as contents per time unit, first value leaving first", () => {
    const r = simulate(
      model({
        stocks: [stock("belt", "1,2,3", { conveyor: { transitTime: "3" }, outflows: ["out"] })],
        flows: [flow("out", "")],
        converters: [
          { kind: "converter", id: "len", name: "len", equation: "QLEN(belt)" },
          { kind: "converter", id: "next", name: "next", equation: "QELEM(belt, 1)" },
          { kind: "converter", id: "last", name: "last", equation: "QELEM(belt, 3)" },
        ],
        run: { start: 0, stop: 4, dt: 1, saveEvery: 1 },
      }),
    );
    expect(r.series.out).toEqual([1, 2, 3, 0, 0]);
    expect(r.series.belt[0]).toBe(6);
    expect([r.series.len[0], r.series.next[0], r.series.last[0]]).toEqual([3, 1, 3]);
  });

  it("repeat the last listed value for the remaining time units", () => {
    const r = simulate(
      model({
        stocks: [stock("belt", "5,1", { conveyor: { transitTime: "4" }, outflows: ["out"] })],
        flows: [flow("out", "")],
        run: { start: 0, stop: 4, dt: 1, saveEvery: 1 },
      }),
    );
    expect(r.series.out).toEqual([5, 1, 1, 1, 0]);
  });

  it("sample the transit time per batch on entry (TRANSTIME reports it)", () => {
    const r = simulate(
      model({
        stocks: [stock("belt", "0", { conveyor: { transitTime: "IF TIME < 2 THEN 2 ELSE 1" }, inflows: ["load"], outflows: ["out"] })],
        flows: [flow("load", "IF TIME < 3 THEN 1 ELSE 0"), flow("out", "")],
        converters: [{ kind: "converter", id: "tt", name: "tt", equation: "TRANSTIME(belt)" }],
        run: { start: 0, stop: 6, dt: 1, saveEvery: 1 },
      }),
    );
    // entered at 0 and 1 ride 2; entered at 2 rides 1, so it leaves with the t=1 batch
    expect(r.series.out).toEqual([0, 0, 1, 2, 0, 0, 0]);
    expect(r.series.tt.slice(0, 4)).toEqual([2, 2, 2, 1]);
  });
});

describe("CYCLETIME on conveyors", () => {
  it("equals the transit time for material leaving the exit", () => {
    const r = simulate(
      model({
        stocks: [stock("belt", "6", { conveyor: { transitTime: "3" }, inflows: ["load"], outflows: ["unload"] })],
        flows: [flow("load", "2"), flow("unload", "")],
        converters: [{ kind: "converter", id: "ct", name: "ct", equation: "CYCLETIME(unload)" }],
        run: { start: 0, stop: 6, dt: 0.5, saveEvery: 1 },
      }),
    );
    // initial contents are not time-stamped; stamped batches exit from t=3
    expect(r.series.ct.slice(0, 3)).toEqual([0, 0, 0]);
    expect(r.series.ct.slice(3).every((x) => Math.abs(x - 3) < 1e-9)).toBe(true);
  });

  it("uses the mean age of a well-mixed plain stock (Little's law at steady state)", () => {
    const r = simulate(
      model({
        stocks: [stock("pool", "50", { inflows: ["fill"], outflows: ["drain"] })],
        flows: [flow("fill", "5"), flow("drain", "5")],
        converters: [{ kind: "converter", id: "ct", name: "ct", equation: "CYCLETIME(drain)" }],
        run: { start: 0, stop: 200, dt: 0.25, saveEvery: 50 },
      }),
    );
    expect(at(r, "ct", 200)).toBeCloseTo(50 / 5, 1);
  });

  it("rejects a CYCLETIME argument that is not a flow name", () => {
    const m = model({
      converters: [{ kind: "converter", id: "bad", name: "bad", equation: "CYCLETIME(2)" }],
      run: { start: 0, stop: 1, dt: 1, saveEvery: 1 },
    });
    expect(() => simulate(m)).toThrow(/CYCLETIME expects/);
  });
});

describe("ovens", () => {
  it("fill to capacity, cook for the sampled time, then empty in one step while refilling", () => {
    const r = simulate(
      model({
        stocks: [stock("oven", "0", { oven: { capacity: "3", fillTime: "INF" }, inflows: ["feed"], outflows: ["done"] })],
        flows: [flow("feed", "1"), flow("done", "2")],
        converters: [
          { kind: "converter", id: "st", name: "st", equation: "OSTATE(oven)" },
          { kind: "converter", id: "ck", name: "ck", equation: "COOKTIME(oven)" },
        ],
        run: { start: 0, stop: 6, dt: 1, saveEvery: 1 },
      }),
    );
    expect(r.series.oven).toEqual([0, 1, 2, 3, 3, 3, 1]);
    expect(r.series.feed).toEqual([1, 1, 1, 0, 0, 1, 1]); // door closed while cooking
    expect(r.series.done).toEqual([0, 0, 0, 0, 0, 3, 0]);
    expect(r.series.st).toEqual([0, 0, 0, 1, 1, 2, 0]);
    expect(r.series.ck).toEqual([0, 0, 0, 2, 2, 2, 0]);
  });

  it("close when the fill time runs out", () => {
    const r = simulate(
      model({
        stocks: [stock("oven", "0", { oven: { capacity: "10", fillTime: "2" }, inflows: ["feed"], outflows: ["done"] })],
        flows: [flow("feed", "1"), flow("done", "1")],
        run: { start: 0, stop: 4, dt: 1, saveEvery: 1 },
      }),
    );
    expect(r.series.oven).toEqual([0, 1, 2, 2, 1]);
    expect(r.series.done).toEqual([0, 0, 0, 2, 0]);
  });

  it("draw from an upstream queue only what they can take", () => {
    const r = simulate(
      model({
        stocks: [
          stock("line", "0", { queue: true, inflows: ["arrive"], outflows: ["serve"] }),
          stock("agent", "0", { oven: { capacity: "1", fillTime: "DT" }, inflows: ["serve"], outflows: ["finish"] }),
          stock("served", "0", { inflows: ["finish"] }),
        ],
        flows: [flow("arrive", "1"), flow("serve", "0"), flow("finish", "3")],
        converters: [{ kind: "converter", id: "wait", name: "wait", equation: "CYCLETIME(serve)" }],
        run: { start: 0, stop: 12, dt: 1, saveEvery: 1 },
      }),
    );
    // one customer every 4 steps (1 step to board + 3 to serve); the line grows
    const servedAt12 = r.series.served.at(-1)!;
    expect(servedAt12).toBe(2);
    expect(r.series.line.at(-1)!).toBeGreaterThan(8);
    expect(Math.max(...r.series.wait)).toBeGreaterThan(3);
    for (let i = 0; i < r.time.length; i++) {
      expect(r.series.line[i] + r.series.agent[i] + r.series.served[i]).toBeCloseTo(r.time[i]);
    }
  });
});

describe("cycle-time functions", () => {
  // Two batches through a conveyor: volume 10 riding 1 step, then volume 2
  // riding 5 steps (the help's CTMEAN example).
  const r = simulate(
    model({
      stocks: [
        stock("belt", "0", { conveyor: { transitTime: "IF TIME < 1 THEN 1 ELSE 5" }, inflows: ["load"], outflows: ["out"] }),
      ],
      flows: [flow("load", "IF TIME < 1 THEN 10 ELSE IF TIME < 2 THEN 2 ELSE 0"), flow("out", "")],
      converters: [
        { kind: "converter", id: "mean", name: "mean", equation: "CTMEAN(out)" },
        { kind: "converter", id: "wmean", name: "wmean", equation: "CTMEAN(out, 0, 1)" },
        { kind: "converter", id: "mx", name: "mx", equation: "CTMAX(out)" },
        { kind: "converter", id: "mn", name: "mn", equation: "CTMIN(out, 99)" },
        { kind: "converter", id: "sd", name: "sd", equation: "CTSTDDEV(out)" },
        { kind: "converter", id: "tp", name: "tp", equation: "THROUGHPUT(out)" },
      ],
      run: { start: 0, stop: 8, dt: 1, saveEvery: 1 },
    }),
  );
  const end = (n: string) => r.series[n].at(-1)!;

  it("CTMEAN averages per batch, or per unit of volume when weighted", () => {
    expect(r.series.out).toEqual([0, 10, 0, 0, 0, 0, 2, 0, 0]);
    expect(end("mean")).toBeCloseTo(3);
    expect(end("wmean")).toBeCloseTo((10 * 1 + 2 * 5) / 12);
  });

  it("CTMIN / CTMAX / CTSTDDEV summarise the batches; initial values before any", () => {
    expect([end("mn"), end("mx")]).toEqual([1, 5]);
    expect(r.series.mn[0]).toBe(99);
    expect(end("sd")).toBeCloseTo(2);
  });

  it("THROUGHPUT is stamped volume over the time since the first batch", () => {
    expect(end("tp")).toBeCloseTo(12 / (8 - 1));
  });
});
