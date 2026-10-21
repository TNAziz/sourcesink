/**
 * SourceSink — `fit` command helpers.
 *
 * Argument parsing and report assembly are pure functions so the calibration
 * grammar (`--param kd=0.05:1:log`, `--rename "BOD (mg/L)=BOD"`) and the
 * printed report can be tested without spawning the CLI.
 */

import {
  applyOverrides,
  type FitMetrics,
  type Dataset,
  type FitResult,
  type ObjectiveKind,
  type ParameterSpec,
} from "@sourcesink/analysis";
import { canonicalName } from "@sourcesink/engine";
import type { Model } from "@sourcesink/model";

import { ArgError, lastValue, parseFlags, parseSeed, type ParsedFlags } from "./args.js";

export interface FitOptions {
  file: string;
  data: string;
  params: ParameterSpec[];
  rename: Record<string, string>;
  method?: "nelder-mead" | "differential-evolution";
  starts?: number;
  objective?: ObjectiveKind;
  seed?: number;
  json: boolean;
  write?: string;
}

/** `NAME=MIN:MAX[:log]` -> a bounded parameter. */
export function parseFitParam(arg: string): ParameterSpec {
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

/** `CSV header=element` -> one rename entry. */
export function parseRename(arg: string): { header: string; element: string } {
  const eq = arg.indexOf("=");
  if (eq < 0) throw new ArgError(`bad --rename '${arg}': expected "CSV header=element"`);
  const header = arg.slice(0, eq).trim();
  const element = arg.slice(eq + 1).trim();
  if (!header) throw new ArgError(`bad --rename '${arg}': the CSV header is empty`);
  if (!element) throw new ArgError(`bad --rename '${arg}': the element name is empty`);
  return { header, element };
}

function parseMethod(flags: ParsedFlags): FitOptions["method"] {
  const raw = lastValue(flags, "method");
  if (raw === undefined) return undefined;
  if (raw === "nelder-mead") return "nelder-mead";
  if (raw === "de" || raw === "differential-evolution") return "differential-evolution";
  throw new ArgError(`bad --method '${raw}': expected nelder-mead or de`);
}

function parseObjective(flags: ParsedFlags): ObjectiveKind | undefined {
  const raw = lastValue(flags, "objective");
  if (raw === undefined) return undefined;
  if (raw === "sse" || raw === "wsse" || raw === "nse") return raw;
  throw new ArgError(`bad --objective '${raw}': expected sse, wsse or nse`);
}

function positiveInteger(raw: string, flag: string): number {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(value) || value < 1) {
    throw new ArgError(`bad --${flag} '${raw}': expected a positive integer`);
  }
  return value;
}

/** Parse `sourcesink fit <model> --data <csv> --param …`. */
export function parseFitArgs(args: string[]): FitOptions {
  const flags = parseFlags(args, {
    values: ["data", "param", "rename", "method", "starts", "objective", "seed", "write"],
    booleans: ["json"],
  });
  const file = flags.positional[0];
  if (!file) throw new ArgError("fit needs a model file");
  if (flags.positional.length > 1) {
    throw new ArgError(`fit takes one model file (unexpected '${flags.positional[1]}')`);
  }

  const data = lastValue(flags, "data");
  if (data === undefined) throw new ArgError("fit needs --data <observations.csv>");

  const params = (flags.values.param ?? []).map(parseFitParam);
  if (params.length === 0) throw new ArgError("fit needs at least one --param NAME=MIN:MAX[:log]");
  const seen = new Map<string, string>();
  for (const param of params) {
    const key = canonicalName(param.name);
    const previous = seen.get(key);
    if (previous !== undefined) {
      throw new ArgError(`duplicate --param '${param.name}' (same as '${previous}')`);
    }
    seen.set(key, param.name);
  }

  const rename: Record<string, string> = {};
  for (const raw of flags.values.rename ?? []) {
    const { header, element } = parseRename(raw);
    if (rename[header] !== undefined) throw new ArgError(`duplicate --rename for '${header}'`);
    rename[header] = element;
  }

  const startsRaw = lastValue(flags, "starts");
  const seedRaw = lastValue(flags, "seed");
  const write = lastValue(flags, "write");
  if (write !== undefined && write.trim() === "") {
    throw new ArgError("bad --write '': expected a file path");
  }

  return {
    file,
    data,
    params,
    rename,
    method: parseMethod(flags),
    starts: startsRaw === undefined ? undefined : positiveInteger(startsRaw, "starts"),
    objective: parseObjective(flags),
    seed: seedRaw === undefined ? undefined : parseSeed(seedRaw),
    json: flags.booleans.has("json"),
    ...(write === undefined ? {} : { write }),
  };
}

