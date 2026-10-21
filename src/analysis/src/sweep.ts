/**
 * SourceSink — parameter sweeps.
 *
 * Run the model at evenly spaced values of one parameter (a response curve)
 * or on a grid of two (a response surface), reduce each run to an output
 * metric, and point out the notable features of the response: where it
 * changes fastest, thresholds, interior optima and saturation.
 *
 * Levels are evenly spaced in value, or in log10(value) for log axes. A run
 * that fails, or whose metric is not finite, is kept in place as NaN.
 */

import type { RunSpec, Model } from "@sourcesink/model";

import type { OutputMetric } from "./contracts.js";
import { simulateEnsemble } from "./ensemble.js";
import { evaluateMetric } from "./metric.js";
import type { Overrides } from "./overrides.js";
import { gridSamples } from "./sampling.js";

export interface SweepAxis {
  /** Element whose equation is replaced by each level. */
  name: string;
  min: number;
  max: number;
  /** Number of levels, at least 2 (both ends included). */
  steps: number;
  scale?: "linear" | "log";
}

export interface SweepSpec {
  /** One axis for a response curve, two for a response surface. */
  axes: [SweepAxis] | [SweepAxis, SweepAxis];
  metric: OutputMetric;
  /** Series whose full trajectories to keep, one per level (1-D only). */
  series?: string[];
  run?: Partial<RunSpec>;
}

export interface SweepResult {
  axes: Array<{ name: string; scale: "linear" | "log"; values: number[] }>;
  metric: OutputMetric;
  /** Metric per run. 1-D: one per level. 2-D: row-major, `outputs[i * n1 + j]`
   * for level i of the first axis and level j of the second. NaN marks a
   * failed run. */
  outputs: number[];
  failed: number;
  /** First failure message, if any run failed. */
  firstError?: string;
  /** Saved times of the trajectories in `traces`. */
  time: number[];
  /** `traces[series][level]`: that run's trajectory, or null if it failed. */
  traces: Record<string, Array<number[] | null>>;
}

/** Evenly spaced levels from min to max, both included. */
export function sweepLevels(axis: SweepAxis): number[] {
  const steps = Math.floor(axis.steps);
  if (!Number.isFinite(axis.min) || !Number.isFinite(axis.max)) {
    throw new Error(`sweep range for '${axis.name}' must be finite`);
  }
  if (!(steps >= 2)) throw new Error(`sweep of '${axis.name}' needs at least 2 steps`);
  if (axis.max <= axis.min) throw new Error(`sweep of '${axis.name}': max must be greater than min`);
  const log = axis.scale === "log";
  if (log && !(axis.min > 0)) throw new Error(`sweep of '${axis.name}' uses log scale but its min is not > 0`);
  const lo = log ? Math.log10(axis.min) : axis.min;
  const hi = log ? Math.log10(axis.max) : axis.max;
  return Array.from({ length: steps }, (_, i) => {
    const u = i === steps - 1 ? hi : lo + ((hi - lo) * i) / (steps - 1);
    return log ? 10 ** u : u;
  });
}

export function sweep(model: Model, spec: SweepSpec): SweepResult {
  const axes = spec.axes.map((axis) => ({
    name: axis.name,
    scale: axis.scale ?? "linear",
    values: sweepLevels(axis),
  }));
  if (axes.length === 2 && axes[0].name === axes[1].name) {
    throw new Error("the two sweep axes must be different elements");
  }

  const samples: Overrides[] =
    axes.length === 1
      ? axes[0].values.map((value) => ({ [axes[0].name]: value }))
      : gridSamples({ [axes[0].name]: axes[0].values, [axes[1].name]: axes[1].values });

  const ensemble = simulateEnsemble({ base: model, samples, run: spec.run });
  let firstError: string | undefined;
  const outputs = ensemble.runs.map((run) => {
    if (!run.result) {
      firstError ??= run.error;
      return Number.NaN;
    }
    try {
      const value = evaluateMetric(run.result, spec.metric);
      return Number.isFinite(value) ? value : Number.NaN;
    } catch (error) {
      firstError ??= error instanceof Error ? error.message : String(error);
      return Number.NaN;
    }
  });

  const traces: Record<string, Array<number[] | null>> = {};
  if (axes.length === 1) {
    for (const name of spec.series ?? []) {
      traces[name] = ensemble.runs.map((run) => {
        const values = run.result?.series[name];
        return values ? Array.from(values) : null;
      });
    }
  }

  return {
    axes,
    metric: spec.metric,
    outputs,
    failed: outputs.filter((v) => Number.isNaN(v)).length,
    firstError,
    time: ensemble.time,
    traces,
  };
}

// ----- features of a response curve ----------------------------------------

export interface CurveFeatures {
  /** Smallest and largest output and the parameter values where they occur. */
  min: { at: number; value: number };
  max: { at: number; value: number };
  /** "up" / "down" when every finite step moves the same way (ties allowed). */
  trend: "up" | "down" | "flat" | "mixed";
  /** The adjacent pair of levels with the largest change in output. */
  steepest?: { from: number; to: number; fromValue: number; toValue: number; share: number };
  /** True when one step holds at least 40% of the whole change: a threshold. */
  threshold: boolean;
  /** An extreme strictly inside the range (an optimum or worst case). */
  interior?: { kind: "peak" | "trough"; at: number; value: number };
  /** The output stops responding beyond this level (the last 30% of the levels
   * move it by under 5% of its range). */
  levelsOff?: { side: "high" | "low"; beyond: number };
}

