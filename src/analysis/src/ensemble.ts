/**
 * SourceSink — ensemble runner.
 *
 * Runs one base model once per sample, passing each sample's overrides through
 * `applyOverrides` and the run's seed through `simulate`. A failing run is
 * recorded in place (with its error) instead of aborting the ensemble, so one
 * bad sample does not discard the others.
 */

import { simulate, type SimulationResult } from "@sourcesink/engine";
import type { Model, RunSpec } from "@sourcesink/model";

import { applyOverrides, type Overrides } from "./overrides.js";

export interface EnsembleSpec {
  base: Model;
  /** One run per sample (parameter overrides). Empty array = one base run. */
  samples: Overrides[];
  /** Optional seeds; run i uses seeds[i % seeds.length]. Default seed 0. */
  seeds?: number[];
  run?: Partial<RunSpec>;
}

export interface EnsembleRun {
  index: number;
  overrides: Overrides;
  seed: number;
  result?: SimulationResult;
  error?: string;
}

export interface EnsembleResult {
  runs: EnsembleRun[];
  /** Shared time axis (from the first successful run). */
  time: number[];
}

/** Run every sample; failed runs are captured, not thrown. */
export function simulateEnsemble(spec: EnsembleSpec): EnsembleResult {
  const samples = spec.samples.length > 0 ? spec.samples : [{}];
  const seeds = spec.seeds ?? [];

  const runs: EnsembleRun[] = samples.map((overrides, index) => {
    const seed = seeds.length > 0 ? seeds[index % seeds.length] : 0;
    try {
      const model = applyOverrides(spec.base, overrides, spec.run);
      return { index, overrides, seed, result: simulate(model, { seed }) };
    } catch (err) {
      return { index, overrides, seed, error: err instanceof Error ? err.message : String(err) };
    }
  });

  const first = runs.find((r) => r.result !== undefined);
  return { runs, time: first?.result?.time.slice() ?? [] };
}
