/**
 * SourceSink — plain-language readings of sensitivity and uncertainty
 * results, shown when the user hovers a bar or a chart.
 *
 * Pure functions so the wording is tested; the thresholds follow common
 * practice for reading Morris screens (σ/μ* ratio, Garcia Sanchez et al.
 * 2014) and Sobol indices (Saltelli et al. 2008).
 */

import { formatNumber } from "../results/csv.js";

export interface MorrisRow {
  name: string;
  mu: number;
  muStar: number;
  sigma: number;
}

export interface SobolRow {
  name: string;
  first: number;
  total: number;
  firstCI: [number, number];
  totalCI: [number, number];
}

/** Heading plus a few short sentences for a hover card. */
export interface Reading {
  heading: string;
  facts: string[];
  meaning: string[];
}

function percent(value: number): string {
  if (!Number.isFinite(value)) return "–";
  return `${Math.round(Math.max(0, value) * 100)}%`;
}

/** How a parameter's Morris effect behaves, from the σ/μ* ratio. */
export function morrisShape(muStar: number, sigma: number): string {
  if (!Number.isFinite(muStar) || !Number.isFinite(sigma)) return "Not enough successful runs to judge.";
  if (muStar === 0) return "Changing it did not move the output at all.";
  const ratio = sigma / muStar;
  if (ratio < 0.1) return "Its effect is nearly linear: the output shifts by about the same amount wherever the other parameters sit.";
  if (ratio < 0.5) return "Its effect is monotonic: raising it always pushes the output the same way, by varying amounts.";
  if (ratio < 1) return "Its effect is mostly monotonic but changes size noticeably across the range.";
  return "Its effect is non-linear or depends on other parameters (an interaction): the same change can matter a lot in one place and little in another.";
}

export function readMorris(row: MorrisRow, rank: number, all: readonly MorrisRow[]): Reading {
  const top = Math.max(...all.map((r) => (Number.isFinite(r.muStar) ? r.muStar : 0)));
  const relative = top > 0 && Number.isFinite(row.muStar) ? row.muStar / top : Number.NaN;
  const meaning: string[] = [];

  if (rank === 1 && all.length > 1) meaning.push("The most influential parameter in this screen.");
  else if (Number.isFinite(relative) && relative < 0.05)
    meaning.push("Negligible next to the leader: a candidate to hold fixed in later analyses.");
  else if (Number.isFinite(relative))
    meaning.push(`About ${percent(relative)} as influential as the top parameter.`);

  meaning.push(morrisShape(row.muStar, row.sigma));

  if (Number.isFinite(row.mu) && Number.isFinite(row.muStar) && row.muStar > 0) {
    const agreement = Math.abs(row.mu) / row.muStar;
    if (agreement > 0.9)
      meaning.push(row.mu > 0 ? "Raising it increases the output." : "Raising it decreases the output.");
    else if (agreement < 0.5)
      meaning.push("The direction flips across the range: sometimes raising it increases the output, sometimes it decreases it.");
  }

  return {
    heading: `#${rank} ${row.name}`,
    facts: [
      `μ* = ${formatNumber(row.muStar)}  (average size of the effect)`,
      `μ = ${formatNumber(row.mu)}  (average signed effect)`,
      `σ = ${formatNumber(row.sigma)}  (spread of the effect)`,
    ],
    meaning,
  };
}

export function readSobol(row: SobolRow, rank: number): Reading {
  const meaning: string[] = [];
  const interaction = row.total - row.first;
  const firstWidth = row.firstCI[1] - row.firstCI[0];
  const totalWidth = row.totalCI[1] - row.totalCI[0];

  if (Number.isFinite(row.total) && row.total < 0.05) {
    meaning.push("Explains under 5% of the output variance even with interactions: it can usually be fixed at a nominal value.");
  } else if (Number.isFinite(row.first)) {
    meaning.push(`On its own it explains about ${percent(row.first)} of the output variance (S1).`);
    if (Number.isFinite(row.total))
      meaning.push(`Counting its interactions with the other parameters, about ${percent(row.total)} (ST).`);
  }

  if (Number.isFinite(interaction) && interaction > 0.1)
    meaning.push(`The ${percent(interaction)} gap between ST and S1 is interaction: its effect depends on the values of other parameters.`);

  if ((Number.isFinite(firstWidth) && firstWidth > 0.2) || (Number.isFinite(totalWidth) && totalWidth > 0.2))
    meaning.push("The confidence whiskers are wide, so treat this ranking as rough: raise Base samples and run again.");

  return {
    heading: `#${rank} ${row.name}`,
    facts: [
      `S1 = ${formatNumber(row.first)}  (95% CI ${formatNumber(row.firstCI[0])} to ${formatNumber(row.firstCI[1])})`,
      `ST = ${formatNumber(row.total)}  (95% CI ${formatNumber(row.totalCI[0])} to ${formatNumber(row.totalCI[1])})`,
    ],
    meaning,
  };
}

export interface BandPoint {
  p5: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p95: number | null;
}

/** One line per band at a hovered time. */
export function readBands(point: BandPoint): string[] {
  const f = (v: number | null): string => (v == null ? "–" : formatNumber(v));
  return [
    `Median ${f(point.median)}: half the runs are above, half below.`,
    `Middle 50% of runs: ${f(point.p25)} to ${f(point.p75)} (dark band).`,
    `Middle 90% of runs: ${f(point.p5)} to ${f(point.p95)} (light band).`,
  ];
}

