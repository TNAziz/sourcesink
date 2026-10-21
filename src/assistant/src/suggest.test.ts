import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import { constantConverters, mergeSuggestions, ruleSuggestions } from "./suggest.js";

function model(): Model {
  const m = emptyModel("River");
  m.run = { start: 0, stop: 10, dt: 0.25, saveEvery: 1 };
  m.stocks = [{ kind: "stock", id: "do", name: "DO", equation: "8" }];
  m.converters = [
    { kind: "converter", id: "k", name: "k", equation: "0.1" },
    { kind: "converter", id: "r", name: "reaeration", equation: "-0.5" },
    { kind: "converter", id: "derived", name: "derived", equation: "k * 2" },
  ];
  return m;
}

function runnable(): Model {
  const m = model();
  m.stocks[0].outflows = ["loss"];
  m.flows = [{ kind: "flow", id: "loss", name: "loss", equation: "DO * k" }];
  return m;
}

const features = (s: { feature: string }[]): string[] => s.map((x) => x.feature);

describe("constantConverters", () => {
  it("finds plain numeric equations and skips expressions", () => {
    const m = model();
    m.converters.push(
      { kind: "converter", id: "sci", name: "sci", equation: "1e-3" },
      { kind: "converter", id: "spaced", name: "spaced", equation: " 2 " },
      { kind: "converter", id: "pi", name: "pi", equation: "PI" },
    );
    expect(constantConverters(m)).toEqual(["k", "reaeration", "sci", "spaced"]);
  });
});

describe("ruleSuggestions", () => {
  it("suggests calibrate when the user mentions data and the model has stocks", () => {
    const suggestions = ruleSuggestions(model(), "I have field measurements from the river.");
    expect(features(suggestions)).toContain("calibrate");
    expect(suggestions.find((s) => s.feature === "calibrate")!.elements).toEqual(["k", "reaeration"]);
  });

  it("does not suggest calibrate without stocks", () => {
    const m = model();
    m.stocks = [];
    expect(features(ruleSuggestions(m, "Here is my CSV data."))).not.toContain("calibrate");
  });

  it("matches whole words only and ignores case", () => {
    expect(features(ruleSuggestions(model(), "The database is metadata."))).not.toContain("calibrate");
    expect(features(ruleSuggestions(model(), "Here is my CSV DATA."))).toContain("calibrate");
  });

  it("suggests sensitivity for uncertainty when two constant converters exist", () => {
    for (const text of ["I am unsure about the values.", "These are uncertain.", "I don't know.", "Give me a range.", "Just an estimate."]) {
      expect(features(ruleSuggestions(model(), text))).toContain("sensitivity");
    }
  });

  it("does not suggest sensitivity with fewer than two constant converters", () => {
    const m = model();
    m.converters = [{ kind: "converter", id: "k", name: "k", equation: "0.1" }];
    expect(features(ruleSuggestions(m, "I am unsure."))).not.toContain("sensitivity");
  });

  it("suggests scenarios for what-if, policy and comparison questions", () => {
    for (const text of ["What if we double the load?", "Show me two scenarios.", "Compare these policies."]) {
      expect(features(ruleSuggestions(model(), text))).toContain("scenarios");
    }
  });

  it("suggests describe when the user asks for an explanation", () => {
    for (const text of ["Explain this model.", "Describe the feedback.", "Tell me the story.", "Give me a summary."]) {
      expect(features(ruleSuggestions(model(), text))).toContain("describe");
    }
  });

  it("suggests run only when an accepted patch makes the model runnable", () => {
    const before = emptyModel("Before");
    const after = runnable();
    expect(features(ruleSuggestions(after, "next", before))).toContain("run");
    expect(features(ruleSuggestions(after, "next"))).not.toContain("run");
    expect(features(ruleSuggestions(after, "next", after))).not.toContain("run");
  });
});

describe("mergeSuggestions", () => {
  it("de-duplicates by feature, keeps the model reason and unions elements", () => {
    const merged = mergeSuggestions(
      model(),
      [{ feature: "calibrate", reason: "model reason", elements: ["k", "ghost"] }],
      [{ feature: "calibrate", reason: "rule reason", elements: ["reaeration", "k"] }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      feature: "calibrate",
      reason: "model reason",
      elements: ["k", "reaeration"],
    });
  });

  it("drops element names that are not in the model", () => {
    const merged = mergeSuggestions(
      model(),
      [{ feature: "sensitivity", reason: "vary", elements: ["missing", "derived"] }],
      [],
    );
    expect(merged[0].elements).toEqual(["derived"]);
  });

  it("omits elements when none survive", () => {
    const merged = mergeSuggestions(model(), [{ feature: "describe", reason: "why", elements: ["ghost"] }], []);
    expect(merged[0]).not.toHaveProperty("elements");
  });

  it("keeps at most three suggestions, model ones first", () => {
    const merged = mergeSuggestions(
      model(),
      [
        { feature: "calibrate", reason: "a" },
        { feature: "sensitivity", reason: "b" },
      ],
      [
        { feature: "scenarios", reason: "c" },
        { feature: "describe", reason: "d" },
        { feature: "run", reason: "e" },
      ],
    );
    expect(features(merged)).toEqual(["calibrate", "sensitivity", "scenarios"]);
  });
});
