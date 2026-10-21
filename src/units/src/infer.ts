/**
 * SourceSink — static unit inference for equations.
 *
 * The checker is intentionally forgiving: a reference whose element has no
 * units (or a graphical function) makes the result unknown, and unknown
 * propagates without producing a finding. This mirrors real models, where
 * units are often left blank.
 */

import { canonicalName, lookupBuiltin, type Expr } from "@sourcesink/engine";

import {
  formatUnit,
  isDimensionless,
  unitsEqual,
  type Unit,
} from "./unit.js";

/** What `inferUnits` needs to know about the model around an expression. */
export interface UnitEnv {
  /** Units keyed by canonical element name (see `canonicalName`). */
  units: Record<string, Unit | undefined>;
  /** Model time unit; used for TIME, DT and delay/smoothing arguments. */
  time?: Unit;
  /** Names of graphical (lookup) functions; their output units are unknown. */
  graphFunctions?: readonly string[];
}

/** One inconsistency found inside an expression. */
export interface UnitIssue {
  message: string;
  expected?: string;
  actual?: string;
}

export interface UnitResult {
  /** The inferred unit; absent when the expression references an element
   * whose units are unknown. */
  unit?: Unit;
  issues: UnitIssue[];
  /** The expression has no unit-bearing references, so its declared units win
   * (e.g. a converter whose equation is just "0.3"). */
  constant: boolean;
  /** A numeric literal appears somewhere; conversion factors are often written
   * as literals, so scale-only differences are not reported for such values. */
  hasLiteral: boolean;
}

const CLOCK_VARIABLES = new Set([
  "TIME",
  "DT",
  "STARTTIME",
  "STOPTIME",
  "INITIAL_TIME",
  "FINAL_TIME",
]);

const DIMENSIONLESS_FUNCTIONS = new Set(["EXP", "LN", "LOGN", "LOG10", "SIN", "COS", "TAN", "ARCTAN"]);
const PRESERVE_FUNCTIONS = new Set(["ABS", "ROUND", "INT", "INTEGER"]);
const SMOOTH_FUNCTIONS = new Set(["SMTH1", "SMTH3", "SMTHN", "SMTH", "DELAY1", "DELAY3", "DELAY", "DELAYN"]);

function dimensionless(): Unit {
  return { dims: {}, scale: 1, display: {} };
}

function merge(
  a: Record<string, number>,
  b: Record<string, number>,
  sign: number,
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const next = (out[key] ?? 0) + sign * value;
    if (Math.abs(next) < 1e-12) delete out[key];
    else out[key] = next;
  }
  return out;
}

function multiply(a: Unit, b: Unit): Unit {
  return {
    dims: merge(a.dims, b.dims, 1),
    scale: a.scale * b.scale,
    display: merge(a.display, b.display, 1),
  };
}

function divide(a: Unit, b: Unit): Unit {
  return {
    dims: merge(a.dims, b.dims, -1),
    scale: a.scale / b.scale,
    display: merge(a.display, b.display, -1),
  };
}

function power(a: Unit, exponent: number): Unit {
  const dims: Record<string, number> = {};
  for (const [key, value] of Object.entries(a.dims)) {
    const next = value * exponent;
    if (Math.abs(next) > 1e-12) dims[key] = next;
  }
  const display: Record<string, number> = {};
  for (const [key, value] of Object.entries(a.display)) {
    const next = value * exponent;
    if (Math.abs(next) > 1e-12) display[key] = next;
  }
  return { dims, scale: Math.pow(a.scale, exponent), display };
}

/** Numeric factor between two same-dimension units (always >= 1). */
function scaleFactor(a: Unit, b: Unit): number {
  const ratio = a.scale / b.scale;
  return ratio >= 1 ? ratio : 1 / ratio;
}

function formatFactor(factor: number): string {
  if (Number.isInteger(factor)) return String(factor);
  return String(Number(factor.toPrecision(6)));
}

function mismatchIssue(a: Unit, b: Unit, verb: string): UnitIssue {
  const message = isDimensionless(a) || isDimensionless(b)
    ? `cannot ${verb} ${formatUnit(a)} and ${formatUnit(b)}`
    : `cannot ${verb} ${formatUnit(a)} and ${formatUnit(b)} (different dimensions)`;
  return { message, expected: formatUnit(a), actual: formatUnit(b) };
}

function scaleIssue(a: Unit, b: Unit, verb: string): UnitIssue {
  const factor = formatFactor(scaleFactor(a, b));
  return {
    message: `cannot ${verb} ${formatUnit(a)} and ${formatUnit(b)}: they differ by a factor of ${factor}`,
    expected: formatUnit(a),
    actual: formatUnit(b),
  };
}

