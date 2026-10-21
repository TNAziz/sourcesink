/**
 * SourceSink — built-in function catalog.
 *
 * This is the authoritative list of functions the equation parser/evaluator in
 * `@sourcesink/engine` must implement. It follows the equation dialect shared by
 * XMILE and common system dynamics practice, so XMILE models evaluate as written.
 *
 * Time-dependent functions (SMTH*, DELAY*, TREND, RANDOM, PREV) are **stateful**:
 * the evaluator must allocate per-element storage across time steps.
 */

export interface BuiltinFunction {
  name: string;
  /** Minimum / maximum argument counts. */
  arity: [min: number, max: number];
  /** Whether the function keeps state across time steps. */
  stateful: boolean;
  /** Short description of semantics. */
  description: string;
}

/** `DT` and the run clock are exposed as zero-argument "variables". */
export const CLOCK_VARIABLES = [
  "TIME",
  "DT",
  "STARTTIME",
  "STOPTIME",
  "INITIAL_TIME",
  "FINAL_TIME",
] as const;

export const CONSTANTS = ["PI"] as const;

export const BUILTIN_FUNCTIONS: BuiltinFunction[] = [
  // --- pure math -----------------------------------------------------------
  { name: "ABS", arity: [1, 1], stateful: false, description: "absolute value" },
  { name: "EXP", arity: [1, 1], stateful: false, description: "e^x" },
  { name: "LN", arity: [1, 1], stateful: false, description: "natural log (alias LOGN)" },
  { name: "LOGN", arity: [1, 1], stateful: false, description: "natural log" },
  { name: "LOG10", arity: [1, 1], stateful: false, description: "base-10 log" },
  { name: "SQRT", arity: [1, 1], stateful: false, description: "square root" },
  { name: "SIN", arity: [1, 1], stateful: false, description: "sine (radians)" },
  { name: "COS", arity: [1, 1], stateful: false, description: "cosine (radians)" },
  { name: "TAN", arity: [1, 1], stateful: false, description: "tangent (radians)" },
  { name: "ARCTAN", arity: [1, 1], stateful: false, description: "arctangent (radians)" },
  { name: "MIN", arity: [2, Number.POSITIVE_INFINITY], stateful: false, description: "minimum" },
  { name: "MAX", arity: [2, Number.POSITIVE_INFINITY], stateful: false, description: "maximum" },
  { name: "MOD", arity: [2, 2], stateful: false, description: "modulo (a % b)" },
  { name: "INT", arity: [1, 1], stateful: false, description: "largest integer <= x (INT(-8.9) = -9); alias INTEGER" },
  { name: "INTEGER", arity: [1, 1], stateful: false, description: "largest integer <= x" },
  { name: "ROUND", arity: [1, 1], stateful: false, description: "round to nearest integer" },
  { name: "POWER", arity: [2, 2], stateful: false, description: "a^b" },
  { name: "MEAN", arity: [1, Number.POSITIVE_INFINITY], stateful: false, description: "arithmetic mean of args" },
  { name: "STDDEV", arity: [1, Number.POSITIVE_INFINITY], stateful: false, description: "population stddev of args" },
  { name: "SUM", arity: [1, Number.POSITIVE_INFINITY], stateful: false, description: "sum of args" },
  { name: "PCT", arity: [1, 1], stateful: false, description: "fraction as a percentage (x * 100)" },
  { name: "SWITCH", arity: [2, 2], stateful: false, description: "SWITCH(a, b): 1 if a > b, else 0" },
  { name: "SOUND", arity: [1, 1], stateful: false, description: "SOUND(x): 1 while x > 0 (no audio in headless runs)" },
  { name: "CGROWTH", arity: [1, 1], stateful: false, description: "CGROWTH(percentage): DT-independent compound growth rate per time unit" },
  { name: "SINWAVE", arity: [2, 2], stateful: false, description: "SINWAVE(amplitude, period): sine wave from the start time" },
  { name: "COSWAVE", arity: [2, 2], stateful: false, description: "COSWAVE(amplitude, period): cosine wave from the start time" },
  { name: "PV", arity: [4, 4], stateful: false, description: "PV(rate, nper, pmt, fv): present value (cash received > 0)" },
  { name: "FV", arity: [4, 4], stateful: false, description: "FV(rate, nper, pmt, pv): future value (cash received > 0)" },
  { name: "PMT", arity: [4, 4], stateful: false, description: "PMT(rate, nper, pv, fv): periodic payment (cash received > 0)" },
  { name: "COUNTER", arity: [2, 2], stateful: false, description: "COUNTER(start, end): equals start at the start time, rises one per time unit, wraps at end" },
  { name: "REWORK", arity: [1, 1], stateful: false, description: "REWORK(percentage): leak fraction so that repeated rework totals `percentage`% of the work" },

  // --- logic / control -----------------------------------------------------
  { name: "IF", arity: [3, 3], stateful: false, description: "IF(cond, a, b) — conditional" },
  { name: "THEN", arity: [0, 0], stateful: false, description: "syntactic; THEN/ELSE are tokens, not calls" },
  { name: "ELSE", arity: [0, 0], stateful: false, description: "syntactic" },
  { name: "AND", arity: [0, 0], stateful: false, description: "logical AND (operator)" },
  { name: "OR", arity: [0, 0], stateful: false, description: "logical OR (operator)" },
  { name: "NOT", arity: [1, 1], stateful: false, description: "logical negation" },

  // --- discrete event inputs ----------------------------------------------
  {
    name: "STEP",
    arity: [2, 2],
    stateful: false,
    description: "STEP(height, time): 0 before `time`, `height` from `time` onward",
  },
  {
    name: "PULSE",
    arity: [1, 3],
    stateful: false,
    description: "PULSE(volume, first?, interval?): moves `volume` in one DT (value volume/DT); first defaults to the start time; no or 0 interval = single pulse",
  },
  {
    name: "RAMP",
    arity: [1, 3],
    stateful: false,
    description: "RAMP(slope, start?, end?): 0 until `start` (default: start time), then rising at `slope`; held after `end`",
  },

  // --- material delays (stateful) -----------------------------------------
  {
    name: "DELAY1",
    arity: [2, 3],
    stateful: true,
    description: "First-order material delay. DELAY1(input, delay, init?): level += (input - outflow)*DT/delay",
  },
  {
    name: "DELAY3",
    arity: [2, 3],
    stateful: true,
    description: "Third-order material delay (3 cascaded first-order delays of delay/3 each)",
  },
  {
    name: "DELAYN",
    arity: [3, 4],
    stateful: true,
    description: "Nth-order material delay: DELAYN(input, delay, init, order)",
  },

  // --- information smoothing (stateful) -----------------------------------
  {
    name: "SMTH1",
    arity: [2, 3],
    stateful: true,
    description: "SMTH1(input, averagingTime, initial?): first-order exponential smooth (a stock)",
  },
  {
    name: "SMTH3",
    arity: [2, 3],
    stateful: true,
    description: "SMTH3(input, averagingTime, initial?): three cascaded smooths of averagingTime/3",
  },
  {
    name: "TREND",
    arity: [2, 3],
    stateful: true,
    description: "TREND(input, averagingTime, initial?): fractional change in input per unit time",
  },

  // --- randomness (stateful seed) -----------------------------------------
  {
    name: "RANDOM",
    arity: [2, 3],
    stateful: true,
    description: "RANDOM(min, max, seed?): uniform random in [min, max]",
  },
  {
    name: "NORMAL",
    arity: [2, 3],
    stateful: true,
    description: "NORMAL(mean, stddev, seed?): gaussian random",
  },
  {
    name: "SMTHN",
    arity: [3, 4],
    stateful: true,
    description: "SMTHN(input, averagingTime, n, initial?): n cascaded smooths of averagingTime/n",
  },
  {
    name: "FORCST",
    arity: [3, 4],
    stateful: true,
    description: "FORCST(input, averagingTime, horizon, initial?): input extrapolated by its trend over `horizon`",
  },
  {
    name: "DERIVN",
    arity: [2, 2],
    stateful: true,
    description: "DERIVN(input, order): nth time derivative by backward differences (0 at the start)",
  },
  {
    name: "NPV",
    arity: [2, 3],
    stateful: true,
    description: "NPV(input, rate, initial?): present value at the start time of the input stream so far",
  },
  {
    name: "ENDVAL",
    arity: [1, 2],
    stateful: true,
    description: "ENDVAL(input, initial?): ending value of the previous run (single run: the initial value)",
  },
  {
    name: "EXPRND",
    arity: [1, 2],
    stateful: true,
    description: "EXPRND(mean, seed?): exponentially distributed random number",
  },
  {
    name: "MONTECARLO",
    arity: [1, 2],
    stateful: true,
    description: "MONTECARLO(probability, seed?): 1 with probability% per time unit, else 0",
  },
  {
    name: "TRANSTIME",
    arity: [1, 1],
    stateful: true,
    description: "TRANSTIME(conveyor): transit time of the material most recently entering",
  },
  {
    name: "QLEN",
    arity: [1, 1],
    stateful: true,
    description: "QLEN(queue or conveyor): number of elements (batches) it holds",
  },
  {
    name: "QELEM",
    arity: [2, 2],
    stateful: true,
    description: "QELEM(queue or conveyor, n): amount in element n, counting from the next to leave",
  },
  {
    name: "CAP",
    arity: [1, 1],
    stateful: true,
    description: "CAP(oven or conveyor): its capacity",
  },
  {
    name: "COOKTIME",
    arity: [1, 1],
    stateful: true,
    description: "COOKTIME(oven): cook time of the current batch while cooking, else 0",
  },
  {
    name: "OSTATE",
    arity: [1, 1],
    stateful: true,
    description: "OSTATE(oven): 0 filling, 1 cooking, 2 emptying",
  },
  {
    name: "CTMEAN",
    arity: [1, 3],
    stateful: true,
    description: "CTMEAN(flow, initial?, weighted?): average cycle time of batches so far",
  },
  {
    name: "CTMIN",
    arity: [1, 3],
    stateful: true,
    description: "CTMIN(flow, initial?, instantaneous?): shortest cycle time",
  },
  {
    name: "CTMAX",
    arity: [1, 3],
    stateful: true,
    description: "CTMAX(flow, initial?, instantaneous?): longest cycle time",
  },
  {
    name: "CTSTDDEV",
    arity: [1, 3],
    stateful: true,
    description: "CTSTDDEV(flow, weighted?, initial?): spread of cycle times",
  },
  {
    name: "CTFLOW",
    arity: [1, 2],
    stateful: true,
    description: "CTFLOW(flow, initial?): time-stamped volume moving through the flow",
  },
  {
    name: "THROUGHPUT",
    arity: [1, 2],
    stateful: true,
    description: "THROUGHPUT(flow, initial?): average time-stamped flow rate since the first batch",
  },
  {
    name: "CYCLETIME",
    arity: [1, 1],
    stateful: true,
    description: "CYCLETIME(outflow): time the material leaving a conveyor or queue through `outflow` spent in it",
  },
  {
    name: "DELAY",
    arity: [2, 3],
    stateful: true,
    description: "DELAY(input, delay, initial?): pipeline delay — input as it was `delay` time units ago",
  },
  {
    name: "POISSON",
    arity: [1, 2],
    stateful: true,
    description: "POISSON(mu, seed?): Poisson-distributed count of events this DT, for a mean of `mu` per unit time",
  },

  // --- state access -------------------------------------------------------
  {
    name: "PREVIOUS",
    arity: [1, 1],
    stateful: true,
    description: "value of the argument one DT step ago",
  },
  {
    name: "INIT",
    arity: [1, 1],
    stateful: true,
    description: "value of the argument at the start of the simulation",
  },
];

