/**
 * Grounded answers: run a model (and what-if variants) for the assistant.
 *
 * The assistant may only answer questions about behavior from results it
 * actually computed. This module turns one `RunRequest` into a simulation
 * plus a handful of plain statements of fact; `turn.ts` sends those facts back
 * to the language model so its reply can cite real numbers.
 *
 * Everything here is pure apart from the engine's own `simulate()`: no
 * network, no file access, no language model.
 */

import { applyOverrides } from "@sourcesink/analysis";
import { canonicalName, simulate, type SimulationResult } from "@sourcesink/engine";
import type { Model } from "@sourcesink/model";

import type { RunEvidence, RunRequest } from "./contracts.js";

/** Numbers in facts are rounded to three significant digits, the precision a
 * reader can use without pretending the model is exact. */
function sig3(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "0";
  return String(Number(value.toPrecision(3)));
}

/** A time expressed in the model's own time units, e.g. "2 Day". */
function formatTime(value: number, units: string | undefined): string {
  const number = sig3(value);
  return units ? `${number} ${units}` : number;
}

/** Signed percentage with a true minus sign, matching the usual prose. */
function formatPercent(value: number): string {
  if (Math.abs(value) < 0.05) return "0%";
  const rounded = sig3(Math.abs(value));
  return value < 0 ? `−${rounded}%` : `+${rounded}%`;
}

/** True when the series never moves in the opposite direction. */
function monotonicDirection(values: readonly number[]): "rising" | "falling" | "flat" | undefined {
  let rising = true;
  let falling = true;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] < values[i - 1]) rising = false;
    if (values[i] > values[i - 1]) falling = false;
  }
  if (rising && falling) return "flat";
  if (rising) return "rising";
  if (falling) return "falling";
  return undefined;
}

function indexOfExtreme(values: readonly number[], mode: "max" | "min"): number {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (mode === "max" ? values[i] > values[best] : values[i] < values[best]) best = i;
  }
  return best;
}

/** The last tenth of the run; a change under 1% over that window reads as
 * "levelled off". */
function levelsOff(values: readonly number[]): number | undefined {
  if (values.length < 3) return undefined;
  const window = Math.max(2, Math.ceil(values.length * 0.1));
  const start = values[values.length - window];
  const end = values[values.length - 1];
  const scale = Math.max(Math.abs(start), Math.abs(end), 1e-12);
  if (Math.abs(end - start) / scale >= 0.01) return undefined;
  return end;
}

/** The first time a series crosses a threshold, in the inferred direction:
 * a series that starts above a level can only "fall below" it and one that
 * starts below can only "rise above" it. */
function crossing(
  time: readonly number[],
  values: readonly number[],
  threshold: number,
): { direction: "below" | "above"; at: number } | undefined {
  const first = values[0];
  const last = values[values.length - 1];
  const direction = first > threshold ? "below" : first < threshold ? "above" : last > threshold ? "below" : "above";
  for (let i = 0; i < values.length; i += 1) {
    if (direction === "below" ? values[i] < threshold : values[i] > threshold) {
      // Interpolate between saved points, so the time is not limited to the
      // save interval (a yearly save would otherwise report 3 for 2.4).
      if (i === 0) return { direction, at: time[0] };
      const v0 = values[i - 1];
      const v1 = values[i];
      const f = v1 === v0 ? 1 : (threshold - v0) / (v1 - v0);
      return { direction, at: time[i - 1] + f * (time[i] - time[i - 1]) };
    }
  }
  return undefined;
}

/** Facts for one reported series. `time` and the simulation share indices. */
function seriesFacts(
  name: string,
  values: readonly number[],
  time: readonly number[],
  units: string | undefined,
  timeUnits: string | undefined,
  threshold: number | undefined,
): string[] {
  if (values.length === 0) return [`${name}: no values were reported`];
  const facts: string[] = [];
  const first = values[0];
  const last = values[values.length - 1];
  const unitSuffix = units ? ` (${units})` : "";
  facts.push(`${name}: starts at ${sig3(first)}, ends at ${sig3(last)}${unitSuffix}`);

  const direction = monotonicDirection(values);
  if (direction === "rising") {
    facts.push(`${name}: rises steadily`);
  } else if (direction === "falling") {
    facts.push(`${name}: falls steadily`);
  } else if (direction === "flat") {
    facts.push(`${name}: stays constant at ${sig3(first)}`);
  } else {
    const maxIndex = indexOfExtreme(values, "max");
    const minIndex = indexOfExtreme(values, "min");
    facts.push(
      `${name}: maximum ${sig3(values[maxIndex])} at ${formatTime(time[maxIndex], timeUnits)}, minimum ${sig3(values[minIndex])} at ${formatTime(time[minIndex], timeUnits)}`,
    );
  }

  if (threshold !== undefined) {
    const hit = crossing(time, values, threshold);
    if (!hit) {
      // The series never reaches the level it would have to cross.
      const verb = values[0] > threshold ? "never falls below" : "never rises above";
      facts.push(`${name} ${verb} ${sig3(threshold)}`);
    } else {
      const verb = hit.direction === "below" ? "first falls below" : "first rises above";
      facts.push(`${name} ${verb} ${sig3(threshold)} at ${formatTime(hit.at, timeUnits)}`);
    }
  }

  const settled = levelsOff(values);
  if (settled !== undefined) facts.push(`${name} levels off near ${sig3(settled)}`);

  return facts;
}

