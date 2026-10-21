/**
 * SourceSink — browser-side assistant client.
 *
 * In the desktop app it calls the preload bridge (`window.sourcesink.assistant`,
 * backed by Electron IPC). In the plain browser build it calls the Vite
 * dev-server middleware. Either way the core only sees a `Complete` function.
 */

import type { Complete, CompletionRequest, CompletionResponse } from "@sourcesink/assistant";
import type { OpencodeStatus } from "@sourcesink/assistant/node";
import type { DesktopApi } from "@sourcesink/desktop/api";

export interface AssistantClient {
  complete: Complete;
  models(): Promise<string[]>;
  status(): Promise<OpencodeStatus>;
}

function desktopApi(): DesktopApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { sourcesink?: DesktopApi }).sourcesink;
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

async function responseJson<T>(res: Response): Promise<T> {
  const body: unknown = await res.json();
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `assistant request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  return responseJson<T>(res);
}

/** Read the dev server's NDJSON stream, forwarding text deltas as they arrive. */
async function readNdjson(
  res: Response,
  onText: (textSoFar: string) => void,
): Promise<CompletionResponse> {
  if (!res.body) throw new Error("the assistant stream had no body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: CompletionResponse | undefined;

  const handle = (line: string) => {
    if (!line.trim()) return;
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      throw new Error("the assistant stream was not valid JSON");
    }
    if (typeof frame !== "object" || frame === null) return;
    const message = frame as Record<string, unknown>;
    if (typeof message.error === "string") throw new Error(message.error);
    if (typeof message.text === "string") onText(message.text);
    if (message.done === true && typeof message.response === "object" && message.response !== null) {
      result = message.response as CompletionResponse;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      handle(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  handle(buffer);

  if (!result) throw new Error("the assistant stream ended without a response");
  return result;
}

/** Complete over the dev-server middleware, honoring request.signal. */
async function completeOverHttp(request: CompletionRequest): Promise<CompletionResponse> {
  if (request.signal?.aborted) throw abortError();

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  request.signal?.addEventListener("abort", onAbort, { once: true });
  const stream = request.onText !== undefined;

  try {
    const res = await fetch(stream ? "/api/assistant/complete?stream=1" : "/api/assistant/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ model: request.model, messages: request.messages }),
      signal: controller.signal,
    });

    if (stream && res.ok) {
      const type = res.headers?.get("content-type") ?? "";
      if (type.includes("application/x-ndjson")) {
        return await readNdjson(res, request.onText!);
      }
    }
    return await responseJson<CompletionResponse>(res);
  } finally {
    request.signal?.removeEventListener("abort", onAbort);
  }
}

/** Complete over Electron IPC; cancel() aborts the in-flight main-process run. */
async function completeOverDesktop(
  api: DesktopApi,
  request: CompletionRequest,
): Promise<CompletionResponse> {
  if (request.signal?.aborted) throw abortError();

  const onAbort = () => api.assistant.cancel();
  request.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const req = { model: request.model, messages: request.messages };
    return await (request.onText
      ? api.assistant.complete(req, request.onText)
      : api.assistant.complete(req));
  } catch (err) {
    if (request.signal?.aborted) throw abortError();
    throw err;
  } finally {
    request.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * The browser-side client: uses window.sourcesink.assistant when running in
 * the desktop app, else fetch() against /api/assistant/* (dev server).
 * complete(request) honors request.signal (desktop: calls cancel();
 * web: AbortController on fetch).
 */
export function assistantClient(): AssistantClient {
  const desktop = desktopApi();

  return {
    complete: (request) =>
      desktop ? completeOverDesktop(desktop, request) : completeOverHttp(request),
    models: () =>
      desktop ? desktop.assistant.models() : getJson<string[]>("/api/assistant/models"),
    status: () =>
      desktop ? desktop.assistant.status() : getJson<OpencodeStatus>("/api/assistant/status"),
  };
}
