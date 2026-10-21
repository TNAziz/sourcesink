/**
 * SourceSink — built-in function library.
 *
 * Mirrors the catalog in `@sourcesink/model` (`src/model/src/functions.ts`). It is
 * duplicated here rather than imported because `@sourcesink/model` does not yet
 * re-export its `functions.ts` module as a package subpath; this module is the
 * single place the engine encodes function semantics.
 */

export interface Builtin {
  name: string;
  min: number;
  max: number; // Number.POSITIVE_INFINITY for variadic
  stateful: boolean;
}

const INF = Number.POSITIVE_INFINITY;

export const BUILTINS: Builtin[] = [
  { name: "ABS", min: 1, max: 1, stateful: false },
  { name: "EXP", min: 1, max: 1, stateful: false },
  { name: "LN", min: 1, max: 1, stateful: false },
  { name: "LOGN", min: 1, max: 1, stateful: false },
  { name: "LOG10", min: 1, max: 1, stateful: false },
  { name: "SQRT", min: 1, max: 1, stateful: false },
  { name: "SIN", min: 1, max: 1, stateful: false },
  { name: "COS", min: 1, max: 1, stateful: false },
  { name: "TAN", min: 1, max: 1, stateful: false },
  { name: "ARCTAN", min: 1, max: 1, stateful: false },
  { name: "MIN", min: 2, max: INF, stateful: false },
  { name: "MAX", min: 2, max: INF, stateful: false },
  { name: "MOD", min: 2, max: 2, stateful: false },
  { name: "INT", min: 1, max: 1, stateful: false },
  { name: "INTEGER", min: 1, max: 1, stateful: false },
  { name: "ROUND", min: 1, max: 1, stateful: false },
  { name: "POWER", min: 2, max: 2, stateful: false },
  { name: "MEAN", min: 1, max: INF, stateful: false },
  { name: "STDDEV", min: 1, max: INF, stateful: false },
  { name: "SUM", min: 1, max: INF, stateful: false },
  { name: "PCT", min: 1, max: 1, stateful: false },
  { name: "COUNTER", min: 2, max: 2, stateful: false },
  { name: "REWORK", min: 1, max: 1, stateful: false },
  { name: "NOT", min: 1, max: 1, stateful: false },
  { name: "STEP", min: 2, max: 2, stateful: false },
  { name: "PULSE", min: 1, max: 3, stateful: false },
  { name: "RAMP", min: 1, max: 3, stateful: false },
  { name: "DELAY1", min: 2, max: 3, stateful: true },
  { name: "DELAY3", min: 2, max: 3, stateful: true },
  { name: "DELAYN", min: 3, max: 4, stateful: true },
  { name: "DELAY", min: 2, max: 3, stateful: true },
  { name: "SMTH1", min: 2, max: 3, stateful: true },
  { name: "SMTH3", min: 2, max: 3, stateful: true },
  { name: "SMTHN", min: 3, max: 4, stateful: true },
  { name: "TREND", min: 2, max: 3, stateful: true },
  { name: "FORCST", min: 3, max: 4, stateful: true },
  { name: "DERIVN", min: 2, max: 2, stateful: true },
  { name: "NPV", min: 2, max: 3, stateful: true },
  { name: "ENDVAL", min: 1, max: 2, stateful: true },
  { name: "EXPRND", min: 1, max: 2, stateful: true },
  { name: "MONTECARLO", min: 1, max: 2, stateful: true },
  { name: "SINWAVE", min: 2, max: 2, stateful: false },
  { name: "COSWAVE", min: 2, max: 2, stateful: false },
  { name: "CGROWTH", min: 1, max: 1, stateful: false },
  { name: "SWITCH", min: 2, max: 2, stateful: false },
  { name: "SOUND", min: 1, max: 1, stateful: false },
  { name: "PV", min: 4, max: 4, stateful: false },
  { name: "FV", min: 4, max: 4, stateful: false },
  { name: "PMT", min: 4, max: 4, stateful: false },
  { name: "RANDOM", min: 2, max: 3, stateful: true },
  { name: "NORMAL", min: 2, max: 3, stateful: true },
  { name: "POISSON", min: 1, max: 2, stateful: true },
  { name: "PREVIOUS", min: 1, max: 1, stateful: true },
  { name: "INIT", min: 1, max: 1, stateful: true },
];

