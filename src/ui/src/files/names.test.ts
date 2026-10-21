import { describe, expect, it } from "vitest";
import { ensureXmileExtension, firstLine, prettifyExampleName, suggestFileName } from "./names";

describe("prettifyExampleName", () => {
  it("title-cases hyphenated slugs", () => {
    expect(prettifyExampleName("logistic-harvest")).toBe("Logistic Harvest");
  });

  it("title-cases underscore and space slugs", () => {
    expect(prettifyExampleName("co2_accumulation")).toBe("Co2 Accumulation");
    expect(prettifyExampleName("reservoir sedimentation")).toBe("Reservoir Sedimentation");
  });

  it("leaves an already-formatted model name untouched", () => {
    expect(prettifyExampleName("Logistic Population Growth with Harvest")).toBe(
      "Logistic Population Growth with Harvest",
    );
    expect(prettifyExampleName("Streeter-Phelps DO sag")).toBe("Streeter-Phelps DO sag");
  });

  it("falls back to Untitled for empty input", () => {
    expect(prettifyExampleName("   ")).toBe("Untitled");
  });
});

describe("firstLine", () => {
  it("returns the first non-empty trimmed line", () => {
    expect(firstLine("\n\n  hello world \nsecond")).toBe("hello world");
  });

  it("returns empty string for missing text", () => {
    expect(firstLine(undefined)).toBe("");
    expect(firstLine(null)).toBe("");
    expect(firstLine("   \n  ")).toBe("");
  });
});

describe("suggestFileName", () => {
  it("keeps an existing file name and forces an XMILE extension", () => {
    expect(suggestFileName("my-model", "Whatever")).toBe("my-model.xmile");
    expect(suggestFileName("model.xml", "Whatever")).toBe("model.xml");
  });

  it("slugifies the model name when there is no file name", () => {
    expect(suggestFileName(null, "Logistic Population Growth")).toBe(
      "logistic-population-growth.xmile",
    );
    expect(suggestFileName(null, "   ")).toBe("untitled.xmile");
  });
});

describe("ensureXmileExtension", () => {
  it("appends .xmile only when no accepted extension is present", () => {
    expect(ensureXmileExtension("a")).toBe("a.xmile");
    expect(ensureXmileExtension("a.xmile")).toBe("a.xmile");
    expect(ensureXmileExtension("a.stmx")).toBe("a.stmx");
    expect(ensureXmileExtension("a.XML")).toBe("a.XML");
  });
});
