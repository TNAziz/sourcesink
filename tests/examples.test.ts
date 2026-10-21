/**
 * Every shipped example model must simulate to sane numbers and meet the
 * checks a teacher would use. A stiff example run with too coarse an
 * integrator once diverged to 1e66 without any test noticing; this guard
 * catches that class of mistake, and the catalog tests keep attribution honest.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyOverrides } from "@sourcesink/analysis";
import { simulate, type SimulationResult } from "@sourcesink/engine";
import { checkUnits } from "@sourcesink/units";
import { readXmile } from "@sourcesink/xmile";

import { renderExamplesReadme } from "../scripts/examples-index.js";

const examplesRoot = join(__dirname, "..", "examples");
const environmentalDir = join(examplesRoot, "environmental");
const environmentalFiles = readdirSync(environmentalDir).filter((f) => f.endsWith(".xmile"));

interface Reference {
  citation: string;
  doi?: string;
}

type CheckType =
  | "value"
  | "final"
  | "max"
  | "min"
  | "argmax"
  | "argmin"
  | "monotonic"
  | "bounds"
  | "oscillates";

interface CatalogCheck {
  type: CheckType;
  series: string;
  time?: number;
  expected?: number;
  tol?: number;
  direction?: "up" | "down";
  min?: number;
  max?: number;
  minPeaks?: number;
}

interface CatalogEntry {
  id: string;
  file: string;
  title: string;
  category: string;
  level: string;
  summary: string;
  question: string;
  teaching: string;
  references: Reference[];
  original?: boolean;
  checks: CatalogCheck[];
}

interface CatalogFile {
  category: string;
  entries: CatalogEntry[];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function objectList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object");
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["models", "entries", "examples"]) {
      const list = record[key];
      if (Array.isArray(list)) {
        return list.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object");
      }
    }
  }
  return [];
}

function parseReferences(value: unknown): Reference[] {
  const out: Reference[] = [];
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const record = item as { citation?: unknown; doi?: unknown };
    const citation = stringValue(record.citation).trim();
    if (!citation) continue;
    const doi = stringValue(record.doi).trim();
    out.push(doi ? { citation, doi } : { citation });
  }
  return out;
}

function parseChecks(value: unknown): CatalogCheck[] {
  const out: CatalogCheck[] = [];
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const type = stringValue(record.type) as CheckType;
    const series = stringValue(record.series).trim();
    if (!type || !series) continue;
    out.push({
      type,
      series,
      ...(typeof record.time === "number" ? { time: record.time } : {}),
      ...(typeof record.expected === "number" ? { expected: record.expected } : {}),
      ...(typeof record.tol === "number" ? { tol: record.tol } : {}),
      ...(record.direction === "up" || record.direction === "down" ? { direction: record.direction } : {}),
      ...(typeof record.min === "number" ? { min: record.min } : {}),
      ...(typeof record.max === "number" ? { max: record.max } : {}),
      ...(typeof record.minPeaks === "number" ? { minPeaks: record.minPeaks } : {}),
    });
  }
  return out;
}

function parseCatalog(category: string): CatalogEntry[] {
  const path = join(examplesRoot, category, "catalog.json");
  if (!existsSync(path)) return [];
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  const entries: CatalogEntry[] = [];
  for (const record of objectList(value)) {
    const id = stringValue(record.id).trim();
    const file = stringValue(record.file).trim();
    if (!id || !file) continue;
    entries.push({
      id,
      file,
      title: stringValue(record.title).trim(),
      category: stringValue(record.category, category).trim() || category,
      level: stringValue(record.level).trim(),
      summary: stringValue(record.summary).trim(),
      question: stringValue(record.question).trim(),
      teaching: stringValue(record.teaching).trim(),
      references: parseReferences(record.references),
      ...(record.original === true ? { original: true } : {}),
      checks: parseChecks(record.checks),
    });
  }
  return entries;
}

const categories = readdirSync(examplesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const catalogs: CatalogFile[] = categories
  .map((category) => ({ category, entries: parseCatalog(category) }))
  .filter((catalog) => catalog.entries.length > 0);

const allEntries = catalogs.flatMap((catalog) =>
  catalog.entries.map((entry) => ({ directory: catalog.category, entry })),
);

/** Linear interpolation of a series at a sample time. */
function interpolate(time: number[], values: number[], at: number): number {
  if (values.length === 0) throw new Error("series is empty");
  if (at <= time[0]) return values[0];
  if (at >= time[time.length - 1]) return values[values.length - 1];
  for (let i = 1; i < time.length; i += 1) {
    if (at <= time[i]) {
      const span = time[i] - time[i - 1];
      const fraction = span === 0 ? 0 : (at - time[i - 1]) / span;
      return values[i - 1] + fraction * (values[i] - values[i - 1]);
    }
  }
  return values[values.length - 1];
}

