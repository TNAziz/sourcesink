import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { emptyModel } from "@sourcesink/model";

import { useEditor } from "../state/store";
import { AnalyzePanel } from "./AnalyzePanel";

describe("AnalyzePanel", () => {
  beforeEach(() => useEditor.getState().loadModel(emptyModel("Smoke"), null));

  it("renders the three analysis tabs without a DOM", () => {
    const out = renderToStaticMarkup(createElement(AnalyzePanel, { onClose: () => {} }));
    expect(out).toContain("Analyze");
    expect(out).toContain("Calibrate");
    expect(out).toContain("Sensitivity");
    expect(out).toContain("Uncertainty");
    expect(out).toContain("Observations");
  });

  it("stays rendered but hidden when closed, so runs keep going", () => {
    const out = renderToStaticMarkup(createElement(AnalyzePanel, { onClose: () => {}, open: false }));
    expect(out).toContain("ana-panel-hidden");
    expect(out).toContain('aria-hidden="true"');
    expect(out).not.toContain("ana-backdrop");
    expect(out).toContain("Sensitivity");
  });
});
