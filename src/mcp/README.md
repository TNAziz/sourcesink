# @sourcesink/mcp

A stdio [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes SourceSink models to agents, notebooks and editors. It is a thin
adapter over `src/tools.ts`; the same operations can be called directly from
TypeScript through `createTools()`.

## Run

From the repository root:

```bash
npm install
npx tsx src/mcp/src/server.ts
```

The package also declares a `sourcesink-mcp` bin that points at
`src/server.ts`.

## Register with an MCP client

Claude Code:

```bash
claude mcp add sourcesink -- npx tsx /absolute/path/to/src/mcp/src/server.ts
```

Generic client configuration:

```json
{
  "mcpServers": {
    "sourcesink": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/src/mcp/src/server.ts"]
    }
  }
}
```

## Tools

| Tool | Purpose |
|---|---|
| `model.create` | Create a model from `{ name }` or XMILE `{ xmile }`. |
| `model.open` | Open a `.xmile`, `.stm` or `.itm` file from disk. |
| `model.get` | Read a model as IR JSON. |
| `model.patch` | Run the gauntlet on a patch, return findings + Markdown diff, apply when valid (unless `dryRun`). |
| `model.validate` | Parse, structure and smoke-check the current model. |
| `model.simulate` | Run the engine; default series are stocks; `every` thins rows. |
| `model.ensemble` | Run explicit samples, a factorial `grid`, or `ranges` (`n`, `lhs`) and summarize. |
| `model.explain` | Markdown explanation, feedback loops and coverage. |
| `model.export` | XMILE or IR JSON text. |
| `model.history` | Applied patches with rationale, provenance and version. |

Resources: `sourcesink://models` (id, name, version) and
`sourcesink://models/{id}` (IR JSON).

Models live in memory for the life of the server process; ids are `m1`,
`m2`, … and each starts at version 1. Every operation returns a structured
`{ error: { code, message } }` value on failure instead of throwing, and the
stdio adapter reports it as an MCP tool error (`isError: true`).

## Tests

```bash
npx vitest run src/mcp            # core tools + stdio smoke test
npm run test:stdio -w @sourcesink/mcp
```
