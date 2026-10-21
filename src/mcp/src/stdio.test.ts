import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const serverPath = fileURLToPath(new URL("./server.ts", import.meta.url));

const EXPECTED_TOOLS = [
  "model.create",
  "model.open",
  "model.get",
  "model.patch",
  "model.validate",
  "model.simulate",
  "model.ensemble",
  "model.explain",
  "model.export",
  "model.history",
  "model.calibrate",
  "model.sensitivity",
];

describe("stdio MCP server", () => {
  const client = new Client({ name: "sourcesink-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["tsx", serverPath],
    stderr: "pipe",
  });

  beforeAll(async () => {
    await client.connect(transport);
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  it("lists all twelve tools and creates a model", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());

    const result = await client.callTool({ name: "model.create", arguments: { name: "stdio smoke" } });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.type).toBe("text");
    const created = JSON.parse(content[0].text!);
    expect(created).toEqual({ id: "m1", version: 1 });
  }, 30000);

  it("validates and applies a patch over stdio", async () => {
    const created = await client.callTool({ name: "model.create", arguments: { name: "patch smoke" } });
    const id = JSON.parse((created.content as Array<{ text?: string }>)[0].text!).id;

    const patched = await client.callTool({
      name: "model.patch",
      arguments: {
        id,
        patch: { ops: [{ op: "add", kind: "stock", element: { name: "Tank", equation: "4" } }] },
      },
    });
    expect(patched.isError).toBeFalsy();
    const result = JSON.parse((patched.content as Array<{ text?: string }>)[0].text!);
    expect(result.ok).toBe(true);
    expect(result.version).toBe(2);
    expect(result.diff).toContain("Tank");
  }, 30000);

  it("serves the model resources", async () => {
    const resources = await client.listResources();
    const models = resources.resources.find((r) => r.uri === "sourcesink://models");
    expect(models).toBeDefined();

    const read = await client.readResource({ uri: "sourcesink://models" });
    const content = read.contents[0] as { text?: string };
    const listed = JSON.parse(content.text!) as Array<{ id: string; name: string; version: number }>;
    expect(listed).toContainEqual({ id: "m1", name: "stdio smoke", version: 1 });

    const one = await client.readResource({ uri: "sourcesink://models/m1" });
    const model = JSON.parse((one.contents[0] as { text?: string }).text!);
    expect(model.name).toBe("stdio smoke");
  }, 30000);
});
