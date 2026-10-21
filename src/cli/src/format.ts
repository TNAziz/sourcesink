/**
 * SourceSink — CLI output formatting.
 *
 * Pure string builders so the CSV shapes (`sweep`, `montecarlo`) can be
 * tested without touching stdout. Numbers match `run`'s convention: integers
 * print as-is, everything else with six decimals.
 */

import type { EnsembleResult, SummaryStats } from "@sourcesink/analysis";

/** Human-stable number formatting shared by every CSV command. */
export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(6);
}

/** Sweep CSV: one row per run with its parameter values and the final value of
 * each selected column. Failed runs still get a row (their finals are NaN). */
export function formatSweepCsv(
  result: EnsembleResult,
  parameterNames: string[],
  columns: string[],
): string {
  const lines = [[...parameterNames, ...columns.map((c) => `${c} final`)].join(",")];
  for (const run of result.runs) {
    const params = parameterNames.map((name) => formatNumber(Number(run.overrides[name])));
    const finals = columns.map((name) => {
      const series = run.result?.series[name];
      return formatNumber(series && series.length > 0 ? series[series.length - 1] : Number.NaN);
    });
    lines.push([...params, ...finals].join(","));
  }
  return lines.join("\n");
}

/** Monte Carlo CSV: `time`, then mean, sd and each requested percentile of
 * every selected column. */
export function formatMonteCarloCsv(
  time: number[],
  summary: Record<string, SummaryStats>,
  columns: string[],
  percentiles: number[],
): string {
  const header = ["time"];
  for (const name of columns) {
    header.push(`${name} mean`, `${name} sd`, ...percentiles.map((p) => `${name} p${p}`));
  }

  const lines = [header.join(",")];
  for (let i = 0; i < time.length; i += 1) {
    const row = [formatNumber(time[i])];
    for (const name of columns) {
      const stats = summary[name];
      row.push(formatNumber(stats?.mean[i] ?? Number.NaN), formatNumber(stats?.sd[i] ?? Number.NaN));
      for (const p of percentiles) {
        row.push(formatNumber(stats?.percentiles[p]?.[i] ?? Number.NaN));
      }
    }
    lines.push(row.join(","));
  }
  return lines.join("\n");
}
