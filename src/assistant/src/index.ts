/**
 * SourceSink — conversational modeling assistant (browser-safe core).
 *
 * Interviews the user, asks a language model for the next reply as JSON, and
 * only ever proposes model changes as patches that passed the gauntlet. The
 * Node-only language-model bridge lives in `@sourcesink/assistant/node`.
 */

export * from "./contracts.js";
export * from "./partial.js";
export * from "./prompt.js";
export * from "./parse.js";
export * from "./suggest.js";
export * from "./turn.js";
