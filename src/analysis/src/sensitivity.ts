/**
 * SourceSink — global sensitivity analysis.
 *
 * Morris screening (Morris 1991; μ* from Campolongo et al. 2007) ranks
 * parameters cheaply; Sobol' variance decomposition (Saltelli 2010 / Jansen
 * 1999 estimators) apportions output variance among them. Both sample in a
 * unit hypercube and map to the parameter's range (linear or log10), then call
 * the engine through `applyOverrides`; no simulation logic is duplicated here.
 */

import { simulate } from "@sourcesink/engine";
import type { Model } from "@sourcesink/model";

import type { MorrisResult, OutputMetric, ParameterSpec, SobolResult } from "./contracts.js";
import { evaluateMetric } from "./metric.js";
import { applyOverrides } from "./overrides.js";
import { sobolSequence } from "./sobol.js";

export interface MorrisOptions {
  /** Number of trajectories (default 20). */
  trajectories?: number;
  /** Number of grid levels; must be even (default 4). */
  levels?: number;
  /** Seed for the starting points and parameter order (default 0). */
  seed?: number;
}

export interface SobolOptions {
  /** Base sample size N (default 512). */
  samples?: number;
  /** Seed for the sequence skip and the bootstrap (default 0). */
  seed?: number;
  /** Bootstrap resamples for the 95% percentile CIs (default 200). */
  bootstrap?: number;
}

