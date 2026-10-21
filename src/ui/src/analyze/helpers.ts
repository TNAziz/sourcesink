/**
 * SourceSink — pure helpers for the Analyze panel.
 *
 * Everything here is free of React and the DOM so it can be unit-tested:
 * parameter-row validation and bounds, column auto-matching, dataset
 * remapping, worker-request construction, display formatting and the bands
 * drawn from an ensemble summary.
 */

import { canonicalName } from "@sourcesink/engine";
import type { Model } from "@sourcesink/model";
import type {
  CalibrationOptions,
  Dataset,
  MorrisOptions,
  ObjectiveKind,
  OutputMetric,
  ParameterSpec,
  SobolOptions,
  SummaryStats,
} from "@sourcesink/analysis";

import { formatNumber } from "../results/csv.js";
import { seriesNames } from "../results/series.js";
import type {
  MorrisRequest,
  SobolRequest,
  UncertaintyRequest,
  CalibrateRequest,
} from "./workerCore.js";

export type ParameterKind = "stock" | "flow" | "converter";

/** One editable parameter row. Bounds stay as text so a half-typed value
 * does not get coerced to zero behind the user's back. */
export interface ParameterRow {
  name: string;
  min: string;
  max: string;
  log: boolean;
}

export interface ParameterOption {
  name: string;
  kind: ParameterKind;
  equation: string;
}

export interface ColumnMapping {
  column: string;
  /** Model output series this column feeds, or null to ignore it. */
  target: string | null;
}

export type Statistic = "final" | "max" | "min" | "mean" | "integral" | "at";

/** Stocks, flows and converters in model order — the only elements an
 * override may set. */
export function parameterOptions(model: Model): ParameterOption[] {
  return [
    ...model.stocks.map((s) => ({ name: s.name, kind: "stock" as const, equation: s.equation })),
    ...model.flows.map((f) => ({ name: f.name, kind: "flow" as const, equation: f.equation })),
    ...model.converters.map((c) => ({ name: c.name, kind: "converter" as const, equation: c.equation })),
  ];
}

