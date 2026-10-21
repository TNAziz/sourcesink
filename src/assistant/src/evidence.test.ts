import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import { evidenceMessage, runEvidence } from "./evidence.js";

function decayModel(initial = 100): Model {
  const model = emptyModel("Decay");
  model.run = { start: 0, stop: 10, dt: 0.01, saveEvery: 0.01, timeUnits: "Year" };
  model.stocks = [
    {
      kind: "stock",
      id: "water",
      name: "Water",
      equation: String(initial),
      units: "kg",
      outflows: ["out"],
    },
  ];
  model.flows = [{ kind: "flow", id: "out", name: "out", equation: "Water * k", units: "kg/Year" }];
  model.converters = [{ kind: "converter", id: "k", name: "k", equation: "0.1", units: "1/Year" }];
  model.connectors = [
    { kind: "connector", id: "c1", name: "c1", from: "Water", to: "out" },
    { kind: "connector", id: "c2", name: "c2", from: "k", to: "out" },
  ];
  return model;
}

function logisticModel(): Model {
  const model = emptyModel("Logistic");
  model.run = { start: 0, stop: 40, dt: 0.05, saveEvery: 1, timeUnits: "Year" };
  model.stocks = [
    { kind: "stock", id: "pop", name: "Population", equation: "1", units: "individuals", inflows: ["growth"] },
  ];
  model.flows = [
    {
      kind: "flow",
      id: "growth",
      name: "growth",
      equation: "r * Population * (1 - Population / K)",
      units: "individuals/Year",
    },
  ];
  model.converters = [
    { kind: "converter", id: "r", name: "r", equation: "0.5", units: "1/Year" },
    { kind: "converter", id: "K", name: "K", equation: "1000", units: "individuals" },
  ];
  model.connectors = [
    { kind: "connector", id: "c1", name: "c1", from: "Population", to: "growth" },
    { kind: "connector", id: "c2", name: "c2", from: "r", to: "growth" },
    { kind: "connector", id: "c3", name: "c3", from: "K", to: "growth" },
  ];
  return model;
}

/** A Streeter–Phelps-like sag: the deficit rises while loading lasts, then
 * reaeration drains it. The peak sits at the moment loading stops. */
function sagModel(): Model {
  const model = emptyModel("Sag");
  model.run = { start: 0, stop: 8, dt: 0.01, saveEvery: 0.1, timeUnits: "Day" };
  model.stocks = [
    {
      kind: "stock",
      id: "deficit",
      name: "DO_deficit",
      equation: "0",
      units: "mg/L",
      inflows: ["loading"],
      outflows: ["reaeration"],
    },
  ];
  model.flows = [
    {
      kind: "flow",
      id: "loading",
      name: "loading",
      equation: "IF TIME < 2 THEN 10 ELSE 0",
      units: "mg/L/Day",
    },
    {
      kind: "flow",
      id: "reaeration",
      name: "reaeration",
      equation: "DO_deficit * 1",
      units: "mg/L/Day",
    },
  ];
  model.connectors = [
    { kind: "connector", id: "c1", name: "c1", from: "DO_deficit", to: "reaeration" },
  ];
  return model;
}

