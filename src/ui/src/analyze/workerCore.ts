/**
 * SourceSink — analysis worker protocol and pure request handler.
 *
 * The worker itself is a thin shell around `handle`, so the whole message
 * path can be tested in Node without constructing a real Worker. Every run
 * is deterministic given the request's seed.
 */

import {
  calibrate,
  latinHypercube,
  morris,
  simulateEnsemble,
  sobol,
  summarize,
} from "@sourcesink/analysis";
import type {
  CalibrationOptions,
  Dataset,
  FitResult,
  MorrisOptions,
  MorrisResult,
  OutputMetric,
  Overrides,
  ParameterSpec,
  SobolOptions,
  SobolResult,
  SummaryStats,
} from "@sourcesink/analysis";
import type { Model } from "@sourcesink/model";

export type AnalysisKind = "calibrate" | "morris" | "sobol" | "uncertainty";

export interface CalibrateRequest {
  id: number;
  kind: "calibrate";
  model: Model;
  data: Dataset;
  params: ParameterSpec[];
  options?: CalibrationOptions;
}

export interface MorrisRequest {
  id: number;
  kind: "morris";
  model: Model;
  params: ParameterSpec[];
  metric: OutputMetric;
  options?: MorrisOptions;
}

export interface SobolRequest {
  id: number;
  kind: "sobol";
  model: Model;
  params: ParameterSpec[];
  metric: OutputMetric;
  options?: SobolOptions;
}

export interface UncertaintyRequest {
  id: number;
  kind: "uncertainty";
  model: Model;
  params: ParameterSpec[];
  runs: number;
  series: string[];
  seed?: number;
}

export type WorkerRequest = CalibrateRequest | MorrisRequest | SobolRequest | UncertaintyRequest;

export interface UncertaintyResult {
  time: number[];
  stats: Record<string, SummaryStats>;
  runs: number;
  failed: number;
}

export type WorkerResponse =
  | { id: number; type: "progress"; stage: string; evaluations?: number }
  | { id: number; type: "result"; kind: "calibrate"; result: FitResult }
  | { id: number; type: "result"; kind: "morris"; result: MorrisResult }
  | { id: number; type: "result"; kind: "sobol"; result: SobolResult }
  | { id: number; type: "result"; kind: "uncertainty"; result: UncertaintyResult }
  | { id: number; type: "error"; kind: AnalysisKind; error: string };

/** Progress message shape (exported for the worker shell). */
export type StatusResponse = Extract<WorkerResponse, { type: "progress" }>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Latin-hypercube draws mapped from unit space to each parameter's range
 * (log10 space for log-scaled parameters). Exposed for tests. */
export function latinOverrides(
  params: ParameterSpec[],
  runs: number,
  seed: number,
): Overrides[] {
  const ranges: Record<string, [number, number]> = {};
  for (const p of params) {
    ranges[p.name] = p.scale === "log" ? [Math.log10(p.min), Math.log10(p.max)] : [p.min, p.max];
  }
  return latinHypercube(ranges, runs, seed).map((sample) => {
    const overrides: Overrides = {};
    for (const p of params) {
      const coordinate = Number(sample[p.name]);
      overrides[p.name] = p.scale === "log" ? 10 ** coordinate : coordinate;
    }
    return overrides;
  });
}

function uncertaintyResult(request: UncertaintyRequest): UncertaintyResult {
  const runs = Math.floor(request.runs);
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`runs must be a positive integer, got ${request.runs}`);
  }
  if (request.series.length === 0) throw new Error("choose at least one series");
  for (const p of request.params) {
    if (p.scale === "log" && !(p.min > 0)) {
      throw new Error(`parameter '${p.name}' uses log scale but its min is not > 0`);
    }
  }
  const seed = request.seed ?? 0;
  const samples = latinOverrides(request.params, runs, seed);
  const ensemble = simulateEnsemble({ base: request.model, samples, seeds: [seed] });
  const stats = summarize(ensemble, request.series, [5, 25, 50, 75, 95]);
  return {
    time: ensemble.time,
    stats,
    runs: ensemble.runs.length,
    failed: ensemble.runs.filter((run) => run.result === undefined).length,
  };
}

/** Handle one request. Every failure becomes an error response so the UI
 * never waits on a crashed worker. */
export function handle(request: WorkerRequest): WorkerResponse {
  try {
    switch (request.kind) {
      case "calibrate":
        return {
          id: request.id,
          type: "result",
          kind: "calibrate",
          result: calibrate(request.model, request.data, request.params, request.options),
        };
      case "morris":
        return {
          id: request.id,
          type: "result",
          kind: "morris",
          result: morris(request.model, request.params, request.metric, request.options),
        };
      case "sobol":
        return {
          id: request.id,
          type: "result",
          kind: "sobol",
          result: sobol(request.model, request.params, request.metric, request.options),
        };
      case "uncertainty":
        return {
          id: request.id,
          type: "result",
          kind: "uncertainty",
          result: uncertaintyResult(request),
        };
      default: {
        const exhaustive: never = request;
        throw new Error(`unknown request ${JSON.stringify(exhaustive)}`);
      }
    }
  } catch (error) {
    return { id: request.id, type: "error", kind: request.kind, error: message(error) };
  }
}

/** Human-readable progress line posted before work starts. */
export function progressStage(kind: AnalysisKind): string {
  switch (kind) {
    case "calibrate":
      return "Fitting parameters…";
    case "morris":
      return "Running Morris screen…";
    case "sobol":
      return "Running Sobol decomposition…";
    case "uncertainty":
      return "Running ensemble…";
    default:
      return "Running…";
  }
}
