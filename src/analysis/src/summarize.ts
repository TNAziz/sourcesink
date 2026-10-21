/**
 * SourceSink — ensemble summary statistics.
 *
 * For each requested series and time point, summarizes the values across the
 * successful runs. Percentiles use linear interpolation between ranks:
 * `rank = p/100 * (n - 1)`, the convention used by R's default `quantile`.
 */

import type { EnsembleResult } from "./ensemble.js";

export interface SummaryStats {
  mean: number[];
  min: number[];
  max: number[];
  /** Population standard deviation (divide by n, not n - 1). */
  sd: number[];
  percentiles: Record<number, number[]>;
}

/** Linear-interpolated percentile of `sorted` (already increasing). */
function percentile(sorted: number[], p: number): number {
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** Per-series statistics across successful runs at each time point:
 * mean, min, max, standard deviation (population), and the requested
 * percentiles (default [5, 50, 95]; linear interpolation between ranks). */
export function summarize(
  result: EnsembleResult,
  series: string[],
  percentiles: number[] = [5, 50, 95],
): Record<string, SummaryStats> {
  for (const p of percentiles) {
    if (!(p >= 0 && p <= 100)) throw new Error(`percentile ${p} is outside [0, 100]`);
  }

  const successful = result.runs.filter((r) => r.result !== undefined);
  const points = result.time.length;
  const out: Record<string, SummaryStats> = {};

  for (const name of series) {
    const runs = successful.filter((r) => r.result!.series[name] !== undefined);
    if (runs.length === 0) throw new Error(`no successful run has series '${name}'`);

    const mean = new Array<number>(points);
    const min = new Array<number>(points);
    const max = new Array<number>(points);
    const sd = new Array<number>(points);
    const pct: Record<number, number[]> = {};
    for (const p of percentiles) pct[p] = new Array<number>(points);

    for (let t = 0; t < points; t += 1) {
      const values = runs
        .map((r) => r.result!.series[name][t])
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => a - b);

      if (values.length === 0) {
        mean[t] = min[t] = max[t] = sd[t] = Number.NaN;
        for (const p of percentiles) pct[p][t] = Number.NaN;
        continue;
      }

      const sum = values.reduce((a, b) => a + b, 0);
      const m = sum / values.length;
      const sumSq = values.reduce((a, b) => a + b * b, 0);
      mean[t] = m;
      min[t] = values[0];
      max[t] = values[values.length - 1];
      sd[t] = Math.sqrt(Math.max(0, sumSq / values.length - m * m));
      for (const p of percentiles) pct[p][t] = percentile(values, p);
    }

    out[name] = { mean, min, max, sd, percentiles: pct };
  }

  return out;
}
