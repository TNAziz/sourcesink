import { describe, expect, it } from "vitest";

import { canonicalName, parse } from "@sourcesink/engine";

import { inferUnits, type UnitEnv, type UnitResult } from "./infer.js";
import { isUnitParseError, parseUnit, type Unit } from "./unit.js";

function unit(text: string): Unit {
  const parsed = parseUnit(text);
  if (isUnitParseError(parsed)) throw new Error(parsed.error);
  return parsed;
}

function env(units: Record<string, string>, time = "day"): UnitEnv {
  const table: Record<string, Unit | undefined> = {};
  for (const [name, text] of Object.entries(units)) {
    table[canonicalName(name)] = text === "" ? undefined : unit(text);
  }
  return { units: table, time: unit(time) };
}

function infer(expression: string, e: UnitEnv): UnitResult {
  return inferUnits(parse(expression), e);
}

describe("inferUnits", () => {
  it("adds and subtracts values with the same units", () => {
    const e = env({ a: "mg/L", b: "mg/L" });
    const result = infer("a + b", e);
    expect(result.unit?.dims).toEqual({ mass: 1, length: -3 });
    expect(result.issues).toEqual([]);
  });

  it("lets a bare number match the other side of + or -", () => {
    const e = env({ a: "1/day" });
    expect(infer("a + 1", e).issues).toEqual([]);
    expect(infer("1 - a", e).issues).toEqual([]);
    expect(infer("a + 1", e).unit?.dims).toEqual({ time: -1 });
  });

  it("reports adding different dimensions", () => {
    const e = env({ a: "mg/L", b: "day" });
    const result = infer("a + b", e);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].message).toMatch(/cannot add/);
  });

  it("reports mixing scales within the same dimension and names the factor", () => {
    const e = env({ a: "mg", b: "g" });
    const result = infer("a + b", e);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].message).toMatch(/factor of 1000/);
  });

  it("multiplies and divides units", () => {
    const e = env({ a: "mg/L", b: "1/day", c: "m3" });
    expect(infer("a * b", e).unit?.dims).toEqual({ mass: 1, length: -3, time: -1 });
    expect(infer("c / a", e).unit?.dims).toEqual({ length: 6, mass: -1 });
  });

  it("raises units to a numeric literal exponent", () => {
    const e = env({ a: "m" });
    expect(infer("a^2", e).unit?.dims).toEqual({ length: 2 });
    expect(infer("a^-1", e).unit?.dims).toEqual({ length: -1 });
    expect(infer("a^b", e).unit).toBeUndefined();
  });

  it("requires IF branches to agree but lets a literal branch adopt the other", () => {
    const e = env({ a: "mg/L", b: "mg/L", c: "kg/L", flag: "dimensionless" });
    expect(infer("IF flag THEN a ELSE b", e).issues).toEqual([]);
    expect(infer("IF flag THEN a ELSE 0", e).issues).toEqual([]);
    expect(infer("IF flag THEN a ELSE c", e).issues).toHaveLength(1);
  });

  it("keeps units through MIN, MAX, ABS, ROUND and INT", () => {
    const e = env({ a: "mg/L", b: "mg/L", c: "kg/L" });
    expect(infer("MIN(a, b)", e).unit?.dims).toEqual({ mass: 1, length: -3 });
    expect(infer("MAX(a, b)", e).unit?.dims).toEqual({ mass: 1, length: -3 });
    expect(infer("ABS(a)", e).unit?.dims).toEqual({ mass: 1, length: -3 });
    expect(infer("ROUND(a)", e).unit?.dims).toEqual({ mass: 1, length: -3 });
    expect(infer("INT(a)", e).unit?.dims).toEqual({ mass: 1, length: -3 });
    expect(infer("MAX(a, c)", e).issues).toHaveLength(1);
  });

  it("requires dimensionless arguments for EXP, LN and trigonometrics", () => {
    const e = env({ a: "mg/L", b: "dimensionless" });
    expect(infer("EXP(a)", e).issues[0].message).toMatch(/dimensionless/);
    expect(infer("LN(b)", e).issues).toEqual([]);
    expect(infer("SIN(a)", e).issues[0].message).toMatch(/dimensionless/);
  });

  it("returns the first argument's units for smoothing and delays", () => {
    const e = env({ a: "mg/L", tau: "day", wrong: "1/day" });
    expect(infer("SMTH1(a, tau)", e).unit?.dims).toEqual({ mass: 1, length: -3 });
    expect(infer("SMTH3(a, tau)", e).unit?.dims).toEqual({ mass: 1, length: -3 });
    expect(infer("DELAY1(a, tau)", e).unit?.dims).toEqual({ mass: 1, length: -3 });
    expect(infer("DELAY3(a, tau)", e).unit?.dims).toEqual({ mass: 1, length: -3 });
    expect(infer("DELAYN(a, tau, 3)", e).unit?.dims).toEqual({ mass: 1, length: -3 });
    expect(infer("DELAY1(a, wrong)", e).issues[0].message).toMatch(/time argument/);
    expect(infer("DELAY1(a, 5)", e).issues).toEqual([]);
  });

  it("uses model time units for TIME and DT", () => {
    const e = env({}, "year");
    expect(infer("TIME", e).unit?.dims).toEqual({ time: 1 });
    expect(infer("DT", e).unit?.dims).toEqual({ time: 1 });
  });

  it("uses the height argument's units for STEP and PULSE, and per-time for RAMP", () => {
    const e = env({ a: "kg", t: "day" }, "day");
    expect(infer("STEP(a, t)", e).unit?.dims).toEqual({ mass: 1 });
    expect(infer("PULSE(a, t)", e).unit?.dims).toEqual({ mass: 1 });
    expect(infer("RAMP(a, t)", e).unit?.dims).toEqual({ mass: 1, time: -1 });
  });

  it("leaves graph functions and references without units unknown", () => {
    const e = env({ a: "mg/L", blank: "" });
    expect(infer("lookup(TIME)", e).unit).toBeUndefined();
    expect(infer("a + blank", e).unit).toBeUndefined();
    expect(infer("a + blank", e).issues).toEqual([]);
    expect(infer("missing * 2", e).unit).toBeUndefined();
  });

  it("marks literal-only equations as constant", () => {
    const e = env({});
    expect(infer("0.3", e).constant).toBe(true);
    expect(infer("LN(2) * 100", e).constant).toBe(true);
    expect(infer("TIME * 2", e).constant).toBe(false);
  });
});
