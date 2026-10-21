/**
 * SourceSink — transport-independent core of the MCP tool surface.
 *
 * Every function here is ordinary TypeScript: the stdio server in `server.ts`
 * is a thin adapter. That keeps the contract testable without spawning a
 * process and lets notebooks, scripts and the UI call the same operations.
 *
 * Errors are values: a missing model, bad input, unreadable file, invalid
 * XMILE or failed simulation comes back as `{ error: { code, message } }`,
 * never as a thrown exception.
 */

import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

import {
  applyOverrides,
  calibrate,
  gridSamples,
  latinHypercube,
  morris,
  parseCsv,
  simulateEnsemble,
  sobol,
  summarize,
  uniformSamples,
  type Dataset,
  type FitResult,
  type MorrisResult,
  type OutputMetric,
  type Overrides,
  type ParameterSpec,
  type SobolResult,
  type SummaryStats,
} from "@sourcesink/analysis";
import { expandArrays, hasArrays, simulate, type SimulationResult } from "@sourcesink/engine";
import { coverage, describeModel, findLoops, type Loop } from "@sourcesink/explain";
import { importStm } from "@sourcesink/legacy";
import { emptyModel, type Model, type Provenance, type RunSpec } from "@sourcesink/model";
import {
  diffModels,
  renderDiff,
  runGauntlet,
  type Finding,
  type ModelPatch,
} from "@sourcesink/patch";
import { readXmile, writeXmile } from "@sourcesink/xmile";
import type { z } from "zod";

import {
  calibrateSchema,
  createSchema,
  ensembleSchema,
  explainSchema,
  exportSchema,
  getSchema,
  historySchema,
  openSchema,
  patchSchema,
  sensitivitySchema,
  simulateSchema,
  validateSchema,
} from "./schemas.js";

export type ToolErrorCode =
  | "not_found"
  | "invalid_input"
  | "io"
  | "parse"
  | "simulation"
  | "internal";

export interface ToolError {
  error: { code: ToolErrorCode; message: string };
}

export type ToolResult<T> = T | ToolError;

export function isToolError<T>(value: ToolResult<T>): value is ToolError {
  return typeof value === "object" && value !== null && "error" in value;
}

function fail(code: ToolErrorCode, message: string): ToolError {
  return { error: { code, message } };
}

function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}

function invalid(error: z.ZodError): ToolError {
  return fail("invalid_input", zodMessage(error));
}

export interface HistoryEntry {
  version: number;
  rationale?: string;
  provenance: Provenance;
  patch: ModelPatch;
  /** The review diff produced when the patch was accepted. */
  diff: string;
  appliedAt: string;
}

interface StoredModel {
  id: string;
  model: Model;
  version: number;
  history: HistoryEntry[];
}

export interface CreateResult {
  id: string;
  version: number;
}

export interface OpenResult {
  id: string;
  version: number;
  warnings: string[];
}

export interface PatchResult {
  ok: boolean;
  findings: Finding[];
  /** Markdown review diff ("" when the patch could not be applied). */
  diff: string;
  version: number;
}

export interface ValidateResult {
  errors: Finding[];
  warnings: Finding[];
}

export interface SimulateResult {
  time: number[];
  series: Record<string, number[]>;
}

export interface EnsembleOutput {
  time: number[];
  summary: Record<string, SummaryStats>;
  /** Runs that threw (bad sample or invalid model). */
  failed: number;
}

/** A fit plus, when `apply` was requested and the fit converged, the model
 * version the fitted constants were applied to. */
export interface CalibrateResult extends FitResult {
  applied?: boolean;
  version?: number;
  findings?: Finding[];
}

export interface ExplainResult {
  markdown: string;
  loops: Loop[];
  truncated: boolean;
  coverage: ReturnType<typeof coverage>;
}

/** Default plot/report series: the stocks, expanded when the model is
 * arrayed (the engine reports scalar elements such as `Prey[North,Deer]`). */
function stockSeries(model: Model): string[] {
  const scalar = hasArrays(model) ? expandArrays(model) : model;
  return scalar.stocks.map((s) => s.name);
}

