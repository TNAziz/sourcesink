/**
 * SourceSink — MCP tool surface.
 *
 * `createTools()` is the transport-independent API; `server.ts` wraps it in a
 * stdio MCP server (tools and resources).
 */

export { createTools, isToolError, ModelTools } from "./tools.js";
export type {
  CalibrateResult,
  CreateResult,
  EnsembleOutput,
  ExplainResult,
  HistoryEntry,
  OpenResult,
  PatchResult,
  SimulateResult,
  ToolError,
  ToolErrorCode,
  ToolResult,
  ValidateResult,
} from "./tools.js";
export * from "./schemas.js";