const BUILTIN_BY_NAME = new Map(BUILTINS.map((b) => [b.name, b]));

/** Return the catalog entry for a function name (case-insensitive). */
export function lookupBuiltin(name: string): Builtin | undefined {
  return BUILTIN_BY_NAME.get(name.toUpperCase());
}

/** The clock / constant identifiers the engine exposes to `resolve`. */
export const CLOCK_VARIABLES = [
  "TIME",
  "DT",
  "STARTTIME",
  "STOPTIME",
  "INITIAL_TIME",
  "FINAL_TIME",
] as const;

export const CONSTANTS = ["PI"] as const;

/** Per-call-site mutable state for stateful built-ins. */
export type BuiltinState =
  | { kind: "level"; level: number } // smth1/trend smoothing state
  | { kind: "levels"; levels: number[] } // delay1/3/N conveyor stages
  | { kind: "rng"; rng: () => number; spare?: number } // RANDOM / NORMAL
  | { kind: "previous"; previous: number } // PREVIOUS
  | { kind: "init"; value: number } // INIT
  | { kind: "history"; values: number[]; lag?: number } // DELAY (one value per step)
  | { kind: "derivn"; prev: number[] } // DERIVN previous values per order
  | { kind: "npv"; sum: number; factor: number }; // NPV running sum

export type StateStore = Map<string, BuiltinState>;

export interface BuiltinEnv {
  /** Current simulation clock. */
  time: number;
  /** Integration step. */
  dt: number;
  /** Per-run state store (keyed by compound call-site). */
  state: StateStore;
  /** Run seed, mixed into each call-site seed for reproducible randomness. */
  seed: number;
  /** Simulation start time (default first pulse for a one-argument PULSE). */
  start?: number;
}

/** FNV-1a 32-bit string hash for deterministic per-site RNG seeding. */
function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG: returns a function yielding floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getLevel(env: BuiltinEnv, site: string, initial: number): number {
  let st = env.state.get(site);
  if (!st) {
    st = { kind: "level", level: initial };
    env.state.set(site, st);
  }
  return (st as { kind: "level"; level: number }).level;
}

function setLevel(env: BuiltinEnv, site: string, level: number): void {
  const st = env.state.get(site);
  if (st && st.kind === "level") st.level = level;
}

function getLevels(env: BuiltinEnv, site: string, initial: number[]): number[] {
  let st = env.state.get(site);
  if (!st) {
    st = { kind: "levels", levels: initial.slice() };
    env.state.set(site, st);
  }
  return (st as { kind: "levels"; levels: number[] }).levels;
}

/** Per-site generator; an explicit `seed` argument makes the stream depend on
 * that seed alone, as in `NORMAL(mean, sd, seed)`. */
function getRng(env: BuiltinEnv, site: string, seed?: number): () => number {
  let st = env.state.get(site);
  if (!st) {
    const s = seed === undefined ? hashString(site) ^ env.seed : Math.trunc(seed);
    st = { kind: "rng", rng: mulberry32(s >>> 0) };
    env.state.set(site, st);
  }
  return (st as { kind: "rng"; rng: () => number }).rng;
}

function smth1(input: number, delay: number, level: number, dt: number): number {
  const out = level + (input - level) * (dt / delay);
  return out;
}

function delay1Stage(level: number, input: number, delay: number, dt: number): { level: number; outflow: number } {
  // Continuous first-order material delay: outflow is a rate = level / delay.
  const outflow = delay !== 0 ? level / delay : input;
  const newLevel = level + (input - outflow) * dt;
  return { level: newLevel, outflow };
}