/** mulberry32 PRNG: returns floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher-Yates shuffle driven by `rand`. */
function shuffle(values: number[], rand: () => number): number[] {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

/** Linear-interpolated percentile of `sorted` (already increasing). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

function mean(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample variance (denominator n - 1); NaN for fewer than two values. */
function variance(values: number[]): number {
  const n = values.length;
  if (n < 2) return Number.NaN;
  const m = mean(values);
  let sum = 0;
  for (const v of values) sum += (v - m) * (v - m);
  return sum / (n - 1);
}

function checkParams(params: ParameterSpec[]): void {
  for (const p of params) {
    if (!(p.max >= p.min)) throw new Error(`parameter '${p.name}' has max < min`);
    if (p.scale === "log" && !(p.min > 0)) {
      throw new Error(`parameter '${p.name}' uses log scale but its min is not > 0`);
    }
  }
}

/** Map a unit-cube coordinate to the parameter's value. */
function valueAt(spec: ParameterSpec, u: number): number {
  if (spec.scale === "log") {
    const lo = Math.log10(spec.min);
    const hi = Math.log10(spec.max);
    return 10 ** (lo + u * (hi - lo));
  }
  return spec.min + u * (spec.max - spec.min);
}

/** Run one sample and reduce it; `undefined` means the run failed (exception
 * or non-finite metric). */
function runSample(
  model: Model,
  params: ParameterSpec[],
  values: number[],
  metric: OutputMetric,
  seed: number,
): number | undefined {
  const overrides: Record<string, number> = {};
  params.forEach((p, i) => (overrides[p.name] = values[i]));
  try {
    const result = simulate(applyOverrides(model, overrides), { seed });
    const value = evaluateMetric(result, metric);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Morris elementary effects (Morris 1991; μ* from Campolongo et al. 2007):
 * r trajectories (default 20) on a p-level grid (default 4, Δ = p/(2(p−1))),
 * each parameter moved once per trajectory. Elementary effects are measured
 * in the unit space, EE = Δy / Δ (as in SALib), so μ* is comparable across
 * parameters with different units; points map onto each parameter's range
 * (log10 space for log-scaled parameters).
 * Report μ, μ* (mean |EE|) and σ per parameter, sorted by μ*. A failed run
 * (exception or non-finite metric) drops the affected effects and counts in
 * `failed`. evaluations = r × (k + 1). */
export function morris(
  model: Model,
  params: ParameterSpec[],
  metric: OutputMetric,
  opts: MorrisOptions = {},
): MorrisResult {
  const trajectories = opts.trajectories ?? 20;
  const levels = opts.levels ?? 4;
  const seed = opts.seed ?? 0;

  if (!Number.isInteger(trajectories) || trajectories < 1) {
    throw new Error(`trajectories must be a positive integer, got ${trajectories}`);
  }
  if (!Number.isInteger(levels) || levels < 2 || levels % 2 !== 0) {
    throw new Error(`levels must be an even integer >= 2, got ${levels}`);
  }
  checkParams(params);

  const k = params.length;
  if (k === 0) {
    return { metric, parameters: [], evaluations: 0, failed: 0 };
  }

  const delta = levels / (2 * (levels - 1));
  const step = 1 / (levels - 1);
  // Valid starting coordinates are 0 .. 1 - Δ on the p-level grid.
  const baseLevels = Math.floor((levels - 1) * (1 - delta)) + 1;
  const rand = mulberry32(seed);
  const effects: number[][] = params.map(() => []);
  let failed = 0;

  for (let t = 0; t < trajectories; t += 1) {
    const x = Array.from({ length: k }, () => Math.floor(rand() * baseLevels) * step);
    const order = shuffle(Array.from({ length: k }, (_, i) => i), rand);

    // values[0] is the trajectory's base point; step j produces values[j + 1].
    const values: number[] = [];
    const at = () => params.map((p, i) => valueAt(p, x[i]));
    const base = runSample(model, params, at(), metric, seed);
    values.push(base ?? Number.NaN);
    if (base === undefined) failed += 1;

    for (const i of order) {
      x[i] += delta;
      const value = runSample(model, params, at(), metric, seed);
      values.push(value ?? Number.NaN);
      if (value === undefined) failed += 1;
    }

    for (let j = 0; j < order.length; j += 1) {
      const before = values[j];
      const after = values[j + 1];
      if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
      const i = order[j];
      effects[i].push((after - before) / delta);
    }
  }

  const rows = params.map((p, i) => {
    const ee = effects[i];
    const mu = mean(ee);
    const muStar = ee.length > 0 ? ee.reduce((a, b) => a + Math.abs(b), 0) / ee.length : Number.NaN;
    let sigma = Number.NaN;
    if (ee.length > 1) {
      let sum = 0;
      for (const v of ee) sum += (v - mu) * (v - mu);
      sigma = Math.sqrt(sum / ee.length);
    } else if (ee.length === 1) {
      sigma = 0;
    }
    return { name: p.name, mu, muStar, sigma };
  });

  // NaN (a parameter with no usable effects) sorts last; ties keep input order.
  rows.sort((a, b) => {
    const av = Number.isFinite(a.muStar) ? a.muStar : Number.NEGATIVE_INFINITY;
    const bv = Number.isFinite(b.muStar) ? b.muStar : Number.NEGATIVE_INFINITY;
    return bv - av;
  });

  return { metric, parameters: rows, evaluations: trajectories * (k + 1), failed };
}

/** Sobol' indices with the Saltelli (2010) scheme: base matrices A and B from
 * one 2k-dimensional Sobol' sequence (seeded by a random skip derived from
 * `seed`), N = samples (default 512), the k matrices A_B(i); first-order
 * S_i = mean(f_B (f_ABi − f_A)) / V (Saltelli 2010) and total
 * S_Ti = mean((f_A − f_ABi)²) / (2V) (Jansen 1999); V = variance of
 * [f_A, f_B]. Bootstrap (default 200 resamples, seeded) 95% percentile CIs.
 * evaluations = N × (k + 2). Rows with a failed run are dropped consistently
 * across the estimators and counted in `failed`. */
export function sobol(
  model: Model,
  params: ParameterSpec[],
  metric: OutputMetric,
  opts: SobolOptions = {},
): SobolResult {
  const samples = opts.samples ?? 512;
  const seed = opts.seed ?? 0;
  const bootstrap = opts.bootstrap ?? 200;

  if (!Number.isInteger(samples) || samples < 2) {
    throw new Error(`samples must be an integer >= 2, got ${samples}`);
  }
  if (!Number.isInteger(bootstrap) || bootstrap < 0) {
    throw new Error(`bootstrap must be a non-negative integer, got ${bootstrap}`);
  }
  checkParams(params);

  const k = params.length;
  if (k === 0) {
    return { metric, parameters: [], evaluations: 0, failed: 0, variance: Number.NaN };
  }

  const rand = mulberry32(seed);
  // A random (but seeded) skip decorrelates runs that differ only in `seed`.
  const skip = 1 + Math.floor(rand() * 4096);
  const points = sobolSequence(samples, 2 * k, skip);

  // Keep only rows whose A, B and every A_B(i) run succeeded.
  const fa: number[] = [];
  const fb: number[] = [];
  const fab: number[][] = [];
  let failed = 0;

  for (const point of points) {
    const a = params.map((p, i) => valueAt(p, point[i]));
    const b = params.map((p, i) => valueAt(p, point[k + i]));
    const fA = runSample(model, params, a, metric, seed);
    const fB = runSample(model, params, b, metric, seed);
    const ab: number[] = [];
    for (let i = 0; i < k; i += 1) {
      const mixed = a.slice();
      mixed[i] = b[i];
      const f = runSample(model, params, mixed, metric, seed);
      ab.push(f ?? Number.NaN);
    }
    if (fA === undefined || fB === undefined || ab.some((f) => !Number.isFinite(f))) {
      failed += 1;
      continue;
    }
    fa.push(fA);
    fb.push(fB);
    fab.push(ab);
  }

  const m = fa.length;
  const pooled = [...fa, ...fb];
  const v = variance(pooled);

  const first = new Array<number>(k).fill(Number.NaN);
  const total = new Array<number>(k).fill(Number.NaN);
  if (m >= 2 && Number.isFinite(v) && v > 0) {
    for (let i = 0; i < k; i += 1) {
      let sumFirst = 0;
      let sumTotal = 0;
      for (let j = 0; j < m; j += 1) {
        const mixed = fab[j][i];
        sumFirst += fb[j] * (mixed - fa[j]);
        sumTotal += (fa[j] - mixed) * (fa[j] - mixed);
      }
      first[i] = sumFirst / m / v;
      total[i] = sumTotal / m / (2 * v);
    }
  }

  const firstCI: Array<[number, number]> = params.map(() => [Number.NaN, Number.NaN]);
  const totalCI: Array<[number, number]> = params.map(() => [Number.NaN, Number.NaN]);

  if (bootstrap > 0 && m >= 2) {
    const firstBoot: number[][] = params.map(() => []);
    const totalBoot: number[][] = params.map(() => []);

    for (let b = 0; b < bootstrap; b += 1) {
      const index = Array.from({ length: m }, () => Math.floor(rand() * m));
      const bA = index.map((j) => fa[j]);
      const bB = index.map((j) => fb[j]);
      const bAB = index.map((j) => fab[j]);
      const bV = variance([...bA, ...bB]);
      if (!(bV > 0)) continue;
      for (let i = 0; i < k; i += 1) {
        let sumFirst = 0;
        let sumTotal = 0;
        for (let j = 0; j < m; j += 1) {
          const mixed = bAB[j][i];
          sumFirst += bB[j] * (mixed - bA[j]);
          sumTotal += (bA[j] - mixed) * (bA[j] - mixed);
        }
        firstBoot[i].push(sumFirst / m / bV);
        totalBoot[i].push(sumTotal / m / (2 * bV));
      }
    }

    for (let i = 0; i < k; i += 1) {
      const fs = firstBoot[i].sort((a, b) => a - b);
      const ts = totalBoot[i].sort((a, b) => a - b);
      firstCI[i] = fs.length > 0 ? [percentile(fs, 2.5), percentile(fs, 97.5)] : [first[i], first[i]];
      totalCI[i] = ts.length > 0 ? [percentile(ts, 2.5), percentile(ts, 97.5)] : [total[i], total[i]];
    }
  } else {
    for (let i = 0; i < k; i += 1) {
      firstCI[i] = [first[i], first[i]];
      totalCI[i] = [total[i], total[i]];
    }
  }

  const rows = params.map((p, i) => ({
    name: p.name,
    first: first[i],
    total: total[i],
    firstCI: firstCI[i],
    totalCI: totalCI[i],
  }));

  rows.sort((a, b) => {
    const av = Number.isFinite(a.total) ? a.total : Number.NEGATIVE_INFINITY;
    const bv = Number.isFinite(b.total) ? b.total : Number.NEGATIVE_INFINITY;
    return bv - av;
  });

  return { metric, parameters: rows, evaluations: samples * (k + 2), failed, variance: v };
}
