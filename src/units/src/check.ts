/**
 * SourceSink — whole-model unit checking.
 *
 * Findings are advisory: many real models leave units blank, and a blank unit
 * is treated as "unknown" rather than wrong. The checks cover flow rates,
 * stock initial values, declared-vs-inferred equation units, and inconsistent
 * operands inside an expression.
 */

import { canonicalName, parse, type Expr } from "@sourcesink/engine";
import type { Converter, Flow, Model, Stock } from "@sourcesink/model";

import { inferUnits, type UnitEnv } from "./infer.js";
import { formatUnit, isDimensionless, isUnitParseError, parseUnit, unitsEqual, type Unit } from "./unit.js";

export interface UnitFinding {
  element: string;
  message: string;
  expected?: string;
  actual?: string;
}

interface Parsed {
  unit?: Unit;
  raw?: string;
}

function parseDeclared(raw: string | undefined): Parsed | string {
  if (raw === undefined || raw.trim() === "") return {};
  const parsed = parseUnit(raw);
  return isUnitParseError(parsed) ? parsed.error : { unit: parsed, raw: raw.trim() };
}

function isError(value: Parsed | string): value is string {
  return typeof value === "string";
}

function factorBetween(a: Unit, b: Unit): number {
  const ratio = a.scale / b.scale;
  return ratio >= 1 ? ratio : 1 / ratio;
}

function formatFactor(factor: number): string {
  if (Number.isInteger(factor)) return String(factor);
  return String(Number(factor.toPrecision(6)));
}

function buildEnv(model: Model, parsed: Map<string, Parsed>): UnitEnv {
  const units: Record<string, Unit | undefined> = {};
  for (const [name, entry] of parsed) units[canonicalName(name)] = entry.unit;
  const run = parseDeclared(model.run.timeUnits);
  const time = !isError(run) ? run.unit : undefined;
  return {
    units,
    ...(time === undefined ? {} : { time }),
    graphFunctions: model.graphFunctions.map((g) => g.name),
  };
}

function inferEquation(equation: string, env: UnitEnv): ReturnType<typeof inferUnits> | undefined {
  if (equation.trim() === "") return undefined;
  let expr: Expr;
  try {
    expr = parse(equation);
  } catch {
    return undefined;
  }
  return inferUnits(expr, env);
}

function equationFindings(
  name: string,
  equation: string,
  declared: Parsed,
  env: UnitEnv,
  kind: "stock" | "flow" | "converter",
): UnitFinding[] {
  const result = inferEquation(equation, env);
  if (result === undefined) return [];
  const findings: UnitFinding[] = result.issues.map((issue) => ({
    element: name,
    message: issue.message,
    ...(issue.expected === undefined ? {} : { expected: issue.expected }),
    ...(issue.actual === undefined ? {} : { actual: issue.actual }),
  }));

  if (declared.unit === undefined || result.constant || result.unit === undefined) return findings;

  const actual = result.unit;
  const declaredText = declared.raw ?? formatUnit(declared.unit);
  const actualText = formatUnit(actual);
  if (!unitsEqual(declared.unit, actual)) {
    findings.push({
      element: name,
      message:
        kind === "stock"
          ? `${name} is in ${declaredText}, but its initial equation gives ${actualText}`
          : `${name} is in ${declaredText}, but its equation gives ${actualText}`,
      expected: declaredText,
      actual: actualText,
    });
  } else if (!isDimensionless(declared.unit) && Math.abs(declared.unit.scale - actual.scale) > 1e-12 && !result.hasLiteral) {
    const factor = formatFactor(factorBetween(declared.unit, actual));
    findings.push({
      element: name,
      message: `${name} is in ${declaredText}, but its equation gives ${actualText}; the values differ by a factor of ${factor}`,
      expected: declaredText,
      actual: actualText,
    });
  }
  return findings;
}

function flowMatches(flow: Flow, ref: string): boolean {
  return ref === flow.id || canonicalName(ref) === canonicalName(flow.name);
}

