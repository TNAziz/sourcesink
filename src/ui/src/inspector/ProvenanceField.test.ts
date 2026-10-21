import { describe, expect, it } from "vitest";

import { provenanceSummary, sourceHref } from "./ProvenanceField";

describe("provenance summary", () => {
  it("describes imports, AI proposals and human work", () => {
    expect(provenanceSummary({ author: "import", agent: "sourcesink-legacy-import" })).toBe(
      "Imported from a legacy model",
    );
    expect(provenanceSummary({ author: "ai", agent: "sourcesink-assistant", confidence: 0.8 })).toBe(
      "Proposed by AI (sourcesink-assistant, confidence 80%)",
    );
    expect(provenanceSummary({ author: "ai" })).toBe("Proposed by AI");
    expect(provenanceSummary({ author: "ai", confidence: 0.5 })).toBe("Proposed by AI (confidence 50%)");
    expect(provenanceSummary({ author: "human" })).toBe("Human-authored");
  });
});

describe("source links", () => {
  it("links URLs and DOIs, leaving other source ids as plain text", () => {
    expect(sourceHref("https://example.org/model")).toBe("https://example.org/model");
    expect(sourceHref("10.1000/xyz123")).toBe("https://doi.org/10.1000/xyz123");
    expect(sourceHref("doi: 10.1000/xyz123")).toBe("https://doi.org/10.1000/xyz123");
    expect(sourceHref("dataset:pop-2020")).toBeNull();
  });
});
