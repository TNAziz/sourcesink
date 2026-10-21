import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TurnProgress } from "@sourcesink/assistant";

import { phaseLabel, StreamingReply } from "./StreamingReply";

function render(progress: TurnProgress | null): string {
  return renderToStaticMarkup(createElement(StreamingReply, { progress }));
}

describe("StreamingReply", () => {
  it("labels every phase", () => {
    expect(phaseLabel("thinking")).toBe("Thinking…");
    expect(phaseLabel("validating")).toMatch(/Checking/);
    expect(phaseLabel("repairing")).toMatch(/Fixing/);
    expect(phaseLabel("running")).toMatch(/Running/);
    expect(phaseLabel("answering")).toMatch(/Writing/);
  });

  it("defaults to thinking before the first progress event", () => {
    expect(render(null)).toContain("Thinking…");
  });

  it("shows the streamed partial message", () => {
    const out = render({ phase: "answering", partialMessage: "A stock is an accumulation" });
    expect(out).toContain("Writing the reply…");
    expect(out).toContain("A stock is an accumulation");
  });

  it("omits the text before the message starts", () => {
    const out = render({ phase: "validating" });
    expect(out).toContain("Checking the reply…");
    expect(out).not.toContain("partial");
  });
});
