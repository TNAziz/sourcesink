import { chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ChatMessage } from "../contracts.js";
import {
  checkOpencode,
  createOpencodeComplete,
  flattenMessages,
  listModels,
  parseOpencodeEvents,
} from "./opencode.js";

const fake = fileURLToPath(new URL("./fixtures/fake-opencode.mjs", import.meta.url));
const repoRoot = process.cwd();

const messages: ChatMessage[] = [
  { role: "system", content: "be terse" },
  { role: "user", content: "hello" },
];

async function withMode<T>(mode: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.FAKE_OPENCODE_MODE;
  process.env.FAKE_OPENCODE_MODE = mode;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.FAKE_OPENCODE_MODE;
    else process.env.FAKE_OPENCODE_MODE = previous;
  }
}

beforeAll(async () => {
  await chmod(fake, 0o755);
});

afterEach(() => {
  delete process.env.FAKE_OPENCODE_MODE;
});

describe("flattenMessages", () => {
  it("puts the system message first and labels each turn", () => {
    expect(
      flattenMessages([
        { role: "user", content: "hi" },
        { role: "system", content: "SYSTEM" },
        { role: "assistant", content: "yo" },
        { role: "user", content: "again" },
      ]),
    ).toBe("SYSTEM\n\n### USER\nhi\n\n### ASSISTANT\nyo\n\n### USER\nagain");
  });

  it("omits the empty system section", () => {
    expect(flattenMessages([{ role: "user", content: "hi" }])).toBe("### USER\nhi");
  });
});

describe("parseOpencodeEvents", () => {
  it("returns one text part", () => {
    expect(
      parseOpencodeEvents('{"type":"text","part":{"type":"text","text":"hello"}}\n'),
    ).toEqual({ text: "hello" });
  });

  it("joins several text parts and sums cost and tokens", () => {
    const stdout = [
      '{"type":"step_start","part":{"type":"step_start"}}',
      '{"type":"text","part":{"type":"text","text":"a"}}',
      '{"type":"text","part":{"type":"text","text":"b"}}',
      '{"type":"step_finish","part":{"reason":"stop","tokens":{"total":10},"cost":0.1}}',
      '{"type":"step_finish","part":{"reason":"stop","tokens":{"total":5},"cost":0.2}}',
    ].join("\n");
    const result = parseOpencodeEvents(stdout);
    expect(result.text).toBe("ab");
    expect(result.tokens).toBe(15);
    expect(result.cost).toBeCloseTo(0.3);
  });

  it("ignores blank and non-JSON lines", () => {
    const stdout = "not json\n\n{\"type\":\"text\",\"part\":{\"text\":\"ok\"}}\n";
    expect(parseOpencodeEvents(stdout)).toEqual({ text: "ok" });
  });

  it("throws on an error event", () => {
    expect(() =>
      parseOpencodeEvents('{"type":"error","error":{"message":"model refused"}}'),
    ).toThrow(/model refused/);
  });

  it("throws when no text was produced", () => {
    expect(() =>
      parseOpencodeEvents('{"type":"step_finish","part":{"reason":"stop"}}'),
    ).toThrow(/no text/);
  });
});

describe("createOpencodeComplete", () => {
  it("sends the prompt, uses the agent config, and parses the reply", async () => {
    await withMode("success", async () => {
      const complete = createOpencodeComplete({ bin: fake, timeoutMs: 5000 });
      const result = await complete({ model: "openrouter/test", messages });
      expect(result.text.startsWith("hello world ")).toBe(true);
      expect(result.tokens).toBe(42);
      expect(result.cost).toBeCloseTo(0.0005);

      const cwd = result.text.slice("hello world ".length);
      expect(cwd).not.toBe(repoRoot);
      expect(cwd.startsWith(repoRoot)).toBe(false);
    });
  });

  it("reports a non-zero exit with the stderr tail", async () => {
    await withMode("exit", async () => {
      const complete = createOpencodeComplete({ bin: fake, timeoutMs: 5000 });
      await expect(complete({ model: "m", messages })).rejects.toThrow(
        /code 7: .*not authenticated/s,
      );
    });
  });

  it("reports an error event", async () => {
    await withMode("error-event", async () => {
      const complete = createOpencodeComplete({ bin: fake, timeoutMs: 5000 });
      await expect(complete({ model: "m", messages })).rejects.toThrow(/model refused/);
    });
  });

  it("kills the child on timeout", async () => {
    await withMode("sleep", async () => {
      const complete = createOpencodeComplete({ bin: fake, timeoutMs: 150 });
      await expect(complete({ model: "m", messages })).rejects.toThrow(/timed out/);
    });
  });

  it("rejects with AbortError on abort", async () => {
    await withMode("sleep", async () => {
      const complete = createOpencodeComplete({ bin: fake, timeoutMs: 10_000 });
      const controller = new AbortController();
      const pending = complete({ model: "m", messages, signal: controller.signal });
      setTimeout(() => controller.abort(), 50);
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    });
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const complete = createOpencodeComplete({ bin: fake, timeoutMs: 5000 });
    const controller = new AbortController();
    controller.abort();
    await expect(
      complete({ model: "m", messages, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("listModels", () => {
  it("returns sorted, unique ids", async () => {
    await withMode("models", async () => {
      await expect(listModels("openrouter", { bin: fake, timeoutMs: 5000 })).resolves.toEqual([
        "openrouter/alpha",
        "openrouter/zeta",
      ]);
    });
  });

  it("rejects when the command fails", async () => {
    await withMode("models-fail", async () => {
      await expect(listModels("openrouter", { bin: fake, timeoutMs: 5000 })).rejects.toThrow(
        /code 2: not signed in/,
      );
    });
  });
});

describe("checkOpencode", () => {
  it("reports the version", async () => {
    await withMode("success", async () => {
      await expect(checkOpencode({ bin: fake, timeoutMs: 5000 })).resolves.toEqual({
        available: true,
        version: "1.2.3",
      });
    });
  });

  it("gives setup advice when the binary is missing", async () => {
    const status = await checkOpencode({ bin: `${fake}-does-not-exist`, timeoutMs: 5000 });
    expect(status.available).toBe(false);
    expect(status.reason).toMatch(/Install OpenCode/);
    expect(status.reason).toMatch(/opencode providers/);
  });

  it("gives setup advice when the command fails", async () => {
    await withMode("version-fail", async () => {
      const status = await checkOpencode({ bin: fake, timeoutMs: 5000 });
      expect(status.available).toBe(false);
      expect(status.reason).toMatch(/could not be run/);
    });
  });
});

describe("assertSafeModelId", () => {
  it("accepts provider/model ids and rejects anything a shell could interpret", async () => {
    const { assertSafeModelId } = await import("./opencode.js");
    expect(assertSafeModelId("openrouter/deepseek/deepseek-v4.1-flash-1017")).toBe(
      "openrouter/deepseek/deepseek-v4.1-flash-1017",
    );
    expect(assertSafeModelId("openrouter/~anthropic/claude-sonnet-latest")).toContain("~");
    for (const bad of ["a & calc", "x;rm -rf ~", "m`id`", "m$(id)", "m|x", 'm"x', "", "a b"]) {
      expect(() => assertSafeModelId(bad), bad).toThrow(/invalid model id/);
    }
  });
});