function argExtreme(values: number[], kind: "max" | "min"): number {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (kind === "max" ? values[i] > values[best] : values[i] < values[best]) best = i;
  }
  return best;
}

/** Local maxima, ignoring wiggles smaller than 1% of the series range. */
/** Count oscillation peaks with hysteresis: a peak counts when the series
 * rises at least 1% of its range above the last trough and then falls at
 * least 1% below that peak. Comparing with adjacent samples instead would
 * miss every peak of a finely sampled curve. */
export function countPeaks(values: number[]): number {
  if (values.length < 3) return 0;
  const range = Math.max(...values) - Math.min(...values);
  if (range === 0) return 0;
  const threshold = range * 0.01;
  let peaks = 0;
  let trough = values[0];
  let peak = -Infinity;
  let rising = false;
  for (const v of values) {
    if (!rising) {
      trough = Math.min(trough, v);
      if (v - trough >= threshold) {
        rising = true;
        peak = v;
      }
    } else {
      peak = Math.max(peak, v);
      if (peak - v >= threshold) {
        peaks += 1;
        rising = false;
        trough = v;
      }
    }
  }
  return peaks;
}

function seriesOf(result: SimulationResult, name: string): number[] {
  const values = result.series[name];
  if (!values) throw new Error(`series '${name}' is not produced by the model`);
  return values;
}

function assertCheck(check: CatalogCheck, result: SimulationResult): void {
  const values = seriesOf(result, check.series);
  const tol = check.tol ?? 1e-6;
  const label = `${check.type} ${check.series}`;
  switch (check.type) {
    case "value": {
      if (check.time === undefined || check.expected === undefined) {
        throw new Error(`${label}: missing time or expected`);
      }
      const actual = interpolate(result.time, values, check.time);
      expect(Math.abs(actual - check.expected), `${label} at t=${check.time}: ${actual}`).toBeLessThanOrEqual(tol);
      return;
    }
    case "final": {
      if (check.expected === undefined) throw new Error(`${label}: missing expected`);
      const actual = values[values.length - 1];
      expect(Math.abs(actual - check.expected), `${label}: ${actual}`).toBeLessThanOrEqual(tol);
      return;
    }
    case "max":
    case "min": {
      if (check.expected === undefined) throw new Error(`${label}: missing expected`);
      const actual = check.type === "max" ? Math.max(...values) : Math.min(...values);
      expect(Math.abs(actual - check.expected), `${label}: ${actual}`).toBeLessThanOrEqual(tol);
      return;
    }
    case "argmax":
    case "argmin": {
      if (check.expected === undefined) throw new Error(`${label}: missing expected`);
      const actual = result.time[argExtreme(values, check.type === "argmax" ? "max" : "min")];
      expect(Math.abs(actual - check.expected), `${label}: ${actual}`).toBeLessThanOrEqual(tol);
      return;
    }
    case "monotonic": {
      if (check.direction !== "up" && check.direction !== "down") {
        throw new Error(`${label}: missing direction`);
      }
      for (let i = 1; i < values.length; i += 1) {
        const violation =
          check.direction === "up" ? values[i] < values[i - 1] - 1e-9 : values[i] > values[i - 1] + 1e-9;
        if (violation) {
          throw new Error(
            `${label} (${check.direction}) reverses at t=${result.time[i]}: ${values[i - 1]} -> ${values[i]}`,
          );
        }
      }
      return;
    }
    case "bounds": {
      if (check.min === undefined || check.max === undefined) throw new Error(`${label}: missing min or max`);
      for (let i = 0; i < values.length; i += 1) {
        expect(values[i], `${label} at t=${result.time[i]}`).toBeGreaterThanOrEqual(check.min - 1e-9);
        expect(values[i], `${label} at t=${result.time[i]}`).toBeLessThanOrEqual(check.max + 1e-9);
      }
      return;
    }
    case "oscillates": {
      if (check.minPeaks === undefined) throw new Error(`${label}: missing minPeaks`);
      const peaks = countPeaks(values);
      expect(peaks, `${label}: ${peaks} local maxima`).toBeGreaterThanOrEqual(check.minPeaks);
      return;
    }
    default:
      throw new Error(`${label}: unknown check type '${String(check.type)}'`);
  }
}