function sameDimensions(a: Unit, b: Unit): boolean {
  return unitsEqual(a, b);
}

function freeLiteral(r: UnitResult): boolean {
  return r.constant && (r.unit === undefined || isDimensionless(r.unit));
}

function result(unit: Unit | undefined, constant: boolean, hasLiteral: boolean, issues: UnitIssue[]): UnitResult {
  return unit === undefined ? { issues, constant, hasLiteral } : { unit, issues, constant, hasLiteral };
}

function numericLiteral(expr: Expr): number | undefined {
  if (expr.type === "number") return expr.value;
  if (expr.type === "unary" && (expr.op === "neg" || expr.op === "pos")) {
    const inner = numericLiteral(expr.operand);
    if (inner !== undefined) return expr.op === "neg" ? -inner : inner;
  }
  return undefined;
}

function timeArgumentIssue(
  label: string,
  arg: UnitResult,
  env: UnitEnv,
): UnitIssue | undefined {
  if (env.time === undefined || arg.unit === undefined || freeLiteral(arg)) return undefined;
  if (unitsEqual(arg.unit, env.time)) return undefined;
  return {
    message: `${label} needs a time argument, but got ${formatUnit(arg.unit)}`,
    expected: formatUnit(env.time),
    actual: formatUnit(arg.unit),
  };
}