function simulatedModel(model: Model, request: RunRequest): Model {
  return request.set && Object.keys(request.set).length > 0 ? applyOverrides(model, request.set) : model;
}

function errorEvidence(request: RunRequest, error: string): RunEvidence {
  return { request, ok: false, error, time: [], series: {}, facts: [] };
}

/** Run one request against `model`, which is already the right base (current
 * or proposal). Unknown override names fail the run with a message naming
 * them; unknown series names become an error fact while the rest are still
 * reported. */
export function runEvidence(model: Model, request: RunRequest): RunEvidence {
  let target: Model;
  try {
    target = simulatedModel(model, request);
  } catch (err) {
    return errorEvidence(request, `Cannot apply the what-if values: ${(err as Error).message}`);
  }

  let result: SimulationResult;
  try {
    result = simulate(target);
  } catch (err) {
    return errorEvidence(request, `The simulation failed: ${(err as Error).message}`);
  }

  const timeUnits = target.run.timeUnits;
  const elementUnits = new Map<string, string | undefined>();
  for (const element of [...target.stocks, ...target.flows, ...target.converters]) {
    elementUnits.set(canonicalName(element.name), element.units);
  }
  const seriesByCanonical = new Map<string, string>();
  for (const name of Object.keys(result.series)) seriesByCanonical.set(canonicalName(name), name);

  // Default to every stock. Arrayed models run as their scalar elements
  // (`Population[North]`), so match those expanded names too.
  const stockNames = new Set(target.stocks.map((stock) => canonicalName(stock.name)));
  const defaultSeries = Object.keys(result.series).filter((name) => {
    const canonical = canonicalName(name);
    const bracket = canonical.indexOf("[");
    return stockNames.has(bracket > 0 ? canonical.slice(0, bracket) : canonical);
  });
  const requested = request.series ?? defaultSeries;
  const facts: string[] = [];
  const series: Record<string, number[]> = {};
  const unknown: string[] = [];

  for (const name of requested) {
    const actual = seriesByCanonical.get(canonicalName(name));
    if (!actual) {
      unknown.push(name);
      continue;
    }
    series[actual] = result.series[actual];
    const threshold = findThreshold(request.thresholds, actual);
    facts.push(
      ...seriesFacts(
        actual,
        result.series[actual],
        result.time,
        elementUnits.get(canonicalName(actual)),
        timeUnits,
        threshold,
      ),
    );
  }
  if (unknown.length > 0) {
    facts.push(`No series named ${unknown.map((name) => `'${name}'`).join(", ")} in the model.`);
  }

  if (request.set && Object.keys(request.set).length > 0) {
    facts.push(...comparisonFacts(model, series));
  }

  return { request, ok: true, ...(timeUnits ? { timeUnits } : {}), time: result.time, series, facts };
}

/** Thresholds are keyed by element name; match them as loosely as overrides. */
function findThreshold(thresholds: Record<string, number> | undefined, name: string): number | undefined {
  if (!thresholds) return undefined;
  const key = canonicalName(name);
  for (const [thresholdName, value] of Object.entries(thresholds)) {
    if (canonicalName(thresholdName) === key) return value;
  }
  return undefined;
}

/** How the what-if run ends compared with the unmodified base model. */
function comparisonFacts(base: Model, runSeries: Record<string, number[]>): string[] {
  let baseResult: SimulationResult;
  try {
    baseResult = simulate(base);
  } catch {
    return [];
  }
  const facts: string[] = [];
  for (const [name, values] of Object.entries(runSeries)) {
    const baseValues = baseResult.series[name];
    if (!baseValues || baseValues.length === 0 || values.length === 0) continue;
    const end = values[values.length - 1];
    const baseEnd = baseValues[baseValues.length - 1];
    if (baseEnd === 0) {
      facts.push(`${name}: ends at ${sig3(end)} instead of ${sig3(baseEnd)}`);
      continue;
    }
    const percent = ((end - baseEnd) / Math.abs(baseEnd)) * 100;
    facts.push(`${name}: ends at ${sig3(end)} instead of ${sig3(baseEnd)} (${formatPercent(percent)})`);
  }
  return facts;
}

/** The facts of several runs as one message for the language model. */
export function evidenceMessage(evidence: RunEvidence[]): string {
  const lines: string[] = ["Simulation results computed by SourceSink:"];
  for (const run of evidence) {
    lines.push("", `Run "${run.request.label}":`);
    if (!run.ok) {
      lines.push(`- The run did not complete: ${run.error ?? "unknown error"}`);
      continue;
    }
    for (const fact of run.facts) lines.push(`- ${fact}`);
    if (run.facts.length === 0) lines.push("- The run produced no reportable series.");
  }
  return lines.join("\n");
}

/** A fallback answer built from the facts alone, used when the follow-up
 * reply cannot be parsed. */
export function factsBulletList(evidence: RunEvidence[]): string {
  const lines: string[] = [];
  for (const run of evidence) {
    lines.push(`**${run.request.label}**`);
    if (!run.ok) {
      lines.push(`- The run did not complete: ${run.error ?? "unknown error"}`);
    } else {
      for (const fact of run.facts) lines.push(`- ${fact}`);
    }
  }
  return lines.join("\n");
}