/** A plain numeric equation ("0.3", " 1e-3 ") or undefined. */
export function numericEquation(equation: string): number | undefined {
  const text = equation.trim();
  if (text === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** Default min/max for an element: ×0.1…×10 of its numeric equation (ordered
 * for negative values), or −1…1 when the equation is not a constant. */
export function suggestedBounds(model: Model, name: string): { min: string; max: string } {
  const key = canonicalName(name);
  const option = parameterOptions(model).find((o) => canonicalName(o.name) === key);
  const value = option ? numericEquation(option.equation) : undefined;
  if (value === undefined || value === 0) return { min: "-1", max: "1" };
  const a = value * 0.1;
  const b = value * 10;
  return { min: formatNumber(Math.min(a, b)), max: formatNumber(Math.max(a, b)) };
}

/** A fresh row for an element, with prefilled, ordered bounds. */
export function parameterRowFor(model: Model, name: string): ParameterRow {
  const bounds = suggestedBounds(model, name);
  return { name, min: bounds.min, max: bounds.max, log: false };
}

/** Start with one row for the first element whose equation is a constant. */
export function initialParameterRows(model: Model): ParameterRow[] {
  const first = parameterOptions(model).find((o) => numericEquation(o.equation) !== undefined);
  return first ? [parameterRowFor(model, first.name)] : [];
}

/** Append a row for the first unused constant, else the first unused element,
 * else the first one (which will show a duplicate-parameter error until the
 * user changes it). Computed elements come last: overriding one replaces its
 * equation with a constant, which is rarely what a fit or screen means. */
export function addParameterRow(model: Model, rows: ParameterRow[]): ParameterRow[] {
  const options = parameterOptions(model);
  const used = new Set(rows.map((r) => canonicalName(r.name)));
  const unused = options.filter((o) => !used.has(canonicalName(o.name)));
  const next = unused.find((o) => numericEquation(o.equation) !== undefined) ?? unused[0] ?? options[0];
  return next ? [...rows, parameterRowFor(model, next.name)] : rows;
}

export interface ParameterValidation {
  specs: ParameterSpec[];
  /** One message per row (null when valid). */
  perRow: Array<string | null>;
  /** At least one usable parameter and no row errors. */
  ok: boolean;
  errors: string[];
}

/** Validate the rows against the model and convert them to ParameterSpecs.
 * Rules: the element exists (stock/flow/converter), min < max, log needs
 * min > 0, and no element is used twice. */
export function validateParameterRows(rows: ParameterRow[], model: Model): ParameterValidation {
  const options = parameterOptions(model);
  const byKey = new Map(options.map((o) => [canonicalName(o.name), o]));
  const seen = new Set<string>();
  const specs: ParameterSpec[] = [];
  const perRow: Array<string | null> = [];
  const errors: string[] = [];

  if (rows.length === 0) errors.push("Add at least one parameter.");

  rows.forEach((row) => {
    const key = canonicalName(row.name);
    const option = byKey.get(key);
    const minText = row.min.trim();
    const maxText = row.max.trim();
    const min = minText === "" ? Number.NaN : Number(minText);
    const max = maxText === "" ? Number.NaN : Number(maxText);

    let message: string | null = null;
    if (row.name.trim() === "" || !option) {
      message = `'${row.name.trim() || "—"}' is not a stock, flow or converter`;
    } else if (seen.has(key)) {
      message = `'${option.name}' is already used`;
    } else if (!Number.isFinite(min) || !Number.isFinite(max)) {
      message = "Enter finite numeric bounds";
    } else if (!(min < max)) {
      message = "Minimum must be less than maximum";
    } else if (row.log && !(min > 0)) {
      message = "Log scale needs a minimum greater than 0";
    }

    if (message || !option) {
      perRow.push(message ?? `'${row.name}' is not a stock, flow or converter`);
    } else {
      seen.add(key);
      perRow.push(null);
      specs.push({
        name: option.name,
        min,
        max,
        ...(row.log ? { scale: "log" as const } : {}),
      });
    }
  });

  for (const message of perRow) if (message) errors.push(message);
  return { specs, perRow, ok: specs.length > 0 && errors.length === 0, errors };
}

/** Auto-match data columns to model output series by canonical name
 * (case-insensitive; spaces and underscores are equivalent). */
export function matchColumns(data: Dataset, model: Model): ColumnMapping[] {
  const byKey = new Map(seriesNames(model).map((name) => [canonicalName(name), name]));
  return Object.keys(data.series).map((column) => ({
    column,
    target: byKey.get(canonicalName(column)) ?? byKey.get(canonicalName(withoutUnits(column))) ?? null,
  }));
}

/** A column header without a trailing unit, e.g. "DO deficit (mg/L)" or
 * "flow [m3/s]" → "DO deficit", "flow". */
export function withoutUnits(header: string): string {
  return header.replace(/\s*[([][^()[\]]*[)\]]\s*$/, "").trim() || header;
}

/** Build a calibration Dataset from a mapping, dropping ignored columns.
 * Returns an error instead of a dataset when nothing is mapped or two
 * columns feed the same element. */
export function buildMappedDataset(
  data: Dataset,
  mapping: ColumnMapping[],
): { dataset: Dataset | null; error: string | null } {
  const mapped = mapping.filter((m): m is { column: string; target: string } => m.target !== null);
  if (mapped.length === 0) return { dataset: null, error: "Map at least one column to a model element." };

  const targets = new Set<string>();
  for (const m of mapped) {
    if (targets.has(m.target)) {
      return { dataset: null, error: `Two columns are mapped to '${m.target}'.` };
    }
    targets.add(m.target);
  }

  const series: Record<string, number[]> = {};
  for (const m of mapped) series[m.target] = data.series[m.column].slice();
  return { dataset: { time: data.time.slice(), series }, error: null };
}

/** OutputMetric for the sensitivity tabs. */
export function makeOutputMetric(series: string, stat: Statistic, at = "0"): OutputMetric {
  if (stat === "at") return { series, stat: "at", time: Number(at) };
  return { series, stat };
}

/** Fitted value with its standard error: "0.3 ± 0.012". Non-finite SEs are
 * shown as ∞ (or — when NaN). */
export function formatEstimate(value: number, se: number | undefined): string {
  const shown = Number.isFinite(value) ? formatNumber(value) : "—";
  if (se === undefined) return shown;
  if (se === Number.POSITIVE_INFINITY) return `${shown} ± ∞`;
  if (!Number.isFinite(se)) return `${shown} ± —`;
  if (se <= 0 || !Number.isFinite(value)) return `${shown} ± ${formatNumber(se)}`;
  // two significant digits of the error set the precision of both numbers
  const decimals = Math.min(12, Math.max(0, 1 - Math.floor(Math.log10(se))));
  return `${value.toFixed(decimals)} ± ${se.toFixed(decimals)}`;
}

/** Standard error as a percentage of the value ("1.2%"), or "—". */
export function relativeError(value: number, se: number | undefined): string {
  if (se === undefined || !Number.isFinite(se) || !Number.isFinite(value) || value === 0) return "—";
  const pct = (100 * se) / Math.abs(value);
  return `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%`;
}

/** A series of bands for the uncertainty chart. Non-finite statistics become
 * null so uPlot breaks the path instead of drawing to zero. */
export interface BandSeries {
  time: number[];
  p5: (number | null)[];
  p25: (number | null)[];
  median: (number | null)[];
  p75: (number | null)[];
  p95: (number | null)[];
}

function nullable(values: number[] | undefined): (number | null)[] {
  if (!values) return [];
  return values.map((v) => (Number.isFinite(v) ? v : null));
}

/** Extract the 5/25/50/75/95 bands from a `summarize` result. The caller
 * must request those percentiles. */
export function buildBandSeries(time: number[], stats: SummaryStats): BandSeries {
  return {
    time: time.slice(),
    p5: nullable(stats.percentiles[5]),
    p25: nullable(stats.percentiles[25]),
    median: nullable(stats.percentiles[50]),
    p75: nullable(stats.percentiles[75]),
    p95: nullable(stats.percentiles[95]),
  };
}

export interface CalibrateRequestInput {
  data: Dataset;
  params: ParameterSpec[];
  options?: CalibrationOptions;
}

/** Worker request constructors (the panel owns request ids). */
export function calibrateRequest(
  id: number,
  model: Model,
  input: CalibrateRequestInput,
): CalibrateRequest {
  return { id, kind: "calibrate", model, ...input };
}

export function morrisRequest(
  id: number,
  model: Model,
  params: ParameterSpec[],
  metric: OutputMetric,
  options: MorrisOptions = {},
): MorrisRequest {
  return { id, kind: "morris", model, params, metric, options };
}

export function sobolRequest(
  id: number,
  model: Model,
  params: ParameterSpec[],
  metric: OutputMetric,
  options: SobolOptions = {},
): SobolRequest {
  return { id, kind: "sobol", model, params, metric, options };
}

export function uncertaintyRequest(
  id: number,
  model: Model,
  params: ParameterSpec[],
  runs: number,
  series: string[],
  seed = 0,
): UncertaintyRequest {
  return { id, kind: "uncertainty", model, params, runs, series, seed };
}

/** The calibration objective labels used by the options dropdown. */
export const OBJECTIVE_LABELS: Array<{ value: ObjectiveKind; label: string }> = [
  { value: "sse", label: "SSE (sum of squared errors)" },
  { value: "wsse", label: "Variance-weighted SSE" },
  { value: "nse", label: "NSE (1 − Nash–Sutcliffe)" },
];
