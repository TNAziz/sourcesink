import { describe, expect, it } from "vitest";

import { gridSamples, latinHypercube, uniformSamples } from "./sampling.js";

/** Index of the equal stratum a value falls in: [lo, hi) split into n bins. */
function stratum(value: number, lo: number, hi: number, n: number): number {
  return Math.floor(((value - lo) / (hi - lo)) * n);
}

describe("gridSamples", () => {
  it("returns the full factorial", () => {
    const samples = gridSamples({ K: [0.1, 0.5], a: [1, 2] });
    expect(samples).toHaveLength(4);
    expect(samples).toEqual(
      expect.arrayContaining([
        { K: 0.1, a: 1 },
        { K: 0.1, a: 2 },
        { K: 0.5, a: 1 },
        { K: 0.5, a: 2 },
      ]),
    );
  });

  it("returns one empty sample for no parameters", () => {
    expect(gridSamples({})).toEqual([{}]);
  });

  it("returns no samples when a level list is empty", () => {
    expect(gridSamples({ K: [] })).toEqual([]);
  });
});

describe("uniformSamples", () => {
  it("draws n values inside each range", () => {
    const samples = uniformSamples({ K: [0, 1], a: [-5, 5] }, 20, 3);
    expect(samples).toHaveLength(20);
    for (const s of samples) {
      expect(Number(s.K)).toBeGreaterThanOrEqual(0);
      expect(Number(s.K)).toBeLessThan(1);
      expect(Number(s.a)).toBeGreaterThanOrEqual(-5);
      expect(Number(s.a)).toBeLessThan(5);
    }
  });

  it("is deterministic per seed", () => {
    expect(uniformSamples({ K: [0, 1] }, 5, 42)).toEqual(uniformSamples({ K: [0, 1] }, 5, 42));
    expect(uniformSamples({ K: [0, 1] }, 5, 42)).not.toEqual(uniformSamples({ K: [0, 1] }, 5, 43));
  });

  it("returns no samples for n <= 0", () => {
    expect(uniformSamples({ K: [0, 1] }, 0)).toEqual([]);
    expect(uniformSamples({ K: [0, 1] }, -2)).toEqual([]);
  });
});

describe("latinHypercube", () => {
  const ranges: Record<string, [number, number]> = { K: [0, 1], a: [-5, 5] };

  it("places exactly one sample in every stratum of every parameter", () => {
    const n = 10;
    const samples = latinHypercube(ranges, n, 5);
    expect(samples).toHaveLength(n);
    for (const [name, [lo, hi]] of Object.entries(ranges)) {
      const bins = samples.map((s) => stratum(Number(s[name]), lo, hi, n));
      expect([...bins].sort((x, y) => x - y)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it("stays inside the ranges", () => {
    for (const s of latinHypercube(ranges, 7, 11)) {
      expect(Number(s.K)).toBeGreaterThanOrEqual(0);
      expect(Number(s.K)).toBeLessThan(1);
      expect(Number(s.a)).toBeGreaterThanOrEqual(-5);
      expect(Number(s.a)).toBeLessThan(5);
    }
  });

  it("is deterministic per seed", () => {
    expect(latinHypercube(ranges, 6, 9)).toEqual(latinHypercube(ranges, 6, 9));
    expect(latinHypercube(ranges, 6, 9)).not.toEqual(latinHypercube(ranges, 6, 10));
  });

  it("returns no samples for n <= 0", () => {
    expect(latinHypercube(ranges, 0)).toEqual([]);
  });
});