/** Pull out the features worth pointing at. Needs at least two finite points;
 * NaN outputs (failed runs) are skipped. */
export function curveFeatures(values: readonly number[], outputs: readonly number[]): CurveFeatures | null {
  const points = values
    .map((x, i) => ({ x, y: outputs[i] }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (points.length < 2) return null;

  let lo = points[0];
  let hi = points[0];
  for (const p of points) {
    if (p.y < lo.y) lo = p;
    if (p.y > hi.y) hi = p;
  }
  const span = hi.y - lo.y;
  const scale = Math.max(Math.abs(hi.y), Math.abs(lo.y), 1e-300);
  const flat = span <= 1e-9 * scale;

  let ups = 0;
  let downs = 0;
  let best: CurveFeatures["steepest"];
  for (let i = 1; i < points.length; i += 1) {
    const d = points[i].y - points[i - 1].y;
    if (d > 1e-12 * scale) ups += 1;
    if (d < -1e-12 * scale) downs += 1;
    const share = span > 0 ? Math.abs(d) / span : 0;
    if (!best || share > best.share) {
      best = { from: points[i - 1].x, to: points[i].x, fromValue: points[i - 1].y, toValue: points[i].y, share };
    }
  }
  const trend = flat ? "flat" : downs === 0 ? "up" : ups === 0 ? "down" : "mixed";

  const last = points.length - 1;
  let interior: CurveFeatures["interior"];
  if (!flat && points.length >= 3) {
    const hiIndex = points.indexOf(hi);
    const loIndex = points.indexOf(lo);
    // an extreme counts as interior when both ends sit clearly away from it
    const clear = (index: number, value: number) =>
      index > 0 && index < last && Math.abs(points[0].y - value) > 0.05 * span && Math.abs(points[last].y - value) > 0.05 * span;
    if (clear(hiIndex, hi.y)) interior = { kind: "peak", at: hi.x, value: hi.y };
    else if (clear(loIndex, lo.y)) interior = { kind: "trough", at: lo.x, value: lo.y };
  }

  let levelsOff: CurveFeatures["levelsOff"];
  if (!flat && points.length >= 6 && trend !== "mixed") {
    const tail = Math.max(2, Math.ceil(points.length * 0.3));
    const moved = (slice: typeof points) =>
      Math.max(...slice.map((p) => p.y)) - Math.min(...slice.map((p) => p.y));
    if (moved(points.slice(-tail)) < 0.05 * span) levelsOff = { side: "high", beyond: points[last - tail + 1].x };
    else if (moved(points.slice(0, tail)) < 0.05 * span) levelsOff = { side: "low", beyond: points[tail - 1].x };
  }

  return {
    min: { at: lo.x, value: lo.y },
    max: { at: hi.x, value: hi.y },
    trend,
    steepest: flat ? undefined : best,
    threshold: !flat && points.length >= 5 && (best?.share ?? 0) >= 0.4,
    interior,
    levelsOff,
  };
}

// ----- features of a response surface --------------------------------------

export interface SurfaceFeatures {
  min: { at: [number, number]; value: number };
  max: { at: [number, number]; value: number };
  /** Average spread of the output along each axis with the other held fixed. */
  spread: [number, number];
  /** Index (0 or 1) of the axis the output depends on more, or -1 if close. */
  dominant: 0 | 1 | -1;
}

export function surfaceFeatures(
  values0: readonly number[],
  values1: readonly number[],
  outputs: readonly number[],
): SurfaceFeatures | null {
  const n0 = values0.length;
  const n1 = values1.length;
  const at = (i: number, j: number) => outputs[i * n1 + j];
  let min: SurfaceFeatures["min"] | undefined;
  let max: SurfaceFeatures["max"] | undefined;
  for (let i = 0; i < n0; i += 1) {
    for (let j = 0; j < n1; j += 1) {
      const v = at(i, j);
      if (!Number.isFinite(v)) continue;
      if (!min || v < min.value) min = { at: [values0[i], values1[j]], value: v };
      if (!max || v > max.value) max = { at: [values0[i], values1[j]], value: v };
    }
  }
  if (!min || !max) return null;

  const rangeOf = (list: number[]) => {
    const finite = list.filter(Number.isFinite);
    return finite.length >= 2 ? Math.max(...finite) - Math.min(...finite) : Number.NaN;
  };
  const mean = (list: number[]) => {
    const finite = list.filter(Number.isFinite);
    return finite.length > 0 ? finite.reduce((a, b) => a + b, 0) / finite.length : 0;
  };
  // spread along axis 0: vary i with j fixed, averaged over j
  const along0 = mean(Array.from({ length: n1 }, (_, j) => rangeOf(Array.from({ length: n0 }, (_, i) => at(i, j)))));
  const along1 = mean(Array.from({ length: n0 }, (_, i) => rangeOf(Array.from({ length: n1 }, (_, j) => at(i, j)))));
  const dominant = along0 > 1.5 * along1 ? 0 : along1 > 1.5 * along0 ? 1 : -1;
  return { min, max, spread: [along0, along1], dominant };
}
