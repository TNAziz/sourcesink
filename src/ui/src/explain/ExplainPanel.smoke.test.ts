import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyModel } from "@sourcesink/model";

import { useEditor } from "../state/store";
import { ExplainPanel } from "./ExplainPanel";

describe("ExplainPanel", () => {
  beforeEach(() => useEditor.getState().loadModel(emptyModel("Smoke"), null));

  it("renders the description, loop list and coverage without a DOM", () => {
    const out = renderToStaticMarkup(createElement(ExplainPanel, { onClose: () => {} }));
    expect(out).toContain("Describe");
    expect(out).toContain("Overview");
    expect(out).toContain("Feedback loops");
    expect(out).toContain("Coverage");
    expect(out).toContain("Covers all");
  });
});
