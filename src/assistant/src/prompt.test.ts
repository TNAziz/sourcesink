import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";
import { runGauntlet, type ModelPatch } from "@sourcesink/patch";

import { STAGES, type Conversation } from "./contracts.js";
import { buildMessages, repairMessage, systemPrompt, unitsRepairMessage } from "./prompt.js";

const OPS = ["add", "update", "rename", "remove", "connect", "disconnect", "wire", "setRun", "setLayout"];
const FEATURES = ["run", "scenarios", "calibrate", "sensitivity", "uncertainty", "describe"];

function sample(): Model {
  const model = emptyModel("Reservoir");
  model.documentation = "A small reservoir model.";
  model.run = { start: 0, stop: 10, dt: 0.25, saveEvery: 1, timeUnits: "Day" };
  model.stocks = [
    {
      kind: "stock",
      id: "stock-water",
      name: "Water",
      equation: "100",
      units: "m3",
      documentation: "Water in the reservoir.",
      outflows: ["outflow"],
      provenance: { author: "human" },
    },
  ];
  model.layout = { Water: { x: 10, y: 20 } };
  return model;
}

describe("systemPrompt", () => {
  it("mentions every patch op value", () => {
    const prompt = systemPrompt();
    for (const op of OPS) expect(prompt).toContain(`"op": "${op}"`);
  });

  it("mentions every interview stage next to guidance", () => {
    const prompt = systemPrompt();
    for (const stage of STAGES) expect(prompt).toContain(stage);
  });

  it("mentions every feature and when to suggest it", () => {
    const prompt = systemPrompt();
    for (const feature of FEATURES) expect(prompt).toContain(feature);
    expect(prompt).toContain("observations");
    expect(prompt).toContain("what-if");
  });

  it("states the reply rules and includes the two worked examples", () => {
    const prompt = systemPrompt();
    expect(prompt).toContain("at most three questions");
    expect(prompt).toContain("units");
    expect(prompt).toContain("documentation");
    expect(prompt).toContain("JSON object only");
    expect(prompt).toContain("Worked example 1");
    expect(prompt).toContain("Worked example 2");
    expect(prompt).toContain("Worked example 3");
    // The examples are themselves valid JSON fragments the parser can find.
    expect(prompt).toContain('"questions": ["What quantity should the model track?"');
    expect(prompt).toContain('{"op": "wire"');
    expect(prompt).toContain('"runs"');
    expect(prompt).toContain("Never state a simulated number you have not run");
  });

  it("lists the built-in function and logic dialect", () => {
    const prompt = systemPrompt();
    expect(prompt).toContain("IF condition THEN value ELSE other_value");
    expect(prompt).toContain("SMTH1");
    expect(prompt).toContain("RAMP");
    expect(prompt).toContain("AND");
  });
});

describe("buildMessages", () => {
  const conversation: Conversation = {
    history: [
      { role: "user", content: "I want to model a reservoir." },
      { role: "assistant", content: "What accumulates?" },
    ],
    stage: "stocks",
  };

  it("includes the current model and its structural description", () => {
    const messages = buildMessages(sample(), conversation, "Water leaves at 5 m3/day.");
    expect(messages[0].role).toBe("system");
    expect(messages[messages.length - 2].role).toBe("user");
    expect(messages[messages.length - 2].content).toContain("## Overview");
    expect(messages[messages.length - 2].content).toContain("**Water**");
    expect(messages[messages.length - 2].content).toContain("Current model (compact JSON)");
  });

  it("omits layout, provenance and internal ids from the model JSON", () => {
    const messages = buildMessages(sample(), conversation, "next");
    const user = messages[messages.length - 2].content;
    expect(user).not.toContain("layout");
    expect(user).not.toContain("provenance");
    expect(user).not.toContain("stock-water");
  });

  it("carries run settings and element fields compactly", () => {
    const messages = buildMessages(sample(), conversation, "next");
    const compact = messages[messages.length - 2].content.split("\n")[1];
    const parsed = JSON.parse(compact) as Record<string, unknown>;
    expect(parsed.name).toBe("Reservoir");
    expect(parsed.run).toMatchObject({ start: 0, stop: 10, dt: 0.25, saveEvery: 1 });
    expect(parsed.stocks).toEqual([
      {
        name: "Water",
        equation: "100",
        units: "m3",
        documentation: "Water in the reservoir.",
        outflows: ["outflow"],
      },
    ]);
  });

  it("says the model is empty instead of sending JSON", () => {
    const messages = buildMessages(emptyModel("Blank"), { history: [], stage: "question" }, "Hello");
    expect(messages[1].content).toBe("The model is empty.");
  });

  it("puts the current model after the history, right before the new user text", () => {
    const messages = buildMessages(sample(), conversation, "The rate is 5.");
    expect(messages.slice(1, 3).map((m) => m.content)).toEqual([
      "I want to model a reservoir.",
      "What accumulates?",
    ]);
    expect(messages[3].content).toContain("Current model (compact JSON)");
    expect(messages[4]).toEqual({ role: "user", content: "The rate is 5." });
  });

  it("gives a what-if worked example with two numeric runs", () => {
    const example = systemPrompt().split("## Worked example 3")[1];
    const json = example.slice(example.indexOf("{"));
    const turn = JSON.parse(json) as {
      runs: { label: string; set?: Record<string, unknown> }[];
    };
    expect(turn.runs.map((run) => run.label)).toEqual(["Current loading", "Loading halved"]);
    expect(turn.runs[0].set).toBeUndefined();
    expect(turn.runs[1].set).toEqual({ loading: 5 });
  });

  it("gives a worked example patch that passes the validation gauntlet", () => {
    const example = systemPrompt().split("## Worked example 2")[1].split("## Worked example 3")[0];
    const json = example.slice(example.indexOf("{"));
    const turn = JSON.parse(json) as { patch: ModelPatch };
    const result = runGauntlet(emptyModel("Example"), turn.patch);
    expect(result.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("repairMessage", () => {
  it("quotes gauntlet findings exactly and asks for the complete JSON reply", () => {
    const text = repairMessage({
      kind: "gauntlet",
      detail: "irrelevant when findings are present",
      findings: [
        {
          stage: "structure",
          severity: "error",
          element: "decay",
          message: "decay.equation references unknown name 'k'",
        },
      ],
    });
    expect(text).toContain("decay.equation references unknown name 'k'");
    expect(text).toContain("complete corrected JSON object");
  });

  it("uses the detail when there are no findings", () => {
    const text = repairMessage({ kind: "parse", detail: "questions must be an array of strings" });
    expect(text).toContain("questions must be an array of strings");
    expect(text).toContain("not a fragment");
  });

  it("omits warnings from the quoted problems", () => {
    const text = repairMessage({
      kind: "gauntlet",
      detail: "error detail",
      findings: [
        { stage: "structure", severity: "warning", message: "unused converter" },
        { stage: "structure", severity: "error", message: "real problem" },
      ],
    });
    expect(text).toContain("real problem");
    expect(text).not.toContain("unused converter");
  });
});

describe("unitsRepairMessage", () => {
  it("quotes every unit finding and asks for the complete corrected reply", () => {
    const text = unitsRepairMessage([
      { stage: "units", severity: "warning", element: "loading", message: "loading.units does not match its flow" },
    ]);
    expect(text).toContain("loading.units does not match its flow");
    expect(text).toContain("complete corrected JSON object");
    expect(text).toContain("consistent units");
  });
});