/** Select requested series; an arrayed base name stands for all its elements. */
function selectSeries(
  result: { series: Record<string, number[]> },
  requested: string[],
): ToolResult<string[]> {
  const keys = Object.keys(result.series);
  const out: string[] = [];
  for (const name of requested) {
    if (result.series[name] !== undefined) {
      out.push(name);
      continue;
    }
    const expanded = keys.filter((key) => key.startsWith(`${name}[`));
    if (expanded.length === 0) return fail("invalid_input", `unknown series '${name}'`);
    out.push(...expanded);
  }
  return [...new Set(out)];
}

/** Calibration throws for bad names or ranges; classify those as input
 * mistakes and everything else as a simulation problem. */
function calibrationFailure(message: string): ToolError {
  const input = /unknown parameter|duplicate calibration parameter|observed series|invalid range|log scale/.test(
    message,
  );
  return fail(input ? "invalid_input" : "simulation", message);
}

function thin<T>(values: T[], every: number): T[] {
  if (every <= 1) return values;
  return values.filter((_, index) => index % every === 0);
}

export class ModelTools {
  private readonly models = new Map<string, StoredModel>();
  private nextId = 1;

  private add(model: Model): StoredModel {
    const stored: StoredModel = { id: `m${this.nextId++}`, model, version: 1, history: [] };
    this.models.set(stored.id, stored);
    return stored;
  }

  private lookup(id: string): StoredModel | undefined {
    return this.models.get(id);
  }

  private missing(id: string): ToolError {
    return fail("not_found", `no model with id '${id}'`);
  }

  /** All stored models, for the `sourcesink://models` resource. */
  list(): Array<{ id: string; name: string; version: number }> {
    return [...this.models.values()].map((m) => ({ id: m.id, name: m.model.name, version: m.version }));
  }

  // ------------------------------------------------------------------ create
  create(input: unknown): ToolResult<CreateResult> {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { name, description, xmile } = parsed.data;
    if ((name === undefined) === (xmile === undefined)) {
      return fail("invalid_input", "provide exactly one of 'name' or 'xmile'");
    }

    let model: Model;
    if (xmile !== undefined) {
      try {
        model = readXmile(xmile);
      } catch (err) {
        return fail("parse", `invalid XMILE: ${(err as Error).message}`);
      }
    } else {
      model = emptyModel(name!);
    }
    if (description !== undefined) model.documentation = description;

    const stored = this.add(model);
    return { id: stored.id, version: stored.version };
  }

  // -------------------------------------------------------------------- open
  open(input: unknown): ToolResult<OpenResult> {
    const parsed = openSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { path } = parsed.data;
    const ext = extname(path).toLowerCase();

    let model: Model;
    let warnings: string[] = [];
    try {
      if (ext === ".xmile") {
        model = readXmile(readFileSync(path, "utf8"));
      } else if (ext === ".stm" || ext === ".itm") {
        const bytes = new Uint8Array(readFileSync(path));
        const imported = importStm(bytes, basename(path, extname(path)));
        model = imported.model;
        warnings = imported.warnings;
      } else {
        return fail("invalid_input", `unsupported file extension '${ext}' (expected .xmile, .stm or .itm)`);
      }
    } catch (err) {
      const message = (err as Error).message;
      const io = ["ENOENT", "EACCES", "EISDIR"].some((code) => message.includes(code));
      return fail(io ? "io" : "parse", `could not open '${path}': ${message}`);
    }

    const stored = this.add(model);
    return { id: stored.id, version: stored.version, warnings };
  }

  // --------------------------------------------------------------------- get
  get(input: unknown): ToolResult<Model> {
    const parsed = getSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const stored = this.lookup(parsed.data.id);
    if (!stored) return this.missing(parsed.data.id);
    return structuredClone(stored.model);
  }

