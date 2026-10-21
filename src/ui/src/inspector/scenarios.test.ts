import { describe, expect, it } from "vitest";
import type { Scenario } from "@sourcesink/model";

import {
  overridesToRows,
  parseOverrideValue,
  rowsToOverrides,
  uniqueScenarioId,
  uniqueScenarioName,
} from "./scenarios";

const scenario = (id: string, name: string): Scenario => ({ id, name, overrides: {} });

describe("scenario override rows", () => {
  it("keeps finite numbers as numbers and other text as equations", () => {
    expect(parseOverrideValue("0.5")).toBe(0.5);
    expect(parseOverrideValue(" -2 ")).toBe(-2);
    expect(parseOverrideValue("1e3")).toBe(1000);
    expect(parseOverrideValue("0.5 * base")).toBe("0.5 * base");
    expect(parseOverrideValue("high")).toBe("high");
    expect(parseOverrideValue("   ")).toBe("");
  });

  it("converts between the override record and rows", () => {
    const overrides = { rate: 0.2, Population: 50, label: "high" };
    expect(overridesToRows(overrides)).toEqual([
      { name: "rate", value: "0.2" },
      { name: "Population", value: "50" },
      { name: "label", value: "high" },
    ]);
    expect(rowsToOverrides(overridesToRows(overrides))).toEqual(overrides);
  });

  it("drops blank names, trims names and lets later rows win", () => {
    expect(
      rowsToOverrides([
        { name: " rate ", value: "0.1" },
        { name: "", value: "1" },
        { name: "rate", value: "0.3" },
      ]),
    ).toEqual({ rate: 0.3 });
  });
});

describe("scenario ids and names", () => {
  it("derives a slug id and disambiguates collisions", () => {
    expect(uniqueScenarioId([], "High growth")).toBe("high-growth");
    expect(uniqueScenarioId([scenario("high-growth", "High growth")], "High growth")).toBe("high-growth-2");
    expect(uniqueScenarioId([], "  ")).toBe("scenario");
  });

  it("keeps names unique, case-insensitively", () => {
    expect(uniqueScenarioName([])).toBe("Scenario");
    expect(uniqueScenarioName([scenario("a", "Scenario")])).toBe("Scenario 2");
    expect(uniqueScenarioName([scenario("a", "Base")], "base")).toBe("base 2");
    expect(uniqueScenarioName([scenario("a", "Base")], "Other")).toBe("Other");
  });
});
