import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const guidePath = `${root}/docs/llm/cli-guide.md`;
const cliPath = `${root}/src/cli/src/run.ts`;
const guide = readFileSync(guidePath, "utf8");

/** Replace a leading `sourcesink ` with this checkout's CLI, so the guide
 * examples can be run verbatim from the repository root. */
const cli = `"${process.execPath}" --import tsx "${cliPath}"`;

function verifiedBlocks(text: string): string[] {
  return [...text.matchAll(/```bash verified\r?\n([\s\S]*?)```/g)].map((match) => match[1]);
}

const blocks = verifiedBlocks(guide);
const commandCount = blocks.reduce(
  (total, block) => total + block.split("\n").filter((line) => line.startsWith("sourcesink ")).length,
  0,
);

function script(block: string): string {
  const body = block
    .split("\n")
    .map((line) => (line.startsWith("sourcesink ") ? `${cli} ${line.slice("sourcesink ".length)}` : line))
    .join("\n");
  return `set -euo pipefail\n${body}\n`;
}

function headingFor(name: string): RegExp {
  return new RegExp(`^#{2,3} \`${name}\``, "m");
}

/** Command names from the dispatcher in run.ts — the source of truth. */
function dispatcherCommands(): string[] {
  const source = readFileSync(cliPath, "utf8");
  return [...source.matchAll(/cmd === "([a-z]+)"/g)].map((match) => match[1]);
}

/** Tool names registered by the MCP server — the source of truth. */
function mcpTools(): string[] {
  const source = readFileSync(`${root}/src/mcp/src/server.ts`, "utf8");
  return [...source.matchAll(/registerTool\(\s*"([^"]+)"/g)].map((match) => match[1]);
}

afterAll(() => {
  rmSync("/tmp/sourcesink-logistic.xmile", { force: true });
  rmSync("/tmp/sourcesink-fitted.xmile", { force: true });
});

describe("docs/llm/cli-guide.md", () => {
  it("has verified command blocks to check", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(8);
    expect(commandCount).toBeGreaterThanOrEqual(12);
  });

  for (const [index, block] of blocks.entries()) {
    it(`runs verified block ${index + 1}`, () => {
      expect(() =>
        execFileSync("bash", ["-c", script(block)], {
          cwd: root,
          encoding: "utf8",
          stdio: "pipe",
          timeout: 60_000,
        }),
      ).not.toThrow();
    });
  }

  it("documents every command in the dispatcher as a heading", () => {
    const commands = dispatcherCommands();
    expect(commands.length).toBeGreaterThanOrEqual(8);
    for (const command of commands) {
      expect(guide, `missing heading for '${command}'`).toMatch(headingFor(command));
    }
  });

  it("mentions every MCP tool", () => {
    const tools = mcpTools();
    expect(tools.length).toBe(12);
    for (const tool of tools) {
      expect(guide, `missing MCP tool '${tool}'`).toContain(`\`${tool}\``);
    }
  });
});
