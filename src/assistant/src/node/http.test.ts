import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Complete } from "../contracts.js";

vi.mock("./opencode.js", () => ({
  AGENT_CONFIG: { agent: { sourcesink: {} } },
  agentConfigPath: async () => "/tmp/sourcesink-opencode-test.json",
  flattenMessages: () => "prompt",
  createOpencodeComplete: () => async () => ({ text: "default" }),
  listModels: async () => ["openrouter/alpha", "openrouter/zeta"],
  checkOpencode: async () => ({ available: true, version: "1.2.3" }),
}));

import { assistantMiddleware, assistantVitePlugin } from "./http.js";

class FakeRequest extends EventEmitter {
  url: string;
  method: string;
  headers: Record<string, string> = { host: "localhost:5173" };

  constructor(url: string, method: string) {
    super();
    this.url = url;
    this.method = method;
  }

  setEncoding(): this {
    return this;
  }

  feed(body: string): void {
    this.emit("data", body);
    this.emit("end");
  }
}

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = "";
  chunks: string[] = [];
  writableEnded = false;
  destroyed = false;

  setHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }

  flushHeaders(): void {
    // Nothing to flush in the fake.
  }

  write(chunk: string): boolean {
    this.chunks.push(String(chunk));
    return true;
  }

  end(chunk?: string): void {
    if (chunk !== undefined) this.chunks.push(String(chunk));
    this.body = chunk ?? "";
    this.writableEnded = true;
    this.emit("finish");
  }
}

function response(): {
  res: ServerResponse & FakeResponse;
  done: Promise<FakeResponse>;
} {
  let resolve!: (value: FakeResponse) => void;
  const done = new Promise<FakeResponse>((r) => {
    resolve = r;
  });
  const fake = new FakeResponse();
  fake.on("finish", () => resolve(fake));
  return { res: fake as ServerResponse & FakeResponse, done };
}

function call(
  handler: ReturnType<typeof assistantMiddleware>,
  url: string,
  method: string,
  body?: string,
): {
  req: FakeRequest;
  res: ServerResponse & FakeResponse;
  done: Promise<FakeResponse>;
  next: ReturnType<typeof vi.fn>;
} {
  const req = new FakeRequest(url, method);
  const { res, done } = response();
  const next = vi.fn();
  handler(req as unknown as IncomingMessage, res, next);
  if (body !== undefined) req.feed(body);
  return { req, res, done, next };
}

