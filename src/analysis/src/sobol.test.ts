import { describe, expect, it } from "vitest";

import { sobolSequence } from "./sobol.js";

describe("sobolSequence", () => {
  it("reproduces the first published points in two dimensions", () => {
    const points = sobolSequence(4, 2);
    expect(points).toHaveLength(4);
    const expected = [
      [0.5, 0.5],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.375, 0.375],
    ];
    points.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(expected[i][0], 12);
      expect(p[1]).toBeCloseTo(expected[i][1], 12);
    });
  });

  it("includes the all-zero point when skip is zero", () => {
    const points = sobolSequence(2, 2, 0);
    expect(points[0]).toEqual([0, 0]);
    expect(points[1][0]).toBeCloseTo(0.5, 12);
    expect(points[1][1]).toBeCloseTo(0.5, 12);
  });

  it("returns n points in [0, 1)^dim for every supported dimension", () => {
    const points = sobolSequence(32, 21);
    expect(points).toHaveLength(32);
    for (const p of points) {
      expect(p).toHaveLength(21);
      for (const x of p) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(1);
      }
    }
  });

  it("covers at least 95% of a 16x16 grid with 256 points", () => {
    const points = sobolSequence(256, 2);
    const seen = new Set<string>();
    for (const [x, y] of points) {
      seen.add(`${Math.min(15, Math.floor(x * 16))},${Math.min(15, Math.floor(y * 16))}`);
    }
    expect(seen.size / 256).toBeGreaterThanOrEqual(0.95);
  });

  it("rejects an unsupported dimension", () => {
    expect(() => sobolSequence(4, 0)).toThrow(/dimension/);
    expect(() => sobolSequence(4, 22)).toThrow(/dimension/);
  });
});