  // ------------------------------------------------------------------- patch
  patch(input: unknown): ToolResult<PatchResult> {
    const parsed = patchSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const stored = this.lookup(parsed.data.id);
    if (!stored) return this.missing(parsed.data.id);

    const patch = parsed.data.patch as unknown as ModelPatch;
    const effective: ModelPatch = {
      ...patch,
      provenance: patch.provenance ?? { author: "ai" },
    };

    const result = runGauntlet(stored.model, effective);
    const diff = result.model
      ? renderDiff(diffModels(stored.model, result.model))
      : "";

    if (result.ok && !parsed.data.dryRun && result.model) {
      stored.model = result.model;
      stored.version += 1;
      stored.history.push({
        version: stored.version,
        rationale: effective.rationale,
        provenance: effective.provenance!,
        patch: effective,
        diff,
        appliedAt: new Date().toISOString(),
      });
    }

    return { ok: result.ok, findings: result.findings, diff, version: stored.version };
  }

  // ---------------------------------------------------------------- validate
  validate(input: unknown): ToolResult<ValidateResult> {
    const parsed = validateSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const stored = this.lookup(parsed.data.id);
    if (!stored) return this.missing(parsed.data.id);

    const result = runGauntlet(stored.model, { ops: [] });
    return {
      errors: result.findings.filter((f) => f.severity === "error"),
      warnings: result.findings.filter((f) => f.severity === "warning"),
    };
  }

  // ---------------------------------------------------------------- simulate
  simulate(input: unknown): ToolResult<SimulateResult> {
    const parsed = simulateSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const stored = this.lookup(parsed.data.id);
    if (!stored) return this.missing(parsed.data.id);

    const run: Partial<RunSpec> = parsed.data.run ?? {};
    const model = structuredClone(stored.model);
    model.run = { ...model.run, ...run };

    let result: SimulationResult;
    try {
      result = simulate(model, { seed: parsed.data.seed ?? 0 });
    } catch (err) {
      return fail("simulation", (err as Error).message);
    }

    let requested: string[];
    try {
      requested = parsed.data.series ?? stockSeries(model);
    } catch (err) {
      return fail("simulation", (err as Error).message);
    }
    const selectedResult = selectSeries(result, requested);
    if (isToolError(selectedResult)) return selectedResult;

    const every = parsed.data.every ?? 1;
    const series: Record<string, number[]> = {};
    for (const name of selectedResult) series[name] = thin(result.series[name], every);
    return { time: thin(result.time, every), series };
  }

  // ---------------------------------------------------------------- ensemble
  ensemble(input: unknown): ToolResult<EnsembleOutput> {
    const parsed = ensembleSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const stored = this.lookup(parsed.data.id);
    if (!stored) return this.missing(parsed.data.id);
    const { samples, grid, ranges, n, lhs, seed = 0 } = parsed.data;

    const designs = [samples, grid, ranges].filter((d) => d !== undefined).length;
    if (designs > 1) return fail("invalid_input", "provide at most one of 'samples', 'grid' or 'ranges'");

    let design: Overrides[];
    if (samples !== undefined) {
      design = samples;
    } else if (grid !== undefined) {
      design = gridSamples(grid);
    } else if (ranges !== undefined) {
      if (n === undefined) return fail("invalid_input", "'n' is required with 'ranges'");
      design = lhs ? latinHypercube(ranges, n, seed) : uniformSamples(ranges, n, seed);
    } else {
      design = [{}];
    }

    const seeds = design.map((_, index) => seed + index);
    const result = simulateEnsemble({ base: stored.model, samples: design, seeds });

    let requested: string[];
    try {
      requested = parsed.data.series ?? stockSeries(stored.model);
    } catch (err) {
      return fail("simulation", (err as Error).message);
    }

    let summary: Record<string, SummaryStats>;
    try {
      summary = summarize(result, requested);
    } catch (err) {
      return fail("simulation", (err as Error).message);
    }

    return {
      time: result.time,
      summary,
      failed: result.runs.filter((run) => run.error !== undefined).length,
    };
  }

