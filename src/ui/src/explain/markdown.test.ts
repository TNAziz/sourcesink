import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseInline, parseMarkdown, renderMarkdown } from "./markdown";

function html(markdown: string): string {
  return renderToStaticMarkup(createElement("div", null, renderMarkdown(markdown)));
}

describe("parseMarkdown", () => {
  it("recognises headings, bullets and paragraphs", () => {
    const blocks = parseMarkdown("## Stocks\n\n- one\n- two\n\nA paragraph.");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "bullets", "paragraph"]);
  });

  it("splits inline bold, italic and code", () => {
    expect(parseMarkdown("- **Population** grows through *births* at `r * x`.")[0]).toEqual({
      type: "bullets",
      items: [
        [
          { type: "strong", text: "Population" },
          { type: "text", text: " grows through " },
          { type: "em", text: "births" },
          { type: "text", text: " at " },
          { type: "code", text: "r * x" },
          { type: "text", text: "." },
        ],
      ],
    });
  });

  it("keeps unmatched markers as literal text", () => {
    expect(parseInline("*not closed")).toEqual([{ type: "text", text: "*not closed" }]);
  });
});

describe("renderMarkdown", () => {
  it("renders the supported elements", () => {
    const out = html("## Stocks\n\n- **Population** depends on *growth* and `r * x`.");
    expect(out).toContain("<h2>Stocks</h2>");
    expect(out).toContain(
      "<ul><li><strong>Population</strong> depends on <em>growth</em> and <code>r * x</code>.</li></ul>",
    );
  });

  it("escapes raw HTML instead of injecting it", () => {
    const out = html("## <script>alert('x')</script>\n\n- <img src=x onerror=alert(1)>");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
  });
});