function connectionFindings(
  flow: Flow,
  stocks: Stock[],
  parsed: Map<string, Parsed>,
  time: Unit | undefined,
  timeLabel: string | undefined,
): UnitFinding[] {
  const declared = parsed.get(flow.name);
  if (declared?.unit === undefined || time === undefined) return [];
  const findings: UnitFinding[] = [];

  for (const stock of stocks) {
    const stockEntry = parsed.get(stock.name);
    if (stockEntry?.unit === undefined) continue;
    const expected: Unit = {
      dims: { ...stockEntry.unit.dims },
      scale: stockEntry.unit.scale / time.scale,
      display: { ...stockEntry.unit.display },
    };
    for (const [key, value] of Object.entries(time.display)) {
      const next = (expected.display[key] ?? 0) - value;
      if (Math.abs(next) < 1e-12) delete expected.display[key];
      else expected.display[key] = next;
    }
    for (const [key, value] of Object.entries(time.dims)) {
      const next = (expected.dims[key] ?? 0) - value;
      if (Math.abs(next) < 1e-12) delete expected.dims[key];
      else expected.dims[key] = next;
    }

    const verb = (stock.outflows ?? []).some((ref) => flowMatches(flow, ref)) ? "drains" : "fills";
    const declaredText = declared.raw ?? formatUnit(declared.unit);
    const stockText = stockEntry.raw ?? formatUnit(stockEntry.unit);
    const expectedText = formatUnit(expected);
    const per = timeLabel ? ` per ${timeLabel}` : "";

    if (!unitsEqual(declared.unit, expected)) {
      findings.push({
        element: flow.name,
        message: `${flow.name} is in ${declaredText}, but it ${verb} ${stock.name} (${stockText})${per}, so it should be ${expectedText}`,
        expected: expectedText,
        actual: declaredText,
      });
    } else if (!isDimensionless(declared.unit) && Math.abs(declared.unit.scale - expected.scale) > 1e-12) {
      const factor = formatFactor(factorBetween(declared.unit, expected));
      findings.push({
        element: flow.name,
        message: `${flow.name} is in ${declaredText}, but it ${verb} ${stock.name} (${stockText})${per}, so it should be ${expectedText}; the values differ by a factor of ${factor}`,
        expected: expectedText,
        actual: declaredText,
      });
    }
  }
  return findings;
}

/** Check every unit-bearing equation and flow connection in a model. Returns
 * warnings only; it never throws on unparseable equations or units. */
export function checkUnits(model: Model): UnitFinding[] {
  const findings: UnitFinding[] = [];
  const parsed = new Map<string, Parsed>();

  const time = parseDeclared(model.run.timeUnits);
  if (isError(time)) {
    findings.push({
      element: "run",
      message: `run time units '${model.run.timeUnits}' are invalid: ${time}`,
      actual: model.run.timeUnits,
    });
  }

  const elements: (Stock | Flow | Converter)[] = [
    ...model.stocks,
    ...model.flows,
    ...model.converters,
  ];
  for (const element of elements) {
    const entry = parseDeclared(element.units);
    if (isError(entry)) {
      findings.push({
        element: element.name,
        message: `${element.name} has invalid units '${element.units}': ${entry}`,
        actual: element.units,
      });
      parsed.set(element.name, { raw: element.units?.trim() });
    } else {
      parsed.set(element.name, entry);
    }
  }

  const env = buildEnv(model, parsed);
  const timeUnit = isError(time) ? undefined : time.unit;
  const timeLabel = model.run.timeUnits?.trim() || undefined;

  for (const stock of model.stocks) {
    const declared = parsed.get(stock.name)!;
    findings.push(...equationFindings(stock.name, stock.equation, declared, env, "stock"));
  }
  for (const flow of model.flows) {
    const declared = parsed.get(flow.name)!;
    findings.push(...equationFindings(flow.name, flow.equation, declared, env, "flow"));
  }
  for (const converter of model.converters) {
    const declared = parsed.get(converter.name)!;
    findings.push(...equationFindings(converter.name, converter.equation, declared, env, "converter"));
  }

  const seen = new Set<string>();
  for (const flow of model.flows) {
    const connected = model.stocks.filter(
      (stock) =>
        (stock.inflows ?? []).some((ref) => flowMatches(flow, ref)) ||
        (stock.outflows ?? []).some((ref) => flowMatches(flow, ref)),
    );
    for (const finding of connectionFindings(flow, connected, parsed, timeUnit, timeLabel)) {
      const key = `${finding.element}\u0000${finding.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(finding);
    }
  }

  return findings;
}