describe("runEvidence", () => {
  it("reports start, end and a steady fall for first-order decay", () => {
    const evidence = runEvidence(decayModel(), { label: "Base" });
    expect(evidence.ok).toBe(true);
    expect(evidence.series.Water).toBeDefined();
    expect(evidence.time.length).toBe(evidence.series.Water.length);
    expect(evidence.facts[0]).toBe("Water: starts at 100, ends at 36.8 (kg)");
    expect(evidence.facts).toContain("Water: falls steadily");
  });

  it("finds the first time a decaying series falls below a threshold, to dt", () => {
    const evidence = runEvidence(decayModel(), { label: "Base", thresholds: { Water: 50 } });
    const fact = evidence.facts.find((f) => f.startsWith("Water first falls below 50"));
    expect(fact).toBeDefined();
    const at = Number(/at ([\d.]+) Year/.exec(fact!)?.[1]);
    expect(Math.abs(at - Math.log(2) / 0.1)).toBeLessThanOrEqual(0.02);
  });

  it("interpolates a crossing between coarse save points", () => {
    const model = decayModel();
    model.run = { ...model.run, saveEvery: 1 };
    const evidence = runEvidence(model, { label: "Coarse", thresholds: { Water: 50 } });
    const fact = evidence.facts.find((f) => f.startsWith("Water first falls below 50"))!;
    const at = Number(/at ([\d.]+) Year/.exec(fact)?.[1]);
    // ln 2 / 0.1 = 6.93; a yearly save alone would report 7.
    expect(Math.abs(at - Math.log(2) / 0.1)).toBeLessThan(0.1);
    expect(at).not.toBe(7);
  });

  it("detects a rising logistic approach to its carrying capacity", () => {
    const evidence = runEvidence(logisticModel(), {
      label: "Logistic",
      thresholds: { Population: 500 },
    });
    expect(evidence.facts).toContain("Population: rises steadily");
    expect(evidence.facts).toContain("Population levels off near 1000");
    const rising = evidence.facts.find((f) => f.startsWith("Population first rises above 500"));
    expect(rising).toBeDefined();
    const at = Number(/at ([\d.]+) Year/.exec(rising!)?.[1]);
    expect(at).toBeGreaterThan(13);
    expect(at).toBeLessThan(15);
  });

  it("reports the peak and trough times of a non-monotonic oxygen sag", () => {
    const evidence = runEvidence(sagModel(), { label: "Sag" });
    const extreme = evidence.facts.find((f) => f.includes("maximum"));
    expect(extreme).toBeDefined();
    expect(extreme).toContain("maximum 8.66 at 2 Day");
    const maxAt = Number(/maximum [\d.]+ at ([\d.]+) Day/.exec(extreme!)?.[1]);
    expect(Math.abs(maxAt - 2)).toBeLessThanOrEqual(0.02);
    expect(evidence.facts.some((f) => f.includes("minimum"))).toBe(true);
  });

  it("reports a never-crossed threshold", () => {
    const evidence = runEvidence(decayModel(), { label: "Base", thresholds: { Water: 200 } });
    expect(evidence.facts).toContain("Water never rises above 200");
  });

  it("names every unknown what-if element and reports no run", () => {
    const evidence = runEvidence(decayModel(), {
      label: "Bad",
      set: { loading: 5 },
    });
    expect(evidence.ok).toBe(false);
    expect(evidence.error).toContain("loading");
    expect(evidence.time).toEqual([]);
    expect(evidence.series).toEqual({});
  });

  it("lists unknown series as an error fact and still reports the rest", () => {
    const evidence = runEvidence(decayModel(), {
      label: "Partial",
      series: ["Water", "Missing"],
    });
    expect(evidence.ok).toBe(true);
    expect(Object.keys(evidence.series)).toEqual(["Water"]);
    expect(evidence.facts.some((f) => f.includes("No series named 'Missing'"))).toBe(true);
    expect(evidence.facts[0]).toContain("Water: starts at 100");
  });

  it("adds a what-if comparison fact when overrides are given", () => {
    const evidence = runEvidence(decayModel(), {
      label: "Doubled",
      set: { Water: 200 },
      series: ["Water"],
    });
    expect(evidence.ok).toBe(true);
    const comparison = evidence.facts.find((f) => f.includes("instead of"));
    expect(comparison).toBeDefined();
    expect(comparison).toMatch(/^Water: ends at 73\.5 instead of 36\.8 \(\+100%\)$/);
  });

  it("turns a simulation failure into ok:false with the engine's message", () => {
    const model = decayModel();
    model.run.dt = 0;
    const evidence = runEvidence(model, { label: "Broken" });
    expect(evidence.ok).toBe(false);
    expect(evidence.error).toContain("run.dt must be > 0");
  });

  it("uses three significant digits for values and times", () => {
    const evidence = runEvidence(decayModel(123456), { label: "Big" });
    expect(evidence.facts[0]).toMatch(/^Water: starts at 123000, ends at [0-9.]+ \(kg\)$/);
  });
});

describe("evidenceMessage", () => {
  it("groups facts under the request label and includes failures", () => {
    const good = runEvidence(decayModel(), { label: "Current loading" });
    const bad = runEvidence(decayModel(), { label: "Broken", set: { nope: 1 } });
    const message = evidenceMessage([good, bad]);
    expect(message).toContain('Run "Current loading":');
    expect(message).toContain("- Water: starts at 100, ends at 36.8 (kg)");
    expect(message).toContain('Run "Broken":');
    expect(message).toContain("did not complete");
    expect(message).toContain("nope");
  });
});

describe("runEvidence with arrays", () => {
  it("defaults to every stock element after expansion", () => {
    const model = emptyModel("Regions");
    model.run = { start: 0, stop: 1, dt: 1, saveEvery: 1 };
    model.dimensions = [{ kind: "dimension", id: "Region", name: "Region", values: ["North", "South"] }];
    model.stocks = [{ kind: "stock", id: "Population", name: "Population", equation: "100", inflows: ["births"] }];
    model.flows = [{ kind: "flow", id: "births", name: "births", equation: "Population[Region] * rate[Region]" }];
    model.converters = [{ kind: "converter", id: "rate", name: "rate", equation: "0.1" }];
    model.arrayed = {
      Population: { dimensions: ["Region"] },
      births: { dimensions: ["Region"] },
      rate: { dimensions: ["Region"] },
    };
    const evidence = runEvidence(model, { label: "Regions" });
    expect(evidence.ok).toBe(true);
    expect(Object.keys(evidence.series)).toEqual(["Population[North]", "Population[South]"]);
  });
});