function infer(expr: Expr, env: UnitEnv): UnitResult {
  switch (expr.type) {
    case "number":
      return result(dimensionless(), true, true, []);

    case "ident": {
      const upper = expr.name.toUpperCase();
      if (CLOCK_VARIABLES.has(upper)) {
        return result(env.time, false, false, []);
      }
      if (upper === "PI") return result(dimensionless(), true, true, []);
      const unit = env.units[canonicalName(expr.name)];
      return result(unit, false, false, []);
    }

    case "unary": {
      const inner = infer(expr.operand, env);
      if (expr.op === "not") {
        return result(dimensionless(), inner.constant, inner.hasLiteral, inner.issues);
      }
      return result(inner.unit, inner.constant, inner.hasLiteral, inner.issues);
    }

    case "binary": {
      const left = infer(expr.left, env);
      const right = infer(expr.right, env);
      const issues = [...left.issues, ...right.issues];
      const constant = left.constant && right.constant;
      const hasLiteral = left.hasLiteral || right.hasLiteral;
      const op = expr.op;

      if (op === "and" || op === "or") {
        return result(dimensionless(), constant, hasLiteral, issues);
      }

      if (op === "<" || op === "<=" || op === ">" || op === ">=" || op === "=" || op === "==" || op === "<>" || op === "!=") {
        if (left.unit !== undefined && right.unit !== undefined) {
          if (!freeLiteral(left) && !freeLiteral(right)) {
            if (!sameDimensions(left.unit, right.unit)) {
              issues.push(mismatchIssue(left.unit, right.unit, "compare"));
            } else if (!isDimensionless(left.unit) && Math.abs(left.unit.scale - right.unit.scale) > 1e-12) {
              issues.push(scaleIssue(left.unit, right.unit, "compare"));
            }
          }
        }
        return result(dimensionless(), constant, hasLiteral, issues);
      }

      if (op === "+" || op === "-") {
        if (left.unit === undefined || right.unit === undefined) {
          return result(undefined, constant, hasLiteral, issues);
        }
        if (freeLiteral(left) && freeLiteral(right)) {
          return result(dimensionless(), constant, hasLiteral, issues);
        }
        if (freeLiteral(left)) return result(right.unit, constant, hasLiteral, issues);
        if (freeLiteral(right)) return result(left.unit, constant, hasLiteral, issues);

        if (!sameDimensions(left.unit, right.unit)) {
          issues.push(mismatchIssue(left.unit, right.unit, op === "+" ? "add" : "subtract"));
        } else if (!isDimensionless(left.unit) && Math.abs(left.unit.scale - right.unit.scale) > 1e-12) {
          issues.push(scaleIssue(left.unit, right.unit, op === "+" ? "add" : "subtract"));
        }
        return result(left.unit, constant, hasLiteral, issues);
      }

      if (op === "*" || op === "/") {
        if (left.unit === undefined || right.unit === undefined) {
          return result(undefined, constant, hasLiteral, issues);
        }
        return result(op === "*" ? multiply(left.unit, right.unit) : divide(left.unit, right.unit), constant, hasLiteral, issues);
      }

      // "^": only a literal exponent lets us infer the result.
      if (op === "^") {
        const exponent = numericLiteral(expr.right);
        if (exponent === undefined || left.unit === undefined) {
          return result(undefined, constant, hasLiteral, issues);
        }
        return result(power(left.unit, exponent), constant, hasLiteral, issues);
      }

      return result(undefined, constant, hasLiteral, issues);
    }

    case "if": {
      const cond = infer(expr.cond, env);
      const then = infer(expr.then, env);
      const els = infer(expr.els, env);
      const issues = [...cond.issues, ...then.issues, ...els.issues];
      const constant = cond.constant && then.constant && els.constant;
      const hasLiteral = cond.hasLiteral || then.hasLiteral || els.hasLiteral;

      if (then.unit === undefined || els.unit === undefined) {
        return result(undefined, constant, hasLiteral, issues);
      }
      if (freeLiteral(then) && freeLiteral(els)) {
        return result(dimensionless(), constant, hasLiteral, issues);
      }
      if (freeLiteral(then)) return result(els.unit, constant, hasLiteral, issues);
      if (freeLiteral(els)) return result(then.unit, constant, hasLiteral, issues);
      if (!sameDimensions(then.unit, els.unit)) {
        issues.push(mismatchIssue(then.unit, els.unit, "choose between"));
      } else if (!isDimensionless(then.unit) && Math.abs(then.unit.scale - els.unit.scale) > 1e-12) {
        issues.push(scaleIssue(then.unit, els.unit, "choose between"));
      }
      return result(then.unit, constant, hasLiteral, issues);
    }

    case "call": {
      const name = expr.name.toUpperCase();
      const args = expr.args.map((arg) => infer(arg, env));
      const issues = args.flatMap((arg) => arg.issues);
      const constant = args.every((arg) => arg.constant);
      const hasLiteral = args.some((arg) => arg.hasLiteral);

      const graph = (env.graphFunctions ?? []).some((f) => canonicalName(f) === canonicalName(expr.name));
      if (graph || lookupBuiltin(name) === undefined) {
        return result(undefined, constant, hasLiteral, issues);
      }

      if (name === "MIN" || name === "MAX") {
        if (args.some((arg) => arg.unit === undefined)) {
          return result(undefined, constant, hasLiteral, issues);
        }
        const first = args[0].unit!;
        for (const arg of args.slice(1)) {
          if (!sameDimensions(first, arg.unit!)) {
            issues.push(mismatchIssue(first, arg.unit!, `pass to ${name}`));
          } else if (!isDimensionless(first) && Math.abs(first.scale - arg.unit!.scale) > 1e-12) {
            issues.push(scaleIssue(first, arg.unit!, `pass to ${name}`));
          }
        }
        return result(first, constant, hasLiteral, issues);
      }

      if (PRESERVE_FUNCTIONS.has(name)) {
        return result(args[0]?.unit, constant, hasLiteral, issues);
      }

      if (DIMENSIONLESS_FUNCTIONS.has(name)) {
        const arg = args[0]?.unit;
        if (arg !== undefined && !isDimensionless(arg)) {
          issues.push({
            message: `${name} needs a dimensionless argument, but got ${formatUnit(arg)}`,
            expected: "dimensionless",
            actual: formatUnit(arg),
          });
        }
        return result(dimensionless(), constant, hasLiteral, issues);
      }

      if (name === "SQRT") {
        return result(args[0]?.unit === undefined ? undefined : power(args[0].unit, 0.5), constant, hasLiteral, issues);
      }

      if (name === "POWER") {
        const exponent = numericLiteral(expr.args[1]);
        if (exponent === undefined || args[0]?.unit === undefined) {
          return result(undefined, constant, hasLiteral, issues);
        }
        return result(power(args[0].unit, exponent), constant, hasLiteral, issues);
      }

      if (SMOOTH_FUNCTIONS.has(name)) {
        const delay = timeArgumentIssue(`the second argument of ${name}`, args[1], env);
        if (delay) issues.push(delay);
        return result(args[0]?.unit, constant, hasLiteral, issues);
      }

      if (name === "STEP" || name === "PULSE") {
        return result(args[0]?.unit, constant, hasLiteral, issues);
      }

      if (name === "RAMP") {
        if (args[0]?.unit === undefined || env.time === undefined) {
          return result(undefined, constant, hasLiteral, issues);
        }
        return result(divide(args[0].unit, env.time), constant, hasLiteral, issues);
      }

      // Other built-ins (random draws, financial functions, …): unknown.
      return result(undefined, constant, hasLiteral, issues);
    }
  }
}

/** Infer the units of an expression from the units of the elements it reads. */
export function inferUnits(expr: Expr, env: UnitEnv): UnitResult {
  return infer(expr, env);
}
