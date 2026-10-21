#!/usr/bin/env -S npx tsx
/**
 * SourceSink — stdio MCP server.
 *
 * Thin adapter over `ModelTools`: registers twelve tools and two read-only
 * resources. Run it with `npx tsx src/mcp/src/server.ts` or via the
 * `sourcesink-mcp` bin.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  calibrateShape,
  createShape,
  ensembleShape,
  explainShape,
  exportShape,
  getShape,
  historyShape,
  openShape,
  patchShape,
  sensitivityShape,
  simulateShape,
  validateShape,
} from "./schemas.js";
import { createTools, isToolError, type ModelTools, type ToolResult } from "./tools.js";

/** Turn a core result (or a structured error) into an MCP tool result. */
function toResult(value: ToolResult<unknown>): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  if (isToolError(value)) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    };
  }
  if (typeof value === "string") {
    return { content: [{ type: "text", text: value }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** Never let an unexpected exception escape a tool call. */
function guard(fn: () => ToolResult<unknown>): ReturnType<typeof toResult> {
  try {
    return toResult(fn());
  } catch (err) {
    return toResult({
      error: { code: "internal", message: (err as Error).message },
    });
  }
}

export function createServer(tools: ModelTools = createTools()): McpServer {
  const server = new McpServer({ name: "sourcesink", version: "0.1.0" });

  server.registerTool(
    "model.create",
    {
      description:
        "Create an in-memory model from a name (empty model) or from XMILE text. Returns its id and version.",
      inputSchema: createShape,
    },
    (args) => guard(() => tools.create(args)),
  );

  server.registerTool(
    "model.open",
    {
      description: "Open a .xmile, .stm or .itm file from disk. Returns the model id, version and import warnings.",
      inputSchema: openShape,
    },
    (args) => guard(() => tools.open(args)),
  );

  server.registerTool(
    "model.get",
    {
      description: "Return a model as IR JSON.",
      inputSchema: getShape,
    },
    (args) => guard(() => tools.get(args)),
  );

  server.registerTool(
    "model.patch",
    {
      description:
        "Validate and optionally apply a model patch. Returns the gauntlet findings, a Markdown review diff and the model version. Applies only when the gauntlet passes and dryRun is false.",
      inputSchema: patchShape,
    },
    (args) => guard(() => tools.patch(args)),
  );

  server.registerTool(
    "model.validate",
    {
      description: "Run the parse, structure and smoke stages of the gauntlet on the current model.",
      inputSchema: validateShape,
    },
    (args) => guard(() => tools.validate(args)),
  );

  server.registerTool(
    "model.simulate",
    {
      description: "Simulate a model. Returns time and the requested series (default: stocks), optionally thinned.",
      inputSchema: simulateShape,
    },
    (args) => guard(() => tools.simulate(args)),
  );

  server.registerTool(
    "model.ensemble",
    {
      description:
        "Run an ensemble from explicit samples, a factorial grid or uniform/Latin-hypercube ranges, and summarize each series.",
      inputSchema: ensembleShape,
    },
    (args) => guard(() => tools.ensemble(args)),
  );

  server.registerTool(
    "model.calibrate",
    {
      description:
        "Fit parameter values to observations by simulation. Returns the FitResult; with apply=true and a converged fit, applies the fitted constants as a validated patch and returns the new version.",
      inputSchema: calibrateShape,
    },
    (args) => guard(() => tools.calibrate(args)),
  );

  server.registerTool(
    "model.sensitivity",
    {
      description:
        "Rank parameters by their effect on one output metric using Morris screening or Sobol' indices.",
      inputSchema: sensitivityShape,
    },
    (args) => guard(() => tools.sensitivity(args)),
  );

  server.registerTool(
    "model.explain",
    {
      description: "Explain the model in its own vocabulary: Markdown, feedback loops and explanation coverage.",
      inputSchema: explainShape,
    },
    (args) => guard(() => tools.explain(args)),
  );

  server.registerTool(
    "model.export",
    {
      description: "Export a model as XMILE or IR JSON text.",
      inputSchema: exportShape,
    },
    (args) => guard(() => tools.export(args)),
  );

  server.registerTool(
    "model.history",
    {
      description: "List the patches applied to a model, with rationale, provenance and version.",
      inputSchema: historyShape,
    },
    (args) => guard(() => tools.history(args)),
  );

  // ---------------------------------------------------------------- resources
  server.registerResource(
    "models",
    "sourcesink://models",
    {
      title: "SourceSink models",
      description: "Ids, names and versions of the models held by this server.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(tools.list(), null, 2) }],
    }),
  );

  const modelTemplate = new ResourceTemplate("sourcesink://models/{id}", {
    list: async () => ({
      resources: tools.list().map((m) => ({
        uri: `sourcesink://models/${m.id}`,
        name: `Model ${m.id}`,
        description: m.name,
        mimeType: "application/json",
      })),
    }),
  });
  server.registerResource(
    "model",
    modelTemplate,
    {
      title: "SourceSink model",
      description: "One model as IR JSON.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const id = String(variables.id);
      const model = tools.get({ id });
      if (isToolError(model)) throw new Error(model.error.message);
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(model, null, 2) }],
      };
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

/** True when this module was launched as the process entry point. Compares
 * real paths so a package `bin` symlink still starts the server. */
function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((err: unknown) => {
    console.error(`sourcesink-mcp: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
