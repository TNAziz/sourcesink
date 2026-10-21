import { describe, expect, it } from "vitest";

import { chartSvg, logTicks, niceTicks, safeFileName } from "./exportChart";

describe("niceTicks", () => {
  it("picks round steps covering the range", () => {
    expect(niceTicks(0, 10, 6)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(0.13, 0.87, 5)).toEqual([0.2, 0.4, 0.6, 0.8]);
    expect(niceTicks(-3, 3, 7)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
  });

  it("pads a single value instead of failing", () => {
    expect(niceTicks(5, 5).length).toBeGreaterThan(1);
  });
});

describe("logTicks", () => {
  it("uses powers of ten over wide ranges and 1-2-5 over narrow ones", () => {
    expect(logTicks(0.1, 1000)).toEqual([0.1, 1, 10, 100, 1000]);
    expect(logTicks(1, 20)).toEqual([1, 2, 5, 10, 20]);
    expect(logTicks(0, 10)).toEqual([]);
  });
});

describe("chartSvg", () => {
  const spec = {
    title: "DO <sag> & recovery",
    x: [0, 1, 2, 3],
    xLabel: "day",
    series: [
      { name: "DO", color: "#5868e8", values: [7, 4, null, 8] },
      { name: "hidden", color: "#999", values: [1, 1, 1, 1], legend: false },
    ],
  };

  it("draws a standalone document with escaped text", () => {
    const svg = chartSvg(spec);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain("DO &lt;sag&gt; &amp; recovery");
    expect(svg).toContain(">day</text>");
  });

  it("breaks a line at gaps and leaves hidden series out of the legend", () => {
    const svg = chartSvg(spec);
    const doLines = svg.match(/<polyline [^>]*stroke="#5868e8"/g) ?? [];
    expect(doLines).toHaveLength(2);
    expect(svg).toContain(">DO</text>");
    expect(svg).not.toContain(">hidden</text>");
  });

  it("drops non-positive values on log axes and fills bands", () => {
    const svg = chartSvg({
      x: [1, 10, 100],
      xLog: true,
      yLog: true,
      series: [{ name: "y", color: "#000", values: [0, 1, 10] }],
      bands: [{ lower: [0.5, 0.5, 5], upper: [2, 2, 20], fill: "rgba(0,0,0,0.1)" }],
    });
    expect(svg).toContain("<polygon");
    const line = /<polyline points="([^"]+)"/.exec(svg)?.[1] ?? "";
    expect(line.split(" ")).toHaveLength(2);
  });
});

describe("safeFileName", () => {
  it("keeps letters, digits, dots and dashes", () => {
    expect(safeFileName("Streeter-Phelps: DO (min)")).toBe("Streeter-Phelps-DO-min");
    expect(safeFileName("  ")).toBe("chart");
  });
});
