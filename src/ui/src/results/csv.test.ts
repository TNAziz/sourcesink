import { describe, expect, it } from "vitest";
import { csvFileName, formatNumber, toCsv } from "./csv";

describe("formatNumber", () => {
  it("rounds to 4 significant digits", () => {
    expect(formatNumber(1234)).toBe("1234");
    expect(formatNumber(1234.5)).toBe("1235");
    expect(formatNumber(1.23456)).toBe("1.235");
    expect(formatNumber(0.123456)).toBe("0.1235");
    expect(formatNumber(-42.42)).toBe("-42.42");
  });

  it("trims trailing zeros", () => {
    expect(formatNumber(100)).toBe("100");
    expect(formatNumber(1.2)).toBe("1.2");
    expect(formatNumber(0.1)).toBe("0.1");
    expect(formatNumber(0.0001)).toBe("0.0001");
  });

  it("switches to exponential form for extremes", () => {
    expect(formatNumber(1e-7)).toBe("1.000e-7");
    expect(formatNumber(2.5e13)).toBe("2.500e+13");
  });

  it("handles zero and non-finite values", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(NaN)).toBe("NaN");
    expect(formatNumber(Infinity)).toBe("Infinity");
    expect(formatNumber(-Infinity)).toBe("-Infinity");
  });
});

describe("toCsv", () => {
  const result = {
    time: [0, 0.5, 1],
    series: { a: [1, 2.5, -3], b: [0.1, 0.2, 0.3] },
  };

  it("writes the time column first and full precision values", () => {
    expect(toCsv(result, ["a", "b"])).toBe(
      "time,a,b\r\n0,1,0.1\r\n0.5,2.5,0.2\r\n1,-3,0.3",
    );
  });

  it("follows the requested column order", () => {
    expect(toCsv(result, ["b", "a"]).split("\r\n")[0]).toBe("time,b,a");
  });

  it("drops requested columns that have no data", () => {
    const csv = toCsv(result, ["a", "ghost"]);
    expect(csv.split("\r\n")[0]).toBe("time,a");
    expect(csv.split("\r\n")).toHaveLength(4);
  });

  it("quotes fields containing commas, quotes or newlines", () => {
    const weird = {
      time: [0],
      series: { "x,y": [1], 'say "hi"': [2], "line\nbreak": [3] },
    };
    expect(toCsv(weird, ["x,y", 'say "hi"', "line\nbreak"])).toBe(
      'time,"x,y","say ""hi""","line\nbreak"\r\n0,1,2,3',
    );
  });

  it("emits just the header for an empty run", () => {
    expect(toCsv({ time: [], series: { a: [] } }, ["a"])).toBe("time,a");
  });
});

describe("csvFileName", () => {
  it("appends -results.csv to the model name", () => {
    expect(csvFileName("Deer Population")).toBe("Deer Population-results.csv");
  });

  it("replaces characters that are invalid in file names", () => {
    expect(csvFileName('a/b:c*d?"e<f>g|h')).toBe("a-b-c-d-e-f-g-h-results.csv");
  });

  it("falls back to a generic name when empty", () => {
    expect(csvFileName("   ")).toBe("model-results.csv");
  });
});