export function evaluateBuiltin(
  env: BuiltinEnv,
  name: string,
  args: number[],
  site: string,
): number {
  const b = BUILTIN_BY_NAME.get(name);
  if (!b) throw new Error(`unknown built-in function '${name}'`);
  if (args.length < b.min || args.length > b.max) {
    const range = b.min === b.max ? `${b.min}` : `${b.min}..${b.max === INF ? "n" : b.max}`;
    throw new Error(
      `${name} expects ${range} argument(s) but got ${args.length}`,
    );
  }

  const dt = env.dt;
  const t = env.time;
  const [a0] = args;

  switch (name) {
    case "ABS":
      return Math.abs(a0);
    case "EXP":
      return Math.exp(a0);
    case "LN":
    case "LOGN":
      return Math.log(a0);
    case "LOG10":
      return Math.log10(a0);
    case "SQRT":
      return Math.sqrt(a0);
    case "SIN":
      return Math.sin(a0);
    case "COS":
      return Math.cos(a0);
    case "TAN":
      return Math.tan(a0);
    case "ARCTAN":
      return Math.atan(a0);
    case "MIN":
      return Math.min(...args);
    case "MAX":
      return Math.max(...args);
    case "MOD":
      return args[0] % args[1];
    case "INT":
    case "INTEGER":
      return Math.floor(a0); // largest integer <= x: INT(-8.9) = -9
    case "ROUND":
      return Math.round(a0);
    case "POWER":
      return Math.pow(args[0], args[1]);
    case "MEAN":
      return args.reduce((s, v) => s + v, 0) / args.length;
    case "SUM":
      return args.reduce((s, v) => s + v, 0);
    case "PCT":
      return a0 * 100;
    case "COUNTER": {
      // start at the run's start time, rise one per time unit, wrap at end
      const [from, to] = args;
      const span = to - from;
      if (!(span > 0)) return from;
      const elapsed = t - (env.start ?? 0);
      const phase = elapsed - span * Math.floor(elapsed / span + 1e-9);
      return from + (Math.abs(phase - span) < 1e-9 ? 0 : phase);
    }
    case "REWORK": {
      // Leak fraction f whose repeated passes (f + f² + …) rework exactly
      // `percentage`% of the work: f / (1 - f) = p  =>  f = p / (1 + p).
      const p = Math.max(0, a0) / 100;
      return p / (1 + p);
    }
    case "STDDEV": {
      const mean = args.reduce((s, v) => s + v, 0) / args.length;
      const variance =
        args.reduce((s, v) => s + (v - mean) * (v - mean), 0) / args.length;
      return Math.sqrt(variance);
    }
    case "NOT":
      return a0 ? 0 : 1;
    case "STEP":
      return t < args[1] ? 0 : args[0];
    case "PULSE": {
      const amount = args[0];
      const first = args.length >= 2 ? args[1] : (env.start ?? t);
      const interval = args.length >= 3 ? args[2] : undefined;
      // The volume moves in one DT, so the value is volume/DT. A pulse fires
      // in the step [t, t+DT) that contains its time; no (or a 0) interval
      // means a single pulse.
      const tol = 1e-9 * Math.max(1, Math.abs(t), Math.abs(first));
      let next = first;
      if (interval !== undefined && interval > 0 && t > first + tol) {
        next = first + Math.ceil((t - first) / interval - 1e-9) * interval;
      }
      return next >= t - tol && next < t + dt - tol ? amount / dt : 0;
    }
    case "RAMP": {
      // RAMP(slope[, start[, end]]): 0 until start, then rising; held at end
      const slope = args[0];
      const start = args.length >= 2 ? args[1] : (env.start ?? 0);
      const end = args.length >= 3 ? args[2] : Number.POSITIVE_INFINITY;
      return t <= start ? 0 : (Math.min(t, end) - start) * slope;
    }
    case "SMTH1":
    case "SMTH3":
    case "SMTHN": {
      // A cascade of n first-order smooths, each a stock with averaging time
      // avg/n. The value is the last stock now; the stocks then integrate
      // this step's input (so the output lags the input by a DT, as a stock).
      const n = name === "SMTH1" ? 1 : name === "SMTH3" ? 3 : Math.max(1, Math.round(args[2]));
      const initArg = name === "SMTHN" ? 3 : 2;
      const input = args[0];
      const init = args.length > initArg ? args[initArg] : input;
      const levels = getLevels(env, site, new Array<number>(n).fill(init));
      const out = levels[n - 1];
      const stage = args[1] / n;
      let feed = input;
      for (let i = 0; i < n; i += 1) {
        const before = levels[i];
        levels[i] = smth1(feed, stage, before, dt);
        feed = before;
      }
      return out;
    }
    case "DELAY1":
    case "DELAY3":
    case "DELAYN": {
      const input = args[0];
      const delay = args[1];
      const init = args.length >= 3 ? args[2] : input * delay;
      const order = name === "DELAY1" ? 1 : name === "DELAY3" ? 3 : Math.max(1, Math.round(args.length >= 4 ? args[3] : 3));
      const stageDelay = order > 0 ? delay / order : delay;
      const perStageInit = order > 0 ? init / order : init;
      const initial = new Array<number>(order).fill(perStageInit);
      const levels = getLevels(env, site, initial);
      let flow = input;
      for (let i = 0; i < order; i += 1) {
        const r = delay1Stage(levels[i], flow, stageDelay, dt);
        levels[i] = r.level;
        flow = r.outflow;
      }
      return flow;
    }
    case "TREND":
    case "FORCST": {
      // TREND = (input - average) / (average * avg_time), with the average a
      // first-order smooth started at input / (1 + initial * avg_time) so the
      // first value is `initial`. FORCST extrapolates input by the trend over
      // `horizon`.
      const input = args[0];
      const avg = args[1];
      const initIdx = name === "TREND" ? 2 : 3;
      const initialTrend = args.length > initIdx ? args[initIdx] : 0;
      const level = getLevel(env, site, input / (1 + initialTrend * avg));
      const trend = level !== 0 && avg !== 0 ? (input - level) / (level * avg) : 0;
      setLevel(env, site, smth1(input, avg, level, dt));
      return name === "TREND" ? trend : input * (1 + trend * args[2]);
    }
    case "DERIVN": {
      // Recursive backward difference (x_t - x_{t-dt}) / dt; 0 at the start.
      const order = Math.max(0, Math.round(args[1]));
      let st = env.state.get(site) as { kind: "derivn"; prev: number[] } | undefined;
      const fresh = !st;
      if (!st) {
        st = { kind: "derivn", prev: new Array<number>(order).fill(Number.NaN) };
        env.state.set(site, st);
      }
      let x = a0;
      for (let k = 0; k < order; k += 1) {
        const prev = st.prev[k];
        st.prev[k] = x;
        x = fresh || Number.isNaN(prev) ? 0 : (x - prev) / dt;
      }
      return x;
    }
    case "NPV": {
      // Present value at the start time of the input stream so far, at a
      // per-period discount rate (discount factor 1 at the start).
      let st = env.state.get(site) as { kind: "npv"; sum: number; factor: number } | undefined;
      if (!st) {
        st = { kind: "npv", sum: args.length >= 3 ? args[2] : 0, factor: 1 };
        env.state.set(site, st);
      }
      const value = st.sum;
      st.sum += a0 * st.factor * dt;
      st.factor /= Math.pow(1 + args[1], dt);
      return value;
    }
    case "ENDVAL":
      // Ending value of the previous run; a single run has none yet, so the
      // initial value (or the input's first value).
      return evaluateBuiltin(env, "INIT", [args.length >= 2 ? args[1] : a0], site);
    case "EXPRND": {
      const rng = getRng(env, site, args[1]);
      return -Math.max(0, a0) * Math.log(1 - rng());
    }
    case "MONTECARLO": {
      const rng = getRng(env, site, args[1]);
      const p = a0 >= 0 && a0 <= 100 ? a0 : 0;
      return rng() * 100 <= p * dt ? 1 : 0;
    }
    case "SINWAVE":
      return Math.abs(args[0]) * Math.sin((2 * Math.PI * (t - (env.start ?? 0))) / args[1]);
    case "COSWAVE":
      return Math.abs(args[0]) * Math.cos((2 * Math.PI * (t - (env.start ?? 0))) / args[1]);
    case "CGROWTH":
      // Fractional rate giving `percentage`% compound growth per time unit at
      // any DT: (1 + p)^DT - 1 per step, as a rate.
      return (Math.pow(1 + a0 / 100, dt) - 1) / dt;
    case "SWITCH":
      return args[0] > args[1] ? 1 : 0;
    case "SOUND":
      return a0 > 0 ? 1 : 0;
    case "PV": {
      // cash received > 0, paid < 0; PV(rate, nper, pmt, fv)
      const [r, n, pmt, fv] = args;
      if (r === 0) return -(fv + pmt * n);
      const g = Math.pow(1 + r, n);
      return -(fv + (pmt * (g - 1)) / r) / g;
    }
    case "FV": {
      const [r, n, pmt, pv] = args;
      if (r === 0) return -(pv + pmt * n);
      const g = Math.pow(1 + r, n);
      return -(pv * g + (pmt * (g - 1)) / r);
    }
    case "PMT": {
      const [r, n, pv, fv] = args;
      if (n === 0) return 0;
      if (r === 0) return -(pv + fv) / n;
      const g = Math.pow(1 + r, n);
      return (-(pv * g + fv) * r) / (g - 1);
    }
    case "RANDOM": {
      const min = args[0];
      const max = args[1];
      const rng = getRng(env, site, args[2]);
      return min + (max - min) * rng();
    }
    case "NORMAL": {
      const mean = args[0];
      const stddev = args[1];
      const rng = getRng(env, site, args[2]);
      let st = env.state.get(site) as { kind: "rng"; rng: () => number; spare?: number };
      if (st.spare !== undefined) {
        const v = st.spare;
        st.spare = undefined;
        return mean + stddev * v;
      }
      // Box–Muller.
      let u1 = 0;
      let u2 = 0;
      while (u1 <= 1e-12) u1 = rng();
      u2 = rng();
      const mag = Math.sqrt(-2 * Math.log(u1));
      const z0 = mag * Math.cos(2 * Math.PI * u2);
      const z1 = mag * Math.sin(2 * Math.PI * u2);
      st.spare = z1;
      return mean + stddev * z0;
    }
    case "POISSON": {
      // Events in this DT for a mean of `mu` per unit time (so mean mu*DT
      // per draw, the usual system dynamics convention), by Knuth's method.
      const rng = getRng(env, site, args[1]);
      const limit = Math.exp(-Math.max(0, a0) * dt);
      let k = 0;
      let p = rng();
      while (p > limit) {
        k += 1;
        p *= rng();
      }
      return k;
    }
    case "PREVIOUS": {
      let st = env.state.get(site);
      if (!st) {
        env.state.set(site, { kind: "previous", previous: a0 });
        return a0;
      }
      const cur = a0;
      const prev = (st as { kind: "previous"; previous: number }).previous;
      (st as { kind: "previous"; previous: number }).previous = cur;
      return prev;
    }
    case "DELAY": {
      // Pipeline delay: the input as it was `delay` time units ago; before
      // that much history exists, the initial value (default: first input).
      // A variable duration is fixed at its initial value.
      let st = env.state.get(site) as { kind: "history"; values: number[]; lag?: number } | undefined;
      if (!st) {
        st = { kind: "history", values: [], lag: Math.max(0, args[1]) };
        env.state.set(site, st);
      }
      st.values.push(a0);
      const back = Math.round((st.lag ?? 0) / dt);
      const idx = st.values.length - 1 - back;
      if (idx >= 0) return st.values[idx];
      return args.length >= 3 ? args[2] : st.values[0];
    }
    case "INIT": {
      let st = env.state.get(site);
      if (!st) {
        st = { kind: "init", value: a0 };
        env.state.set(site, st);
      }
      return (st as { kind: "init"; value: number }).value;
    }
    default:
      throw new Error(`built-in '${name}' not implemented`);
  }
}