  // ----------------------------------------------------------------- explain
  explain(input: unknown): ToolResult<ExplainResult> {
    const parsed = explainSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const stored = this.lookup(parsed.data.id);
    if (!stored) return this.missing(parsed.data.id);

    try {
      const description = describeModel(stored.model);
      const loops = findLoops(stored.model);
      return {
        markdown: description.markdown,
        loops: loops.loops,
        truncated: loops.truncated,
        coverage: coverage(stored.model, description),
      };
    } catch (err) {
      return fail("internal", `could not explain the model: ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ export
  export(input: unknown): ToolResult<string> {
    const parsed = exportSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const stored = this.lookup(parsed.data.id);
    if (!stored) return this.missing(parsed.data.id);
    try {
      return parsed.data.format === "xmile"
        ? writeXmile(stored.model)
        : JSON.stringify(stored.model, null, 2);
    } catch (err) {
      return fail("internal", `could not export the model: ${(err as Error).message}`);
    }
  }

  // --------------------------------------------------------------- calibrate
  calibrate(input: unknown): ToolResult<CalibrateResult> {
    const parsed = calibrateSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const stored = this.lookup(parsed.data.id);
    if (!stored) return this.missing(parsed.data.id);

    let data: Dataset;
    if (parsed.data.data.csv !== undefined) {
      try {
        data = parseCsv(parsed.data.data.csv);
      } catch (err) {
        return fail("parse", `invalid CSV: ${(err as Error).message}`);
      }
    } else {
      data = {
        time: parsed.data.data.time!,
        series: parsed.data.data.series!,
      };
    }

    let fit: FitResult;
    try {
      fit = calibrate(
        stored.model,
        data,
        parsed.data.params as ParameterSpec[],
        parsed.data.options,
      );
    } catch (err) {
      return calibrationFailure((err as Error).message);
    }

    if (!parsed.data.apply) return fit;
    if (!fit.converged) return { ...fit, applied: false, version: stored.version };

    const patch: ModelPatch = {
      ops: Object.entries(fit.parameters).map(([name, value]) => ({
        op: "update",
        name,
        changes: { equation: String(value) },
      })),
      rationale: "fitted parameter values from model.calibrate",
      provenance: { author: "ai", agent: "sourcesink-calibrate" },
    };
    const applied = this.patch({ id: parsed.data.id, patch });
    if (isToolError(applied)) return applied;
    if (!applied.ok) {
      const first = applied.findings.find((f) => f.severity === "error");
      return fail("invalid_input", `fitted parameters failed validation: ${first?.message ?? "unknown error"}`);
    }
    return { ...fit, applied: true, version: applied.version, findings: applied.findings };
  }

  // ------------------------------------------------------------- sensitivity
  sensitivity(input: unknown): ToolResult<MorrisResult | SobolResult> {
    const parsed = sensitivitySchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const stored = this.lookup(parsed.data.id);
    if (!stored) return this.missing(parsed.data.id);

    const params = parsed.data.params as ParameterSpec[];
    const metric = parsed.data.metric as OutputMetric;
    const seed = parsed.data.seed ?? 0;

    // Check names and the metric series once so a typo is an input error,
    // not a table full of NaN rows from silently failed samples.
    const overrides: Overrides = {};
    for (const param of params) overrides[param.name] = param.min;
    try {
      applyOverrides(stored.model, overrides);
      if (!(metric.series in simulate(stored.model, { seed }).series)) {
        return fail("invalid_input", `unknown series '${metric.series}'`);
      }
    } catch (err) {
      return fail("invalid_input", (err as Error).message);
    }

    try {
      if (parsed.data.method === "sobol") {
        return sobol(stored.model, params, metric, {
          ...(parsed.data.samples === undefined ? {} : { samples: parsed.data.samples }),
          seed,
        });
      }
      return morris(stored.model, params, metric, {
        ...(parsed.data.trajectories === undefined ? {} : { trajectories: parsed.data.trajectories }),
        seed,
      });
    } catch (err) {
      return fail("invalid_input", (err as Error).message);
    }
  }

  // ----------------------------------------------------------------- history
  history(input: unknown): ToolResult<HistoryEntry[]> {
    const parsed = historySchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const stored = this.lookup(parsed.data.id);
    if (!stored) return this.missing(parsed.data.id);
    return structuredClone(stored.history);
  }
}

/** Convenience factory for the server and for tests. */
export function createTools(): ModelTools {
  return new ModelTools();
}
