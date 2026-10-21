import { describe, expect, it } from "vitest";

import { emptyModel } from "@sourcesink/model";

import {
  ArgError,
  findScenario,
  lastValue,
  parseColumns,
  parseFlags,
  parseParam,
  parsePercentiles,
  parseRangeParam,
  parseRuns,
  parseSeed,
  parseSet,
} from "./args.js";

describe("parseParam", () => {
  it("expands NAME=LO:HI:COUNT into evenly spaced levels including both ends", () => {
    const param = parseParam("K=0.1:1.0:3");
    expect(param.name).toBe("K");
    expect(param.values).toHaveLength(3);
    expect(param.values[0]).toBeCloseTo(0.1, 12);
    expect(param.values[1]).toBeCloseTo(0.55, 12);
    expect(param.values[2]).toBeCloseTo(1.0, 12);
  });

  it("accepts an explicit comma-separated list", () => {
    expect(parseParam("a=1,2,4")).toEqual({ name: "a", values: [1, 2, 4] });
  });

  it("accepts a single explicit value", () => {
    expect(parseParam("K=0.5")).toEqual({ name: "K", values: [0.5] });
  });

  it("keeps negative bounds", () => {
    expect(parseParam("x=-1:1:3").values).toEqual([-1, 0, 1]);
  });

  it.each([
    "K",
    "=1",
    "K=",
    "K=1:2",
    "K=1:2:3:4",
    "K=1:2:1",
    "K=1:2:2.5",
    "K=1:x:3",
    "K=1,,2",
    "K=2:1:3",
  ])("throws for the bad form %s", (arg) => {
    expect(() => parseParam(arg)).toThrow(ArgError);
  });
});

describe("parseRangeParam", () => {
  it("parses NAME=MIN:MAX", () => {
    expect(parseRangeParam("K=0.1:1.0")).toEqual({ name: "K", range: [0.1, 1.0] });
  });

  it.each(["K", "K=", "K=0.1", "K=1:0.1", "K=a:b", "K=1:2:3"])("throws for %s", (arg) => {
    expect(() => parseRangeParam(arg)).toThrow(ArgError);
  });
});

describe("parseSet", () => {
  it("converts a numeric right side to a number", () => {
    expect(parseSet("growth rate=0.1")).toEqual({ "growth rate": 0.1 });
  });

  it("keeps a non-numeric right side as an equation string", () => {
    expect(parseSet("K=S * 2")).toEqual({ K: "S * 2" });
  });

  it.each(["K", "=1", "K="])("throws for %s", (arg) => {
    expect(() => parseSet(arg)).toThrow(ArgError);
  });
});

describe("parsePercentiles", () => {
  it("parses a comma-separated list", () => {
    expect(parsePercentiles("5,50,95")).toEqual([5, 50, 95]);
  });

  it.each(["", "5,,95", "5,101", "5,-1", "a"])("throws for %s", (arg) => {
    expect(() => parsePercentiles(arg)).toThrow(ArgError);
  });
});

describe("parseColumns", () => {
  it("splits plain names", () => {
    expect(parseColumns("S,T")).toEqual(["S", "T"]);
  });

  it("does not split a comma inside array subscripts", () => {
    expect(parseColumns("Prey[North,Deer],T")).toEqual(["Prey[North,Deer]", "T"]);
  });
});

describe("parseFlags", () => {
  const spec = { values: ["columns", "set"], booleans: ["json"] };

  it("separates positionals, values and switches", () => {
    const flags = parseFlags(["m.xmile", "--json", "--columns", "S,T", "--set", "K=1"], spec);
    expect(flags.positional).toEqual(["m.xmile"]);
    expect(flags.booleans.has("json")).toBe(true);
    expect(flags.values.columns).toEqual(["S,T"]);
    expect(flags.values.set).toEqual(["K=1"]);
    expect(lastValue(flags, "columns")).toBe("S,T");
  });

  it("accepts --name=value and repeated flags", () => {
    const flags = parseFlags(["--set=a=1", "--set", "b=2"], spec);
    expect(flags.values.set).toEqual(["a=1", "b=2"]);
  });

  it("rejects unknown options, missing values and valued switches", () => {
    expect(() => parseFlags(["--nope"], spec)).toThrow(ArgError);
    expect(() => parseFlags(["--columns"], spec)).toThrow(/needs a value/);
    expect(() => parseFlags(["--columns", "--json"], spec)).toThrow(/needs a value/);
    expect(() => parseFlags(["--json=1"], spec)).toThrow(/takes no value/);
  });
});

describe("findScenario", () => {
  const model = emptyModel("scenarios");
  model.scenarios = [
    { id: "s1", name: "Fast growth", overrides: { K: 0.2 } },
    { id: "s2", name: "slow", overrides: {} },
  ];

  it("matches by id or name, case-insensitively with spaces ≡ underscores", () => {
    expect(findScenario(model, "s1").id).toBe("s1");
    expect(findScenario(model, "slow").id).toBe("s2");
    expect(findScenario(model, "FAST GROWTH").id).toBe("s1");
    expect(findScenario(model, "fast_growth").id).toBe("s1");
  });

  it("throws a clear error for an unknown scenario", () => {
    expect(() => findScenario(model, "nope")).toThrow("unknown scenario 'nope'");
  });
});

describe("numeric flags", () => {
  it("parses runs and seeds", () => {
    expect(parseRuns("200")).toBe(200);
    expect(parseSeed("-3")).toBe(-3);
    expect(parseSeed("0")).toBe(0);
  });

  it("rejects non-integers and bad runs", () => {
    expect(() => parseRuns("0")).toThrow(ArgError);
    expect(() => parseRuns("2.5")).toThrow(ArgError);
    expect(() => parseSeed("x")).toThrow(ArgError);
  });
});
