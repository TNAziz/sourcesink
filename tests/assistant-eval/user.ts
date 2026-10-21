/**
 * SourceSink — the scripted user for the assistant round trip.
 *
 * The scripted user is a second language-model call that plays someone who
 * knows the real system. It is given the corpus `story` (the user's own words)
 * and the original model's structural description (the truth), and answers the
 * assistant's questions from those two things only.
 */

import type { ChatMessage } from "@sourcesink/assistant";

const RULES = `You are playing the user in a conversation with a system-dynamics modeling assistant.

You know the real system described below. Answer the assistant's questions from that knowledge only, in plain language, as a person who knows the system would (not as a model author). Keep each reply to one to three short sentences.

Rules:
- Do not invent details that are not in the story or the description.
- Do not volunteer equations. Only give a rate law when the assistant explicitly asks for one, and then state it in words or as a simple formula.
- Do not tell the assistant how to build the model; answer the question and stop.
- When the assistant's model is complete (it has the same stocks, flows and feedback as the description), reply with exactly the token DONE and nothing else. Never say DONE before then.`;

function systemPrompt(story: string, description: string): string {
  return [
    RULES,
    "",
    "## The system, in your own words",
    "",
    story.trim(),
    "",
    "## The system as it really is",
    "",
    description.trim(),
  ].join("\n");
}

/**
 * Build the scripted user's messages for its next reply: a system prompt with
 * the story, the model description and the rules above, then the conversation
 * so far with the roles swapped (the assistant's messages become the user's,
 * and the real user's messages become the assistant's).
 */
export function scriptedUserMessages(
  story: string,
  description: string,
  history: ChatMessage[],
): ChatMessage[] {
  const swapped: ChatMessage[] = history.map((message) => ({
    role:
      message.role === "user" ? "assistant" : message.role === "assistant" ? "user" : "system",
    content: message.content,
  }));
  return [{ role: "system", content: systemPrompt(story, description) }, ...swapped];
}

/** True when the scripted user declared the model complete. The token must be
 * the whole reply; surrounding quotes, emphasis or a full stop are tolerated. */
export function isCompletedReply(text: string): boolean {
  return /^[\s"'`*_]*done[.!]?[\s"'`*_]*$/i.test(text);
}
