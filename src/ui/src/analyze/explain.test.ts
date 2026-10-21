import { describe, expect, it } from "vitest";

import { morrisShape, readBands, readMorris, readSobol } from "./explain";

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
