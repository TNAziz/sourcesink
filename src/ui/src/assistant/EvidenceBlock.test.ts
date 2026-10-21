import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RunEvidence } from "@sourcesink/assistant";

import { EvidenceBlock } from "./EvidenceBlock";

const base: RunEvidence = {
  request: { label: "Current loading" },
  ok: true,
  timeUnits: "Day",
  time: [0, 1, 2],
  series: { DO: [8, 6, 5.5] },
  facts: ["DO: starts at 8, ends at 5.5 (mg/L)", "DO first falls below 6 at 1 Day"],
};

const failed: RunEvidence = {
  request: { label: "Loading halved", set: { nope: 1 } },
  ok: false,
  error: "unknown element 'nope'",
  time: [],
  series: {},
  facts: [],
};

describe("EvidenceBlock", () => {
  it("renders one card per run with its label, facts and errors", () => {
    const out = renderToStaticMarkup(createElement(EvidenceBlock, { evidence: [base, failed] }));
    expect(out).toContain("Current loading");
    expect(out).toContain("DO: starts at 8, ends at 5.5 (mg/L)");
    expect(out).toContain("DO first falls below 6 at 1 Day");
    expect(out).toContain("Loading halved");
    expect(out).toContain("unknown element &#x27;nope&#x27;");
  });

  it("renders nothing when there is no evidence", () => {
    expect(renderToStaticMarkup(createElement(EvidenceBlock, { evidence: [] }))).toBe("");
  });
});
