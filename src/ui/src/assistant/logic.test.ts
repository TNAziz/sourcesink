import { describe, expect, it } from "vitest";
import { emptyModel, type Model } from "@sourcesink/model";
import type { ModelDiff, ModelPatch, PatchOp } from "@sourcesink/patch";
import type { FeatureSuggestion } from "@sourcesink/assistant";

import {
  appliedNote,
  buildSubsetPatch,
  connectorRowKey,
  diffRows,
  elementRowKey,
  formatCost,
  formatFieldValue,
  groupDiff,
  splitMessage,
  stageLabel,
  suggestionAction,
  suggestionLabel,
} from "./logic";

const patch = (ops: PatchOp[]): ModelPatch => ({ ops });

function base(): Model {
  const m = emptyModel("subset");
  m.converters = [
    { kind: "converter", id: "k", name: "k", equation: "0.1" },
    { kind: "converter", id: "q", name: "q", equation: "1" },
  ];
  return m;
}

describe("suggestionAction", () => {
  it("routes each feature to the panel it opens", () => {
    const calibrate: FeatureSuggestion = {
      feature: "calibrate",
      reason: "data",
      elements: ["kd", "BOD"],
    };
    expect(suggestionAction(calibrate)).toEqual({
      kind: "analyze",
      tab: "calibrate",
      elements: ["kd", "BOD"],
    });
    expect(suggestionAction({ feature: "sensitivity", reason: "r" })).toEqual({
      kind: "analyze",
      tab: "sensitivity",
    });
    expect(suggestionAction({ feature: "uncertainty", reason: "r", elements: [] })).toEqual({
      kind: "analyze",
      tab: "uncertainty",
    });
    expect(suggestionAction({ feature: "run", reason: "r" })).toEqual({ kind: "run" });
    expect(suggestionAction({ feature: "describe", reason: "r" })).toEqual({ kind: "describe" });
    expect(suggestionAction({ feature: "scenarios", reason: "r" })).toMatchObject({
      kind: "scenarios",
    });
  });

  it("labels the buttons", () => {
    expect(suggestionLabel({ feature: "calibrate", reason: "" })).toBe("Open Calibrate");
    expect(suggestionLabel({ feature: "run", reason: "" })).toBe("Run the model");
  });

  it("labels stages for the indicator", () => {
    expect(stageLabel("next-steps")).toBe("Next steps");
    expect(stageLabel("question")).toBe("Question");
  });
});

describe("diff review", () => {
  const diff: ModelDiff = {
    elements: [
      { kind: "stock", name: "Water", change: "added", fields: [{ field: "equation", after: "10" }] },
      { kind: "converter", name: "kd", change: "changed", fields: [{ field: "equation", before: "0.1", after: "0.2" }] },
      { kind: "flow", name: "old", change: "removed", fields: [{ field: "equation", before: "1" }] },
    ],
    connectors: [
      { from: "kd", to: "Water", change: "added" },
      { from: "a", to: "b", change: "removed" },
    ],
    run: [],
  };

  it("flattens rows with stable, canonical keys", () => {
    const rows = diffRows(diff);
    expect(rows.map((r) => r.key)).toEqual([
      elementRowKey("Water"),
      elementRowKey("kd"),
      elementRowKey("old"),
      connectorRowKey("kd", "Water"),
      connectorRowKey("a", "b"),
    ]);
    expect(elementRowKey("Water")).toBe(elementRowKey("water"));
  });

  it("groups as added/changed/removed elements and connectors", () => {
    const sections = groupDiff(diff);
    expect(sections.map((s) => [s.title, s.rows.length])).toEqual([
      ["Added elements", 1],
      ["Changed elements", 1],
      ["Removed elements", 1],
      ["Added connectors", 1],
      ["Removed connectors", 1],
    ]);
  });

  it("formats field values for display", () => {
    expect(formatFieldValue("a * b")).toBe("a * b");
    expect(formatFieldValue(3)).toBe("3");
    expect(formatFieldValue(undefined)).toBe("—");
    expect(formatFieldValue({ x: 1 })).toBe('{"x":1}');
  });
});

