import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validate, type Model } from "@sourcesink/model";
import { applyScenario } from "@sourcesink/analysis";
import { parse, simulate } from "@sourcesink/engine";
import { readXmile } from "@sourcesink/xmile";

/**
 * Evaluation corpus: small original XMILE models with known behaviour, plus
 * deliberately broken models for repair tests.
 *
 * A "value" check compares with a relative tolerance that falls back to an
 * absolute tolerance of `tol` near zero (|actual - expected| <= tol * max(1,
 * |expected|)), so exact zeros remain checkable.
 */

/** Every check may name one of the model's scenarios; it is then asserted
 * against a copy with that scenario applied (overrides + run-spec changes). */
interface CheckBase {
  scenario?: string;
}
interface ValueCheck extends CheckBase {
  type: "value";
  series: string;
  time: number;
  expected: number;
  tol: number;
}
interface ConservedCheck extends CheckBase {
  type: "conserved";
  series: string[];
  tol: number;
}
interface MonotonicCheck extends CheckBase {
  type: "monotonic";
  series: string;
  direction: "up" | "down";
}
interface BoundsCheck extends CheckBase {
  type: "bounds";
  series: string;
  min: number;
  max: number;
}
interface FinalCheck extends CheckBase {
  type: "final";
  series: string;
  expected: number;
  tol: number;
}
type Check = ValueCheck | ConservedCheck | MonotonicCheck | BoundsCheck | FinalCheck;

interface GoodEntry {
  file: string;
  story: string;
  /** Optional explanation for checks that depend on a method or scenario. */
  note?: string;
  checks: Check[];
}

interface BrokenEntry {
  file: string;
  defect: string;
  failsAt: "parse" | "validate" | "simulate" | "nonfinite";
}

const here = new URL(".", import.meta.url);
const good = JSON.parse(readFileSync(new URL("./manifest.json", here), "utf8")) as GoodEntry[];
const broken = JSON.parse(readFileSync(new URL("./broken/manifest.json", here), "utf8")) as BrokenEntry[];

function read(file: string): Model {
  return readXmile(readFileSync(new URL(`./models/${file}`, here), "utf8"));
}

function equations(model: Model): string[] {
  return [
    ...model.stocks.map((e) => e.equation),
    ...model.flows.map((e) => e.equation),
    ...model.converters.map((e) => e.equation),
  ];
}

/** Index of `t` in the saved time grid (within a small tolerance). */
function indexAt(times: number[], t: number): number {
  let best = -1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i += 1) {
    const diff = Math.abs(times[i] - t);
    if (diff < bestDiff) {
      best = i;
      bestDiff = diff;
    }
  }
  return bestDiff <= 1e-6 * Math.max(1, Math.abs(t)) ? best : -1;
}

function close(actual: number, expected: number, tol: number): boolean {
  return Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected));
}

function seriesOf(model: Model, values: Record<string, number[]>, name: string): number[] {
  const s = values[name];
  if (!s) {
    throw new Error(`no series '${name}' in model '${model.name}'`);
  }
  return s;
}

