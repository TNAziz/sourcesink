/**
 * SourceSink — headless runner.
 *
 * Usage:
 *   sourcesink run <model.xmile|model.stm|model.itm> [--json] [--columns a,b,c]
 *                 [--method euler|rk2|rk4|rk45] [--scenario <name|id>]
 *                 [--set NAME=VALUE ...]
 *   sourcesink sweep <model> --param K=0.1:1.0:10 [--param a=1,2,4]
 *                   [--columns S,T] [--json]
 *   sourcesink montecarlo <model> --param K=0.1:1.0 [--param …] --runs 200
 *                         [--seed 1] [--lhs] [--columns S]
 *                         [--percentiles 5,50,95]
 *   sourcesink convert <model.stm|.itm> [out.xmile]
 *
 * Reads an XMILE v1.0 model (or imports a legacy .stm/.itm file),
 * simulates it with the engine, and prints a table (CSV) or JSON object. This
 * is the integration seam between `@sourcesink/xmile`/`@sourcesink/legacy`
 * (parse), `@sourcesink/model` (IR + validation), `@sourcesink/engine`
 * (simulate) and `@sourcesink/analysis` (overrides and ensembles).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";

import {
  applyOverrides,
  applyScenario,
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
  type EnsembleResult,
  type FitResult,
  type MorrisResult,
  type Overrides,
  type SobolResult,
  type SummaryStats,
} from "@sourcesink/analysis";
import { canonicalName, simulate, type SimulateOptions } from "@sourcesink/engine";
import { importStm } from "@sourcesink/legacy";
import { validate, type Model } from "@sourcesink/model";
import { checkUnits } from "@sourcesink/units";
import { readXmile, writeXmile } from "@sourcesink/xmile";

import {
  ArgError,
  findScenario,
  lastValue,
  parseColumns,
  parseFlags,
  parseParam,
  parsePercentiles,
  parseRangeParam,
  parseRuns,
  parseSeed,
  parseSet,
  type ParsedFlags,
} from "./args.js";
import { formatExplainReport, explainReport, parseExplainArgs } from "./explain.js";
import { fittedModel, formatFitReport, matchUnitHeaders, parseFitArgs } from "./fit.js";
import { formatMonteCarloCsv, formatSweepCsv } from "./format.js";
import { formatSensitivityReport, parseSensitivityArgs } from "./sensitivity.js";

function usage(): never {
  console.error("usage: sourcesink run <model.xmile|.stm|.itm> [--json] [--columns a,b,c]");
  console.error("                      [--method euler|rk2|rk4|rk45] [--scenario <name|id>] [--set NAME=VALUE]...");
  console.error("       sourcesink sweep <model> --param K=0.1:1.0:10 [--param a=1,2,4] [--columns S,T] [--json]");
  console.error("       sourcesink montecarlo <model> --param K=0.1:1.0 [--param ...] --runs 200 [--seed 1] [--lhs]");
  console.error("                             [--columns S] [--percentiles 5,50,95]");
  console.error("       sourcesink convert <model.stm|.itm> [out.xmile]");
  console.error("       sourcesink explain <model> [--loops] [--json]");
  console.error("       sourcesink fit <model> --data obs.csv --param NAME=MIN:MAX[:log] [--param ...]");
  console.error("                     [--rename \"CSV header=element\"]... [--method nelder-mead|de] [--starts N]");
  console.error("                     [--objective sse|wsse|nse] [--seed N] [--json] [--write fitted.xmile]");
  console.error("       sourcesink units <model> [--json]");
  console.error("       sourcesink sensitivity <model> --param NAME=MIN:MAX[:log] [--param ...]");
  console.error("                     --metric SERIES:STAT[@TIME] [--method morris|sobol] [--trajectories N]");
  console.error("                     [--samples N] [--seed N] [--json]");
  process.exit(2);
}

const isLegacy = (file: string) => /\.(stm|itm)$/i.test(file);

/** Load any supported model file; legacy import notes go to stderr. */
function loadModel(file: string): Model {
  if (!isLegacy(file)) return readXmile(readFileSync(file, "utf8"));
  const { model, warnings } = importStm(new Uint8Array(readFileSync(file)), basename(file, extname(file)));
  for (const w of warnings) console.error(`import: ${w}`);
  return model;
}

/** Load and structurally validate; invalid models exit 1 (not a CLI mistake). */
function loadValidated(file: string): Model {
  const model = loadModel(file);
  const errors = validate(model);
  if (errors.length) {
    console.error(`model validation failed:\n  - ${errors.join("\n  - ")}`);
    process.exit(1);
  }
  return model;
}

/** Rethrow any failure as a one-line `ArgError` (unless it already is one). */
function userError(err: unknown): never {
  if (err instanceof ArgError) throw err;
  throw new ArgError(err instanceof Error ? err.message : String(err));
}

