/**
 * SourceSink — language-model calls through a long-lived `opencode serve`.
 *
 * Starting the OpenCode CLI costs several seconds per call. A server answers in
 * well under a second, so this bridge starts one lazily, reuses it for every
 * completion, and streams the reply's text deltas from the server's event
 * stream. The CLI bridge (`opencode.ts`) remains the fallback when no server can
 * be started.
 *
 * The server's HTTP API can read provider keys and run shell commands. It is
 * therefore always started with a random Basic-auth password and bound to
 * 127.0.0.1; the password never leaves this module (no logging, no output).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Complete, CompletionRequest, CompletionResponse } from "../contracts.js";
import { agentConfigPath, createOpencodeComplete, flattenMessages, SPAWN_SHELL } from "./opencode.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_START_TIMEOUT_MS = 15_000;

export interface ServerOptions {
  /** Executable; default "opencode". */
  bin?: string;
  /** Per-completion timeout; default 120000 ms. */
  timeoutMs?: number;
  /** How long to wait for the "listening" line; default 15000 ms. */
  startTimeoutMs?: number;
  /** CLI fallback (tests inject their own); default for the same binary. */
  cli?: Complete;
}

interface RunningServer {
  child: ChildProcess;
  baseUrl: string;
  auth: string;
  dir: string;
  exited: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

function basicAuth(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
}

/** A delay whose timer does not keep the Node process alive. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** A port nothing is listening on right now (the server treats `--port 0` as
 * its default 4096, so `0` cannot be passed through). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => {
        if (port > 0) resolve(port);
        else reject(new Error("could not find a free port for the OpenCode server"));
      });
    });
  });
}

function stderrTail(stderr: string): string {
  return stderr
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(-5)
    .join("\n");
}

/** Resolve with the base URL printed on stdout, or reject on timeout/exit. */
function waitForListening(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (err: Error | undefined, url?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("error", onError);
      child.off("exit", onExit);
      if (err) reject(err);
      else resolve(url!);
    };

    const onStdout = (chunk: string) => {
      stdout += chunk;
      const match = stdout.match(/listening on (http:\/\/[^\s]+)/);
      if (match) finish(undefined, match[1]);
    };
    const onStderr = (chunk: string) => {
      stderr = (stderr + chunk).slice(-4096);
    };
    const onError = (err: Error) => finish(err);
    const onExit = (code: number | null) => {
      const tail = stderrTail(stderr);
      finish(
        new Error(
          `opencode server exited (code ${code}) before it was listening${tail ? `: ${tail}` : ""}`,
        ),
      );
    };
    const timer = setTimeout(() => {
      finish(new Error(`opencode server did not start within ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

/** Start one server process and wait until it accepts requests. */
async function startServer(bin: string, startTimeoutMs: number): Promise<RunningServer> {
  const config = await agentConfigPath();
  const port = await freePort();
  const password = randomBytes(32).toString("hex");
  const dir = await mkdtemp(path.join(tmpdir(), "sourcesink-serve-"));

  const child = spawn(
    bin,
    ["serve", "--pure", "--port", String(port), "--hostname", "127.0.0.1"],
    {
      cwd: dir,
      env: { ...process.env, OPENCODE_CONFIG: config, OPENCODE_SERVER_PASSWORD: password },
      stdio: ["ignore", "pipe", "pipe"],
      shell: SPAWN_SHELL,
    },
  );

  const server: RunningServer = {
    child,
    baseUrl: "",
    auth: basicAuth(password),
    dir,
    exited: false,
  };
  child.once("exit", () => {
    server.exited = true;
  });

  try {
    server.baseUrl = await waitForListening(child, startTimeoutMs);
  } catch (err) {
    child.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  return server;
}

async function api(
  server: RunningServer,
  method: string,
  pathname: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${server.baseUrl}${pathname}`, {
    method,
    headers: {
      Authorization: server.auth,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (isRecord(body) && typeof body.error === "string") return body.error;
    if (isRecord(body) && isRecord(body.data) && typeof body.data.message === "string") {
      return body.data.message;
    }
  } catch {
    // Not JSON; the status alone is the useful part.
  }
  return "";
}

function splitModel(model: string): { providerID: string; modelID: string } {
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) {
    throw new Error(`model id must look like "<provider>/<model>": ${model}`);
  }
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
}

function parseMessageResponse(body: unknown): CompletionResponse {
  if (!isRecord(body) || !Array.isArray(body.parts)) {
    throw new Error("OpenCode returned no message parts");
  }
  const text = body.parts
    .map((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : "",
    )
    .join("");
  if (!text) throw new Error("OpenCode produced no text");

  const info = isRecord(body.info) ? body.info : {};
  const cost = typeof info.cost === "number" ? info.cost : undefined;

  let tokens: number | undefined;
  const reported = info.tokens;
  if (isRecord(reported)) {
    if (typeof reported.total === "number") tokens = reported.total;
    else {
      const input = typeof reported.input === "number" ? reported.input : 0;
      const output = typeof reported.output === "number" ? reported.output : 0;
      if (typeof reported.input === "number" || typeof reported.output === "number") {
        tokens = input + output;
      }
    }
  } else if (typeof reported === "number") {
    tokens = reported;
  }

  return {
    text,
    ...(cost === undefined ? {} : { cost }),
    ...(tokens === undefined ? {} : { tokens }),
  };
}

async function createSession(server: RunningServer, signal: AbortSignal): Promise<string> {
  const res = await api(server, "POST", "/session", { title: "sourcesink" }, signal);
  if (!res.ok) {
    const detail = await errorDetail(res);
    throw new Error(`could not create an OpenCode session (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const body: unknown = await res.json();
  if (!isRecord(body) || typeof body.id !== "string") {
    throw new Error("OpenCode returned no session id");
  }
  return body.id;
}

interface Subscription {
  /** Resolves once the event stream's headers arrive (or shortly after). */
  ready: Promise<void>;
  close(): void;
}

/** Text deltas for one session from the server's global event stream. */
function subscribe(
  server: RunningServer,
  sessionId: string,
  onDelta: (delta: string) => void,
): Subscription {
  const controller = new AbortController();
  let readyResolve!: () => void;
  let readyReject!: (err: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  void (async () => {
    try {
      const res = await fetch(`${server.baseUrl}/event`, {
        headers: { Authorization: server.auth, Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`opencode event stream answered ${res.status}`);
      }
      // The server registers the subscriber before writing headers, so every
      // delta for the message we are about to send will reach us.
      readyResolve();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      // Deltas carry no part type: remember it from the part's update. Only
      // `text` parts are the visible reply; `reasoning` parts must not leak.
      const partTypes = new Map<string, string>();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            let event: unknown;
            try {
              event = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (!isRecord(event)) continue;
            const props = event.properties;
            if (!isRecord(props) || props.sessionID !== sessionId) continue;

            if (event.type === "message.part.updated") {
              const part = props.part;
              if (isRecord(part) && typeof part.id === "string" && typeof part.type === "string") {
                partTypes.set(part.id, part.type);
              }
              continue;
            }
            if (event.type !== "message.part.delta" || props.field !== "text") continue;
            if (typeof props.partID !== "string" || partTypes.get(props.partID) !== "text") continue;
            if (typeof props.delta === "string" && props.delta) onDelta(props.delta);
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        readyReject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return { ready, close: () => controller.abort() };
}

async function deleteSession(server: RunningServer, sessionId: string): Promise<void> {
  // Best effort, but never let a wedged server hold the call open.
  await api(
    server,
    "DELETE",
    `/session/${encodeURIComponent(sessionId)}`,
    {},
    AbortSignal.timeout(2000),
  );
}

async function abortSession(server: RunningServer, sessionId: string): Promise<void> {
  await api(
    server,
    "POST",
    `/session/${encodeURIComponent(sessionId)}/abort`,
    {},
    AbortSignal.timeout(2000),
  );
}

async function stopServer(server: RunningServer): Promise<void> {
  if (!server.exited && server.child.exitCode === null) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => server.child.kill("SIGKILL"), 2000);
      server.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      server.child.kill("SIGTERM");
    });
  }
  await rm(server.dir, { recursive: true, force: true }).catch(() => undefined);
}

function serverIsGone(server: RunningServer): boolean {
  return server.exited || server.child.exitCode !== null;
}

/** A fetch failure (rather than an HTTP error) usually means the server died. */
function looksDisconnected(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const message = err instanceof Error ? err.message : "";
  return /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up|other side closed|terminated/i.test(
    message,
  );
}

/** Give the exit event a moment to arrive before deciding to restart. */
async function waitForExit(server: RunningServer): Promise<void> {
  for (let i = 0; i < 100 && !serverIsGone(server); i += 1) await sleep(10);
}

async function completeOnServer(
  server: RunningServer,
  request: CompletionRequest,
  timeoutMs: number,
): Promise<CompletionResponse> {
  const { providerID, modelID } = splitModel(request.model);
  const prompt = flattenMessages(request.messages);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  request.signal?.addEventListener("abort", onAbort, { once: true });

  let sessionId: string | undefined;
  let stream: Subscription | undefined;
  try {
    sessionId = await createSession(server, controller.signal);

    let soFar = "";
    stream = subscribe(server, sessionId, (delta) => {
      soFar += delta;
      try {
        request.onText?.(soFar);
      } catch {
        // A display callback must never break the completion.
      }
    });
    await Promise.race([stream.ready.catch(() => undefined), sleep(2000)]);

    const res = await api(
      server,
      "POST",
      `/session/${encodeURIComponent(sessionId)}/message`,
      {
        agent: "sourcesink",
        model: { providerID, modelID },
        parts: [{ type: "text", text: prompt }],
      },
      controller.signal,
    );
    if (!res.ok) {
      const detail = await errorDetail(res);
      throw new Error(
        `opencode server answered ${res.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    return parseMessageResponse(await res.json());
  } catch (err) {
    if (request.signal?.aborted) {
      if (sessionId) await abortSession(server, sessionId).catch(() => undefined);
      throw abortError();
    }
    if (timedOut) throw new Error(`opencode server timed out after ${timeoutMs} ms`);
    throw err;
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onAbort);
    stream?.close();
    if (sessionId) await deleteSession(server, sessionId).catch(() => undefined);
  }
}

/**
 * A Complete backed by one long-lived `opencode serve` child: started
 * lazily on first use (single start even under concurrent calls), restarted
 * once if it dies, stopped by `dispose()`. Per completion: fresh session,
 * subscribe to /event for that session to call request.onText(textSoFar)
 * as text deltas arrive, POST the message, resolve with the final text +
 * cost/tokens, delete the session. Abort → POST abort, reject AbortError.
 * Timeout default 120 s. If the server cannot start within 15 s, fall back to
 * createOpencodeComplete() (the CLI) for that call and remember the failure.
 */
export function createServerComplete(
  options: ServerOptions = {},
): Complete & { dispose(): Promise<void> } {
  const bin = options.bin ?? "opencode";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const cli = options.cli ?? createOpencodeComplete({ bin, timeoutMs });

  let disposed = false;
  /** No more server starts: the first one failed, or the one restart is used. */
  let unavailable = false;
  let starts = 0;
  let current: RunningServer | undefined;
  let starting: Promise<RunningServer | null> | undefined;

  function usable(): RunningServer | undefined {
    if (current && serverIsGone(current)) current = undefined;
    return current;
  }

  async function ensureServer(): Promise<RunningServer | null> {
    if (disposed) throw new Error("The assistant server was disposed.");
    if (unavailable) return null;

    const running = usable();
    if (running) return running;
    if (starting) return starting;
    if (starts >= 2) {
      unavailable = true;
      return null;
    }

    starting = startServer(bin, startTimeoutMs)
      .then((server) => {
        current = server;
        starts += 1;
        return server;
      })
      .catch(() => {
        unavailable = true;
        return null;
      })
      .finally(() => {
        starting = undefined;
      });
    return starting;
  }

  async function complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (request.signal?.aborted) throw abortError();

    let server = await ensureServer();
    if (!server) return cli(request);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (request.signal?.aborted) throw abortError();
      try {
        return await completeOnServer(server, request, timeoutMs);
      } catch (err) {
        if (request.signal?.aborted || (err as { name?: string }).name === "AbortError") {
          throw err;
        }
        const disconnected = serverIsGone(server) || looksDisconnected(err);
        if (!disconnected) throw err;
        if (!serverIsGone(server)) await waitForExit(server);
        const next = await ensureServer();
        if (!next) return cli(request);
        if (next !== server) {
          server = next;
          continue;
        }
        throw err;
      }
    }
    throw new Error("The assistant server kept stopping; try again.");
  }

  async function dispose(): Promise<void> {
    disposed = true;
    if (starting) {
      await starting.catch(() => undefined);
    }
    const server = current;
    current = undefined;
    if (server) await stopServer(server);
  }

  const completeFn: Complete = (request) => complete(request);
  return Object.assign(completeFn, { dispose });
}
