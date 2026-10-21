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