// ----- sweeps ----------------------------------------------------------------

/** What a response-curve feature list says, as short sentences. */
export interface CurveReading {
  lines: string[];
  /** A narrower range worth sweeping next, if one stands out. */
  zoom?: { min: number; max: number; reason: string };
}

export interface CurveFeaturesLike {
  min: { at: number; value: number };
  max: { at: number; value: number };
  trend: "up" | "down" | "flat" | "mixed";
  steepest?: { from: number; to: number; fromValue: number; toValue: number; share: number };
  threshold: boolean;
  interior?: { kind: "peak" | "trough"; at: number; value: number };
  levelsOff?: { side: "high" | "low"; beyond: number };
}

export function readCurve(
  features: CurveFeaturesLike,
  parameter: string,
  metric: string,
  levels: readonly number[],
): CurveReading {
  const f = formatNumber;
  const lines: string[] = [];
  let zoom: CurveReading["zoom"];
  const first = levels[0];
  const last = levels[levels.length - 1];
  const around = (value: number): { min: number; max: number } => {
    const i = levels.findIndex((v) => v >= value);
    const lo = levels[Math.max(0, i - 1)] ?? first;
    const hi = levels[Math.min(levels.length - 1, i + 1)] ?? last;
    return { min: lo, max: hi };
  };

  if (features.trend === "flat") {
    lines.push(
      `${metric} hardly changes as ${parameter} goes from ${f(first)} to ${f(last)}. In this range ${parameter} does not matter; try a wider range or another parameter.`,
    );
    return { lines };
  }

  if (features.trend === "up" || features.trend === "down") {
    const verb = features.trend === "up" ? "rises" : "falls";
    const [a, b] = features.trend === "up" ? [features.min.value, features.max.value] : [features.max.value, features.min.value];
    lines.push(`${metric} ${verb} steadily as ${parameter} increases, from ${f(a)} to ${f(b)}.`);
  } else {
    lines.push(
      `${metric} ranges from ${f(features.min.value)} (at ${parameter} = ${f(features.min.at)}) to ${f(features.max.value)} (at ${parameter} = ${f(features.max.at)}), and changes direction along the way.`,
    );
  }

  if (features.interior) {
    const word = features.interior.kind === "peak" ? "highest" : "lowest";
    lines.push(
      `It is ${word} inside the range, at ${parameter} ≈ ${f(features.interior.at)} (${f(features.interior.value)}): an optimum or a worst case worth a closer look.`,
    );
    zoom = { ...around(features.interior.at), reason: `around the ${word} point` };
  }

  const steep = features.steepest;
  if (steep && features.threshold) {
    lines.push(
      `A threshold: between ${parameter} = ${f(steep.from)} and ${f(steep.to)} the output jumps from ${f(steep.fromValue)} to ${f(steep.toValue)}, ${Math.round(steep.share * 100)}% of the whole change in one step.`,
    );
    const i = levels.findIndex((v) => v >= steep.from);
    zoom = {
      min: levels[Math.max(0, i - 1)] ?? steep.from,
      max: levels[Math.min(levels.length - 1, i + 2)] ?? steep.to,
      reason: "across the threshold",
    };
  } else if (steep && steep.share > 0.15) {
    lines.push(`It is most sensitive between ${parameter} = ${f(steep.from)} and ${f(steep.to)}.`);
  }

  if (features.levelsOff) {
    lines.push(
      features.levelsOff.side === "high"
        ? `Above ${parameter} ≈ ${f(features.levelsOff.beyond)} it levels off: raising ${parameter} further buys almost nothing.`
        : `Below ${parameter} ≈ ${f(features.levelsOff.beyond)} it levels off: lowering ${parameter} further changes almost nothing.`,
    );
  }
  return { lines, zoom };
}

export interface SurfaceFeaturesLike {
  min: { at: [number, number]; value: number };
  max: { at: [number, number]; value: number };
  spread: [number, number];
  dominant: 0 | 1 | -1;
}

export function readSurface(features: SurfaceFeaturesLike, names: [string, string], metric: string): string[] {
  const f = formatNumber;
  const lines = [
    `${metric} is highest, ${f(features.max.value)}, at ${names[0]} = ${f(features.max.at[0])}, ${names[1]} = ${f(features.max.at[1])}.`,
    `It is lowest, ${f(features.min.value)}, at ${names[0]} = ${f(features.min.at[0])}, ${names[1]} = ${f(features.min.at[1])}.`,
  ];
  if (features.dominant === -1) {
    lines.push(`${names[0]} and ${names[1]} move the output by similar amounts over these ranges.`);
  } else {
    const strong = names[features.dominant];
    const weak = names[1 - features.dominant];
    const ratio = features.spread[features.dominant] / Math.max(features.spread[1 - features.dominant], 1e-300);
    lines.push(
      Number.isFinite(ratio) && ratio < 1000
        ? `${strong} matters more: it moves the output about ${f(ratio)}× as much as ${weak} does.`
        : `${strong} drives the output; ${weak} hardly moves it over this range.`,
    );
  }
  return lines;
}