describe("buildSubsetPatch", () => {
  const ops: PatchOp[] = [
    { op: "add", kind: "converter", element: { name: "alpha", equation: "1" } },
    { op: "update", name: "k", changes: { equation: "0.2" } },
    { op: "connect", from: "alpha", to: "q" },
    { op: "setRun", run: { stop: 20 } },
  ];
  const all = new Set([
    elementRowKey("alpha"),
    elementRowKey("k"),
    connectorRowKey("alpha", "q"),
  ]);

  it("keeps every op when everything is selected", () => {
    expect(buildSubsetPatch(patch(ops), base(), all).ops).toEqual(ops);
  });

  it("drops unchecked element ops and keeps valid new connects", () => {
    const selected = new Set([elementRowKey("alpha"), connectorRowKey("alpha", "q")]);
    const out = buildSubsetPatch(patch(ops), base(), selected).ops;
    expect(out.map((o) => o.op)).toEqual(["add", "connect"]);
  });

  it("keeps run-spec changes only when the rest of the patch is accepted", () => {
    const partial = new Set([elementRowKey("alpha")]);
    expect(buildSubsetPatch(patch(ops), base(), partial).ops.map((o) => o.op)).toEqual(["add"]);

    const onlyRun = patch([{ op: "setRun", run: { stop: 5 } }]);
    expect(buildSubsetPatch(onlyRun, base(), new Set()).ops).toHaveLength(1);
  });

  it("drops a connect whose new end was unchecked", () => {
    const selected = new Set([connectorRowKey("alpha", "q")]);
    expect(buildSubsetPatch(patch(ops), base(), selected).ops.map((o) => o.op)).toEqual([]);
  });

  it("allows a connect between elements that already exist", () => {
    const connectors = patch([{ op: "connect", from: "k", to: "q" }]);
    const selected = new Set([connectorRowKey("k", "q")]);
    expect(buildSubsetPatch(connectors, base(), selected).ops).toHaveLength(1);
  });

  it("follows the flow and both ends for a wire", () => {
    const wiring = patch([
      { op: "add", kind: "stock", element: { name: "S" } },
      { op: "add", kind: "flow", element: { name: "f" } },
      { op: "wire", flow: "f", to: "S" },
    ]);
    const both = new Set([elementRowKey("S"), elementRowKey("f")]);
    expect(buildSubsetPatch(wiring, base(), both).ops.map((o) => o.op)).toEqual(["add", "add", "wire"]);

    const flowOnly = new Set([elementRowKey("f")]);
    expect(buildSubsetPatch(wiring, base(), flowOnly).ops.map((o) => o.op)).toEqual([
      "add",
    ]);
  });

  it("includes a rename when either its old or new name is checked", () => {
    const rename = patch([{ op: "rename", name: "k", to: "growth" }]);
    expect(buildSubsetPatch(rename, base(), new Set([elementRowKey("growth")])).ops).toHaveLength(1);
    expect(buildSubsetPatch(rename, base(), new Set([elementRowKey("k")])).ops).toHaveLength(1);
    expect(buildSubsetPatch(rename, base(), new Set([elementRowKey("q")])).ops).toHaveLength(0);
  });
});

describe("appliedNote", () => {
  it("names the elements that were applied", () => {
    expect(
      appliedNote(
        patch([
          { op: "add", kind: "stock", element: { name: "Water" } },
          { op: "update", name: "kd", changes: { equation: "0.2" } },
        ]),
      ),
    ).toBe("Applied: Water, kd.");
    expect(appliedNote(patch([{ op: "setRun", run: { stop: 5 } }]))).toBe(
      "Applied the run-settings change.",
    );
  });
});

describe("message rendering helpers", () => {
  it("splits a trailing numbered question list from the prose", () => {
    const content = "Here is a start.\n\n1. What units?\n2. How long?";
    expect(splitMessage(content)).toEqual({
      text: "Here is a start.",
      questions: ["What units?", "How long?"],
    });
  });

  it("leaves text without a question block alone", () => {
    expect(splitMessage("Just prose.")).toEqual({ text: "Just prose.", questions: [] });
    expect(splitMessage("A line\n1. mid-sentence\nmore")).toEqual({
      text: "A line\n1. mid-sentence\nmore",
      questions: [],
    });
  });

  it("formats costs", () => {
    expect(formatCost(0.0032)).toBe("$0.0032");
    expect(formatCost(0)).toBe("$0.0000");
    expect(formatCost(0.00001)).toBe("<$0.0001");
  });
});

describe("diffRows field review", () => {
  it("hides provenance and ids and puts the equation first", () => {
    const rows = diffRows({
      elements: [
        {
          kind: "converter",
          name: "k",
          change: "added",
          fields: [
            { field: "documentation", after: "Rate." },
            { field: "provenance", after: { author: "ai" } },
            { field: "id", after: "k" },
            { field: "equation", after: "0.1" },
          ],
        },
      ],
      connectors: [],
    } as unknown as ModelDiff);
    expect(rows[0].fields.map((f) => f.field)).toEqual(["equation", "documentation"]);
  });
});
