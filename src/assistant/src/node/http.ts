/**
 * SourceSink — a tiny HTTP bridge for the browser build.
 *
 * The Vite dev server registers `assistantMiddleware` so the editor can call
 * the same three endpoints the desktop preload exposes over IPC. It is only
 * ever mounted on the development server; a static build has no assistant.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import type { ChatMessage, Complete, CompletionResponse } from "../contracts.js";
import { checkOpencode, createOpencodeComplete, listModels } from "./opencode.js";
import { createServerComplete } from "./server.js";

type Next = () => void;

export type AssistantHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: Next,
) => void;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(text);
}

/** One NDJSON frame of a streamed completion. */
function writeLine(res: ServerResponse, body: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`${JSON.stringify(body)}\n`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding?.("utf8");
    req.on("data", (chunk: string | Buffer) => {
      body += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

interface CompleteBody {
  model: string;
  messages: ChatMessage[];
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    (m.role === "system" || m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string"
  );
}

function parseCompleteBody(text: string): CompleteBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("request body must be JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("request body must be an object");
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.model !== "string" || body.model.trim() === "") {
    throw new Error("model must be a non-empty string");
  }
  if (!Array.isArray(body.messages) || !body.messages.every(isChatMessage)) {
    throw new Error("messages must be an array of { role, content }");
  }
  return { model: body.model, messages: body.messages };
}

/** Only the editor's own page may spend model credit: a request carrying an
 * Origin header (every cross-site fetch does) must come from the same host
 * the dev server is serving. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A Connect/Node style handler for POST /api/assistant/complete
 * (body: { model, messages } → CompletionResponse JSON),
 * GET /api/assistant/models, GET /api/assistant/status.
 * Errors → { error } with status 500 (400 for a bad body). Calls `next()`
 * for other paths. Aborts the completion if the request closes early.
 */
export function assistantMiddleware(complete?: Complete): AssistantHandler {
  const run = complete ?? createOpencodeComplete();

  return (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    if (pathname.startsWith("/api/assistant/") && !sameOrigin(req)) {
      sendJson(res, 403, { error: "cross-origin requests are not allowed" });
      return;
    }

    if (pathname === "/api/assistant/complete") {
      if (method !== "POST") {
        sendJson(res, 405, { error: "method not allowed" });
        return;
      }

      const stream = url.searchParams.get("stream") === "1";
      const controller = new AbortController();
      const onClose = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on("close", onClose);

      void (async () => {
        try {
          let body: CompleteBody;
          try {
            body = parseCompleteBody(await readBody(req));
          } catch (err) {
            sendJson(res, 400, { error: errorMessage(err) });
            return;
          }

          if (stream) {
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.flushHeaders?.();
          }

          try {
            const result: CompletionResponse = await run({
              model: body.model,
              messages: body.messages,
              signal: controller.signal,
              ...(stream ? { onText: (text: string) => writeLine(res, { text }) } : {}),
            });
            if (stream) {
              writeLine(res, { done: true, response: result });
              if (!res.writableEnded) res.end();
            } else if (!res.writableEnded) {
              sendJson(res, 200, result);
            }
          } catch (err) {
            if (stream) {
              writeLine(res, { error: errorMessage(err) });
              if (!res.writableEnded) res.end();
            } else if (!res.writableEnded) {
              sendJson(res, 500, { error: errorMessage(err) });
            }
          }
        } finally {
          res.off("close", onClose);
        }
      })();
      return;
    }

    if (method === "GET" && pathname === "/api/assistant/models") {
      void listModels().then(
        (models) => {
          if (!res.writableEnded) sendJson(res, 200, models);
        },
        (err) => {
          if (!res.writableEnded) sendJson(res, 500, { error: errorMessage(err) });
        },
      );
      return;
    }

    if (method === "GET" && pathname === "/api/assistant/status") {
      void checkOpencode().then((status) => {
        if (!res.writableEnded) sendJson(res, 200, status);
      });
      return;
    }

    next();
  };
}

interface MiddlewareStack {
  use(handler: AssistantHandler): unknown;
}

interface DevServerLike {
  middlewares: MiddlewareStack;
  httpServer?: { on(event: "close", listener: () => void): unknown };
}

/** Vite plugin registering the middleware on the dev server only. */
export function assistantVitePlugin(): {
  name: string;
  configureServer(server: DevServerLike): void;
} {
  return {
    name: "sourcesink-assistant",
    configureServer(server) {
      const complete = createServerComplete();
      server.middlewares.use(assistantMiddleware(complete));
      server.httpServer?.on("close", () => {
        void complete.dispose();
      });
    },
  };
}
