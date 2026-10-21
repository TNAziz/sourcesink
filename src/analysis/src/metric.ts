/**
 * SourceSink — reduce a simulation to one scalar for sensitivity analysis.
 *
 * The statistics are computed over the saved points. `mean` is the
 * time-average (integral divided by elapsed time), so a save interval that
 * changes part-way through is weighted by elapsed time rather than by the
 * number of rows.
 */

import type { SimulationResult } from "@sourcesink/engine";

import { interpolateAt } from "./align.js";
import type { OutputMetric } from "./contracts.js";

/** Trapezoid-rule integral of `values` over `time` (NaN if any value is not
 * finite). */
function trapezoid(time: number[], values: number[]): number {
  let sum = 0;
  for (let i = 1; i < time.length; i += 1) {
    sum += ((time[i] - time[i - 1]) * (values[i] + values[i - 1])) / 2;
  }
  return sum;
}

/** Reduce one simulation to a number (OutputMetric in contracts.ts):
 * final, max, min, mean (time-average by the trapezoid rule over the saved
 * points), integral (trapezoid), at (interpolateAt from align.ts). An unknown
 * series throws. */
export function evaluateMetric(result: SimulationResult, metric: OutputMetric): number {
  const values = result.series[metric.series];
  if (values === undefined) throw new Error(`unknown series '${metric.series}'`);
  const time = result.time;

  switch (metric.stat) {
    case "final":
      return values.length > 0 ? values[values.length - 1] : Number.NaN;
    case "max": {
      let max = Number.NEGATIVE_INFINITY;
      for (const v of values) if (Number.isFinite(v) && v > max) max = v;
      return Number.isFinite(max) ? max : Number.NaN;
    }
    case "min": {
      let min = Number.POSITIVE_INFINITY;
      for (const v of values) if (Number.isFinite(v) && v < min) min = v;
      return Number.isFinite(min) ? min : Number.NaN;
    }
    case "integral":
      return trapezoid(time, values);
    case "mean": {
      if (time.length === 0) return Number.NaN;
      const span = time[time.length - 1] - time[0];
      if (time.length === 1 || span === 0) return values[0];
      return trapezoid(time, values) / span;
    }
    case "at":
      return interpolateAt(time, values, metric.time);
    default: {
      const exhaustive: never = metric;
      throw new Error(`unknown metric ${JSON.stringify(exhaustive)}`);
    }
  }
}