describe("example models", () => {
  it("are present", () => {
    expect(environmentalFiles.length).toBeGreaterThan(5);
  });

  for (const file of environmentalFiles) {
    it(`${file} stays finite and bounded`, () => {
      const model = readXmile(readFileSync(join(environmentalDir, file), "utf8"));
      const result = simulate(model);
      for (const stock of model.stocks) {
        const values = result.series[stock.name];
        expect(values, stock.name).toBeDefined();
        for (const value of values) {
          expect(Number.isFinite(value), `${stock.name} is finite`).toBe(true);
          expect(Math.abs(value), `${stock.name} stays below 1e8`).toBeLessThan(1e8);
        }
      }
    });
  }
});

describe("example catalogs", () => {
  it("have unique ids across all categories", () => {
    const seen = new Map<string, string>();
    for (const { directory, entry } of allEntries) {
      const previous = seen.get(entry.id);
      expect(previous, `${entry.id} appears in both ${previous} and ${directory}`).toBeUndefined();
      seen.set(entry.id, directory);
    }
  });

  for (const { directory, entry } of allEntries) {
    it(`${directory}/${entry.id} catalog entry is complete`, () => {
      expect(entry.category).toBe(directory);
      expect(["intro", "intermediate", "advanced"]).toContain(entry.level);
      expect(entry.file.endsWith(".xmile")).toBe(true);
      expect(existsSync(join(examplesRoot, directory, entry.file)), `${entry.file} exists`).toBe(true);
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.summary.length).toBeGreaterThan(0);
      expect(entry.question.length).toBeGreaterThan(0);
      expect(entry.teaching.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.checks)).toBe(true);
      expect(entry.checks.length).toBeGreaterThan(0);
      for (const reference of entry.references) {
        expect(reference.citation.trim().length).toBeGreaterThan(0);
        if (reference.doi !== undefined) {
          expect(reference.doi, `DOI for "${reference.citation}"`).toMatch(/^10\.\d{4,9}\/\S+$/);
        }
      }
      if (entry.references.length === 0) {
        expect(entry.original, `${entry.id} has no references and must set original: true`).toBe(true);
      }
    });
  }

  for (const { directory, entry } of allEntries) {
    it(`${directory}/${entry.id} parses, simulates, is unit-clean and meets its checks`, () => {
      const model = readXmile(readFileSync(join(examplesRoot, directory, entry.file), "utf8"));

      for (const element of [...model.stocks, ...model.flows, ...model.converters]) {
        expect(element.documentation?.trim(), `${element.kind} '${element.name}' has a <doc>`).toBeTruthy();
      }

      const findings = checkUnits(model);
      expect(
        findings.map((finding) => `${finding.element}: ${finding.message}`),
        `${entry.file} unit findings`,
      ).toEqual([]);

      const result = simulate(model);
      for (const [name, values] of Object.entries(result.series)) {
        for (let i = 0; i < values.length; i += 1) {
          expect(Number.isFinite(values[i]), `${name} at t=${result.time[i]} is finite`).toBe(true);
        }
      }

      for (const check of entry.checks) assertCheck(check, result);
    });
  }

  it("examples/README.md is up to date with the catalogs", () => {
    const readme = readFileSync(join(examplesRoot, "README.md"), "utf8");
    expect(readme).toBe(renderExamplesReadme());
  });
});

const iceAlbedo = join(examplesRoot, "climate", "ice-albedo.xmile");

describe("climate/ice-albedo", () => {
  it.skipIf(!existsSync(iceAlbedo))("settles near 247.7 K from a 230 K start", () => {
    const base = readXmile(readFileSync(iceAlbedo, "utf8"));
    const model = applyOverrides(base, { initial_temperature: 230 });
    const result = simulate(model);
    const stock = model.stocks.find((entry) => /temp/i.test(entry.name)) ?? model.stocks[0];
    expect(stock, "ice-albedo has a temperature stock").toBeDefined();
    const values = result.series[stock.name];
    expect(values, `${stock.name} is simulated`).toBeDefined();
    expect(values[values.length - 1], "final temperature").toBeGreaterThanOrEqual(247.7 - 1.5);
    expect(values[values.length - 1], "final temperature").toBeLessThanOrEqual(247.7 + 1.5);
  });
});

describe("countPeaks", () => {
  it("counts the peaks of a finely sampled sine and ignores tiny wiggles", () => {
    const sine = Array.from({ length: 2001 }, (_, i) => Math.sin((i / 2000) * 2 * Math.PI * 5));
    expect(countPeaks(sine)).toBe(5);
    const wiggle = Array.from({ length: 500 }, (_, i) => i + 0.001 * Math.sin(i));
    expect(countPeaks(wiggle)).toBe(0);
    expect(countPeaks([1, 1, 1])).toBe(0);
  });
});