const METHODS = new Set(["euler", "rk2", "rk4", "rk45"]);

/** `--method` as a simulate option, or undefined for the run spec's value. */
function methodOption(flags: ParsedFlags): SimulateOptions | undefined {
  const raw = lastValue(flags, "method");
  if (raw === undefined) return undefined;
  if (!METHODS.has(raw)) throw new ArgError(`bad --method '${raw}': expected euler, rk2, rk4 or rk45`);
  return { integration: raw as SimulateOptions["integration"] };
}

/** Explicit `--columns`, or [] when the flag is absent. */
function columnList(flags: ParsedFlags): string[] {
  const raw = lastValue(flags, "columns");
  return raw === undefined ? [] : parseColumns(raw);
}

/** Column names of the first successful run when no --columns was given. */
function defaultColumns(result: EnsembleResult): string[] {
  const first = result.runs.find((r) => r.result !== undefined);
  return first ? Object.keys(first.result!.series) : [];
}

/** Reject duplicate parameter names (canonical equality, e.g. K = k). */
function assertDistinct(names: string[]): void {
  const seen = new Map<string, string>();
  for (const name of names) {
    const key = canonicalName(name);
    const previous = seen.get(key);
    if (previous !== undefined) {
      throw new ArgError(`duplicate --param '${name}' (same as '${previous}')`);
    }
    seen.set(key, name);
  }
}

/** Fail early (exit 2) on an override name the model does not have. */
function validateNames(model: Model, samples: Overrides[]): void {
  if (samples.length === 0) return;
  try {
    applyOverrides(model, samples[0]);
  } catch (err) {
    userError(err);
  }
}

/** Ensemble failures are data, not a fatal error: summarize them on stderr. */
function reportFailures(result: EnsembleResult): void {
  const failed = result.runs.filter((r) => r.error !== undefined);
  if (failed.length > 0) {
    console.error(`${failed.length} of ${result.runs.length} runs failed: ${failed[0].error}`);
  }
}

function emitCsv(time: number[], series: Record<string, number[]>, columns: string[]): void {
  const keys = columns.length ? columns : Object.keys(series);
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(6));
  console.log(["time", ...keys].join(","));
  for (let i = 0; i < time.length; i++) {
    console.log([fmt(time[i]), ...keys.map((k) => fmt(series[k]?.[i] ?? Number.NaN))].join(","));
  }
}