function okComplete(text = "reply"): Complete {
  return async () => ({ text });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assistantMiddleware", () => {
  it("refuses cross-origin requests before calling the model", async () => {
    const complete = vi.fn(okComplete());
    const handler = assistantMiddleware(complete);
    const req = new FakeRequest("/api/assistant/complete", "POST");
    req.headers.origin = "https://evil.example";
    const { res, done } = response();
    handler(req as unknown as IncomingMessage, res, vi.fn());
    expect((await done).statusCode).toBe(403);
    expect(complete).not.toHaveBeenCalled();
  });

  it("accepts a same-origin request", async () => {
    const handler = assistantMiddleware(okComplete());
    const req = new FakeRequest("/api/assistant/status", "GET");
    req.headers.origin = "http://localhost:5173";
    const { res, done } = response();
    handler(req as unknown as IncomingMessage, res, vi.fn());
    expect((await done).statusCode).toBe(200);
  });

  it("completes a valid POST", async () => {
    const { done } = call(
      assistantMiddleware(okComplete("hello")),
      "/api/assistant/complete",
      "POST",
      JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    );
    const res = await done;
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(JSON.parse(res.body)).toEqual({ text: "hello" });
  });

  it("streams NDJSON deltas and a final response", async () => {
    const complete: Complete = async (request) => {
      request.onText?.("Hel");
      request.onText?.("Hello");
      return { text: "Hello", tokens: 2 };
    };
    const { done } = call(
      assistantMiddleware(complete),
      "/api/assistant/complete?stream=1",
      "POST",
      JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    );
    const res = await done;
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/x-ndjson/);
    const frames = res.chunks
      .join("")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(frames).toEqual([
      { text: "Hel" },
      { text: "Hello" },
      { done: true, response: { text: "Hello", tokens: 2 } },
    ]);
  });

  it("reports a streamed failure as an error frame", async () => {
    const failing: Complete = async () => {
      throw new Error("provider exploded");
    };
    const { done } = call(
      assistantMiddleware(failing),
      "/api/assistant/complete?stream=1",
      "POST",
      JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    );
    const res = await done;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.chunks.join("").trim())).toEqual({ error: "provider exploded" });
  });

  it("only requests streaming when stream=1 is asked for", async () => {
    let sawOnText = false;
    const complete: Complete = async (request) => {
      sawOnText = request.onText !== undefined;
      return { text: "plain" };
    };
    const { done } = call(
      assistantMiddleware(complete),
      "/api/assistant/complete",
      "POST",
      JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    );
    await done;
    expect(sawOnText).toBe(false);
  });

  it("rejects a bad body with 400", async () => {
    const { done } = call(
      assistantMiddleware(okComplete()),
      "/api/assistant/complete",
      "POST",
      "{not json",
    );
    const res = await done;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/JSON/);
  });

  it("rejects an invalid message list with 400", async () => {
    const { done } = call(
      assistantMiddleware(okComplete()),
      "/api/assistant/complete",
      "POST",
      JSON.stringify({ model: "m", messages: [{ role: "narrator", content: "hi" }] }),
    );
    const res = await done;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/messages/);
  });

  it("turns a completion failure into 500 { error }", async () => {
    const failing: Complete = async () => {
      throw new Error("provider exploded");
    };
    const { done } = call(
      assistantMiddleware(failing),
      "/api/assistant/complete",
      "POST",
      JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    );
    const res = await done;
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: "provider exploded" });
  });

  it("aborts the completion when the request closes early", async () => {
    let seen: AbortSignal | undefined;
    const complete: Complete = async (request) => {
      seen = request.signal;
      return { text: "late" };
    };
    const { res: fakeRes, done } = call(
      assistantMiddleware(complete),
      "/api/assistant/complete",
      "POST",
      JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    );
    fakeRes.emit("close");
    const res = await done;
    expect(seen?.aborted).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("returns the model list", async () => {
    const { done } = call(assistantMiddleware(okComplete()), "/api/assistant/models", "GET");
    const res = await done;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(["openrouter/alpha", "openrouter/zeta"]);
  });

  it("returns the opencode status", async () => {
    const { done } = call(assistantMiddleware(okComplete()), "/api/assistant/status", "GET");
    const res = await done;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ available: true, version: "1.2.3" });
  });

  it("calls next() for other paths", () => {
    const { done, next } = call(assistantMiddleware(okComplete()), "/api/other", "GET");
    expect(next).toHaveBeenCalledOnce();
    expect(done).toBeInstanceOf(Promise);
  });

  it("rejects a non-POST complete with 405", async () => {
    const { done } = call(assistantMiddleware(okComplete()), "/api/assistant/complete", "GET");
    const res = await done;
    expect(res.statusCode).toBe(405);
  });
});

describe("assistantVitePlugin", () => {
  it("registers the middleware and disposes the server on close", async () => {
    const use = vi.fn();
    const on = vi.fn();
    const plugin = assistantVitePlugin();
    expect(plugin.name).toBe("sourcesink-assistant");
    plugin.configureServer({ middlewares: { use }, httpServer: { on } });
    expect(use).toHaveBeenCalledOnce();
    expect(use.mock.calls[0][0]).toBeTypeOf("function");
    expect(on).toHaveBeenCalledWith("close", expect.any(Function));

    const close = on.mock.calls[0][1] as () => void;
    expect(() => close()).not.toThrow();
  });
});
