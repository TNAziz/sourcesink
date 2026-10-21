# SourceSink — build contract

SourceSink is an open-source system dynamics (stock-and-flow) modeling tool,
written in TypeScript, for the desktop (Linux, Windows, macOS), the browser and
the command line.

## What we are building

1. A **graphical map editor**: stocks, flows, converters, connectors and
   graphical functions, with drag-and-draw editing and auto-layout.
2. A **simulation engine**: DT-based integration (Euler, Runge-Kutta 2 and 4,
   adaptive RK45), the built-in function library (smoothing, delays, pulses,
   ramps, random numbers, discrete stocks), run specs, arrays and scenarios.
3. **Analysis**: calibration to data, Morris and Sobol sensitivity, Monte Carlo
   uncertainty, unit checking, plain-language model description.
4. **The modeling assistant**: AI-proposed changes as validated patches.
5. **File I/O**: **XMILE** (the OASIS open standard) as the native format, and
   an importer for the legacy `.stm`/`.itm` model formats.

## Repo layout

```
src/            app source (npm workspaces)
  engine/       pure-TS simulation engine (integrators, function library), no UI
  model/        model IR: stocks/flows/converters/connectors, equations, arrays
  xmile/        XMILE reader/writer
  legacy/       .stm/.itm importer
  analysis/     ensembles, calibration, sensitivity, uncertainty
  explain/      causal links, feedback loops, structural description
  units/        dimensional analysis
  patch/        validated model edits (the only way automation changes a model)
  assistant/    conversational modeling assistant and its language-model bridge
  mcp/          MCP server for AI agents
  cli/          the `sourcesink` command line
  ui/           React + Vite editor
  desktop/      Electron shell and installers
examples/       cited, tested example models (XMILE + catalog.json)
docs/           architecture, analysis, assistant, format notes, manual, LLM guide
tests/          integration tests: example library, evaluation corpus, guides
```

## Hard rules

- **Original work only.** Never copy third-party code, icons, graphics, help
  text or sample models into the repository or the product. A local
  `extraction/` folder (ignored by git) may hold third-party reference files
  for testing the importer; never commit, redistribute or embed anything from it.
- **Legacy importer from our own notes.** The `.stm`/`.itm` reader is written
  from the field notes in `docs/format/stm.md`, which describe what the files
  contain as observed in sample files. Document each field's observed meaning.
- **No third-party product names** in the product name, the UI or user-facing
  documentation.

## Stack and conventions

- TypeScript, ESM, strict mode. npm workspaces. Vitest for tests.
- The engine is a **pure function** of (model, run spec) → results, with no I/O
  in `src/engine`, so it is testable and reusable in the browser and CLI.
- Every behavior change comes with a test; where an analytic or published
  answer exists, test against it.
- Conventional Commits. No generated binaries committed.

## Read these before coding

- `docs/architecture.md`: component and API boundaries.
- `docs/analysis.md`, `docs/assistant.md`: the analysis layer and the assistant.
- `docs/format/stm.md`: legacy file-format notes for the importer.
- `docs/ROADMAP.md`, `docs/plans/`: the roadmap and feature plans.
