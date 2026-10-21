import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage, Complete } from "../contracts.js";
import { createOpencodeComplete } from "./opencode.js";
import { createServerComplete } from "./server.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const serveBin = path.join(fixtures, "fake-opencode-serve.mjs");
const hangBin = path.join(fixtures, "fake-opencode-serve-hang.mjs");
const cliBin = path.join(fixtures, "fake-opencode.mjs");

const messages: ChatMessage[] = [
  { role: "system", content: "be terse" },
  { role: "user", content: "hello" },
];

const REPLY = "Hello from the fake server";

interface Harness {
  complete: Complete & { dispose(): Promise<void> };
  fallback: ReturnType<typeof vi.fn>;
  seen: string[];
}

let workspace: string;
let logFile: string;
let crashMarker: string;
const running: Array<Complete & { dispose(): Promise<void> }> = [];

async function lines(): Promise<string[]> {
  try {
    return (await readFile(logFile, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function count(prefix: string): Promise<number> {
  return (await lines()).filter((line) => line.startsWith(prefix)).length;
}

function harness(overrides: {
  bin?: string;
  timeoutMs?: number;
  startTimeoutMs?: number;
  fallbackText?: string;
} = {}): Harness {
  const fallback = vi.fn(async () => ({ text: overrides.fallbackText ?? "from cli" }));
  const complete = createServerComplete({
    bin: overrides.bin ?? serveBin,
    timeoutMs: overrides.timeoutMs ?? 5000,
    startTimeoutMs: overrides.startTimeoutMs ?? 5000,
    cli: fallback,
  });
  running.push(complete);
  return { complete, fallback, seen: [] };
}

beforeAll(async () => {
  await Promise.all([chmod(serveBin, 0o755), chmod(hangBin, 0o755), chmod(cliBin, 0o755)]);
});

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "sourcesink-server-test-"));
  logFile = path.join(workspace, "log");
  crashMarker = path.join(workspace, "crashed");
  process.env.FAKE_SERVE_LOG = logFile;
  process.env.FAKE_SERVE_CRASH_MARKER = crashMarker;
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((complete) => complete.dispose()));
  delete process.env.FAKE_SERVE_LOG;
  delete process.env.FAKE_SERVE_CRASH_MARKER;
  await rm(workspace, { recursive: true, force: true });
});

