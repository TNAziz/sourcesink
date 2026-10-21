/**
 * SourceSink — Node-only language-model bridge for the assistant (OpenCode).
 * Imported by the desktop main process and the Vite dev server, never by the
 * browser bundle.
 */

export * from "./opencode.js";
export * from "./server.js";
export * from "./http.js";
export type { OpencodeStatus } from "./types.js";
