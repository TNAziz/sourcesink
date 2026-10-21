/**
 * SourceSink — unit parsing and comparison.
 *
 * Units are deliberately lightweight: a unit is a map of base symbols to
 * exponents plus a scale factor relative to the dimension's base unit. The
 * parser accepts the spellings people actually type in SD models ("mg/L",
 * "1/day", "m3/s", "kg m-2", "tonnes/Year", "people", "%"), and anything it
 * does not recognise becomes its own base symbol so models with domain-specific
 * units ("fish", "dollars") still work.
 */

/** A parsed unit. Exponents are rational in principle; ordinary model units
 * use integers (or 0.5 from a square root). */
export interface Unit {
  /** Canonical base dimension -> exponent, e.g. { mass: 1, length: -3 }. */
  dims: Record<string, number>;
  /** Multiplier to the dimension's base unit (e.g. mg -> 0.001 g). */
  scale: number;
  /** Surface symbols, for human-readable formatting (e.g. { mg: 1, L: -1 }). */
  display: Record<string, number>;
}

export interface UnitParseError {
  error: string;
  text: string;
  position?: number;
}

export function isUnitParseError(value: Unit | UnitParseError): value is UnitParseError {
  return "error" in value;
}

interface Known {
  /** Canonical dimension, or null for dimensionless. */
  dim: string | null;
  /** Exponent of this symbol in its canonical dimension (L -> length^3). */
  power: number;
  scale: number;
  /** Preferred display spelling. */
  display: string;
}

const ALIASES: Record<string, Known> = {};

function alias(names: string[], known: Known): void {
  for (const name of names) ALIASES[name] = known;
}

/* Time: the base is the second. */
alias(["s", "sec", "second"], { dim: "time", power: 1, scale: 1, display: "s" });
alias(["min", "minute"], { dim: "time", power: 1, scale: 60, display: "min" });
alias(["h", "hr", "hour", "hrs"], { dim: "time", power: 1, scale: 3600, display: "h" });
alias(["d", "day"], { dim: "time", power: 1, scale: 86400, display: "day" });
alias(["wk", "week", "wks"], { dim: "time", power: 1, scale: 604800, display: "week" });
alias(["mo", "month", "mos"], { dim: "time", power: 1, scale: 2629800, display: "month" });
alias(["yr", "year", "yrs", "a"], { dim: "time", power: 1, scale: 31557600, display: "year" });

/* Mass: the base is the gram. */
alias(["mg"], { dim: "mass", power: 1, scale: 1e-3, display: "mg" });
alias(["g"], { dim: "mass", power: 1, scale: 1, display: "g" });
alias(["kg"], { dim: "mass", power: 1, scale: 1e3, display: "kg" });
alias(["tonne", "t"], { dim: "mass", power: 1, scale: 1e6, display: "tonne" });

/* Length: the base is the metre. */
alias(["mm"], { dim: "length", power: 1, scale: 1e-3, display: "mm" });
alias(["cm"], { dim: "length", power: 1, scale: 1e-2, display: "cm" });
alias(["m"], { dim: "length", power: 1, scale: 1, display: "m" });
alias(["km"], { dim: "length", power: 1, scale: 1e3, display: "km" });

/* Volume is length cubed, so litres and cubic metres compare directly. */
alias(["l", "liter", "litre"], { dim: "length", power: 3, scale: 1e-3, display: "L" });
alias(["ml"], { dim: "length", power: 3, scale: 1e-6, display: "mL" });

/* Percent is a scaled dimensionless quantity. */
alias(["%", "percent", "pct"], { dim: null, power: 1, scale: 1e-2, display: "%" });

const DIMENSIONLESS_WORDS = new Set(["dimensionless", "unitless", "dmnl", "1"]);

/** Strip a plural "s" from unknown words. "person" and "people" stay distinct
 * on purpose: guessing synonyms is out of scope. */
function normalizeWord(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
}

function blankUnit(): Unit {
  return { dims: {}, scale: 1, display: {} };
}

function addExponent(map: Record<string, number>, key: string, exponent: number): void {
  const next = (map[key] ?? 0) + exponent;
  if (Math.abs(next) < 1e-12) delete map[key];
  else map[key] = next;
}

function fail(text: string, position: number, error: string): UnitParseError {
  return { error, text, position };
}

/** Read an exponent after a symbol: `^3`, `^-0.5`, `3`, `-2`. */
function readExponent(src: string, start: number): { exponent: number; next: number } {
  let i = start;
  let explicit = false;
  if (src[i] === "^") {
    explicit = true;
    i += 1;
  }
  const numberStart = i;
  if (src[i] === "+" || src[i] === "-") i += 1;
  while (i < src.length && /[0-9]/.test(src[i])) i += 1;
  if (src[i] === ".") {
    i += 1;
    while (i < src.length && /[0-9]/.test(src[i])) i += 1;
  }
  if (i === numberStart || (i === numberStart + 1 && /[+-]/.test(src[numberStart]))) {
    return { exponent: explicit ? Number.NaN : 1, next: numberStart };
  }
  return { exponent: Number(src.slice(numberStart, i)), next: i };
}

/**
 * Parse a unit string. An empty string, `1` and `dimensionless` are
 * dimensionless. Malformed syntax returns a `UnitParseError` rather than
 * throwing, because unit checking is advisory.
 */