function commandRun(args: string[]): void {
  const flags = parseFlags(args, {
    values: ["columns", "method", "scenario", "set"],
    booleans: ["json"],
  });
  const file = flags.positional[0];
  if (!file) usage();

  let model = loadValidated(file);

  const scenarioRef = lastValue(flags, "scenario");
  if (scenarioRef !== undefined) {
    try {
      model = applyScenario(model, findScenario(model, scenarioRef));
    } catch (err) {
      userError(err);
    }
  }

  const setArgs = flags.values.set ?? [];
  if (setArgs.length > 0) {
    const overrides = Object.assign({}, ...setArgs.map(parseSet)) as Overrides;
    try {
      model = applyOverrides(model, overrides);
    } catch (err) {
      userError(err);
    }
  }

  const options = methodOption(flags);
  const result = simulate(model, options ?? {});

  if (flags.booleans.has("json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    emitCsv(result.time, result.series, columnList(flags));
  }
}

function commandSweep(args: string[]): void {
  const flags = parseFlags(args, { values: ["param", "columns"], booleans: ["json"] });
  const file = flags.positional[0];
  if (!file) usage();

  const params = (flags.values.param ?? []).map(parseParam);
  if (params.length === 0) {
    throw new ArgError("sweep needs at least one --param NAME=LO:HI:COUNT or NAME=a,b,c");
  }
  assertDistinct(params.map((p) => p.name));

  const levels: Record<string, number[]> = {};
  for (const p of params) levels[p.name] = p.values;

  const model = loadValidated(file);
  const samples = gridSamples(levels);
  validateNames(model, samples);

  const result = simulateEnsemble({ base: model, samples });
  reportFailures(result);

  if (flags.booleans.has("json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const columns = columnList(flags);
  console.log(formatSweepCsv(result, params.map((p) => p.name), columns.length ? columns : defaultColumns(result)));
}

function commandMonteCarlo(args: string[]): void {
  const flags = parseFlags(args, {
    values: ["param", "runs", "seed", "columns", "percentiles"],
    booleans: ["lhs"],
  });
  const file = flags.positional[0];
  if (!file) usage();

  const params = (flags.values.param ?? []).map(parseRangeParam);
  if (params.length === 0) {
    throw new ArgError("montecarlo needs at least one --param NAME=MIN:MAX");
  }
  assertDistinct(params.map((p) => p.name));

  const ranges: Record<string, [number, number]> = {};
  for (const p of params) ranges[p.name] = p.range;

  const runsArg = lastValue(flags, "runs");
  if (runsArg === undefined) throw new ArgError("montecarlo needs --runs N");
  const runs = parseRuns(runsArg);

  const seedArg = lastValue(flags, "seed");
  const seed = seedArg === undefined ? 0 : parseSeed(seedArg);
  const pctArg = lastValue(flags, "percentiles");
  const percentiles = pctArg === undefined ? [5, 50, 95] : parsePercentiles(pctArg);

  const model = loadValidated(file);
  const samples = flags.booleans.has("lhs")
    ? latinHypercube(ranges, runs, seed)
    : uniformSamples(ranges, runs, seed);
  validateNames(model, samples);

  const result = simulateEnsemble({ base: model, samples, seeds: [seed] });
  reportFailures(result);

  const columns = columnList(flags);
  const selected = columns.length ? columns : defaultColumns(result);
  let summary: Record<string, SummaryStats>;
  try {
    summary = summarize(result, selected, percentiles);
  } catch (err) {
    userError(err);
  }
  console.log(formatMonteCarloCsv(result.time, summary, selected, percentiles));
}

function commandConvert(args: string[]): void {
  const { positional } = parseFlags(args, {});
  const [file, out] = positional;
  if (!file || !isLegacy(file)) usage();
  const xml = writeXmile(loadModel(file));
  if (out) writeFileSync(out, xml);
  else process.stdout.write(xml);
}

function commandExplain(args: string[]): void {
  const options = parseExplainArgs(args);
  const report = explainReport(loadModel(options.file));
  console.log(formatExplainReport(report, options));
}

function commandFit(args: string[]): void {
  const options = parseFitArgs(args);
  const model = loadValidated(options.file);

  let data: Dataset;
  try {
    data = matchUnitHeaders(parseCsv(readFileSync(options.data, "utf8"), { rename: options.rename }), model);
  } catch (err) {
    userError(err);
  }

  let result: FitResult;
  try {
    result = calibrate(model, data, options.params, {
      ...(options.method === undefined ? {} : { method: options.method }),
      ...(options.starts === undefined ? {} : { starts: options.starts }),
      ...(options.objective === undefined ? {} : { objective: options.objective }),
      ...(options.seed === undefined ? {} : { seed: options.seed }),
    });
  } catch (err) {
    userError(err);
  }

  if (options.write !== undefined) {
    writeFileSync(options.write, writeXmile(fittedModel(model, result)));
    console.error(`wrote fitted model to ${options.write}`);
  }
  console.log(options.json ? JSON.stringify(result, null, 2) : formatFitReport(result));
}

function commandUnits(args: string[]): void {
  const flags = parseFlags(args, { booleans: ["json"] });
  const file = flags.positional[0];
  if (!file) usage();

  const findings = checkUnits(loadModel(file));
  if (flags.booleans.has("json")) {
    console.log(JSON.stringify(findings, null, 2));
  } else if (findings.length === 0) {
    console.log("No unit problems found.");
  } else {
    for (const finding of findings) console.log(`${finding.element}: ${finding.message}`);
  }
}

function commandSensitivity(args: string[]): void {
  const options = parseSensitivityArgs(args);
  const model = loadValidated(options.file);
  const seed = options.seed ?? 0;

  // Fail with a CLI error (exit 2) for a typo, rather than letting every
  // sample fail silently and the table fill with NaN.
  const overrides: Overrides = {};
  for (const param of options.params) overrides[param.name] = param.min;
  try {
    applyOverrides(model, overrides);
    const probe = simulate(model, { seed });
    if (probe.series[options.metric.series] === undefined) {
      throw new ArgError(`unknown series '${options.metric.series}'`);
    }
  } catch (err) {
    userError(err);
  }

  let result: MorrisResult | SobolResult;
  try {
    result =
      options.method === "sobol"
        ? sobol(model, options.params, options.metric, {
            ...(options.samples === undefined ? {} : { samples: options.samples }),
            seed,
          })
        : morris(model, options.params, options.metric, {
            ...(options.trajectories === undefined ? {} : { trajectories: options.trajectories }),
            seed,
          });
  } catch (err) {
    userError(err);
  }

  console.log(
    options.json ? JSON.stringify(result, null, 2) : formatSensitivityReport(result, options.method),
  );
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "run") return commandRun(rest);
    if (cmd === "sweep") return commandSweep(rest);
    if (cmd === "montecarlo") return commandMonteCarlo(rest);
    if (cmd === "convert") return commandConvert(rest);
    if (cmd === "explain") return commandExplain(rest);
    if (cmd === "fit") return commandFit(rest);
    if (cmd === "sensitivity") return commandSensitivity(rest);
    if (cmd === "units") return commandUnits(rest);
    usage();
  } catch (err) {
    if (err instanceof ArgError) {
      console.error(err.message);
      process.exit(2);
    }
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
