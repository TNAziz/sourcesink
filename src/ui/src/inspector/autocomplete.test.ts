import { describe, expect, it } from "vitest";

import {
  applyCompletion,
  matchCompletions,
  tokenAtCursor,
  type Completion,
} from "./autocomplete";

const candidates: Completion[] = [
  { label: "Deer", insert: "Deer", kind: "element" },
  { label: "birth rate", insert: "birth_rate", kind: "element" },
  { label: "deaths", insert: "deaths", kind: "element" },
  { label: "SMTH1", insert: "SMTH1", kind: "builtin" },
];

describe("tokenAtCursor", () => {
  it("extracts the identifier ending at the caret", () => {
    const text = "Deer * BIRTH_RATE";
    expect(tokenAtCursor(text, text.length)).toEqual({
      start: 7,
      end: 17,
      query: "BIRTH_RATE",
    });
  });

  it("returns the partial word when the caret is mid-identifier", () => {
    expect(tokenAtCursor("Deer * BIRTH_RATE", 12)).toEqual({
      start: 7,
      end: 17,
      query: "BIRTH",
    });
  });

  it("returns null when the caret is not next to an identifier", () => {
    expect(tokenAtCursor("SMTH1(", 6)).toBeNull();
    expect(tokenAtCursor("Deer ", 5)).toBeNull();
    expect(tokenAtCursor("", 0)).toBeNull();
  });

  it("clamps the caret to the text bounds", () => {
    expect(tokenAtCursor("abc", 99)).toEqual({ start: 0, end: 3, query: "abc" });
    expect(tokenAtCursor("abc", -5)).toEqual({ start: 0, end: 3, query: "" });
  });
});

describe("matchCompletions", () => {
  it("ranks prefix matches before substring matches", () => {
    const items: Completion[] = [
      { label: "birth rate", insert: "birth_rate", kind: "element" },
      { label: "rate of change", insert: "rate_of_change", kind: "element" },
    ];
    expect(matchCompletions("rate", items).map((c) => c.insert)).toEqual([
      "rate_of_change",
      "birth_rate",
    ]);
  });

  it("is case-insensitive and orders shorter labels first within a tier", () => {
    expect(matchCompletions("de", candidates).map((c) => c.insert)).toEqual([
      "Deer",
      "deaths",
    ]);
  });

  it("returns all candidates in order for an empty query", () => {
    expect(matchCompletions("", candidates)).toEqual(candidates);
  });

  it("drops candidates that do not match", () => {
    expect(matchCompletions("zzz", candidates)).toEqual([]);
  });

  it("deduplicates candidates by insert text", () => {
    const dupes: Completion[] = [
      { label: "Deer", insert: "Deer", kind: "element" },
      { label: "deer", insert: "deer", kind: "element" },
    ];
    expect(matchCompletions("dee", dupes)).toHaveLength(1);
  });
});

describe("applyCompletion", () => {
  it("replaces the whole token and moves the caret past the insert", () => {
    const text = "Deer * BIR";
    const token = tokenAtCursor(text, text.length);
    expect(token).not.toBeNull();
    expect(applyCompletion(text, token!, "BIRTH_RATE")).toEqual({
      text: "Deer * BIRTH_RATE",
      cursor: 17,
    });
  });

  it("replaces characters after the caret that belong to the token", () => {
    const text = "Deer * BIRTH_RATE + 1";
    const token = tokenAtCursor(text, 12);
    expect(applyCompletion(text, token!, "rate")).toEqual({
      text: "Deer * rate + 1",
      cursor: 11,
    });
  });
});
