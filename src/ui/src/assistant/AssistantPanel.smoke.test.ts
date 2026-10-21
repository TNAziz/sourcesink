import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { AssistantPanel } from "./AssistantPanel";
import type { AssistantClient } from "./client";
import { DEFAULT_MODEL } from "./logic";
import { resetSession, appendUser } from "./session";

const client: AssistantClient = {
  complete: async () => ({ text: "{}" }),
  models: async () => [DEFAULT_MODEL, "openrouter/other/model"],
  status: async () => ({ available: true, version: "1.0.0" }),
};

describe("AssistantPanel", () => {
  beforeEach(() => resetSession());

  it("renders the header, stage strip and empty state without a DOM", () => {
    const out = renderToStaticMarkup(
      createElement(AssistantPanel, { onClose: () => {}, onSuggestion: () => {}, client }),
    );
    expect(out).toContain("Assistant");
    expect(out).toContain(DEFAULT_MODEL);
    expect(out).toContain("Question");
    expect(out).toContain("Next steps");
    expect(out).toContain("Oxygen in a river below a treatment plant");
    expect(out).toContain("Send");
  });

  it("renders a kept conversation after the panel reopens", () => {
    appendUser("Model oxygen in a river.");
    const out = renderToStaticMarkup(
      createElement(AssistantPanel, { onClose: () => {}, onSuggestion: () => {}, client }),
    );
    expect(out).toContain("Model oxygen in a river.");
    expect(out).not.toContain("Describe a system in ordinary language");
  });
});
