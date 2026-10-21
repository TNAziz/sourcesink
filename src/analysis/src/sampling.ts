/**
 * SourceSink — deterministic ensemble sampling designs.
 *
 * All samplers are pure functions of their inputs and seeds: the same
 * arguments always produce the same samples. Randomness comes from a local
 * mulberry32 generator; parameters are visited in `Object.keys` order, so
 * designs are stable across runs and platforms.
 */

import type { Overrides } from "./overrides.js";

/** mulberry32 PRNG: returns floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher-Yates shuffle driven by `rand`. */
function shuffle(values: number[], rand: () => number): number[] {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

/** Full factorial of the given levels.
 * `gridSamples({K: [0.1, 0.5], a: [1, 2]})` -> 4 samples. An empty level list
 * yields no samples; no parameters yields one empty sample. */
export function gridSamples(levels: Record<string, number[]>): Overrides[] {
  let combos: Overrides[] = [{}];
  for (const [name, values] of Object.entries(levels)) {
    const next: Overrides[] = [];
    for (const combo of combos) {
      for (const value of values) next.push({ ...combo, [name]: value });
    }
    combos = next;
  }
  return combos;
}

/** `n` independent uniform draws per parameter, all in [min, max). */
export function uniformSamples(
  ranges: Record<string, [number, number]>,
  n: number,
  seed = 0,
): Overrides[] {
  if (n <= 0) return [];
  const rand = mulberry32(seed);
  const names = Object.keys(ranges);
  const samples: Overrides[] = [];
  for (let i = 0; i < n; i += 1) {
    const sample: Overrides = {};
    for (const name of names) {
      const [lo, hi] = ranges[name];
      sample[name] = lo + (hi - lo) * rand();
    }
    samples.push(sample);
  }
  return samples;
}

/** Latin hypercube: `n` equal strata per parameter, one sample in each, the
 * strata order shuffled independently per parameter. */
export function latinHypercube(
  ranges: Record<string, [number, number]>,
  n: number,
  seed = 0,
): Overrides[] {
  if (n <= 0) return [];
  const rand = mulberry32(seed);
  const names = Object.keys(ranges);

  const strata = new Map<string, number[]>();
  for (const name of names) strata.set(name, shuffle(Array.from({ length: n }, (_, i) => i), rand));

  const samples: Overrides[] = [];
  for (let i = 0; i < n; i += 1) {
    const sample: Overrides = {};
    for (const name of names) {
      const [lo, hi] = ranges[name];
      sample[name] = lo + ((strata.get(name)![i] + rand()) / n) * (hi - lo);
    }
    samples.push(sample);
  }
  return samples;
}
