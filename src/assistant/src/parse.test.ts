import { describe, expect, it } from "vitest";

import { parseTurn } from "./parse.js";

const base = {
  message: "Tell me more.",
  questions: [],
  suggestions: [],
  stage: "stocks",
};

function json(value: unknown): string {
  return JSON.stringify(value);
}

describe("parseTurn", () => {
  it("parses a bare JSON object", () => {
    const result = parseTurn(json(base), "question");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn.message).toBe("Tell me more.");
    expect(result.turn.stage).toBe("stocks");
  });

  it("accepts a ```json fenced object", () => {
    const result = parseTurn("```json\n" + json(base) + "\n```", "question");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.turn.message).toBe("Tell me more.");
  });

  it("finds the object inside surrounding prose", () => {
    const result = parseTurn(`Sure, here is the reply:\n${json(base)}\nLet me know.`, "question");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.turn.stage).toBe("stocks");
  });

  it("ignores braces inside strings while balancing", () => {
    const text = json({ ...base, message: "Use {curly} braces and a } too." });
    const result = parseTurn(`reply: ${text}`, "question");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.turn.message).toBe("Use {curly} braces and a } too.");
  });

  it("treats missing questions as an empty list", () => {
    const result = parseTurn(json({ message: "Hi", stage: "flows" }), "question");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.turn.questions).toEqual([]);
  });

  it("keeps only the first three of five questions", () => {
    const result = parseTurn(
      json({ ...base, questions: ["a", "b", "c", "d", "e"] }),
      "question",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.turn.questions).toEqual(["a", "b", "c"]);
  });

  it("falls back to the current stage when the reply stage is unknown", () => {
    const result = parseTurn(json({ ...base, stage: "astrology" }), "feedback");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.turn.stage).toBe("feedback");
  });

  it("falls back to the current stage when the reply stage is missing", () => {
    const result = parseTurn(json({ message: "Hi" }), "numbers");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.turn.stage).toBe("numbers");
  });

  it("drops suggestions whose feature is unknown", () => {
    const result = parseTurn(
      json({
        ...base,
        suggestions: [
          { feature: "telepathy", reason: "not a feature" },
          { feature: "calibrate", reason: "you have data", elements: ["k"] },
        ],
      }),
      "question",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.turn.suggestions).toHaveLength(1);
      expect(result.turn.suggestions[0]).toMatchObject({ feature: "calibrate", elements: ["k"] });
    }
  });

  it("returns an error for a non-object reply", () => {
    for (const text of ["[1, 2, 3]", "42", "no json here"]) {
      const result = parseTurn(text, "question");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBeTruthy();
    }
  });

  it("returns an error when the message is missing or empty", () => {
    for (const value of [{ questions: [] }, { message: "   " }, { message: 4 }]) {
      const result = parseTurn(json(value), "question");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("message must be a non-empty string");
    }
  });

  it("returns a precise error when questions is not an array of strings", () => {
    const result = parseTurn(json({ ...base, questions: ["ok", 3] }), "question");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("questions must be an array of strings");
  });

  it("requires a patch to be an object with an ops array", () => {
    for (const patch of [null, [], { ops: "nope" }, { notOps: [] }]) {
      const result = parseTurn(json({ ...base, patch }), "question");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("patch must be an object with an ops array");
    }
  });

  it("leaves op validation to the gauntlet", () => {
    const patch = { ops: [{ op: "bogus", name: "x" }] };
    const result = parseTurn(json({ ...base, patch }), "question");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.turn.patch).toEqual(patch);
  });

  it("never throws on malformed text", () => {
    for (const text of ["", "{", '{"message":"x"', "```json\n{oops}\n```", '{"message":"x"} trailing }']) {
      expect(() => parseTurn(text, "question")).not.toThrow();
    }
  });
});

describe("parseTurn runs", () => {
  it("keeps a valid run request with all its fields", () => {
    const result = parseTurn(
      json({
        ...base,
        runs: [
          {
            label: "Loading halved",
            on: "current",
            set: { loading: 5 },
            series: ["DO"],
            thresholds: { DO: 5 },
          },
        ],
      }),
      "question",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn.runs).toEqual([
      {
        label: "Loading halved",
        on: "current",
        set: { loading: 5 },
        series: ["DO"],
        thresholds: { DO: 5 },
      },
    ]);
  });

  it("keeps at most three runs", () => {
    const result = parseTurn(
      json({
        ...base,
        runs: [{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }],
      }),
      "question",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.turn.runs?.map((r) => r.label)).toEqual(["a", "b", "c"]);
  });

  it("drops malformed runs and non-numeric values without failing the turn", () => {
    const result = parseTurn(
      json({
        ...base,
        runs: [
          null,
          { label: 7 },
          { label: "  " },
          { label: "ok", on: "somewhere", set: { good: 2, bad: "x" }, thresholds: { t: -1, u: "no" } },
        ],
      }),
      "question",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn.runs).toEqual([
      { label: "ok", set: { good: 2 }, thresholds: { t: -1 } },
    ]);
  });

  it("filters non-string series names and ignores an empty series list", () => {
    const result = parseTurn(
      json({
        ...base,
        runs: [
          { label: "a", series: ["DO", 4, "BOD"] },
          { label: "b", series: [] },
        ],
      }),
      "question",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn.runs).toEqual([{ label: "a", series: ["DO", "BOD"] }, { label: "b" }]);
  });

  it("treats a non-array runs value as no runs", () => {
    for (const runs of [{}, "base", 3, null]) {
      const result = parseTurn(json({ ...base, runs }), "question");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.turn.runs).toBeUndefined();
    }
  });
});
