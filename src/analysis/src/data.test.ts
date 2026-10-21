import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { fitMetrics, objective, parseCsv, toCsv } from "./data.js";
import type { Alignment } from "./contracts.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const alignment = (
  series: string,
  observed: number[],
  simulated: number[],
): Alignment => ({ series, time: observed.map((_, i) => i), observed, simulated });

describe("parseCsv", () => {
  it("parses a comma-separated file with a Time header", () => {
    const data = parseCsv("Time,S\n0,10\n1,20\n2,30\n");
    expect(data).toEqual({ time: [0, 1, 2], series: { S: [10, 20, 30] } });
  });

  it("auto-detects semicolon and tab delimiters", () => {
    expect(parseCsv("t;S\n0;1\n1;2\n").series.S).toEqual([1, 2]);
    expect(parseCsv("t\tS\n0\t1\n1\t2\n").series.S).toEqual([1, 2]);
  });

  it("prefers the delimiter that is most frequent on the header line", () => {
    const data = parseCsv('t,"a;b"\n0,1\n');
    expect(data.series["a;b"]).toEqual([1]);
  });

  it("handles a quoted header with doubled quotes and quoted fields", () => {
    const data = parseCsv('Time,"S ""net""",V\n0,"1","2.5"\n1,"2.5",3\n');
    expect(data.series['S "net"']).toEqual([1, 2.5]);
    expect(data.series.V).toEqual([2.5, 3]);
  });

  it("strips a UTF-8 BOM and accepts CRLF line ends and blank lines", () => {
    const data = parseCsv("\uFEFFTime,S\r\n\r\n0,1\r\n1,2\r\n\r\n");
    expect(data).toEqual({ time: [0, 1], series: { S: [1, 2] } });
  });

  it("reads missing-value markers and blank cells as NaN", () => {
    const data = parseCsv("t,S\n0,NA\n1,\n2,NaN\n3,#N/A\n4,-\n5,n/a\n");
    expect(data.series.S.every((v) => Number.isNaN(v))).toBe(true);
  });

  it("renames headers and keeps only requested columns", () => {
    const data = parseCsv("Time,DO (mg/L),Temp\n0,8,12\n1,7,13\n", {
      rename: { "DO (mg/L)": "DO" },
      columns: ["DO"],
    });
    expect(data).toEqual({ time: [0, 1], series: { DO: [8, 7] } });
  });

  it("converts ISO dates to days since the first date", () => {
    const data = parseCsv("Date,S\n2024-05-01,1\n2024-05-03,2\n2024-05-04,3\n");
    expect(data.time).toEqual([0, 2, 3]);
  });

  it("uses a time column named by the caller", () => {
    const data = parseCsv("step,S\n5,1\n10,2\n", { timeColumn: "step" });
    expect(data.time).toEqual([5, 10]);
  });

  it("throws with the line number for a non-numeric time", () => {
    expect(() => parseCsv("t,S\n0,1\nsoon,2\n")).toThrow(/line 3/);
  });

  it("throws with the line number for a non-numeric cell", () => {
    expect(() => parseCsv("t,S\n0,1\n1,high\n")).toThrow(/line 3.*'S'.*'high'/);
  });

  it("throws when time does not strictly increase", () => {
    expect(() => parseCsv("t,S\n0,1\n2,2\n2,3\n")).toThrow(/line 4.*strictly increasing/);
  });

  it("throws when dates and numbers are mixed in the time column", () => {
    expect(() => parseCsv("t,S\n2024-05-01,1\n2,2\n")).toThrow(/mix/);
  });

  it("throws for ragged rows and unknown columns", () => {
    expect(() => parseCsv("t,S\n0,1,extra\n")).toThrow(/line 2: expected 2 columns/);
    expect(() => parseCsv("t,S\n0,1\n", { columns: ["Q"] })).toThrow(/'Q'/);
    expect(() => parseCsv("t,S\n0,1\n", { timeColumn: "when" })).toThrow(/'when'/);
  });

  it("reads the fixture", () => {
    const data = parseCsv(fixture("daily-do.csv"));
    expect(data.time).toEqual([0, 1, 3]);
    expect(data.series["DO (mg/L)"]).toEqual([8.4, 8.1, 7.6]);
  });
});

