import { afterEach, describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";
import { simulate } from "@sourcesink/engine";

import type {
  ChatMessage,
  Complete,
  CompletionRequest,
  Conversation,
  TurnOptions,
  TurnProgress,
} from "./contracts.js";
import { runGauntlet as realGauntlet, type Finding } from "@sourcesink/patch";
import { __setGauntletForTests, newConversation, runTurn } from "./turn.js";

interface Scripted {
  complete: Complete;
  calls: { model: string; messages: ChatMessage[]; signal?: AbortSignal }[];
  requests: CompletionRequest[];
}

function scripted(replies: string[], costs: (number | undefined)[] = []): Scripted {
  const calls: Scripted["calls"] = [];
  const requests: CompletionRequest[] = [];
  let next = 0;
  const complete: Complete = async (request) => {
    requests.push(request);
    calls.push({ model: request.model, messages: request.messages.map((m) => ({ ...m })), signal: request.signal });
    const text = replies[Math.min(next, replies.length - 1)] ?? "";
    const cost = costs[next];
    next += 1;
    return { text, ...(cost !== undefined ? { cost } : {}) };
  };
  return { complete, calls, requests };
}

function reply(turn: Record<string, unknown>): string {
  return JSON.stringify(turn);
}

function options(overrides: Partial<TurnOptions> = {}): TurnOptions {
  return { model: "test/model", ...overrides };
}

/** A runnable one-stock first-order decay model. */
function decayModel(): Model {
  const model = emptyModel("Decay");
  model.run = { start: 0, stop: 10, dt: 0.01, saveEvery: 0.01, timeUnits: "Year" };
  model.stocks = [
    {
      kind: "stock",
      id: "water",
      name: "Water",
      equation: "100",
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

function oneStockModel(): Model {
  const model = emptyModel("River");
  model.run = { start: 0, stop: 5, dt: 1, saveEvery: 1 };
  model.stocks = [{ kind: "stock", id: "water", name: "Water", equation: "100" }];
  return model;
}

// Days throughout, so the patch is unit-consistent (the empty model's time unit
// is Year; a per-Day flow would draw a units warning and a repair).
const decayOps = [
  { op: "setRun", run: { timeUnits: "Day" } },
  { op: "add", kind: "stock", element: { name: "Water", equation: "100", units: "m3", documentation: "Water in the reservoir." } },
  { op: "add", kind: "flow", element: { name: "outflow", equation: "Water * loss_rate", units: "m3/Day", documentation: "Water leaving the reservoir." } },
  { op: "add", kind: "converter", element: { name: "loss_rate", equation: "0.1", units: "1/Day", documentation: "Fraction lost per day." } },
  { op: "wire", flow: "outflow", from: "Water", to: null },
  { op: "connect", from: "Water", to: "outflow" },
  { op: "connect", from: "loss_rate", to: "outflow" },
];

describe("runTurn", () => {
  it("accepts a good patch on the first try, stamps provenance and returns a diff", async () => {
    const { complete, calls } = scripted(
      [
        reply({
          message: "I added a water stock and its loss.",
          questions: [],
          patch: { rationale: "A one-stock decay model.", ops: decayOps },
          suggestions: [{ feature: "run", reason: "It is runnable now." }],
          stage: "numbers",
        }),
      ],
      [0.02],
    );
    const model = emptyModel("Reservoir");
    const result = await runTurn(model, newConversation(), "Water drains at ten percent per day.", complete, options());

    expect(calls).toHaveLength(1);
    expect(result.gaveUp).toBe(false);
    expect(result.failures).toEqual([]);
    expect(result.cost).toBeCloseTo(0.02);
    expect(result.proposal).toBeDefined();
    expect(result.proposal!.model.stocks).toHaveLength(1);
    expect(result.proposal!.diff.elements.map((e) => e.name)).toEqual(["Water", "outflow", "loss_rate"]);
    expect(result.proposal!.diff.connectors).toHaveLength(2);

    const stock = result.proposal!.model.stocks[0];
    expect(stock.provenance).toMatchObject({ author: "ai", agent: "test/model" });
    expect(Number.isNaN(Date.parse(stock.provenance!.createdAt!))).toBe(false);
    expect(result.turn.patch!.rationale).toBe("A one-stock decay model.");
    expect(result.turn.patch!.provenance).toMatchObject({ author: "ai", agent: "test/model" });
    expect(result.turn.stage).toBe("numbers");
    expect(result.conversation.history).toHaveLength(2);
    expect(result.conversation.history[1].content).toContain("I added a water stock");
  });

  it("repairs an unparsable reply, then accepts the corrected one", async () => {
    const { complete, calls } = scripted(
      [
        "I would add a stock first, but here is no JSON.",
        reply({
          message: "Added the stock.",
          questions: [],
          patch: { ops: [{ op: "add", kind: "stock", element: { name: "Water", equation: "100", units: "m3", documentation: "Water." } }] },
          suggestions: [],
          stage: "flows",
        }),
      ],
      [0.01, 0.02],
    );
    const result = await runTurn(emptyModel("R"), newConversation(), "Start with water.", complete, options());

    expect(calls).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ attempt: 1, kind: "parse" });
    expect(result.proposal).toBeDefined();
    expect(result.cost).toBeCloseTo(0.03);
    expect(calls[1].messages.some((m) => m.role === "assistant" && m.content.includes("no JSON"))).toBe(true);
    expect(calls[1].messages.some((m) => m.role === "user" && m.content.includes("could not be accepted"))).toBe(true);
    expect(result.conversation.history.some((m) => m.content.includes("could not be accepted"))).toBe(false);
  });

  it("sends the exact gauntlet error back and accepts the repaired patch", async () => {
    const broken = [
      { op: "add", kind: "flow", element: { name: "decay", equation: "Water * decay_rate", units: "m3/Day", documentation: "Loss." } },
      { op: "wire", flow: "decay", from: "Water", to: null },
    ];
    const fixed = [...broken, { op: "add", kind: "converter", element: { name: "decay_rate", equation: "0.1", units: "1/Day", documentation: "Rate." } }];
    const { complete, calls } = scripted([
      reply({ message: "Adding the outflow.", questions: [], patch: { ops: broken }, suggestions: [], stage: "numbers" }),
      reply({ message: "Adding the missing rate.", questions: [], patch: { ops: fixed }, suggestions: [], stage: "numbers" }),
    ]);
    const result = await runTurn(oneStockModel(), newConversation(), "Water decays.", complete, options());

    expect(calls).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].kind).toBe("gauntlet");
    expect(result.failures[0].findings?.some((f) => f.message.includes("unknown name 'decay_rate'"))).toBe(true);
    expect(result.failures[0].feedback).toContain("decay.equation references unknown name 'decay_rate'");
    expect(
      calls[1].messages.some(
        (m) => m.role === "user" && m.content.includes("decay.equation references unknown name 'decay_rate'"),
      ),
    ).toBe(true);
    expect(result.proposal).toBeDefined();
    expect(result.proposal!.model.flows).toHaveLength(1);
  });

  it("gives up after four bad replies (three repairs) without changing the model", async () => {
    const { complete, calls } = scripted(["nope", "still nope", "nope again", "one more nope"]);
    const model = oneStockModel();
    const conversation = newConversation();
    const result = await runTurn(model, conversation, "Go on.", complete, options());

    expect(calls).toHaveLength(4);
    expect(result.gaveUp).toBe(true);
    expect(result.proposal).toBeUndefined();
    expect(result.turn.patch).toBeUndefined();
    expect(result.failures).toHaveLength(4);
    expect(result.turn.message).toContain("3 repair attempts");
    expect(result.turn.message).toContain("reply does not contain a JSON object");
    expect(result.turn.message).toContain("model was not changed");
    expect(result.conversation.stage).toBe("question");
    expect(result.conversation.history).toHaveLength(2);
    expect(model.stocks[0].equation).toBe("100");
  });

  it("handles a question-only turn and advances the stage", async () => {
    const { complete } = scripted([
      reply({
        message: "Let's map the boundary.",
        questions: ["What is inside the system?", "What is held fixed?"],
        suggestions: [],
        stage: "boundary",
      }),
    ]);
    const result = await runTurn(emptyModel("R"), newConversation(), "I want to model a lake.", complete, options());

    expect(result.proposal).toBeUndefined();
    expect(result.gaveUp).toBe(false);
    expect(result.turn.stage).toBe("boundary");
    expect(result.conversation.stage).toBe("boundary");
    expect(result.conversation.history[1].content).toContain("1. What is inside the system?");
    expect(result.conversation.history[1].content).toContain("2. What is held fixed?");
  });

  it("rejects with an AbortError before calling the model when already aborted", async () => {
    const { complete, calls } = scripted(["unused"]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      runTurn(emptyModel("R"), newConversation(), "Hello", complete, options({ signal: controller.signal })),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(0);
  });

  it("rejects with an AbortError when the signal fires during the request, with no partial state", async () => {
    const controller = new AbortController();
    const complete: Complete = async (request) => {
      expect(request.signal).toBe(controller.signal);
      controller.abort();
      return { text: reply({ message: "hi", questions: [], suggestions: [], stage: "stocks" }) };
    };
    await expect(
      runTurn(emptyModel("R"), newConversation(), "Hello", complete, options({ signal: controller.signal })),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("scripted conversation", () => {
  it("builds and simulates a one-stock decay model in three turns", async () => {
    let conversation: Conversation = newConversation();
    let model = emptyModel("Decay");

    const first = scripted([
      reply({
        message: "What accumulates, and over what time span?",
        questions: ["What quantity should decay?", "How long should the run be?"],
        suggestions: [],
        stage: "stocks",
      }),
    ]);
    const turn1 = await runTurn(model, conversation, "I want to model radioactive decay over 10 years.", first.complete, options());
    conversation = turn1.conversation;

    const second = scripted([
      reply({
        message: "I added the material stock and set the run.",
        questions: [],
        patch: {
          ops: [
            { op: "add", kind: "stock", element: { name: "Material", equation: "100", units: "kg", documentation: "Undecayed material." } },
            { op: "setRun", run: { start: 0, stop: 10, dt: 0.01, saveEvery: 1, timeUnits: "Year" } },
          ],
        },
        suggestions: [],
        stage: "flows",
      }),
    ]);
    const turn2 = await runTurn(model, conversation, "It starts at 100 kg.", second.complete, options());
    conversation = turn2.conversation;
    expect(turn2.proposal).toBeDefined();
    model = turn2.proposal!.model;

    const third = scripted([
      reply({
        message: "I added the decay outflow and its rate.",
        questions: [],
        patch: {
          ops: [
            { op: "add", kind: "flow", element: { name: "decay", equation: "Material * decay_rate", units: "kg/Year", documentation: "Material lost per year." } },
            { op: "add", kind: "converter", element: { name: "decay_rate", equation: "0.1", units: "1/Year", documentation: "Fraction lost per year." } },
            { op: "wire", flow: "decay", from: "Material", to: null },
            { op: "connect", from: "Material", to: "decay" },
            { op: "connect", from: "decay_rate", to: "decay" },
          ],
        },
        suggestions: [],
        stage: "numbers",
      }),
    ]);
    const turn3 = await runTurn(model, conversation, "Ten percent each year.", third.complete, options());
    expect(turn3.proposal).toBeDefined();
    expect(turn3.conversation.stage).toBe("numbers");

    const result = simulate(turn3.proposal!.model);
    expect(result.time[0]).toBe(0);
    expect(result.time[result.time.length - 1]).toBe(10);
    expect(result.series.Material[0]).toBe(100);
    expect(result.series.Material[result.series.Material.length - 1]).toBeCloseTo(100 * Math.exp(-1), 1);
  });
});

describe("grounded runs", () => {
  afterEach(() => __setGauntletForTests());

  const answerReply = (message: string) =>
    reply({ message, questions: [], suggestions: [], stage: "next-steps" });

  it("runs the model, sends the facts back and replaces the reply with the grounded answer", async () => {
    const { complete, calls } = scripted([
      reply({
        message: "Let me run it first.",
        questions: [],
        runs: [{ label: "Base", thresholds: { Water: 50 } }],
        suggestions: [],
        stage: "numbers",
      }),
      answerReply("Water first falls below 50 at about 6.9 years."),
    ]);
    const progress: TurnProgress[] = [];
    const result = await runTurn(
      decayModel(),
      newConversation(),
      "When does Water fall below 50?",
      complete,
      options({ onProgress: (p) => progress.push(p) }),
    );

    expect(calls).toHaveLength(2);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence![0].request.label).toBe("Base");
    expect(result.evidence![0].facts).toContain("Water: falls steadily");

    const followUp = calls[1].messages;
    expect(followUp[followUp.length - 2]).toMatchObject({ role: "assistant", content: expect.stringContaining("Let me run it first.") });
    expect(followUp[followUp.length - 1].role).toBe("user");
    expect(followUp[followUp.length - 1].content).toContain("Water first falls below 50 at");
    expect(followUp[followUp.length - 1].content).toContain(
      "Now answer the user's question from these results",
    );

    expect(result.turn.message).toBe("Water first falls below 50 at about 6.9 years.");
    expect(result.turn.runs).toBeDefined();
    expect(progress.map((p) => p.phase)).toEqual(
      expect.arrayContaining(["thinking", "validating", "running", "answering"]),
    );
  });

  it("ignores runs and patches in the follow-up reply and keeps the original proposal", async () => {
    const { complete, calls } = scripted([
      reply({
        message: "Adding the stock and running it.",
        questions: [],
        patch: {
          ops: [
            {
              op: "add",
              kind: "stock",
              element: { name: "Water", equation: "100", units: "m3", documentation: "Water." },
            },
          ],
        },
        runs: [{ label: "After the change" }],
        suggestions: [],
        stage: "numbers",
      }),
      reply({
        message: "It starts at 100 and stays there.",
        questions: [],
        patch: { ops: [{ op: "remove", name: "Water" }] },
        runs: [{ label: "Sneaky second run" }],
        suggestions: [],
        stage: "next-steps",
      }),
    ]);
    const result = await runTurn(emptyModel("R"), newConversation(), "Add water.", complete, options());

    expect(calls).toHaveLength(2);
    expect(result.proposal?.model.stocks).toHaveLength(1);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence![0].request.label).toBe("After the change");
    expect(result.turn.patch?.ops).toHaveLength(1);
    expect(result.turn.runs).toHaveLength(1);
    expect(result.turn.runs![0].label).toBe("After the change");
    expect(result.turn.message).toBe("It starts at 100 and stays there.");
  });

  it("appends the facts as a bullet list when the follow-up reply does not parse", async () => {
    const { complete, calls } = scripted([
      reply({
        message: "Running the model.",
        questions: [],
        runs: [{ label: "Base", thresholds: { Water: 50 } }],
        suggestions: [],
        stage: "numbers",
      }),
      "I could not write JSON.",
    ]);
    const result = await runTurn(decayModel(), newConversation(), "When?", complete, options());

    expect(calls).toHaveLength(2);
    expect(result.gaveUp).toBe(false);
    expect(result.evidence).toHaveLength(1);
    expect(result.turn.message).toContain("Running the model.");
    expect(result.turn.message).toContain("**Base**");
    expect(result.turn.message).toContain("- Water: starts at 100, ends at 36.8 (kg)");
    expect(result.turn.message).toContain("- Water first falls below 50 at");
  });

  it("runs on the proposal by default and on the current model when asked", async () => {
    const { complete, calls } = scripted([
      reply({
        message: "Doubling the starting water and comparing.",
        questions: [],
        patch: {
          ops: [{ op: "update", name: "Water", changes: { equation: "200" } }],
        },
        runs: [
          { label: "Current", on: "current", series: ["Water"] },
          { label: "Proposal", on: "proposal", series: ["Water"] },
        ],
        suggestions: [],
        stage: "numbers",
      }),
      answerReply("It starts at 200 instead of 100."),
    ]);
    const result = await runTurn(oneStockModel(), newConversation(), "Double it.", complete, options());

    expect(calls).toHaveLength(2);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence![0].facts[0]).toContain("Water: starts at 100");
    expect(result.evidence![1].facts[0]).toContain("Water: starts at 200");
    expect(result.turn.message).toBe("It starts at 200 instead of 100.");
  });

  it("computes at most three runs per turn", async () => {
    const runs = Array.from({ length: 5 }, (_, i) => ({ label: `Run ${i + 1}` }));
    const { complete, calls } = scripted([
      reply({ message: "Running several.", questions: [], runs, suggestions: [], stage: "numbers" }),
      answerReply("Done."),
    ]);
    const result = await runTurn(decayModel(), newConversation(), "Compare.", complete, options());

    expect(calls).toHaveLength(2);
    expect(result.evidence).toHaveLength(3);
    expect(result.evidence!.map((e) => e.request.label)).toEqual(["Run 1", "Run 2", "Run 3"]);
  });

  it("repairs unit warnings once, then accepts the patch with the warnings", async () => {
    __setGauntletForTests((model, patch) => {
      const result = realGauntlet(model, patch);
      const finding: Finding = {
        stage: "units" as unknown as Finding["stage"],
        severity: "warning",
        element: "Water",
        message: "Water.units is missing",
      };
      return { ...result, findings: [...result.findings, finding] };
    });
    const patch = {
      ops: [
        {
          op: "add",
          kind: "stock",
          element: { name: "Water", equation: "100", units: "m3", documentation: "Water." },
        },
      ],
    };
    const { complete, calls } = scripted([
      reply({ message: "Added water.", questions: [], patch, suggestions: [], stage: "numbers" }),
      reply({ message: "Added water.", questions: [], patch, suggestions: [], stage: "numbers" }),
    ]);
    const result = await runTurn(emptyModel("R"), newConversation(), "Add water.", complete, options());

    expect(calls).toHaveLength(2);
    expect(calls[1].messages.some((m) => m.content.includes("Water.units is missing"))).toBe(true);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].findings?.[0].message).toBe("Water.units is missing");
    expect(result.proposal).toBeDefined();
    expect(result.proposal!.warnings.map((w) => w.message)).toContain("Water.units is missing");
  });

  it("does not repair unit warnings about elements the patch did not touch", async () => {
    __setGauntletForTests((model, patch) => {
      const result = realGauntlet(model, patch);
      return {
        ...result,
        findings: [
          ...result.findings,
          {
            stage: "units" as unknown as Finding["stage"],
            severity: "warning",
            element: "Elsewhere",
            message: "Elsewhere.units is inconsistent",
          },
        ],
      };
    });
    const { complete, calls } = scripted([
      reply({
        message: "Added water.",
        questions: [],
        patch: {
          ops: [
            {
              op: "add",
              kind: "stock",
              element: { name: "Water", equation: "100", units: "m3", documentation: "Water." },
            },
          ],
        },
        suggestions: [],
        stage: "numbers",
      }),
    ]);
    const result = await runTurn(emptyModel("R"), newConversation(), "Add water.", complete, options());

    expect(calls).toHaveLength(1);
    expect(result.proposal!.warnings.map((w) => w.message)).toContain("Elsewhere.units is inconsistent");
  });

  it("streams the partial message through onProgress", async () => {
    const complete: Complete = async (request) => {
      request.onText?.('{"message": "Hel');
      request.onText?.('{"message": "Hello \\"there');
      return {
        text: reply({ message: 'Hello "there', questions: [], suggestions: [], stage: "stocks" }),
      };
    };
    const progress: TurnProgress[] = [];
    await runTurn(emptyModel("R"), newConversation(), "Hi", complete, options({ onProgress: (p) => progress.push(p) }));

    const partials = progress.filter((p) => p.partialMessage !== undefined).map((p) => p.partialMessage);
    expect(partials).toEqual(["Hel", 'Hello "there']);
    expect(progress[0].phase).toBe("thinking");
  });
});