describe("createServerComplete", () => {
  it("starts one server for three concurrent calls and streams in order", async () => {
    const { complete } = harness();
    const seen: string[][] = [[], [], []];

    const results = await Promise.all(
      seen.map((collected, index) =>
        complete({
          model: "openrouter/deepseek/deepseek-v4.1-flash-1017",
          messages: [...messages, { role: "user", content: `call ${index}` }],
          onText: (text) => collected.push(text),
        }),
      ),
    );

    expect(results.map((result) => result.text)).toEqual([REPLY, REPLY, REPLY]);
    expect(results[0]).toMatchObject({ cost: 0.001, tokens: 12 });

    // One spawn, three fresh sessions, three deletes.
    expect(await count("spawn")).toBe(1);
    expect(await count("session ")).toBe(3);
    expect(await count("delete ")).toBe(3);
    expect(await count("unauthorized")).toBe(0);

    for (const collected of seen) {
      expect(collected).toEqual([
        "Hello ",
        "Hello from the ",
        "Hello from the fake server",
      ]);
    }
  });

  it("sends the tool-less agent and the split model id", async () => {
    const { complete } = harness();
    await expect(
      complete({
        model: "openrouter/deepseek/deepseek-v4.1-flash-1017",
        messages,
      }),
    ).resolves.toMatchObject({ text: REPLY });

    const log = await lines();
    expect(log.some((line) => line.startsWith("message ses_") && line.endsWith(" sourcesink"))).toBe(
      true,
    );
    expect(await count("fail ")).toBe(0);
  });

  it("deletes the conversation after each completion", async () => {
    const { complete } = harness();
    const first = await complete({ model: "openrouter/model", messages });
    const second = await complete({ model: "openrouter/model", messages });

    expect(first.text).toBe(REPLY);
    expect(second.text).toBe(REPLY);
    expect(await count("session ")).toBe(2);
    expect(await count("delete ")).toBe(2);
  });

  it("aborts the session and rejects with AbortError", async () => {
    const { complete } = harness();
    // Warm the server first: aborting a call while the server starts has no
    // session to abort yet.
    await complete({ model: "openrouter/model", messages });
    const before = (await lines()).length;

    const controller = new AbortController();
    const pending = complete({
      model: "openrouter/model",
      messages: [...messages, { role: "user", content: "SLOW please" }],
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    const log = (await lines()).slice(before);
    const abortIndex = log.findIndex((line) => line.startsWith("abort ses_"));
    const messageIndex = log.findIndex((line) => line.startsWith("message ses_"));
    expect(abortIndex).toBeGreaterThan(messageIndex);
    expect(log.some((line) => line.startsWith("done "))).toBe(false);
    expect(await count("delete ")).toBe(2);
  });

  it("times out a slow completion", async () => {
    const { complete } = harness({ timeoutMs: 150 });
    await expect(
      complete({
        model: "openrouter/model",
        messages: [...messages, { role: "user", content: "SLOW please" }],
      }),
    ).rejects.toThrow(/timed out after 150 ms/);
  });

  it("rejects immediately for an already-aborted signal", async () => {
    const { complete } = harness();
    const controller = new AbortController();
    controller.abort();
    await expect(
      complete({ model: "openrouter/model", messages, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await count("spawn")).toBe(0);
  });

  it("restarts the server once after a crash", async () => {
    const { complete, fallback } = harness();

    const recovered = await complete({
      model: "openrouter/model",
      messages: [...messages, { role: "user", content: "CRASH_ONCE" }],
    });
    expect(recovered.text).toBe(REPLY);
    expect(await count("spawn")).toBe(2);
    expect(await count("crash ")).toBe(1);
    expect(fallback).not.toHaveBeenCalled();

    await complete({ model: "openrouter/model", messages });
    expect(await count("spawn")).toBe(2);
  });

  it("falls back to the CLI after the one restart is used", async () => {
    const { complete, fallback } = harness();

    await complete({
      model: "openrouter/model",
      messages: [...messages, { role: "user", content: "CRASH_EVERY" }],
    });
    expect(fallback).toHaveBeenCalledTimes(1);
    // The first server dies, the one permitted restart dies too, then the CLI.
    expect(await count("spawn")).toBe(2);

    await complete({ model: "openrouter/model", messages });
    expect(fallback).toHaveBeenCalledTimes(2);
    expect(await count("spawn")).toBe(2);
  });

  it("falls back to the CLI when the server cannot start, and remembers it", async () => {
    const complete = createServerComplete({
      bin: hangBin,
      startTimeoutMs: 200,
      timeoutMs: 5000,
      cli: createOpencodeComplete({ bin: cliBin, timeoutMs: 5000 }),
    });
    running.push(complete);

    const first = await complete({ model: "openrouter/model", messages });
    const second = await complete({ model: "openrouter/model", messages });

    // The existing fake CLI's reply, not the server's.
    expect(first.text).toMatch(/^hello world /);
    expect(second.text).toMatch(/^hello world /);
    expect(second.tokens).toBe(42);
    // The failed start is remembered: the hanging server was spawned once.
    expect(await count("hang spawn")).toBe(1);
  });

  it("stops the server on dispose and refuses further calls", async () => {
    const { complete } = harness();
    await complete({ model: "openrouter/model", messages });

    await complete.dispose();
    expect((await lines()).some((line) => line.startsWith("signal "))).toBe(true);
    await expect(complete({ model: "openrouter/model", messages })).rejects.toThrow(/disposed/);
  });
});
