/**
 * SourceSink — CLI argument parsing helpers.
 *
 * Everything here is a pure function of its string arguments so the CLI's
 * grammar (`--param K=0.1:1.0:10`, `--set "growth rate=0.1"`, …) can be unit
 * tested without spawning a process. User mistakes raise `ArgError`, which
 * `run.ts` turns into a one-line stderr message and exit code 2.
 */

import type { Overrides } from "@sourcesink/analysis";
import { canonicalName } from "@sourcesink/engine";
import type { Model, Scenario } from "@sourcesink/model";

/** A problem with the command line (reported as one line, exit code 2). */
export class ArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgError";
  }
}

/** Which flags consume a following value and which are bare switches. */
export interface FlagSpec {
  values?: string[];
  booleans?: string[];
}

export interface ParsedFlags {
  /** Non-flag arguments, in order. */
  positional: string[];
  /** Flag values, keyed by flag name (repeatable flags keep every value). */
  values: Record<string, string[]>;
  booleans: Set<string>;
}

/** Split `args` into positionals and flags, rejecting unknown or malformed
 * options. `--name=value` and `--name value` are both accepted. */
export function parseFlags(args: string[], spec: FlagSpec): ParsedFlags {
  const valueNames = new Set(spec.values ?? []);
  const boolNames = new Set(spec.booleans ?? []);
  const positional: string[] = [];
  const values: Record<string, string[]> = {};
  const booleans = new Set<string>();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);

    if (valueNames.has(name)) {
      const next = eq >= 0 ? arg.slice(eq + 1) : args[++i];
      if (next === undefined || next.startsWith("--")) {
        throw new ArgError(`option '--${name}' needs a value`);
      }
      (values[name] ??= []).push(next);
    } else if (boolNames.has(name)) {
      if (eq >= 0) throw new ArgError(`option '--${name}' takes no value`);
      booleans.add(name);
    } else {
      throw new ArgError(`unknown option '--${name}'`);
    }
  }

  return { positional, values, booleans };
}

/** The last value given for a flag (repeatable flags: last wins). */
export function lastValue(flags: ParsedFlags, name: string): string | undefined {
  const all = flags.values[name];
  return all && all.length > 0 ? all[all.length - 1] : undefined;
}

/** Split `NAME=VALUE`; both sides must be non-empty. */
function assignment(arg: string, label: string): { name: string; spec: string } {
  const eq = arg.indexOf("=");
  if (eq < 0) throw new ArgError(`bad ${label} '${arg}': expected NAME=VALUE`);
  const name = arg.slice(0, eq).trim();
  const spec = arg.slice(eq + 1).trim();
  if (!name) throw new ArgError(`bad ${label} '${arg}': element name is empty`);
  if (!spec) throw new ArgError(`bad ${label} '${arg}': value is empty`);
  return { name, spec };
}

/** Parse one numeric token, naming the whole argument in the error. */
function number(token: string, label: string, whole: string): number {
  const text = token.trim();
  const value = Number(text);
  if (text === "" || !Number.isFinite(value)) {
    throw new ArgError(`bad ${label} '${whole}': '${text}' is not a number`);
  }
  return value;
}

/** `K=0.1:1.0:3` -> three evenly spaced levels including both ends;
 * `a=1,2,4` -> exactly those values. */
export function parseParam(arg: string): { name: string; values: number[] } {
  const { name, spec } = assignment(arg, "--param");
  if (!spec.includes(":")) {
    const parts = spec.split(",");
    const values = parts.map((p) => number(p, "--param", arg));
    return { name, values };
  }

  const parts = spec.split(":");
  if (parts.length !== 3) {
    throw new ArgError(`bad --param '${arg}': expected NAME=LO:HI:COUNT or NAME=a,b,c`);
  }
  const lo = number(parts[0], "--param", arg);
  const hi = number(parts[1], "--param", arg);
  const count = number(parts[2], "--param", arg);
  if (!Number.isInteger(count) || count < 2) {
    throw new ArgError(`bad --param '${arg}': the count must be an integer >= 2`);
  }
  if (hi < lo) throw new ArgError(`bad --param '${arg}': HI must be >= LO`);
  const values = Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));
  return { name, values };
}

/** `K=0.1:1.0` -> a sampling range [0.1, 1.0]. */
export function parseRangeParam(arg: string): { name: string; range: [number, number] } {
  const { name, spec } = assignment(arg, "--param");
  const parts = spec.split(":");
  if (parts.length !== 2) {
    throw new ArgError(`bad --param '${arg}': expected NAME=MIN:MAX`);
  }
  const lo = number(parts[0], "--param", arg);
  const hi = number(parts[1], "--param", arg);
  if (!(hi > lo)) throw new ArgError(`bad --param '${arg}': expected MIN < MAX`);
  return { name, range: [lo, hi] };
}

/** `NAME=VALUE` -> a one-entry override. A numeric right side becomes a
 * number; anything else stays an equation string. */
export function parseSet(arg: string): Overrides {
  const { name, spec } = assignment(arg, "--set");
  const value = Number(spec);
  return { [name]: Number.isFinite(value) ? value : spec };
}

/** Comma-separated element names; bracketed array subscripts may contain
 * commas, so a comma followed by `]` does not split. */
export function parseColumns(arg: string): string[] {
  return arg
    .split(/,(?![^[]*\])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Comma-separated percentiles in [0, 100]. */
export function parsePercentiles(arg: string): number[] {
  const parts = arg.split(",");
  if (parts.some((p) => p.trim() === "")) {
    throw new ArgError(`bad --percentiles '${arg}': expected a comma-separated list`);
  }
  return parts.map((p) => {
    const value = number(p, "--percentiles", arg);
    if (value < 0 || value > 100) {
      throw new ArgError(`bad --percentiles '${arg}': percentiles must be within 0..100`);
    }
    return value;
  });
}

/** Find a scenario by id or name (case-insensitive, spaces ≡ underscores). */
export function findScenario(model: Model, ref: string): Scenario {
  const want = canonicalName(ref);
  const found = (model.scenarios ?? []).find(
    (s) =>
      s.id === ref ||
      s.name === ref ||
      canonicalName(s.id) === want ||
      canonicalName(s.name) === want,
  );
  if (!found) throw new ArgError(`unknown scenario '${ref}'`);
  return found;
}

/** A positive integer (number of Monte Carlo runs). */
export function parseRuns(arg: string): number {
  const value = Number(arg);
  if (arg.trim() === "" || !Number.isInteger(value) || value < 1) {
    throw new ArgError(`bad --runs '${arg}': expected a positive integer`);
  }
  return value;
}

/** An integer seed (negative values are allowed and wrapped by the PRNG). */
export function parseSeed(arg: string): number {
  const value = Number(arg);
  if (arg.trim() === "" || !Number.isInteger(value)) {
    throw new ArgError(`bad --seed '${arg}': expected an integer`);
  }
  return value;
}
