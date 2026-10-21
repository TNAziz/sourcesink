/**
 * SourceSink — fitting model parameters to observed data.
 *
 * Calibration wraps a general-purpose minimiser around the simulation engine:
 * each candidate parameter set is applied to a copy of the model
 * (`applyOverrides`), simulated, aligned with the observations and reduced to
 * a scalar objective. Local identifiability is estimated from a finite-
 * difference Jacobian of the weighted residuals at the optimum.
 */

import { canonicalName, simulate } from "@sourcesink/engine";
import type { Model } from "@sourcesink/model";

import { align } from "./align.js";
import { fitMetrics, objective } from "./data.js";
import type {
  Alignment,
  CalibrationOptions,
  Dataset,
  FitMetrics,
  FitResult,
  Identifiability,
  ObjectiveKind,
  ParameterSpec,
} from "./contracts.js";
import { differentialEvolution, nelderMead, type OptimizeResult } from "./optimize.js";
import { applyOverrides, type Overrides } from "./overrides.js";
import { latinHypercube } from "./sampling.js";

/** A parameter plus its search coordinate. Log-scaled parameters are
 * optimised in log10 space; `lo`/`hi` are the actual bounds. */
interface BoundParameter {
  name: string;
  lo: number;
  hi: number;
  log: boolean;
  coordLo: number;
  coordHi: number;
  initialCoord: number;
}

/** Plain numeric equation ("0.3", "1e-3", " 12 ") -> number; otherwise
 * undefined. Used for the default starting point of a parameter. */
function plainNumber(equation: string): number | undefined {
  const text = equation.trim();
  if (!text) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Resolve parameter names once so unknown names fail before any simulation
 * (during optimisation they would only look like an infinite objective). */
function overridableElements(model: Model): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of model.stocks) out.set(canonicalName(s.name), s.equation);
  for (const f of model.flows) out.set(canonicalName(f.name), f.equation);
  for (const c of model.converters) out.set(canonicalName(c.name), c.equation);
  return out;
}

function buildParameters(model: Model, specs: ParameterSpec[]): BoundParameter[] {
  const elements = overridableElements(model);
  const seen = new Set<string>();
  return specs.map((spec) => {
    const key = canonicalName(spec.name);
    if (seen.has(key)) throw new Error(`duplicate calibration parameter '${spec.name}'`);
    seen.add(key);
    const equation = elements.get(key);
    if (equation === undefined) {
      throw new Error(`unknown parameter '${spec.name}' (not a stock, flow or converter)`);
    }
    const { min, max } = spec;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      throw new Error(`parameter '${spec.name}': invalid range [${min}, ${max}]`);
    }
    const log = spec.scale === "log";
    if (log && (min <= 0 || max <= 0)) {
      throw new Error(`parameter '${spec.name}': a log scale needs min and max > 0`);
    }

    const current = plainNumber(equation);
    let initial =
      spec.initial !== undefined && Number.isFinite(spec.initial)
        ? spec.initial
        : current !== undefined && current >= min && current <= max
          ? current
          : log
            ? Math.sqrt(min * max)
            : (min + max) / 2;
    initial = clamp(initial, min, max);

    const toCoord = (value: number): number => (log ? Math.log10(value) : value);
    return {
      name: spec.name,
      lo: min,
      hi: max,
      log,
      coordLo: toCoord(min),
      coordHi: toCoord(max),
      initialCoord: toCoord(initial),
    };
  });
}

/** Weight applied to squared residuals for one observed series (matches
 * the "wsse" objective in data.ts), used for the identifiability Jacobian. */
function residualWeight(data: Dataset, series: string, observed: number[]): number {
  const weight = data.weights?.[series] ?? 1;
  if (observed.length === 0) return weight;
  const mean = observed.reduce((sum, v) => sum + v, 0) / observed.length;
  const sst = observed.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  return sst > 0 ? weight / (sst / observed.length) : weight;
}

/** Invert a small square matrix by Gauss-Jordan elimination with partial
 * pivoting. Returns null when a pivot is negligible relative to the matrix
 * scale (singular or numerically rank-deficient). */
function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  if (n === 0) return [];
  let scale = 1;
  for (const row of matrix) for (const v of row) scale = Math.max(scale, Math.abs(v));

  const a = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (!(Math.abs(a[pivot][col]) > 1e-12 * scale)) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    for (let c = 0; c < 2 * n; c += 1) a[col][c] /= divisor;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = a[r][col];
      if (factor === 0) continue;
      for (let c = 0; c < 2 * n; c += 1) a[r][c] -= factor * a[col][c];
    }
  }
  return a.map((row) => row.slice(n));
}

/** Local identifiability at `values` from central finite differences of the
 * stacked weighted residuals. */
