/**
 * SourceSink — language-model calls through the OpenCode CLI.
 *
 * Every completion runs `opencode run` with a custom, tool-less agent defined
 * in a temporary config file. The child gets the prompt on stdin, runs in an
 * empty temporary directory (so it cannot see the user's project), and its
 * JSON-lines output is reduced to the assistant's `CompletionResponse`.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ChatMessage,
  Complete,
  CompletionRequest,
  CompletionResponse,
} from "../contracts.js";
import type { OpencodeStatus } from "./types.js";

export const DEFAULT_MODEL = "openrouter/deepseek/deepseek-v4.1-flash-1017";

/** On Windows `opencode` is usually a .cmd shim, which needs a shell. */
export const SPAWN_SHELL = process.platform === "win32";

/** Model ids reach a command line (and on Windows a shell), so only plain
 * provider/model characters are allowed. */
export function assertSafeModelId(model: string): string {
  if (!/^[A-Za-z0-9._~:/-]{1,200}$/.test(model)) {
    throw new Error(`invalid model id: ${JSON.stringify(model)}`);
  }
  return model;
}

export interface OpencodeOptions {
  /** Executable; default "opencode". */
  bin?: string;
  /** Kill the child after this long; default 120000 ms. */
  timeoutMs?: number;
}

const DEFAULT_OPTIONS: Required<OpencodeOptions> = {
  bin: "opencode",
  timeoutMs: 120_000,
};

/** The agent that must be used: primary mode, no tools, JSON-object replies. */
export const AGENT_CONFIG = {
  $schema: "https://opencode.ai/config.json",
  agent: {
    sourcesink: {
      description: "SourceSink modeling assistant (no tools)",
      mode: "primary",
      prompt:
        "You are the SourceSink modeling assistant. Reply with a single JSON object only.",
      tools: { "*": false },
      permission: { edit: "deny", bash: "deny", webfetch: "deny" },
    },
  },
};

