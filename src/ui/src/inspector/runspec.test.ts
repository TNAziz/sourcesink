import { describe, expect, it } from "vitest";

import { runToDraft, validateRunDraft, type RunDraft } from "./runspec";

function draft(overrides: Partial<RunDraft> = {}): RunDraft {
  return { start: "0", stop: "12", dt: "0.25", saveEvery: "1", ...overrides };
}

describe("runToDraft", () => {
  it("renders numbers as strings", () => {
    expect(runToDraft({ start: 0, stop: 20, dt: 0.5, saveEvery: 2 })).toEqual({
      start: "0",
      stop: "20",
      dt: "0.5",
      saveEvery: "2",
    });
  });
});

describe("validateRunDraft", () => {
  it("accepts a well-formed spec", () => {
    const result = validateRunDraft(draft());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.values).toEqual({ start: 0, stop: 12, dt: 0.25, saveEvery: 1 });
  });

  it("rejects a non-positive dt and omits it from the values", () => {
    const result = validateRunDraft(draft({ dt: "0" }));
    expect(result.valid).toBe(false);
    expect(result.errors.dt).toBe("Must be > 0");
    expect(result.values.dt).toBeUndefined();
  });

  it("rejects a non-positive save interval", () => {
    expect(validateRunDraft(draft({ saveEvery: "-1" })).errors.saveEvery).toBe("Must be > 0");
  });

  it("rejects stop before start", () => {
    const result = validateRunDraft(draft({ start: "10", stop: "5" }));
    expect(result.errors.stop).toBe("Must be ≥ start");
  });

  it("treats a blank or non-numeric field as invalid", () => {
    expect(validateRunDraft(draft({ start: "" })).errors.start).toBe("Enter a number");
    expect(validateRunDraft(draft({ stop: "abc" })).errors.stop).toBe("Enter a number");
  });

  it("allows a zero start", () => {
    expect(validateRunDraft(draft({ start: "0" })).valid).toBe(true);
  });
});
