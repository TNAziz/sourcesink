/**
 * SourceSink — types shared between the Node bridge and the browser client.
 *
 * Kept free of Node imports so `src/ui/src/assistant/client.ts` can import the
 * type without pulling `node:child_process` into the web bundle.
 */

export interface OpencodeStatus {
  available: boolean;
  /** Reported by `opencode --version` when available. */
  version?: string;
  /** Setup advice when the CLI is missing or cannot be run. */
  reason?: string;
}