interface OpencodeEvent {
  type?: unknown;
  part?: unknown;
  error?: unknown;
  message?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Flatten messages into one prompt for stdin: the system message first, then
 * each message under a "### USER" / "### ASSISTANT" header.
 */
export function flattenMessages(messages: ChatMessage[]): string {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const turns = messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "### USER" : "### ASSISTANT"}\n${m.content}`);
  return [system, ...turns].filter((part) => part.length > 0).join("\n\n");
}

function errorText(event: OpencodeEvent): string {
  for (const value of [event.error, event.message]) {
    if (typeof value === "string" && value.trim()) return value;
    if (isRecord(value)) {
      const nested = isRecord(value.data) ? value.data.message : undefined;
      for (const candidate of [value.message, nested, value.name]) {
        if (typeof candidate === "string" && candidate.trim()) return candidate;
      }
    }
  }
  return "unknown error";
}

/**
 * Parse opencode's JSON-lines stdout into a CompletionResponse (join text
 * parts in order; sum cost and tokens over step_finish events). Ignore blank
 * and non-JSON lines. Throw with a clear message on an error event or when no
 * text was produced.
 */
export function parseOpencodeEvents(stdout: string): CompletionResponse {
  const texts: string[] = [];
  let cost = 0;
  let tokens = 0;
  let sawCost = false;
  let sawTokens = false;

  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const event = parsed as OpencodeEvent;

    if (event.type === "error") {
      throw new Error(`opencode error: ${errorText(event)}`);
    }

    if (event.type === "text" && isRecord(event.part)) {
      if (event.part.type === "text" || typeof event.part.text === "string") {
        if (typeof event.part.text === "string") texts.push(event.part.text);
      }
      continue;
    }

    if (event.type === "step_finish" && isRecord(event.part)) {
      const part = event.part;
      if (typeof part.cost === "number") {
        cost += part.cost;
        sawCost = true;
      }
      const reported = part.tokens;
      if (typeof reported === "number") {
        tokens += reported;
        sawTokens = true;
      } else if (isRecord(reported) && typeof reported.total === "number") {
        tokens += reported.total;
        sawTokens = true;
      }
    }
  }

  const text = texts.join("");
  if (texts.length === 0) {
    throw new Error("opencode produced no text");
  }
  return {
    text,
    ...(sawCost ? { cost } : {}),
    ...(sawTokens ? { tokens } : {}),
  };
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

function stderrTail(stderr: string): string {
  const lines = stderr.trim().split(/\r?\n/).filter((line) => line.trim());
  return lines.slice(-5).join("\n");
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Run a short-lived command to completion (used for models/version). */
function runCollect(bin: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], shell: SPAWN_SHELL });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

/** Write the tool-less agent config once; shared by the CLI and server bridges. */
let configFile: Promise<string> | undefined;
export function agentConfigPath(): Promise<string> {
  configFile ??= (async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sourcesink-opencode-"));
    const target = path.join(dir, "opencode.json");
    await writeFile(target, JSON.stringify(AGENT_CONFIG, null, 2), "utf8");
    return target;
  })();
  return configFile;
}

/**
 * A `Complete` backed by the opencode CLI: writes the agent config to a temp
 * file once, spawns opencode with stdin = flattened prompt, cwd = a fresh empty
 * temp dir, env OPENCODE_CONFIG set; kills it on timeout or `request.signal`
 * abort (reject with AbortError on abort).
 */
export function createOpencodeComplete(options?: OpencodeOptions): Complete {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return async (request: CompletionRequest): Promise<CompletionResponse> => {
    if (request.signal?.aborted) throw abortError();

    const prompt = flattenMessages(request.messages);
    const agentConfig = await agentConfigPath();
    const cwd = await mkdtemp(path.join(tmpdir(), "sourcesink-run-"));
    if (request.signal?.aborted) {
      await rm(cwd, { recursive: true, force: true });
      throw abortError();
    }

    return new Promise<CompletionResponse>((resolve, reject) => {
      const child = spawn(
        opts.bin,
        ["run", "--pure", "--agent", "sourcesink", "-m", assertSafeModelId(request.model), "--format", "json"],
        {
          cwd,
          env: { ...process.env, OPENCODE_CONFIG: agentConfig },
          stdio: ["pipe", "pipe", "pipe"],
          shell: SPAWN_SHELL,
        },
      );

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;

      const cleanup = () => {
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        void rm(cwd, { recursive: true, force: true });
      };
      const finish = (err: Error | undefined, value?: CompletionResponse) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) reject(err);
        else resolve(value!);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
        finish(new Error(`opencode timed out after ${opts.timeoutMs} ms`));
      }, opts.timeoutMs);
      const onAbort = () => {
        child.kill("SIGKILL");
        finish(abortError());
      };
      request.signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.stdin.on("error", () => {
        // The child may exit before consuming stdin (bad model, auth error).
      });
      child.on("error", (err) => finish(err));
      child.on("close", (code) => {
        if (settled) return;
        if (timedOut) return;
        if (request.signal?.aborted) return finish(abortError());

        if (code !== 0) {
          let text = "";
          try {
            text = parseOpencodeEvents(stdout).text;
          } catch {
            // No usable events; the stderr tail below is the useful message.
          }
          if (!text) {
            const tail = stderrTail(stderr);
            return finish(
              new Error(
                `opencode exited with code ${code}${tail ? `: ${tail}` : " with no output"}`,
              ),
            );
          }
        }

        try {
          finish(undefined, parseOpencodeEvents(stdout));
        } catch (err) {
          const tail = stderrTail(stderr);
          const message = err instanceof Error ? err.message : String(err);
          finish(new Error(tail ? `${message}: ${tail}` : message));
        }
      });

      child.stdin.end(prompt);
    });
  };
}

/** `opencode models <provider>` → sorted ids. */
export async function listModels(
  provider = "openrouter",
  options?: OpencodeOptions,
): Promise<string[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const result = await runCollect(opts.bin, ["models", provider], opts.timeoutMs);
  if (result.code !== 0) {
    const tail = stderrTail(result.stderr);
    throw new Error(
      `opencode models failed with code ${result.code}${tail ? `: ${tail}` : ""}`,
    );
  }
  return [
    ...new Set(
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ),
  ].sort();
}

/**
 * { available: true, version } or { available: false, reason } with setup
 * advice (install opencode; run `opencode providers` to sign in to
 * OpenRouter). Never throws.
 */
export async function checkOpencode(options?: OpencodeOptions): Promise<OpencodeStatus> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  try {
    const result = await runCollect(opts.bin, ["--version"], opts.timeoutMs);
    if (result.code === 0) {
      return { available: true, version: result.stdout.trim() };
    }
    const tail = stderrTail(result.stderr);
    return {
      available: false,
      reason:
        `opencode could not be run${tail ? `: ${tail}` : "."} ` +
        "Run `opencode providers` to sign in to OpenRouter.",
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      reason:
        `opencode was not found or could not be started (${detail}). ` +
        "Install OpenCode from https://opencode.ai, then run `opencode providers` " +
        "to sign in to OpenRouter.",
    };
  }
}