function identifiabilityAt(
  model: Model,
  data: Dataset,
  kind: ObjectiveKind,
  params: BoundParameter[],
  values: number[],
  seed: number,
): Identifiability {
  const names = params.map((p) => p.name);
  if (params.length === 0) return { parameters: [], standardErrors: {}, correlation: [], warnings: [] };

  const overridesFor = (vals: number[]): Overrides => {
    const overrides: Overrides = {};
    params.forEach((p, i) => (overrides[p.name] = vals[i]));
    return overrides;
  };

  const residualsAt = (vals: number[]): number[] | null => {
    try {
      const result = simulate(applyOverrides(model, overridesFor(vals)), { seed });
      const alignments = align(result, data);
      const out: number[] = [];
      for (const a of alignments) {
        let scale = data.weights?.[a.series] ?? 1;
        if (kind === "wsse") scale = residualWeight(data, a.series, a.observed);
        else if (kind === "nse") {
          const mean = a.observed.reduce((sum, v) => sum + v, 0) / Math.max(1, a.observed.length);
          const sst = a.observed.reduce((sum, v) => sum + (v - mean) ** 2, 0);
          scale = sst > 0 ? (data.weights?.[a.series] ?? 1) / sst : data.weights?.[a.series] ?? 1;
        }
        const root = Math.sqrt(scale);
        for (let i = 0; i < a.observed.length; i += 1) {
          out.push(root * (a.simulated[i] - a.observed[i]));
        }
      }
      return out;
    } catch {
      return null;
    }
  };

  const base = residualsAt(values);
  const residualCount = base ? base.length : 0;
  const p = params.length;
  const gram = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  let skippedColumns = false;

  if (base) {
    const columns: number[][] = [];
    for (let j = 0; j < p; j += 1) {
      const step = 1e-4 * (params[j].hi - params[j].lo);
      const plus = clamp(values[j] + step, params[j].lo, params[j].hi);
      const minus = clamp(values[j] - step, params[j].lo, params[j].hi);
      const span = plus - minus;
      if (!(span > 0) || step === 0) {
        columns.push(new Array<number>(base.length).fill(0));
        skippedColumns = true;
        continue;
      }
      const higher = values.slice();
      const lower = values.slice();
      higher[j] = plus;
      lower[j] = minus;
      const rPlus = residualsAt(higher);
      const rMinus = residualsAt(lower);
      if (!rPlus || !rMinus || rPlus.length !== base.length || rMinus.length !== base.length) {
        columns.push(new Array<number>(base.length).fill(0));
        skippedColumns = true;
        continue;
      }
      columns.push(rPlus.map((v, i) => (v - rMinus[i]) / span));
    }

    for (let a = 0; a < p; a += 1) {
      for (let b = 0; b < p; b += 1) {
        let sum = 0;
        for (let i = 0; i < base.length; i += 1) sum += columns[a][i] * columns[b][i];
        gram[a][b] = sum;
      }
    }
  }

  const sse = base ? base.reduce((sum, v) => sum + v * v, 0) : Number.POSITIVE_INFINITY;
  const s2 = residualCount > p ? sse / (residualCount - p) : Number.POSITIVE_INFINITY;
  const inverse = base ? invertMatrix(gram) : null;

  const standardErrors: Record<string, number> = {};
  for (let j = 0; j < p; j += 1) {
    const variance = inverse ? s2 * inverse[j][j] : Number.POSITIVE_INFINITY;
    standardErrors[names[j]] =
      Number.isFinite(variance) && variance >= 0 ? Math.sqrt(variance) : Number.POSITIVE_INFINITY;
  }

  const correlation: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let a = 0; a < p; a += 1) {
    correlation[a][a] = 1;
    for (let b = a + 1; b < p; b += 1) {
      let value = 0;
      if (inverse && inverse[a][a] > 0 && inverse[b][b] > 0) {
        value = inverse[a][b] / Math.sqrt(inverse[a][a] * inverse[b][b]);
      } else if (gram[a][a] > 0 && gram[b][b] > 0) {
        value = gram[a][b] / Math.sqrt(gram[a][a] * gram[b][b]);
      }
      value = clamp(value, -1, 1);
      correlation[a][b] = value;
      correlation[b][a] = value;
    }
  }

  const warnings: string[] = [];
  if (!inverse || skippedColumns) {
    warnings.push("cannot estimate standard errors: the parameter sensitivity matrix is singular");
  }
  for (let a = 0; a < p; a += 1) {
    for (let b = a + 1; b < p; b += 1) {
      const value = correlation[a][b];
      if (Number.isFinite(value) && Math.abs(value) > 0.95) {
        warnings.push(
          `${names[a]} and ${names[b]} are strongly correlated (${value.toFixed(2)})`,
        );
      }
    }
  }
  for (let j = 0; j < p; j += 1) {
    const range = params[j].hi - params[j].lo;
    if (!(standardErrors[names[j]] <= range)) {
      warnings.push(`${names[j]} is poorly identified (standard error > the parameter range)`);
    }
  }

  return { parameters: names, standardErrors, correlation, warnings };
}