/** Five significant digits, with integers kept as written. */
function sig(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  if (value === 0) return "0";
  return String(Number(value.toPrecision(5)));
}

/** A value and its standard error at the precision the error supports:
 * two significant digits of the error, e.g. "0.3440 ± 0.0041". */
export function withError(value: number, error: number): string {
  if (!Number.isFinite(error) || error <= 0) return `${sig(value)} ± ${sig(error)}`;
  const decimals = Math.min(12, Math.max(0, 1 - Math.floor(Math.log10(error))));
  return `${value.toFixed(decimals)} ± ${error.toFixed(decimals)}`;
}

const METRIC_COLUMNS = ["points", "RMSE", "NSE", "R²", "bias"] as const;

function metricCells(m: FitMetrics): string[] {
  const four = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(4))) : sig(v));
  return [String(m.n), four(m.rmse), four(m.nse), four(m.r2), four(m.bias)];
}

/** Human-readable calibration report: fitted value ± standard error per
 * parameter, objective, evaluation count, per-series metrics and warnings. */
export function formatFitReport(result: FitResult): string {
  const names = Object.keys(result.parameters);
  const width = Math.max(9, ...names.map((name) => name.length));
  const lines: string[] = ["Fitted parameters:"];

  for (const name of names) {
    const error = result.identifiability.standardErrors[name];
    const shown = error === undefined ? sig(result.parameters[name]) : withError(result.parameters[name], error);
    lines.push(`  ${name.padEnd(width)} = ${shown}`);
  }

  lines.push(`Objective: ${sig(result.objective)}`);
  lines.push(`Evaluations: ${result.evaluations}`);
  lines.push(`Converged: ${result.converged ? "yes" : "no"}`);

  const series = Object.keys(result.metrics);
  lines.push("", "Series metrics:");
  if (series.length === 0) {
    lines.push("  (none)");
  } else {
    const rows = series.map((name) => [name, ...metricCells(result.metrics[name])]);
    const header = ["series", ...METRIC_COLUMNS];
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
    lines.push(`  ${line(header)}`);
    for (const r of rows) lines.push(`  ${line(r)}`);
  }

  const warnings = result.identifiability.warnings;
  lines.push("", "Identifiability warnings:");
  if (warnings.length === 0) lines.push("  none");
  else for (const warning of warnings) lines.push(`  - ${warning}`);

  return lines.join("\n");
}

/** Map observed columns whose header carries a trailing unit, e.g.
 * "BOD (mg/L)" or "flow [m3/s]", onto the model element of the bare name.
 * Columns that already name an element, or match nothing, are left alone. */
export function matchUnitHeaders(data: Dataset, model: Model): Dataset {
  const names = new Map<string, string>();
  for (const e of [...model.stocks, ...model.flows, ...model.converters]) names.set(canonicalName(e.name), e.name);
  const series: Dataset["series"] = {};
  for (const [column, values] of Object.entries(data.series)) {
    const bare = column.replace(/\s*[([][^()[\]]*[)\]]\s*$/, "").trim();
    const target = names.has(canonicalName(column)) ? column : names.get(canonicalName(bare)) ?? column;
    series[series[target] === undefined ? target : column] = values;
  }
  return { ...data, series };
}

/** A copy of `model` with the fitted parameters as constant equations. */
export function fittedModel(model: Model, result: FitResult): Model {
  return applyOverrides(model, result.parameters);
}
