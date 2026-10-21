import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@sourcesink/assistant";

import { isCompletedReply, scriptedUserMessages } from "./user.js";

const STORY = "A pond is filled by a constant diversion, so its storage grows linearly.";
const DESCRIPTION = "## Stocks\n\nStorage starts at 10 and is filled by Inflow.";

describe("scriptedUserMessages", () => {
  it("puts the story, the description and the rules in the system prompt", () => {
    const messages = scriptedUserMessages(STORY, DESCRIPTION, []);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain(STORY);
    expect(messages[0].content).toContain(DESCRIPTION);
    expect(messages[0].content).toContain("plain language");
    expect(messages[0].content).toContain("Only give a rate law when the assistant explicitly asks");
    expect(messages[0].content).toContain("DONE");
  });

  it("swaps the roles of the conversation so far", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "I have a pond." },
      { role: "assistant", content: "What accumulates?\n\n1. Water?" },
      { role: "user", content: "Water, starting at 10." },
    ];

    const messages = scriptedUserMessages(STORY, DESCRIPTION, history);
    expect(messages.slice(1)).toEqual([
      { role: "assistant", content: "I have a pond." },
      { role: "user", content: "What accumulates?\n\n1. Water?" },
      { role: "assistant", content: "Water, starting at 10." },
    ]);
  });

  it("does not mutate the history it is given", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "I have a pond." },
      { role: "assistant", content: "What accumulates?" },
    ];
    const snapshot = structuredClone(history);

    scriptedUserMessages(STORY, DESCRIPTION, history);
    expect(history).toEqual(snapshot);
  });
});

describe("isCompletedReply", () => {
  it("accepts the DONE token alone, with optional punctuation and emphasis", () => {
    expect(isCompletedReply("DONE")).toBe(true);
    expect(isCompletedReply("  done. ")).toBe(true);
    expect(isCompletedReply('"DONE"')).toBe(true);
  });

  it("does not accept DONE inside a sentence", () => {
    expect(isCompletedReply("Not done yet.")).toBe(false);
    expect(isCompletedReply("DONE once you add the outflow.")).toBe(false);
    expect(isCompletedReply("")).toBe(false);
  });
});