describe("fitMetrics", () => {
  it("computes n, sse, rmse, nse, r2 and bias on a hand-computable case", () => {
    const metrics = fitMetrics(alignment("S", [1, 2, 3, 4], [1, 2, 3, 5]));
    expect(metrics.n).toBe(4);
    expect(metrics.sse).toBe(1);
    expect(metrics.rmse).toBe(0.5);
    expect(metrics.nse).toBeCloseTo(0.8, 12);
    expect(metrics.r2).toBeCloseTo(42.25 / 43.75, 12);
    expect(metrics.bias).toBe(0.25);
  });

  it("gives NSE and R² of 1 for a perfect fit", () => {
    const metrics = fitMetrics(alignment("S", [1, 2, 3], [1, 2, 3]));
    expect(metrics).toMatchObject({ n: 3, sse: 0, rmse: 0, nse: 1, r2: 1, bias: 0 });
  });

  it("gives NaN NSE for constant observations", () => {
    const metrics = fitMetrics(alignment("S", [2, 2, 2], [1, 2, 3]));
    expect(metrics.nse).toBeNaN();
    expect(metrics.r2).toBeNaN();
  });

  it("drops NaN pairs and reports an empty alignment as n = 0 with NaN elsewhere", () => {
    const metrics = fitMetrics(alignment("S", [1, Number.NaN], [2, 3]));
    expect(metrics.n).toBe(1);
    expect(metrics.sse).toBe(1);

    const empty = fitMetrics(alignment("S", [], []));
    expect(empty).toEqual({
      n: 0,
      sse: Number.NaN,
      rmse: Number.NaN,
      nse: Number.NaN,
      r2: Number.NaN,
      bias: Number.NaN,
    });
  });
});

describe("objective", () => {
  // Same shape in different units: identical SSE, but series B is scaled 100×.
  const a = alignment("a", [1, 2, 3], [1, 2, 4]);
  const b = alignment("b", [100, 200, 300], [100, 200, 310]);

  it("sums squared errors", () => {
    expect(objective([a, b], "sse")).toBeCloseTo(101, 12);
  });

  it("weights WSSE by observed variance so units stop mattering", () => {
    // var(a) = 2/3, var(b) = 20000/3 -> 1.5 + 0.015
    expect(objective([a, b], "wsse")).toBeCloseTo(1.515, 12);
  });

  it("sums 1 − NSE", () => {
    expect(objective([a, b], "nse")).toBeCloseTo(0.505, 12);
  });

  it("applies per-series weights", () => {
    expect(objective([a, b], "sse", { a: 2 })).toBeCloseTo(102, 12);
    expect(objective([a, b], "wsse", { a: 2 })).toBeCloseTo(3.015, 12);
    expect(objective([a, b], "nse", { a: 2 })).toBeCloseTo(1.005, 12);
  });

  it("skips series without paired points and returns Infinity when there are none", () => {
    const empty = alignment("e", [], []);
    expect(objective([a, empty], "sse")).toBeCloseTo(1, 12);
    expect(objective([], "sse")).toBe(Number.POSITIVE_INFINITY);
    expect(objective([empty], "wsse")).toBe(Number.POSITIVE_INFINITY);
    expect(objective([empty], "nse")).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("toCsv", () => {
  it("writes a header and one row per time step", () => {
    const text = toCsv({ time: [0, 1], series: { S: [1, Number.NaN] } });
    expect(text).toBe("Time,S\n0,1\n1,\n");
  });

  it("quotes fields that need it", () => {
    const text = toCsv({ time: [0], series: { 'a,b': [1], 'say "hi"': [2], " padded ": [3] } });
    expect(text).toBe('Time,"a,b","say ""hi"""," padded "\n0,1,2,3\n');
  });

  it("round-trips through parseCsv", () => {
    const data = {
      time: [0, 1, 2.5],
      series: { S: [1, Number.NaN, 3], "DO (mg/L)": [8, 7, 6] },
    };
    expect(parseCsv(toCsv(data))).toEqual(data);
  });
});
