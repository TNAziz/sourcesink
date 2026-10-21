# Architecture

Dependency rule: **edges point inward toward `@sourcesink/model`.** The IR is the
shared contract; no package may depend on a package "later" in this list.

```
          ui  /  cli  /  mcp*        (apps)
                   │
    ┌──────────────┼──────────────┐
    ▼              ▼              ▼
analysis        patch          explain       xmile ──▶ model
    └──────────────┼──────────────┘           legacy ─▶ model
                   ▼
                 engine ──▶ model (IR + function catalog)
```

\* `mcp` is in progress. Apps may also call `engine` and the I/O packages
directly (see the dependency list below).

## Packages

- **`@sourcesink/model`** — IR types (`index.ts`) and the built-in function
  catalog (`functions.ts`); `emptyModel`, `validate`, `allElements`, `byName`.
  Zero runtime dependencies. Owned by the manager.
- **`@sourcesink/engine`** — pure functions, no I/O: `parse`, `evaluate`,
  `evaluateExpression`, `collectReferences`, `canonicalName`,
  `computeOrder`/`orderPhases`, `simulate`, `expandArrays`/`hasArrays`/
  `elementName`, and the built-in catalog (`lookupBuiltin`, `evaluateBuiltin`).
- **`@sourcesink/analysis`** — ensembles and analysis designs:
  `applyOverrides`/`applyScenario`, `simulateEnsemble`, `summarize`,
  `gridSamples`/`uniformSamples`/`latinHypercube`. Depends on engine + model.
- **`@sourcesink/patch`** — reviewable `ModelPatch` operations: `applyPatch`,
  `diffModels`/`renderDiff`, and `runGauntlet` (schema → apply → parse →
  structure → smoke). Depends on engine + model.
- **`@sourcesink/explain`** — deterministic model explanation:
  `causalLinks`/`linkPolarities`, `findLoops`, `describeModel`/`coverage`.
  Depends on engine + model (graph and numeric polarities only).
- **`@sourcesink/xmile`** — `readXmile(xml): Model`, `writeXmile(model): string`;
  XMILE (OASIS) schema v1.0, round-trip tests, provenance and scenarios.
  Depends on model.
- **`@sourcesink/legacy`** — `importStm(bytes): { model, warnings }` (best-effort),
  `parseStm` (header/sections) and `readObjects`; per `docs/format/stm.md`.
  Depends on model.
- **`@sourcesink/cli`** — `run`, `convert`, `sweep`, `montecarlo` (see CLI).
  Depends on analysis, engine, xmile, legacy, model.
- **`@sourcesink/ui`** — Vite + React + `@xyflow/react` diagram editor; graph and
  table views; run panel. Depends on engine, xmile, legacy, model.
- **`@sourcesink/mcp`** — tool server exposing model/simulation/analysis as MCP
  tools for agents and notebooks. In progress; not yet a workspace package.
- **`@sourcesink/desktop`** — Electron shell (native window, menus, file dialogs,
  Linux packaging); no package dependencies.

## Data flow

1. Author/load: `legacy` or `xmile` produces `Model`.
2. `ui` edits `Model` directly (unidirectional), renders stocks as
   source/sink nodes, flows as pipes, converters as circles, connectors as edges.
   `patch` proposes validated model changes; `explain` reads the graph.
3. Run: `engine.simulate(Model)` for one run, or `analysis.simulateEnsemble(...)`
   for overrides/seeds; `cli` formats the result.
4. Save: `xmile.writeXmile(Model)`.

## Simulation semantics

- Fixed-step integration over `[run.start, run.stop]` with step `run.dt`,
  recording every `run.saveEvery` units plus the final time. Methods are Euler
  (default), RK2 (Heun: average of the slopes at `t` and `t+DT`) and RK4;
  precedence is `SimulateOptions.integration` → `run.integration` → Euler.
- Arrays (subscripts) are compiled to scalar elements before simulation:
  `Population[Region]` becomes `Population[North]`, …; dimension references,
  `*` selection and the aggregate functions SUM/MEAN/STDDEV/MIN/MAX are
  rewritten per element, so every engine feature works on arrays unchanged.
- Continuous stocks integrate the net of their inflows and outflows; flows and
  converters are evaluated in dependency order each step; connectors are
  information links and never move material.
- Conveyors, queues and ovens are discrete-state stocks. A conveyor carries
  batches (slats) for a per-batch transit time with optional leaks; a queue is
  first-in first-out and outflows take from it in listed order; an oven fills,
  cooks and empties in batches. These advance once per step using the
  start-of-step flows.
- Under RK, stateful functions (SMTH1/3, DELAY1/3/N, TREND, RANDOM/NORMAL,
  PREV/INIT and the cycle-time statistics) return their start-of-step value in
  intermediate stages, so they advance exactly once per DT, not once per stage.

## CLI

`@sourcesink/cli` loads XMILE or legacy models (`loadModel`). Commands write CSV
to stdout unless noted; bad arguments, unknown elements and unknown scenarios
print one line to stderr and exit 2 (a structurally invalid model exits 1).
Without `--columns`, all result series are used.

- `run <model> [--json] [--columns a,b,c] [--method euler|rk2|rk4]
  [--scenario <name|id>] [--set NAME=VALUE]...` — one simulation. `--set`
  replaces an element's equation (numeric right sides become constants) and is
  applied after `--scenario`.
- `convert <model.stm|.itm> [out.xmile]` — import a legacy model and write XMILE
  (stdout when no output path is given).
- `sweep <model> --param K=lo:hi:n [--param a=1,2,4]... [--columns S,T] [--json]`
  — full-factorial grid (`gridSamples`). CSV: one row per run with the parameter
  values and `<column> final` values; `--json` prints the full `EnsembleResult`.
- `montecarlo <model> --param K=min:max [--param ...] --runs N [--seed S]
  [--lhs] [--columns S] [--percentiles 5,50,95]` — uniform (or Latin-hypercube
  with `--lhs`) sampling. CSV: `time`, then `<column> mean`, `<column> sd` and
  `<column> p<P>` for each percentile.
- Failed ensemble runs are reported on stderr (`n of m runs failed: …`) and do
  not abort the command; a failed sweep run keeps its row with NaN finals.

## Conventions

- Every package exports ESM TypeScript, strict mode, no build step needed for
  vitest (tests import `.ts` directly).
- Equations use the SD dialect: names are identifiers (spaces allowed in names,
  but equations reference by bare name; engine resolves names -> values).
- New functionality requires a unit test; cross-package correctness requires an
  integration test under `tests/`.
