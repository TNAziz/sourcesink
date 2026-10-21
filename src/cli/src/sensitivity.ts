/**
 * SourceSink — `sensitivity` command helpers.
 *
 * The metric grammar (`DO:at@5`, `S:final`) and the ranked tables are pure
 * functions so the command can be tested without spawning a process.
 */

import type {
  MorrisResult,
  OutputMetric,
  ParameterSpec,
  SobolResult,
} from "@sourcesink/analysis";
import { canonicalName } from "@sourcesink/engine";

import { ArgError, lastValue, parseFlags, parseSeed } from "./args.js";

export type SensitivityMethod = "morris" | "sobol";

export interface SensitivityOptions {
  file: string;
  params: ParameterSpec[];
  metric: OutputMetric;
  method: SensitivityMethod;
  trajectories?: number;
  samples?: number;
  seed?: number;
  json: boolean;
}

const STATS = new Set(["final", "max", "min", "mean", "integral", "at"]);

/** `SERIES:STAT[@TIME]` -> an OutputMetric. */
export function parseMetric(arg: string): OutputMetric {
  const colon = arg.lastIndexOf(":");
  if (colon < 0) throw new ArgError(`bad --metric '${arg}': expected SERIES:STAT[@TIME]`);
  const series = arg.slice(0, colon).trim();
  const rest = arg.slice(colon + 1).trim();
  if (!series) throw new ArgError(`bad --metric '${arg}': the series name is empty`);

  const at = rest.indexOf("@");
  const stat = (at < 0 ? rest : rest.slice(0, at)).trim().toLowerCase();
  const timeText = at < 0 ? undefined : rest.slice(at + 1).trim();
  if (!STATS.has(stat)) {
    throw new ArgError(
      `bad --metric '${arg}': unknown statistic '${stat}' (expected final, max, min, mean, integral or at)`,
    );
  }
  if (stat === "at") {
    if (timeText === undefined) throw new ArgError(`bad --metric '${arg}': 'at' needs @TIME`);
    const time = Number(timeText);
    if (timeText === "" || !Number.isFinite(time)) {
      throw new ArgError(`bad --metric '${arg}': '@${timeText}' is not a time`);
    }
    return { series, stat: "at", time };
  }
  if (timeText !== undefined) {
    throw new ArgError(`bad --metric '${arg}': only 'at' takes @TIME`);
  }
  return { series, stat: stat as "final" | "max" | "min" | "mean" | "integral" };
}

function parseParam(arg: string): ParameterSpec {
  const eq = arg.indexOf("=");
  if (eq < 0) throw new ArgError(`bad --param '${arg}': expected NAME=MIN:MAX[:log]`);
  const name = arg.slice(0, eq).trim();
  const spec = arg.slice(eq + 1).trim();
  if (!name) throw new ArgError(`bad --param '${arg}': parameter name is empty`);

  const parts = spec.split(":");
  if (parts.length !== 2 && parts.length !== 3) {
    throw new ArgError(`bad --param '${arg}': expected NAME=MIN:MAX[:log]`);
  }
  const number = (token: string): number => {
    const text = token.trim();
    const value = Number(text);
    if (text === "" || !Number.isFinite(value)) {
      throw new ArgError(`bad --param '${arg}': '${text}' is not a number`);
    }
    return value;
  };
  const min = number(parts[0]);
  const max = number(parts[1]);
  if (!(max > min)) throw new ArgError(`bad --param '${arg}': expected MIN < MAX`);

  let scale: ParameterSpec["scale"];
  if (parts.length === 3) {
    const tag = parts[2].trim().toLowerCase();
    if (tag !== "log") throw new ArgError(`bad --param '${arg}': the scale must be 'log'`);
    if (!(min > 0)) throw new ArgError(`bad --param '${arg}': a log scale needs MIN > 0`);
    scale = "log";
  }
  return scale ? { name, min, max, scale } : { name, min, max };
}

function positiveInteger(raw: string, flag: string): number {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(value) || value < 1) {
    throw new ArgError(`bad --${flag} '${raw}': expected a positive integer`);
  }
  return value;
}

