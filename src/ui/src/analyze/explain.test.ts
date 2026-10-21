import { describe, expect, it } from "vitest";

import { morrisShape, readBands, readCurve, readMorris, readSobol, readSurface } from "./explain";

describe("morrisShape", () => {
  it("classifies effects by the sigma / mu* ratio", () => {
    expect(morrisShape(1, 0.05)).toMatch(/linear/);
    expect(morrisShape(1, 0.3)).toMatch(/^Its effect is monotonic/);
    expect(morrisShape(1, 0.8)).toMatch(/mostly monotonic/);
    expect(morrisShape(1, 1.5)).toMatch(/interaction/);
  });

  it("handles zero and missing effects", () => {
    expect(morrisShape(0, 0)).toMatch(/did not move/);
    expect(morrisShape(Number.NaN, 1)).toMatch(/Not enough/);
  });
});

describe("readMorris", () => {
  const rows = [
    { name: "ka", mu: -2, muStar: 2, sigma: 0.1 },
    { name: "kd", mu: 0.2, muStar: 1, sigma: 1.2 },
    { name: "DO_sat", mu: 0.01, muStar: 0.01, sigma: 0 },
  ];

  it("flags the leader, its direction and the facts", () => {
    const reading = readMorris(rows[0], 1, rows);
    expect(reading.heading).toBe("#1 ka");
    expect(reading.meaning[0]).toMatch(/most influential/);
    expect(reading.meaning.join(" ")).toMatch(/decreases the output/);
    expect(reading.facts[0]).toContain("μ* = 2");
  });

  it("reports relative size and a direction that flips", () => {
    const reading = readMorris(rows[1], 2, rows);
    expect(reading.meaning[0]).toMatch(/About 50% as influential/);
    expect(reading.meaning.join(" ")).toMatch(/direction flips/);
  });

  it("marks negligible parameters as candidates to fix", () => {
    expect(readMorris(rows[2], 3, rows).meaning[0]).toMatch(/Negligible/);
  });
});

describe("readSobol", () => {
  it("explains shares, interactions and wide intervals", () => {
    const reading = readSobol({ name: "kd", first: 0.4, total: 0.7, firstCI: [0.1, 0.6], totalCI: [0.6, 0.8] }, 1);
    const text = reading.meaning.join(" ");
    expect(text).toContain("about 40% of the output variance");
    expect(text).toContain("about 70% (ST)");
    expect(text).toMatch(/30% gap between ST and S1 is interaction/);
    expect(text).toMatch(/whiskers are wide/);
  });

  it("calls tiny total effects fixable", () => {
    const reading = readSobol({ name: "x", first: 0.01, total: 0.02, firstCI: [0, 0.02], totalCI: [0.01, 0.03] }, 3);
    expect(reading.meaning).toHaveLength(1);
    expect(reading.meaning[0]).toMatch(/can usually be fixed/);
  });
});

describe("readBands", () => {
  it("reads the median and both bands", () => {
    const lines = readBands({ p5: 1, p25: 2, median: 3, p75: 4, p95: 5 });
    expect(lines[0]).toContain("Median 3");
    expect(lines[1]).toContain("2 to 4");
    expect(lines[2]).toContain("1 to 5");
  });
});

describe("readCurve", () => {
  const levels = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];

  it("describes a threshold and offers to zoom across it", () => {
    const reading = readCurve(
      {
        min: { at: 0.6, value: 5 },
        max: { at: 0.1, value: 250 },
        trend: "down",
        steepest: { from: 0.2, to: 0.3, fromValue: 240, toValue: 20, share: 0.9 },
        threshold: true,
        levelsOff: { side: "high", beyond: 0.4 },
      },
      "SRT",
      "S · final value",
      levels,
    );
    const text = reading.lines.join(" ");
    expect(text).toContain("S · final value falls steadily");
    expect(text).toContain("A threshold: between SRT = 0.2 and 0.3");
    expect(text).toContain("90% of the whole change");
    expect(text).toContain("Above SRT ≈ 0.4 it levels off");
    expect(reading.zoom).toEqual({ min: 0.1, max: 0.4, reason: "across the threshold" });
  });

  it("calls a flat response irrelevant and suggests a wider range", () => {
    const reading = readCurve(
      { min: { at: 0.1, value: 1 }, max: { at: 0.1, value: 1 }, trend: "flat", threshold: false },
      "k",
      "y",
      levels,
    );
    expect(reading.lines[0]).toMatch(/does not matter; try a wider range/);
    expect(reading.zoom).toBeUndefined();
  });

  it("points at an interior optimum", () => {
    const reading = readCurve(
      {
        min: { at: 0.1, value: 1 },
        max: { at: 0.3, value: 9 },
        trend: "mixed",
        threshold: false,
        interior: { kind: "peak", at: 0.3, value: 9 },
      },
      "k",
      "y",
      levels,
    );
    expect(reading.lines.join(" ")).toContain("highest inside the range, at k ≈ 0.3");
    expect(reading.zoom).toEqual({ min: 0.2, max: 0.4, reason: "around the highest point" });
  });
});

describe("readSurface", () => {
  it("names the extremes and the dominant parameter", () => {
    const lines = readSurface(
      { min: { at: [1, 2], value: 0 }, max: { at: [3, 4], value: 10 }, spread: [8, 2], dominant: 0 },
      ["SRT", "HRT"],
      "S",
    );
    expect(lines[0]).toContain("highest, 10, at SRT = 3, HRT = 4");
    expect(lines[2]).toContain("SRT matters more: it moves the output about 4× as much as HRT");
  });
});
