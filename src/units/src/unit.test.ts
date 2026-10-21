import { describe, expect, it } from "vitest";

import {
  formatUnit,
  isUnitParseError,
  parseUnit,
  unitsEqual,
  type Unit,
  type UnitParseError,
} from "./unit.js";

function unit(text: string): Unit {
  const parsed = parseUnit(text);
  if (isUnitParseError(parsed)) throw new Error(`unexpected parse error: ${parsed.error}`);
  return parsed;
}

function error(text: string): UnitParseError {
  const parsed = parseUnit(text);
  if (!isUnitParseError(parsed)) throw new Error(`expected a parse error for '${text}'`);
  return parsed;
}

describe("parseUnit", () => {
  it("parses a concentration", () => {
    const u = unit("mg/L");
    expect(u.dims).toEqual({ mass: 1, length: -3 });
    expect(u.scale).toBeCloseTo(1, 12);
    expect(u.display).toEqual({ mg: 1, L: -1 });
  });

  it("parses rates, reciprocal time and exponents written with or without ^", () => {
    expect(unit("1/day").dims).toEqual({ time: -1 });
    expect(unit("m^3/s").dims).toEqual({ length: 3, time: -1 });
    expect(unitsEqual(unit("m^3/s"), unit("m3/s"))).toBe(true);
    expect(unit("m-2").dims).toEqual({ length: -2 });
    expect(unit("kg m-2").dims).toEqual({ mass: 1, length: -2 });
  });

  it("is case-insensitive for time aliases", () => {
    expect(unitsEqual(unit("tonnes/Year"), unit("tonne/yr"))).toBe(true);
    expect(unitsEqual(unit("1/hour"), unit("1/hr"))).toBe(true);
  });

  it("treats dimensionless spellings alike", () => {
    for (const text of ["", "1", "dimensionless", "unitless"]) {
      expect(parseUnit(text)).toEqual({ dims: {}, scale: 1, display: {} });
    }
  });

  it("parses percent as a scaled dimensionless quantity", () => {
    const percent = unit("%");
    expect(percent.dims).toEqual({});
    expect(percent.scale).toBeCloseTo(0.01, 12);
    expect(unitsEqual(percent, unit("dimensionless"))).toBe(true);
    expect(unit("percent").scale).toBeCloseTo(0.01, 12);
  });

  it("keeps unknown words as their own symbols and folds simple plurals", () => {
    expect(unit("people").dims).toEqual({ people: 1 });
    expect(unitsEqual(unit("persons"), unit("person"))).toBe(true);
    expect(unitsEqual(unit("people"), unit("person"))).toBe(false);
    expect(unitsEqual(unit("fish"), unit("fish"))).toBe(true);
  });

  it("treats descriptors after a unit as annotations, not extra dimensions", () => {
    const yieldUnit = unit("mg biomass / mg BOD");
    expect(yieldUnit.dims).toEqual({});
    expect(unit("mg O2 / mg algae / day").dims).toEqual({ time: -1 });
    expect(unit("kg N / ha / cm").dims).toEqual({ mass: 1, ha: -1, length: -1 });
  });

  it("compares dimensions while ignoring scale", () => {
    expect(unitsEqual(unit("mg"), unit("kg"))).toBe(true);
    expect(unitsEqual(unit("L"), unit("m3"))).toBe(true);
    expect(unitsEqual(unit("mg/L"), unit("g/L"))).toBe(true);
    expect(unitsEqual(unit("mg/L"), unit("mg/kg"))).toBe(false);
  });

  it("formats parsed units", () => {
    expect(formatUnit(unit("mg/L"))).toBe("mg/L");
    expect(formatUnit(unit("1/day"))).toBe("1/day");
    expect(formatUnit(unit("m^3/s"))).toBe("m^3/s");
    expect(formatUnit(unit("dimensionless"))).toBe("dimensionless");
  });

  it.each(["mg//L", "kg/", "m^", "3/day", "mg + L", "m 2"])(
    "returns an error for the malformed unit %s",
    (text) => {
      const result = error(text);
      expect(result.error.length).toBeGreaterThan(0);
      expect(result.text).toBe(text);
    },
  );
});