/** Fit `params` to `data` by simulating `model`.
 *
 * Nelder-Mead starts at each parameter's initial value (or the element's
 * constant, or the middle of its range) and, with `starts > 1`, performs
 * additional restarts from seeded Latin-hypercube points. Differential
 * evolution always performs one seeded run. A failed simulation, a thrown
 * error or a non-finite objective is scored as `+Infinity`.
 *
 * Observed series must exist in the model output and parameter names must be
 * stocks, flows or converters; both are checked up front so typos are clear
 * errors rather than a calibration that silently never improves. */
export function calibrate(
  model: Model,
  data: Dataset,
  params: ParameterSpec[],
  options: CalibrationOptions = {},
): FitResult {
  const bounds = buildParameters(model, params);
  const method = options.method ?? "nelder-mead";
  const kind = options.objective ?? "sse";
  const seed = options.seed ?? 0;
  const objectiveKind: ObjectiveKind = kind;

  const decode = (theta: number[]): number[] =>
    theta.map((coord, i) => (bounds[i].log ? 10 ** coord : coord));

  const overridesFor = (values: number[]): Overrides => {
    const overrides: Overrides = {};
    bounds.forEach((b, i) => (overrides[b.name] = values[i]));
    return overrides;
  };

  const initialValues = bounds.map((b) => (b.log ? 10 ** b.initialCoord : b.initialCoord));

  // Validate the observations against the model before optimising: align()
  // would otherwise turn a bad column name into an all-Infinity objective.
  const initialResult = simulate(applyOverrides(model, overridesFor(initialValues)), { seed });
  for (const name of Object.keys(data.series)) {
    if (!(name in initialResult.series)) {
      throw new Error(`observed series '${name}' is not in the model results`);
    }
  }

  const evaluate = (values: number[]): { alignments: Alignment[]; objective: number } | null => {
    try {
      const result = simulate(applyOverrides(model, overridesFor(values)), { seed });
      const alignments = align(result, data);
      const value = objective(alignments, objectiveKind, data.weights);
      return Number.isFinite(value) ? { alignments, objective: value } : null;
    } catch {
      return null;
    }
  };
  const objectiveAt = (theta: number[]): number => {
    const evaluated = evaluate(decode(theta));
    return evaluated ? evaluated.objective : Number.POSITIVE_INFINITY;
  };

  const lo = bounds.map((b) => b.coordLo);
  const hi = bounds.map((b) => b.coordHi);
  const x0 = bounds.map((b) => b.initialCoord);

  let bestTheta = x0;
  let bestObjective = Number.POSITIVE_INFINITY;
  let evaluations = 0;
  let converged = false;
  const history: number[] = [];

  if (method === "differential-evolution") {
    const result = differentialEvolution(objectiveAt, lo, hi, {
      maxEvaluations: options.maxEvaluations,
      tol: options.tolerance,
      seed,
    });
    bestTheta = result.x;
    bestObjective = result.f;
    evaluations = result.evaluations;
    converged = result.converged;
    history.push(...result.history);
  } else {
    const starts = Math.max(1, Math.floor(options.starts ?? 1));
    const startsAt: number[][] = [x0];
    if (starts > 1) {
      const ranges: Record<string, [number, number]> = {};
      bounds.forEach((b, i) => (ranges[`p${i}`] = [b.coordLo, b.coordHi]));
      const samples = latinHypercube(ranges, starts - 1, seed);
      for (const sample of samples) {
        startsAt.push(bounds.map((_, i) => Number(sample[`p${i}`])));
      }
    }

    for (const start of startsAt) {
      const result: OptimizeResult = nelderMead(objectiveAt, start, lo, hi, {
        maxEvaluations: options.maxEvaluations,
        tol: options.tolerance,
      });
      evaluations += result.evaluations;
      if (result.f < bestObjective) {
        bestObjective = result.f;
        bestTheta = result.x;
        converged = result.converged;
      }
      history.push(bestObjective);
    }
  }

  const bestValues = decode(bestTheta);
  const best = evaluate(bestValues);
  const alignments = best ? best.alignments : [];
  const metrics: Record<string, FitMetrics> = {};
  for (const alignment of alignments) metrics[alignment.series] = fitMetrics(alignment);

  return {
    method,
    parameters: Object.fromEntries(bounds.map((b, i) => [b.name, bestValues[i]])),
    objective: bestObjective,
    evaluations,
    converged,
    alignments,
    metrics,
    identifiability: identifiabilityAt(model, data, objectiveKind, bounds, bestValues, seed),
    history,
  };
}
