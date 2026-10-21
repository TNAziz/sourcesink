import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "@sourcesink/assistant";

import { assistantClient } from "./client.js";

const messages: ChatMessage[] = [{ role: "user", content: "hi" }];

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function ndjsonResponse(...chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/x-ndjson; charset=utf-8" }),
    body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assistantClient (web)", () => {
  it("POSTs a completion and returns the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: "hello", tokens: 3 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await assistantClient().complete({ model: "openrouter/test", messages });

    expect(result).toEqual({ text: "hello", tokens: 3 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/assistant/complete");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ model: "openrouter/test", messages });
  });

  it("fetches models and status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(["openrouter/a"]))
      .mockResolvedValueOnce(jsonResponse({ available: true, version: "1.2.3" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = assistantClient();
    await expect(client.models()).resolves.toEqual(["openrouter/a"]);
    await expect(client.status()).resolves.toEqual({ available: true, version: "1.2.3" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/assistant/models");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/assistant/status");
  });

  it("surfaces the server's error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "no auth" }, false, 500)));
    await expect(assistantClient().complete({ model: "m", messages })).rejects.toThrow(/no auth/);
  });

  it("streams text deltas over NDJSON when onText is given", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        ndjsonResponse(
          '{"text":"Hel"}\n{"text":"He',
          'llo"}\n{"done":true,"response":{"text":"Hello","tokens":2}}\n',
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const seen: string[] = [];
    const result = await assistantClient().complete({
      model: "openrouter/test",
      messages,
      onText: (text) => seen.push(text),
    });

    expect(seen).toEqual(["Hel", "Hello"]);
    expect(result).toEqual({ text: "Hello", tokens: 2 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/assistant/complete?stream=1");
  });

  it("reports an error frame from the stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(ndjsonResponse('{"error":"provider down"}\n')),
    );
    await expect(
      assistantClient().complete({ model: "m", messages, onText: () => {} }),
    ).rejects.toThrow(/provider down/);
  });

  it("rejects a stream that ends without a response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjsonResponse('{"text":"half"}\n')));
    await expect(
      assistantClient().complete({ model: "m", messages, onText: () => {} }),
    ).rejects.toThrow(/without a response/);
  });

  it("falls back to plain JSON when the server ignores the stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ text: "not streamed" })),
    );
    const seen: string[] = [];
    await expect(
      assistantClient().complete({ model: "m", messages, onText: (t) => seen.push(t) }),
    ).resolves.toEqual({ text: "not streamed" });
    expect(seen).toEqual([]);
  });

  it("aborts the fetch when the signal aborts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }),
    );

    const controller = new AbortController();
    const pending = assistantClient().complete({ model: "m", messages, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects immediately for an already-aborted signal", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(
      assistantClient().complete({ model: "m", messages, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("assistantClient (desktop)", () => {
  function stubDesktop() {
    const assistant = {
      complete: vi.fn(
        async (_req: unknown, _onText?: (text: string) => void) => ({ text: "from desktop" }),
      ),
      models: vi.fn(async () => ["openrouter/desktop"]),
      status: vi.fn(async () => ({ available: true, version: "9" })),
      cancel: vi.fn(),
    };
    vi.stubGlobal("window", { sourcesink: { isDesktop: true, assistant } });
    return assistant;
  }

  it("uses the preload bridge", async () => {
    const assistant = stubDesktop();
    const client = assistantClient();
    await expect(client.complete({ model: "m", messages })).resolves.toEqual({
      text: "from desktop",
    });
    await expect(client.models()).resolves.toEqual(["openrouter/desktop"]);
    await expect(client.status()).resolves.toEqual({ available: true, version: "9" });
    expect(assistant.complete).toHaveBeenCalledWith({ model: "m", messages });
  });

  it("cancels the in-flight run and rejects with AbortError", async () => {
    const assistant = stubDesktop();
    let rejectRun!: (err: Error) => void;
    assistant.complete.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRun = reject;
        }),
    );

    const controller = new AbortController();
    const pending = assistantClient().complete({ model: "m", messages, signal: controller.signal });
    controller.abort();
    const err = new Error("cancelled");
    err.name = "AbortError";
    rejectRun(err);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(assistant.cancel).toHaveBeenCalledOnce();
  });

  it("passes onText through the preload bridge", async () => {
    const assistant = stubDesktop();
    assistant.complete.mockImplementation(
      async (_req: unknown, onText?: (text: string) => void) => {
        onText?.("part one");
        onText?.("part one, two");
        return { text: "part one, two" };
      },
    );

    const seen: string[] = [];
    const result = await assistantClient().complete({
      model: "m",
      messages,
      onText: (text) => seen.push(text),
    });

    expect(result).toEqual({ text: "part one, two" });
    expect(seen).toEqual(["part one", "part one, two"]);
    expect(assistant.complete).toHaveBeenCalledWith(
      { model: "m", messages },
      expect.any(Function),
    );
  });
});
