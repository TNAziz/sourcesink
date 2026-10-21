import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExamplesMenu } from "./ExamplesMenu";

describe("ExamplesMenu", () => {
  it("renders the search, filters and cards without a DOM", () => {
    const out = renderToStaticMarkup(createElement(ExamplesMenu, { onClose: () => {} }));
    expect(out).toContain("Example models");
    expect(out).toContain("Search examples");
    expect(out).toContain("All levels");
    expect(out).toContain("Environmental engineering");
    expect(out).toContain("Streeter-Phelps dissolved-oxygen sag");
    expect(out).toContain("Based on Streeter (1925)");
  });
});