export function parseUnit(text: string): Unit | UnitParseError {
  const src = text.trim();
  if (src.length === 0) return blankUnit();

  const dims: Record<string, number> = {};
  const display: Record<string, number> = {};
  let scale = 1;
  let sign = 1;
  let last: { displayKey: string; exponent: number } | null = null;
  let expectFactor = false;
  let i = 0;

  while (i < src.length) {
    let hadSpace = false;
    while (i < src.length && /\s/.test(src[i])) {
      hadSpace = true;
      i += 1;
    }
    if (i >= src.length) break;

    const c = src[i];
    if (c === "/" || c === "*" || c === "·") {
      if (expectFactor) {
        return fail(src, i, `expected a unit before '${c}'`);
      }
      sign = c === "/" ? -1 : 1;
      expectFactor = true;
      last = null;
      i += 1;
      continue;
    }

    let symbol: string;
    let exponent: number;
    let known: Known | undefined;
    let unknown = false;

    if (c === "%") {
      symbol = "%";
      exponent = 1;
      known = ALIASES["%"];
      i += 1;
    } else if (/[A-Za-z]/.test(c)) {
      const wordStart = i;
      let j = i;
      while (j < src.length && /[A-Za-z]/.test(src[j])) j += 1;
      const raw = src.slice(wordStart, j);
      const normalized = normalizeWord(raw);
      known = ALIASES[normalized];

      // "mg O2", "kg N", "mg biomass": an unknown word after a known unit is
      // a descriptor, not another factor. "kg m-2" stays a product because
      // "m" is known.
      if (known === undefined && last !== null && hadSpace) {
        let k = j;
        while (k < src.length && /[A-Za-z0-9]/.test(src[k])) k += 1;
        const after = src[k] ?? "";
        const signedExponent = (/[+-]/.test(after) && /[0-9]/.test(src[k + 1] ?? "")) || after === "^";
        if (!signedExponent) {
          const descriptor = src.slice(wordStart, k);
          const key = `${last.displayKey} ${descriptor}`.trim();
          addExponent(display, last.displayKey, -last.exponent);
          addExponent(display, key, last.exponent);
          last.displayKey = key;
          i = k;
          expectFactor = false;
          continue;
        }
      }

      i = j;
      const read = readExponent(src, i);
      if (Number.isNaN(read.exponent)) {
        return fail(src, i, "expected an exponent after '^'");
      }
      exponent = read.exponent;
      i = read.next;

      if (known === undefined) {
        unknown = true;
        symbol = normalized;
        if (DIMENSIONLESS_WORDS.has(symbol)) {
          known = { dim: null, power: 1, scale: 1, display: "" };
        }
      } else {
        symbol = known.display;
      }
    } else if (c === "1") {
      if (i + 1 < src.length && /[0-9.]/.test(src[i + 1])) {
        return fail(src, i, "a bare number is not a unit (write '1' for dimensionless)");
      }
      i += 1;
      known = { dim: null, power: 1, scale: 1, display: "" };
      symbol = "";
      exponent = 1;
    } else {
      return fail(src, i, `unexpected character '${c}'`);
    }

    const signed = sign * exponent;
    if (known && known.dim !== null) {
      addExponent(dims, known.dim, signed * known.power);
      if (known.display) addExponent(display, symbol, signed);
      scale *= Math.pow(known.scale, signed);
    } else if (known && known.dim === null) {
      if (known.display) addExponent(display, symbol, signed);
      if (known.scale !== 1) scale *= Math.pow(known.scale, signed);
    } else if (unknown) {
      addExponent(dims, symbol, signed);
      addExponent(display, symbol, signed);
    }

    last = symbol ? { displayKey: symbol, exponent: signed } : null;
    sign = 1;
    expectFactor = false;
  }

  if (expectFactor) return fail(src, src.length, "expected a unit after the operator");
  return { dims, scale, display };
}

/** Compare the physical dimensions of two units, ignoring scale (mg and kg
 * are the same kind of quantity). */
export function unitsEqual(a: Unit, b: Unit): boolean {
  const keys = new Set([...Object.keys(a.dims), ...Object.keys(b.dims)]);
  for (const key of keys) {
    const left = a.dims[key] ?? 0;
    const right = b.dims[key] ?? 0;
    if (Math.abs(left - right) > 1e-9) return false;
  }
  return true;
}

/** True when the unit has no base dimensions (scale is ignored). */
export function isDimensionless(u: Unit): boolean {
  return Object.keys(u.dims).length === 0;
}

function formatExponent(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(6)));
}

function formatTerm(symbol: string, exponent: number): string {
  return exponent === 1 ? symbol : `${symbol}^${formatExponent(exponent)}`;
}

/** Render a unit in the conventional numerator/denominator form. */
export function formatUnit(u: Unit): string {
  const positive: string[] = [];
  const negative: string[] = [];
  for (const [symbol, exponent] of Object.entries(u.display)) {
    if (Math.abs(exponent) < 1e-12) continue;
    if (exponent > 0) positive.push(formatTerm(symbol, exponent));
    else negative.push(formatTerm(symbol, -exponent));
  }
  if (positive.length === 0 && negative.length === 0) return "dimensionless";
  let out = positive.length > 0 ? positive.join("*") : "1";
  for (const term of negative) out += `/${term}`;
  return out;
}