/** Parse `sourcesink sensitivity <model> --param … --metric …`. */
export function parseSensitivityArgs(args: string[]): SensitivityOptions {
  const flags = parseFlags(args, {
    values: ["param", "metric", "method", "trajectories", "samples", "seed"],
    booleans: ["json"],
  });
  const file = flags.positional[0];
  if (!file) throw new ArgError("sensitivity needs a model file");
  if (flags.positional.length > 1) {
    throw new ArgError(`sensitivity takes one model file (unexpected '${flags.positional[1]}')`);
  }

  const params = (flags.values.param ?? []).map(parseParam);
  if (params.length === 0) {
    throw new ArgError("sensitivity needs at least one --param NAME=MIN:MAX[:log]");
  }
  const seen = new Map<string, string>();
  for (const param of params) {
    const key = canonicalName(param.name);
    const previous = seen.get(key);
    if (previous !== undefined) {
      throw new ArgError(`duplicate --param '${param.name}' (same as '${previous}')`);
    }
    seen.set(key, param.name);
  }

  const metricRaw = lastValue(flags, "metric");
  if (metricRaw === undefined) throw new ArgError("sensitivity needs --metric SERIES:STAT[@TIME]");
  const metric = parseMetric(metricRaw);

  const methodRaw = lastValue(flags, "method") ?? "morris";
  if (methodRaw !== "morris" && methodRaw !== "sobol") {
    throw new ArgError(`bad --method '${methodRaw}': expected morris or sobol`);
  }

  const trajectoriesRaw = lastValue(flags, "trajectories");
  const samplesRaw = lastValue(flags, "samples");
  const seedRaw = lastValue(flags, "seed");
  return {
    file,
    params,
    metric,
    method: methodRaw,
    trajectories:
      trajectoriesRaw === undefined ? undefined : positiveInteger(trajectoriesRaw, "trajectories"),
    samples: samplesRaw === undefined ? undefined : positiveInteger(samplesRaw, "samples"),
    seed: seedRaw === undefined ? undefined : parseSeed(seedRaw),
    json: flags.booleans.has("json"),
  };
}

/** Five significant digits, with integers kept as written. */
function sig(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  if (value === 0) return "0";
  return String(Number(value.toPrecision(5)));
}

function metricLabel(metric: OutputMetric): string {
  return metric.stat === "at" ? `${metric.series}:at@${sig(metric.time)}` : `${metric.series}:${metric.stat}`;
}

function width(names: string[]): number {
  return Math.max(9, ...names.map((name) => name.length));
}

/** Morris μ, μ* and σ, ranked by μ* as returned. */
export function formatMorrisReport(result: MorrisResult): string {
  const names = result.parameters.map((p) => p.name);
  const w = width(names);
  const lines = [
    `Morris screening (metric ${metricLabel(result.metric)})`,
    `Evaluations: ${result.evaluations}, failed: ${result.failed}`,
    "",
    `${"parameter".padEnd(w)}  ${"mu*".padStart(10)}  ${"mu".padStart(10)}  ${"sigma".padStart(10)}`,
  ];
  for (const row of result.parameters) {
    lines.push(
      `${row.name.padEnd(w)}  ${sig(row.muStar).padStart(10)}  ${sig(row.mu).padStart(10)}  ${sig(row.sigma).padStart(10)}`,
    );
  }
  return lines.join("\n");
}

/** Sobol' first-order and total indices with their 95 % intervals. */
export function formatSobolReport(result: SobolResult): string {
  const names = result.parameters.map((p) => p.name);
  const w = width(names);
  const lines = [
    `Sobol' indices (metric ${metricLabel(result.metric)})`,
    `Evaluations: ${result.evaluations}, failed: ${result.failed}, variance: ${sig(result.variance)}`,
    "",
    `${"parameter".padEnd(w)}  ${"S1 [95% CI]".padStart(22)}  ${"ST [95% CI]".padStart(22)}`,
  ];
  const interval = (value: number, ci: [number, number]): string =>
    `${sig(value)} [${sig(ci[0])}, ${sig(ci[1])}]`;
  for (const row of result.parameters) {
    lines.push(
      `${row.name.padEnd(w)}  ${interval(row.first, row.firstCI).padStart(22)}  ${interval(row.total, row.totalCI).padStart(22)}`,
    );
  }
  return lines.join("\n");
}

/** Pick the report that matches the method that produced `result`. */
export function formatSensitivityReport(
  result: MorrisResult | SobolResult,
  method: SensitivityMethod,
): string {
  return method === "sobol"
    ? formatSobolReport(result as SobolResult)
    : formatMorrisReport(result as MorrisResult);
}