/** Discrete-time formulas used by the engine (single reference). */
export const TIME_STEP_SEMANTICS = {
  // SMTH1(input, delay): exponential average level.
  //   level(t) = level(t-DT) + (input - level(t-DT)) * (DT / delay)
  //   output(t) = level(t)
  smth1: "return level; then level += (input - level) * DT / delay (a stock)",
  // SMTH3: three cascaded SMTH1, each with time constant = delay / 3.
  smth3: "cascade of 3 smth1 with delay/3",
  // DELAY1(input, delay): material conveyor of one stage.
  //   inflow = input; outflow = level * DT / delay; level += inflow - outflow
  delay1: "outflow = level*DT/delay; level = level + input*DT - outflow",
  // DELAY3 / DELAYN: N cascaded DELAY1 stages, each with delay / N.
  delayN: "cascade of N delay1 stages with delay/N",
  // STEP(height, t): 0 while TIME < t else height.
  step: "TIME < t ? 0 : height",
  // PULSE(volume, first, interval): volume/DT in each step [t, t+DT) holding
  // a pulse time first + k*interval (a single pulse without an interval).
  pulse: "volume/DT in the step containing a pulse time, else 0",
  // RAMP(slope, start, end): (min(TIME, end) - start) * slope after start.
  ramp: "TIME <= start ? 0 : (min(TIME, end) - start) * slope",
} as const;

/** Return the catalog entry for a function name, or undefined. */
export function lookupBuiltin(name: string): BuiltinFunction | undefined {
  const upper = name.toUpperCase();
  return BUILTIN_FUNCTIONS.find((f) => f.name === upper);
}

export default BUILTIN_FUNCTIONS;