function check(model: Model, result: ReturnType<typeof simulate>, c: Check): void {
  const { time, series } = result;
  switch (c.type) {
    case "value": {
      const s = seriesOf(model, series, c.series);
      const i = indexAt(time, c.time);
      expect(i, `time ${c.time} is not on the save grid`).toBeGreaterThanOrEqual(0);
      expect(
        close(s[i], c.expected, c.tol),
        `${c.series}(${time[i]}) = ${s[i]}, expected ${c.expected} +/- ${c.tol}`,
      ).toBe(true);
      return;
    }
    case "conserved": {
      const seriesList = c.series.map((name) => seriesOf(model, series, name));
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < time.length; i += 1) {
        const total = seriesList.reduce((sum, s) => sum + s[i], 0);
        lo = Math.min(lo, total);
        hi = Math.max(hi, total);
      }
      expect(hi - lo, `${c.series.join(" + ")} is not conserved (range ${lo}..${hi})`).toBeLessThanOrEqual(c.tol);
      return;
    }
    case "monotonic": {
      const s = seriesOf(model, series, c.series);
      const sign = c.direction === "up" ? 1 : -1;
      for (let i = 1; i < s.length; i += 1) {
        const delta = (s[i] - s[i - 1]) * sign;
        const slack = -1e-9 * Math.max(1, Math.abs(s[i - 1]));
        expect(delta, `${c.series} is not monotonic ${c.direction} at t=${time[i]}`).toBeGreaterThanOrEqual(slack);
      }
      return;
    }
    case "bounds": {
      const s = seriesOf(model, series, c.series);
      for (let i = 0; i < s.length; i += 1) {
        expect(s[i], `${c.series}(${time[i]}) = ${s[i]} is below ${c.min}`).toBeGreaterThanOrEqual(c.min - 1e-9);
        expect(s[i], `${c.series}(${time[i]}) = ${s[i]} is above ${c.max}`).toBeLessThanOrEqual(c.max + 1e-9);
      }
      return;
    }
    case "final": {
      const s = seriesOf(model, series, c.series);
      const actual = s[s.length - 1];
      expect(
        close(actual, c.expected, c.tol),
        `${c.series} ends at ${actual}, expected ${c.expected} +/- ${c.tol}`,
      ).toBe(true);
      return;
    }
  }
}

describe("evaluation corpus: good models", () => {
  for (const entry of good) {
    it(`${entry.file} — ${entry.story}`, () => {
      const model = read(entry.file);
      expect(validate(model)).toEqual([]);

      const base = simulate(model);
      type Run = { model: Model; result: ReturnType<typeof simulate> };
      const scenarioRuns = new Map<string, Run>();
      for (const c of entry.checks) {
        const id = c.scenario;
        if (!id || scenarioRuns.has(id)) continue;
        const scenario = model.scenarios?.find((s) => s.id === id);
        expect(scenario, `scenario '${id}' is not defined in ${entry.file}`).toBeDefined();
        const scenarioModel = applyScenario(model, scenario!);
        expect(validate(scenarioModel), `scenario '${id}' is invalid`).toEqual([]);
        scenarioRuns.set(id, { model: scenarioModel, result: simulate(scenarioModel) });
      }

      for (const c of entry.checks) {
        const run = c.scenario ? scenarioRuns.get(c.scenario)! : { model, result: base };
        check(run.model, run.result, c);
      }

      // Every run is deterministic; this also verifies that explicitly seeded
      // RANDOM streams reproduce exactly.
      for (const run of [{ model, result: base }, ...scenarioRuns.values()]) {
        for (const [name, values] of Object.entries(run.result.series)) {
          expect(values.every((v) => Number.isFinite(v)), `${name} has a non-finite value`).toBe(true);
        }
        const again = simulate(run.model);
        expect(again.time).toEqual(run.result.time);
        for (const [name, values] of Object.entries(run.result.series)) {
          expect(again.series[name], `${name} is not reproducible`).toEqual(values);
        }
      }
    });
  }
});

describe("evaluation corpus: broken models", () => {
  for (const entry of broken) {
    it(`${entry.file} — ${entry.defect} (${entry.failsAt})`, () => {
      const xml = readFileSync(new URL(`./broken/${entry.file}`, here), "utf8");

      if (entry.failsAt === "parse") {
        expect(() => {
          const model = readXmile(xml);
          for (const equation of equations(model)) parse(equation);
        }).toThrow();
        return;
      }

      const model = readXmile(xml);
      for (const equation of equations(model)) parse(equation);

      if (entry.failsAt === "validate") {
        expect(validate(model).length).toBeGreaterThan(0);
        return;
      }

      expect(validate(model)).toEqual([]);

      if (entry.failsAt === "simulate") {
        expect(() => simulate(model)).toThrow();
        return;
      }

      const result = simulate(model);
      const nonfinite = Object.entries(result.series).filter(([, values]) =>
        values.some((v) => !Number.isFinite(v)),
      );
      expect(nonfinite.length, "expected a non-finite series").toBeGreaterThan(0);
    });
  }
});
