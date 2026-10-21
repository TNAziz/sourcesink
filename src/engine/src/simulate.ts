/**
 * SourceSink — simulation engine.
 *
 * Euler, RK2 (Heun) or RK4 integration over [run.start, run.stop] with step
 * `run.dt`, recording a
 * row every `run.saveEvery` units (plus the final time). The engine is a pure
 * function of `(model, opts)` with no I/O.
 *
 * Semantics follow the single-reference discrete-time formulas in
 * `src/model/src/functions.ts` (TIME_STEP_SEMANTICS). See `builtins.ts` for the
 * function implementations.
 */

import type {
  Converter,
  Flow,
  GraphFunction,
  Model,
  Stock,
} from "@sourcesink/model";

import { evaluate, parse, type EvalContext, type Expr } from "./expr.js";
import { expandArrays, hasArrays } from "./arrays.js";
import { canonicalName, conveyorFlowOwners, orderPhases, ovenFlowOwners, queueFlowOwners } from "./order.js";
import {
  evaluateBuiltin,
  lookupBuiltin,
  type StateStore,
} from "./builtins.js";

export interface SimulationResult {
  /** Sample times (length = row count). */
  time: number[];
  /** Per-element series keyed by element name, for all stocks, flows and
   * converters (not connectors, dimensions, or graph functions). */
  series: Record<string, number[]>;
}

export interface SimulateOptions {
  /** Deterministic seed mixed into RANDOM / NORMAL (default 0). */
  seed?: number;
  /** Integration method; defaults to `run.integration`, then Euler. */
  integration?: "euler" | "rk2" | "rk4" | "rk45";
}

const EPS = 1e-9;

/** Functions whose first argument names a stock or flow (not a value). */
const STOCK_FUNCTIONS = new Set(["CYCLETIME", "TRANSTIME", "QLEN", "QELEM", "CAP", "COOKTIME", "OSTATE"]);
/** Cycle-time functions: their first argument names a flow. */
const CYCLE_FUNCTIONS = new Set(["CTMEAN", "CTMIN", "CTMAX", "CTSTDDEV", "CTFLOW", "THROUGHPUT"]);

/** One batch on a conveyor: what is left of it, how much of it each leak
 * flow drains per step (linear leakage — the same amount every step), and
 * how many steps it still rides. Transit time is sampled per batch on entry,
 * so batches can ride for different times. */
interface Slat {
  amount: number;
  leaks: number[];
  /** Time the batch entered the conveyor. */
  entered: number;
  /** Steps left; the batch leaves in the step where this is 1. */
  remaining: number;
  /** Time-stamped for cycle-time measures (initial contents are not). */
  stamped: boolean;
}

/** A queue holds batches first-in first-out, stamped with their entry time. */
interface Batch {
  amount: number;
  entered: number;
  stamped: boolean;
}

/** Running statistics behind CTMEAN, CTMIN, CTMAX, CTSTDDEV and THROUGHPUT. */
interface CycleStats {
  batches: number;
  sum: number;
  sumSq: number;
  volume: number;
  volSum: number;
  volSumSq: number;
  min: number;
  max: number;
  first: number;
}

/** Runtime state of a conveyor stock. */
interface ConveyorState {
  slats: Slat[];
  /** Outflow ids: the exit flow (if any) and the leak flows, in order. */
  exit?: string;
  leakIds: string[];
  /** Transit time of the most recent batch to enter (TRANSTIME). */
  transit: number;
}

/** Runtime state of an oven. */
interface OvenState {
  contents: number;
  /** "open": door open, filling; "cooking": door closed until `cookEnd`. */
  phase: "open" | "cooking";
  openedAt: number;
  cookEnd: number;
  /** Cook time sampled when the door last closed (COOKTIME). */
  cookTime: number;
}

/** Split an equation at top-level commas (a conveyor's initial list). */
function topLevelList(eq: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < eq.length; i++) {
    const c = eq[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(eq.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(eq.slice(from));
  return parts;
}

function interpolate(gf: GraphFunction, x: number): number {
  const pts = gf.points;
  if (pts.length === 0) return Number.NaN;
  if (pts.length === 1) return pts[0].y;

  if (x <= pts[0].x) {
    if (gf.extrapolation === "extend" && pts.length >= 2) {
      const slope = (pts[1].y - pts[0].y) / (pts[1].x - pts[0].x);
      return pts[0].y + slope * (x - pts[0].x);
    }
    return pts[0].y;
  }
  const last = pts[pts.length - 1];
  if (x >= last.x) {
    if (gf.extrapolation === "extend" && pts.length >= 2) {
      const prev = pts[pts.length - 2];
      const slope = (last.y - prev.y) / (last.x - prev.x);
      return last.y + slope * (x - last.x);
    }
    return last.y;
  }

  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (x >= a.x && x <= b.x) {
      if (gf.interpolation === "held" || gf.interpolation === "discrete") {
        return a.y;
      }
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return last.y;
}

export function simulate(model: Model, opts: SimulateOptions = {}): SimulationResult {
  // Arrays run as their scalar elements (`Prey[North,Deer]`, …).
  if (hasArrays(model)) model = expandArrays(model);
  const run = model.run;
  if (!(run.dt > 0)) throw new Error("run.dt must be > 0");
  if (!(run.saveEvery > 0)) throw new Error("run.saveEvery must be > 0");
  if (run.stop < run.start) throw new Error("run.stop must be >= run.start");

  const dt = run.dt;
  const start = run.start;
  const stop = run.stop;
  const saveEvery = run.saveEvery;
  const seed = opts.seed ?? 0;

  // ----- element index -----------------------------------------------------
  const stocksById = new Map<string, Stock>();
  const flowsById = new Map<string, Flow>();
  const convertersById = new Map<string, Converter>();
  const graphById = new Map<string, GraphFunction>();
  const idByName = new Map<string, string>(); // canonicalName -> id

  for (const s of model.stocks) {
    stocksById.set(s.id, s);
    idByName.set(canonicalName(s.name), s.id);
  }
  for (const f of model.flows) {
    flowsById.set(f.id, f);
    idByName.set(canonicalName(f.name), f.id);
  }
  for (const c of model.converters) {
    convertersById.set(c.id, c);
    idByName.set(canonicalName(c.name), c.id);
  }
  for (const g of model.graphFunctions) {
    graphById.set(g.id, g);
    idByName.set(canonicalName(g.name), g.id);
  }

  const order = orderPhases(model);

  // ----- equation ASTs (parsed once so call sites stay stable) ------------
  const conveyorOwner = conveyorFlowOwners(model);
  const queueOwner = queueFlowOwners(model);
  const ovenOwner = ovenFlowOwners(model);
  const ovenAst = new Map<string, { capacity: Expr; fillTime: Expr }>();
  for (const s of model.stocks) {
    if (s.oven) ovenAst.set(s.id, { capacity: parse(s.oven.capacity), fillTime: parse(s.oven.fillTime) });
  }
  const isComputed = (f: Flow) => (conveyorOwner.has(f.id) && !f.leak) || queueOwner.has(f.id);
  const astById = new Map<string, Expr>();
  // A conveyor's initial value may be a list, one value per time unit.
  const initialList = new Map<string, Expr[]>();
  for (const s of model.stocks) {
    const parts = s.conveyor ? topLevelList(s.equation) : [s.equation];
    if (parts.length > 1) initialList.set(s.id, parts.map((p) => parse(p)));
    else astById.set(s.id, parse(s.equation));
  }
  // Conveyor exits and queue outflows are computed; their equations are unused.
  for (const f of model.flows) if (!isComputed(f)) astById.set(f.id, parse(f.equation));
  const transitAst = new Map<string, Expr>();
  for (const s of model.stocks) if (s.conveyor) transitAst.set(s.id, parse(s.conveyor.transitTime));
  for (const c of model.converters) astById.set(c.id, parse(c.equation));

  // ----- per-stock inflow / outflow flow ids -------------------------------
  // Flow wiring comes only from the stock's own lists (connectors are
  // information links and never move material). Entries are flow ids; a flow
  // name is accepted too.
  const flowIdOf = (ref: string): string => {
    if (flowsById.has(ref)) return ref;
    const id = idByName.get(canonicalName(ref));
    if (id !== undefined && flowsById.has(id)) return id;
    throw new Error(`stock references unknown flow '${ref}'`);
  };
  const inflowIds = new Map<string, Set<string>>();
  const outflowIds = new Map<string, Set<string>>();
  for (const s of model.stocks) {
    inflowIds.set(s.id, new Set((s.inflows ?? []).map(flowIdOf)));
    outflowIds.set(s.id, new Set((s.outflows ?? []).map(flowIdOf)));
  }

  // ----- mutable run state --------------------------------------------------
  const conveyors = new Map<string, ConveyorState>();
  const queues = new Map<string, Batch[]>();
  const ovens = new Map<string, OvenState>();
  const cycleStats = new Map<string, CycleStats>();
  /** Average age of the contents of each plain (well-mixed) stock. */
  const meanAge = new Map<string, number>();
  const valueById = new Map<string, number>();
  const state: StateStore = new Map();
  let time = start;

  const resolve = (name: string): number => {
    const upper = name.toUpperCase();
    if (upper === "TIME") return time;
    if (upper === "DT") return dt;
    if (upper === "STARTTIME" || upper === "INITIAL_TIME") return start;
    if (upper === "STOPTIME" || upper === "FINAL_TIME") return stop;
    if (upper === "PI") return Math.PI;
    if (upper === "RUNCOUNT") return 1; // single run; no sensitivity runs yet
    if (upper === "PAUSE") return 0; // interactive pause: not applicable headless
    if (upper === "INF") return Number.POSITIVE_INFINITY;
    const id = idByName.get(canonicalName(name));
    if (id !== undefined && valueById.has(id)) return valueById.get(id)!;
    throw new Error(`unresolved identifier '${name}'`);
  };

  // During the intermediate stages of a Runge-Kutta step, stateful functions
  // (smooths, delays, random draws, cycle-time statistics) must not advance:
  // they return the value they had at the start of the step.
  let staging = false;
  const stepValues = new Map<string, number>();
  const heldAcrossStages = (key: string, compute: () => number): number => {
    if (staging && stepValues.has(key)) return stepValues.get(key)!;
    const v = compute();
    stepValues.set(key, v);
    return v;
  };

  const fn = (name: string, args: number[], site: string): number => {
    const builtin = lookupBuiltin(name);
    if (builtin) {
      const call = () => evaluateBuiltin({ time, dt, state, seed, start: run.start }, name.toUpperCase(), args, site);
      return builtin.stateful ? heldAcrossStages(site, call) : call();
    }
    const gf = graphById.get(idByName.get(canonicalName(name)) ?? "");
    if (gf) {
      if (args.length !== 1) {
        throw new Error(`graphical function '${name}' expects 1 argument`);
      }
      return interpolate(gf, args[0]);
    }
    throw new Error(`unknown function '${name}'`);
  };

  const makeContext = (ownerId: string): EvalContext => ({
    resolve,
    fn: (name, args, site) => fn(name, args, `${ownerId}:${site}`),
    byName: (name, args, site) => {
      const upper = name.toUpperCase();
      if (!CYCLE_FUNCTIONS.has(upper) && !STOCK_FUNCTIONS.has(upper)) return undefined;
      return heldAcrossStages(`${ownerId}:${site}:${upper}`, () => stockFunction(upper, args, `${ownerId}:${site}`));
    },
  });

  /** Functions whose first argument names a stock or flow (CYCLETIME, QLEN,
   * CTMEAN, …). `key` identifies the call site. */
  const stockFunction = (upper: string, args: Expr[], key: string): number => {
    const a = args[0];
    const id = a && a.type === "ident" ? idByName.get(canonicalName(a.name)) : undefined;
    if (CYCLE_FUNCTIONS.has(upper)) {
      if (!id || !flowsById.has(id)) throw new Error(`${upper} expects the name of a flow`);
      const opt = (i: number, d: number) => (args[i] ? evaluate(args[i], makeContext(`${key}:${i}`)) : d);
      return cycleFunction(upper, id, key, opt);
    }
    if (upper === "CYCLETIME") {
      if (args.length !== 1 || !id || !flowsById.has(id)) {
        throw new Error("CYCLETIME expects one argument: the name of an outflow");
      }
      return cycleTime(id);
    }
    if (!id || !stocksById.has(id)) throw new Error(`${upper} expects the name of a conveyor or queue`);
    if (upper === "TRANSTIME") return conveyors.get(id)?.transit ?? 0;
    if (upper === "CAP") return ovens.has(id) ? ovenCapacity(id) : Number.POSITIVE_INFINITY;
    if (upper === "COOKTIME") {
      const o = ovens.get(id);
      return o && o.phase === "cooking" ? o.cookTime : 0;
    }
    if (upper === "OSTATE") {
      const o = ovens.get(id);
      return !o || o.phase === "open" ? 0 : ovenDumping(o) ? 2 : 1;
    }
    const elems = elements(id);
    if (upper === "QLEN") return elems.length;
    // QELEM(stock, n): element n, counting from the next to leave (1)
    const n = args[1] ? Math.round(evaluate(args[1], makeContext(key))) : 1;
    return elems[n - 1] ?? 0;
  };

  const evaluateElement = (id: string): number => {
    const ast = astById.get(id);
    if (!ast) throw new Error(`no equation parsed for element ${id}`);
    return evaluate(ast, makeContext(id));
  };

  // A graph function used as a variable reads the element feeding it.
  const gfInput = new Map<string, string>();
  for (const g of model.graphFunctions) {
    const c = model.connectors.find((k) => canonicalName(k.to) === canonicalName(g.name));
    if (c) gfInput.set(g.id, c.from);
  }

  /** Leak fractions for a conveyor's leak flows, evaluated now and kept in
   * [0, 1] overall. */
  const leakFractions = (c: ConveyorState): number[] => {
    const fs = c.leakIds.map((id) => Math.max(0, evaluateElement(id)));
    const total = fs.reduce((a, b) => a + b, 0);
    return total > 1 ? fs.map((f) => f / total) : fs;
  };

  const transitSteps = (transit: number) => Math.max(1, Math.round(transit / dt));

  /** Build a conveyor at t0. A single initial value is laid out as if a steady
   * inflow had filled it — each slat entered with the same amount and has
   * leaked in proportion to its age (an even spread when nothing leaks). A
   * list gives the contents of each unit of time along the belt, the first
   * value leaving first; missing units repeat the last value. */
  const initConveyor = (id: string): number => {
    const transit = evaluate(transitAst.get(id)!, makeContext(`${id}:transit`));
    const steps = transitSteps(transit);
    const outs = [...outflowIds.get(id)!];
    const c: ConveyorState = {
      slats: [],
      exit: outs.find((f) => !flowsById.get(f)!.leak),
      leakIds: outs.filter((f) => flowsById.get(f)!.leak),
      transit,
    };
    const fr = leakFractions(c);
    const f = fr.reduce((a, b) => a + b, 0);
    const list = initialList.get(id)?.map((e) => evaluate(e, makeContext(id)));
    const single = list ? 0 : (valueById.get(id) ?? 0);
    const evenEntry = single / (steps * (1 - (f * (steps - 1)) / (2 * steps)));
    for (let k = 0; k < steps; k++) {
      const age = steps - 1 - k; // slat k leaves in k+1 steps
      let amount: number;
      let entered: number;
      if (list) {
        amount = (list[Math.min(Math.floor(k * dt + EPS), list.length - 1)] ?? 0) * dt;
        const leakedShare = (f * age) / steps;
        entered = leakedShare < 1 ? amount / (1 - leakedShare) : 0;
      } else {
        entered = evenEntry;
        amount = entered * (1 - (f * age) / steps);
      }
      c.slats.push({
        amount,
        leaks: fr.map((x) => (entered * x) / steps),
        entered: start - (age + 1) * dt,
        remaining: k + 1,
        stamped: false,
      });
    }
    conveyors.set(id, c);
    return c.slats.reduce((a, s2) => a + s2.amount, 0);
  };

  const exiting = (c: ConveyorState) => c.slats.filter((s2) => s2.remaining <= 1);
  const afterLeaks = (s2: Slat) => Math.max(0, s2.amount - s2.leaks.reduce((a, b) => a + b, 0));

  /** Values a conveyor's outflows carry this step, from its state. */
  const conveyorFlowValue = (flowId: string): number => {
    const c = conveyors.get(conveyorOwner.get(flowId)!);
    if (!c) return 0;
    const li = c.leakIds.indexOf(flowId);
    if (li >= 0) return c.slats.reduce((a, s2) => a + Math.min(s2.leaks[li], s2.amount), 0) / dt;
    return exiting(c).reduce((a, s2) => a + afterLeaks(s2), 0) / dt;
  };

  /** Move a conveyor one step: every slat leaks, the ones due leave, and this
   * step's inflow enters with a freshly sampled transit time. Returns the new
   * contents. */
  const advanceConveyor = (id: string, stepDt: number): number => {
    const c = conveyors.get(id)!;
    let inflow = 0;
    for (const fid of inflowIds.get(id)!) inflow += (valueById.get(fid) ?? 0) * stepDt;
    const moved: Slat[] = c.slats
      .filter((s2) => s2.remaining > 1)
      .map((s2) => ({ ...s2, amount: afterLeaks(s2), remaining: s2.remaining - 1 }));
    if (inflow > 0) {
      c.transit = evaluate(transitAst.get(id)!, makeContext(`${id}:transit`));
      const steps = transitSteps(c.transit);
      const fr = leakFractions(c);
      moved.push({ amount: inflow, leaks: fr.map((f) => (inflow * f) / steps), entered: time, remaining: steps, stamped: true });
    }
    c.slats = moved;
    return moved.reduce((a, s2) => a + s2.amount, 0);
  };

  /** A conveyor's or queue's elements, the next to leave first. */
  const elements = (id: string): number[] => {
    const c = conveyors.get(id);
    if (c) {
      return [...c.slats]
        .sort((a, b) => a.remaining - b.remaining || a.entered - b.entered)
        .map((s2) => s2.amount);
    }
    return (queues.get(id) ?? []).map((b) => b.amount);
  };

  // ----- ovens ------------------------------------------------------------
  const ovenCapacity = (id: string) => Math.max(0, evaluate(ovenAst.get(id)!.capacity, makeContext(`${id}:cap`)));
  const ovenFillTime = (id: string) => {
    const f = evaluate(ovenAst.get(id)!.fillTime, makeContext(`${id}:fill`));
    return f > 0 ? f : dt; // 0 means "one step" (the DT option)
  };
  const ovenDumping = (o: OvenState) => o.phase === "cooking" && time >= o.cookEnd - EPS;

  /** How much an oven can take this step: room left while its door is open
   * (or while it empties, when it refills at once). */
  const ovenAcceptance = (id: string): number => {
    const o = ovens.get(id);
    if (!o) return 0;
    if (o.phase === "open") return Math.max(0, ovenCapacity(id) - o.contents);
    return ovenDumping(o) ? ovenCapacity(id) : 0;
  };

  /** Clip the inflows of every oven to what it can accept, in listed order. */
  const limitOvenInflows = (stepDt: number): void => {
    for (const id of ovens.keys()) {
      let room = ovenAcceptance(id);
      for (const fid of inflowIds.get(id)!) {
        const v = Math.max(0, valueById.get(fid) ?? 0);
        const take = Math.min(v * stepDt, room);
        if (take < v * stepDt) valueById.set(fid, take / stepDt);
        room -= take;
      }
    }
  };

  /** Fill, close (sampling the cook time) and empty, one step at a time. */
  const advanceOven = (id: string, stepDt: number): number => {
    const o = ovens.get(id)!;
    let inflow = 0;
    for (const fid of inflowIds.get(id)!) inflow += Math.max(0, valueById.get(fid) ?? 0) * stepDt;
    if (ovenDumping(o)) {
      o.contents = inflow;
      o.phase = "open";
      o.openedAt = time;
    } else if (o.phase === "open") {
      o.contents += inflow;
    }
    if (o.phase === "open") {
      const now = time + stepDt;
      if (o.contents <= EPS) {
        o.openedAt = now; // nothing to cook yet: keep the door open
      } else if (o.contents >= ovenCapacity(id) - EPS || now - o.openedAt >= ovenFillTime(id) - EPS) {
        const exit = [...outflowIds.get(id)!][0];
        o.cookTime = exit ? Math.max(0, evaluateElement(exit)) : 0;
        o.phase = "cooking";
        o.cookEnd = now + o.cookTime;
      }
    }
    return o.contents;
  };

  /** What a queue's outflows carry this step: a queue "wants" to pass all its
   * contents plus this step's inflow, served in outflow order; a flow into
   * another queue takes only the next element (plus the inflow). */
  const queueFlowValues = (qid: string): Map<string, number> => {
    const batches = queues.get(qid) ?? [];
    let inflow = 0;
    for (const fid of inflowIds.get(qid)!) inflow += Math.max(0, valueById.get(fid) ?? 0) * dt;
    // Queued contents leave first; this step's arrivals can pass straight
    // through to a reservoir, cloud or queue, but an oven (or conveyor) takes
    // only what was already waiting, as much as it accepts.
    let queued = batches.reduce((a, b) => a + b.amount, 0);
    let arriving = inflow;
    let head = 0;
    const out = new Map<string, number>();
    for (const fid of outflowIds.get(qid)!) {
      const sink = model.stocks.find((s2) => inflowIds.get(s2.id)!.has(fid));
      let take: number;
      if (sink?.oven) {
        take = Math.min(ovenAcceptance(sink.id), queued);
        queued -= take;
      } else if (sink?.queue) {
        const fromQueue = Math.min(batches[head]?.amount ?? 0, queued);
        queued -= fromQueue;
        take = fromQueue + arriving;
        arriving = 0;
        head++;
      } else {
        take = queued + arriving;
        queued = 0;
        arriving = 0;
      }
      out.set(fid, take / dt);
    }
    return out;
  };

  /** Time-stamped material leaving through `flowId` this step: its volume,
   * total age (volume x time spent since entering), and youngest/oldest age. */
  const leaving = (flowId: string): { amount: number; age: number; min: number; max: number } => {
    const acc = { amount: 0, age: 0, min: Number.POSITIVE_INFINITY, max: 0 };
    const add = (amount: number, age: number) => {
      if (amount <= EPS) return;
      acc.amount += amount;
      acc.age += amount * age;
      acc.min = Math.min(acc.min, age);
      acc.max = Math.max(acc.max, age);
    };
    const owner = conveyorOwner.get(flowId);
    if (owner) {
      const c = conveyors.get(owner);
      if (!c) return acc;
      const li = c.leakIds.indexOf(flowId);
      for (const s2 of li < 0 ? exiting(c) : c.slats) {
        if (s2.stamped) add(li < 0 ? afterLeaks(s2) : Math.min(s2.leaks[li], s2.amount), time - s2.entered);
      }
      return acc;
    }
    for (const [qid, batches] of queues) {
      const outs = [...outflowIds.get(qid)!];
      if (!outs.includes(flowId)) continue;
      // Earlier outflows take from the head first.
      let skip = 0;
      for (const f of outs) {
        if (f === flowId) break;
        skip += Math.max(0, valueById.get(f) ?? 0) * dt;
      }
      let want = Math.max(0, valueById.get(flowId) ?? 0) * dt;
      for (const b of batches) {
        let avail = b.amount;
        const sk = Math.min(skip, avail);
        skip -= sk;
        avail -= sk;
        const take = Math.min(want, avail);
        want -= take;
        if (b.stamped) add(take, time - b.entered);
        if (want <= 0) break;
      }
      return acc;
    }
    // A plain stock is well mixed: what leaves has the contents' mean age.
    for (const [sid, outs] of outflowIds) {
      if (outs.has(flowId)) add(Math.max(0, valueById.get(flowId) ?? 0) * dt, meanAge.get(sid) ?? 0);
    }
    return acc;
  };

  const cycleTime = (flowId: string): number => {
    const l = leaving(flowId);
    return l.amount > 0 ? l.age / l.amount : 0;
  };

  /** CTMEAN, CTMIN, CTMAX, CTSTDDEV, CTFLOW and THROUGHPUT, accumulated per
   * call site (each is evaluated once per step). */
  const cycleFunction = (fn: string, flowId: string, key: string, opt: (i: number, d: number) => number): number => {
    let st = cycleStats.get(key);
    if (!st) {
      st = { batches: 0, sum: 0, sumSq: 0, volume: 0, volSum: 0, volSumSq: 0, min: Infinity, max: 0, first: NaN };
      cycleStats.set(key, st);
    }
    const l = leaving(flowId);
    const ct = l.amount > 0 ? l.age / l.amount : 0;
    if (l.amount > 0) {
      st.batches += 1;
      st.sum += ct;
      st.sumSq += ct * ct;
      st.volume += l.amount;
      st.volSum += l.amount * ct;
      st.volSumSq += l.amount * ct * ct;
      st.min = Math.min(st.min, l.min);
      st.max = Math.max(st.max, l.max);
      if (Number.isNaN(st.first)) st.first = time;
    }
    const seen = st.batches > 0;
    switch (fn) {
      case "CTMEAN":
        if (!seen) return opt(1, 0);
        return opt(2, 0) === 1 ? st.volSum / st.volume : st.sum / st.batches;
      case "CTMAX":
        if (opt(2, 0) === 1) return l.amount > 0 ? l.max : 0;
        return seen ? st.max : opt(1, 0);
      case "CTMIN":
        if (opt(2, 0) === 1) return l.amount > 0 ? l.min : 0;
        return seen ? st.min : opt(1, 0);
      case "CTSTDDEV": {
        if (!seen) return opt(2, 0);
        const weighted = opt(1, 0) === 1;
        const mean = weighted ? st.volSum / st.volume : st.sum / st.batches;
        const sq = weighted ? st.volSumSq / st.volume : st.sumSq / st.batches;
        return Math.sqrt(Math.max(0, sq - mean * mean));
      }
      case "CTFLOW":
        return time <= start + EPS ? opt(1, l.amount / dt) : l.amount / dt;
      default: {
        // THROUGHPUT: stamped volume so far over the time since it began
        const span = time - st.first;
        return seen && span > EPS ? st.volume / span : opt(1, 0);
      }
    }
  };


  /** Append this step's inflow, then take the outflows from the head. */
  const advanceQueue = (id: string, stepDt: number): number => {
    const batches = queues.get(id)!;
    let inflow = 0;
    for (const fid of inflowIds.get(id)!) inflow += (valueById.get(fid) ?? 0) * stepDt;
    if (inflow > 0) batches.push({ amount: inflow, entered: time, stamped: true });
    for (const f of outflowIds.get(id)!) {
      let want = Math.max(0, valueById.get(f) ?? 0) * stepDt;
      while (want > EPS && batches.length) {
        const take = Math.min(want, batches[0].amount);
        batches[0].amount -= take;
        want -= take;
        if (batches[0].amount <= EPS) batches.shift();
      }
    }
    return batches.reduce((a, b) => a + b.amount, 0);
  };

  /** Evaluate one flow/converter/graph function and store its value. */
  const evalNode = (id: string): void => {
    if (conveyorOwner.has(id)) {
      valueById.set(id, conveyorFlowValue(id));
      return;
    }
    const ov = ovenOwner.get(id);
    if (ov) {
      const o = ovens.get(ov);
      valueById.set(id, o && ovenDumping(o) ? o.contents / dt : 0);
      return;
    }
    const q = queueOwner.get(id);
    if (q) {
      valueById.set(id, queueFlowValues(q).get(id) ?? 0);
      return;
    }
    const gf = graphById.get(id);
    if (gf) {
      const input = gfInput.get(id);
      valueById.set(id, interpolate(gf, input === undefined ? Number.NaN : resolve(input)));
      return;
    }
    let v = evaluateElement(id);
    const f = flowsById.get(id);
    if (f && f.nonNegative && v < 0) v = 0;
    valueById.set(id, v);
  };

  const evalAux = (): void => {
    for (const id of order.perStep) evalNode(id);
  };

  /** A non-negative stock can only lose what it holds this step: cut its
   * outflows (in listed order) so they never draw it below zero. The cut
   * value is what downstream stocks receive, so material is conserved. */
  const limitOutflows = (stepDt: number): void => {
    for (const id of order.stocks) {
      const s = stocksById.get(id)!;
      if (s.conveyor || s.oven || !(s.nonNegative || s.queue)) continue;
      let available = valueById.get(id) ?? 0;
      for (const fid of inflowIds.get(id)!) available += (valueById.get(fid) ?? 0) * stepDt;
      for (const fid of outflowIds.get(id)!) {
        const out = valueById.get(fid) ?? 0;
        if (out <= 0) {
          available -= out * stepDt;
          continue;
        }
        const allowed = Math.max(0, available) / stepDt;
        if (out > allowed) valueById.set(fid, allowed);
        available -= Math.min(out, allowed) * stepDt;
      }
    }
  };

  const method = opts.integration ?? run.integration ?? "euler";
  const continuous = order.stocks.filter((id) => {
    const s2 = stocksById.get(id)!;
    return !s2.conveyor && !s2.queue && !s2.oven;
  });
  const netFlow = (id: string): number => {
    let net = 0;
    for (const fid of inflowIds.get(id)!) net += valueById.get(fid) ?? 0;
    for (const fid of outflowIds.get(id)!) net -= valueById.get(fid) ?? 0;
    return net;
  };

  /** Runge-Kutta estimate of the continuous stocks after one step, from flow
   * evaluations at intermediate points (RK2 here is Heun's method:
   * the average of the flows at t and at t+DT). Conveyors, queues and ovens
   * advance once per step with the start-of-step flows. All values and the
   * clock are restored afterwards. */
  const rungeKutta = (h: number): Map<string, number> => {
    const snapshot = new Map(valueById);
    const t0 = time;
    const y0 = new Map(continuous.map((id) => [id, valueById.get(id) ?? 0]));
    const slope = () => new Map(continuous.map((id) => [id, netFlow(id)]));
    const stage = (c: number, k: Map<string, number>) => {
      for (const id of continuous) valueById.set(id, y0.get(id)! + c * h * k.get(id)!);
      time = t0 + c * h;
      staging = true;
      try {
        evalAux();
        limitOutflows(h);
        limitOvenInflows(h);
      } finally {
        staging = false;
      }
      return slope();
    };
    const k1 = slope();
    const next = new Map<string, number>();
    if (method === "rk45") {
      for (const [id, v] of adaptiveStep(t0, h, y0, k1)) next.set(id, v);
    } else if (method === "rk2") {
      const k2 = stage(1, k1);
      for (const id of continuous) next.set(id, y0.get(id)! + (h / 2) * (k1.get(id)! + k2.get(id)!));
    } else {
      const k2 = stage(0.5, k1);
      const k3 = stage(0.5, k2);
      const k4 = stage(1, k3);
      for (const id of continuous) {
        next.set(id, y0.get(id)! + (h / 6) * (k1.get(id)! + 2 * k2.get(id)! + 2 * k3.get(id)! + k4.get(id)!));
      }
    }
    valueById.clear();
    for (const [k, v] of snapshot) valueById.set(k, v);
    time = t0;
    return next;
  };

  /** Flows at an arbitrary point (t, y) within a step, stateful functions
   * held at their start-of-step values. */
  const slopeAt = (t: number, y: Map<string, number>): Map<string, number> => {
    for (const id of continuous) valueById.set(id, y.get(id)!);
    time = t;
    staging = true;
    try {
      evalAux();
      limitOutflows(dt);
      limitOvenInflows(dt);
    } finally {
      staging = false;
    }
    return new Map(continuous.map((id) => [id, netFlow(id)]));
  };

  /** Adaptive Dormand-Prince 5(4) over [t0, t0+h]: sub-steps shrink or grow
   * to keep the local error within tolerance, so accuracy no longer depends
   * on DT for the continuous stocks. */
  const adaptiveStep = (t0: number, h: number, y0: Map<string, number>, k1Start: Map<string, number>): Map<string, number> => {
    const RTOL = 1e-6;
    const ATOL = 1e-9;
    let t = t0;
    let y = new Map(y0);
    let sub = h;
    const comb = (base: Map<string, number>, step: number, terms: Array<[number, Map<string, number>]>) =>
      new Map(continuous.map((id) => [id, base.get(id)! + step * terms.reduce((a, [c, k]) => a + c * k.get(id)!, 0)]));
    while (t < t0 + h - EPS * Math.max(1, Math.abs(t0 + h))) {
      sub = Math.min(sub, t0 + h - t);
      const k1 = t === t0 ? k1Start : slopeAt(t, y);
      const k2 = slopeAt(t + sub / 5, comb(y, sub, [[1 / 5, k1]]));
      const k3 = slopeAt(t + (3 * sub) / 10, comb(y, sub, [[3 / 40, k1], [9 / 40, k2]]));
      const k4 = slopeAt(t + (4 * sub) / 5, comb(y, sub, [[44 / 45, k1], [-56 / 15, k2], [32 / 9, k3]]));
      const k5 = slopeAt(
        t + (8 * sub) / 9,
        comb(y, sub, [[19372 / 6561, k1], [-25360 / 2187, k2], [64448 / 6561, k3], [-212 / 729, k4]]),
      );
      const k6 = slopeAt(
        t + sub,
        comb(y, sub, [[9017 / 3168, k1], [-355 / 33, k2], [46732 / 5247, k3], [49 / 176, k4], [-5103 / 18656, k5]]),
      );
      const y5 = comb(y, sub, [[35 / 384, k1], [500 / 1113, k3], [125 / 192, k4], [-2187 / 6784, k5], [11 / 84, k6]]);
      const k7 = slopeAt(t + sub, y5);
      // difference between the 5th- and embedded 4th-order solutions
      const e = comb(new Map(continuous.map((id) => [id, 0])), sub, [
        [35 / 384 - 5179 / 57600, k1],
        [500 / 1113 - 7571 / 16695, k3],
        [125 / 192 - 393 / 640, k4],
        [-2187 / 6784 + 92097 / 339200, k5],
        [11 / 84 - 187 / 2100, k6],
        [-1 / 40, k7],
      ]);
      let norm = 0;
      for (const id of continuous) {
        const scale = ATOL + RTOL * Math.max(Math.abs(y.get(id)!), Math.abs(y5.get(id)!));
        norm = Math.max(norm, Math.abs(e.get(id)!) / scale);
      }
      if (norm <= 1 || sub <= h * 1e-6) {
        t += sub;
        y = y5;
      }
      sub *= norm === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * norm ** -0.2));
    }
    return y;
  };

  const integrate = (stepDt: number): void => {
    limitOutflows(stepDt);
    limitOvenInflows(stepDt);
    const rk = method === "euler" ? undefined : rungeKutta(stepDt);
    for (const id of order.stocks) {
      const stock = stocksById.get(id)!;
      if (stock.oven) {
        valueById.set(id, advanceOven(id, stepDt));
        continue;
      }
      if (stock.conveyor) {
        valueById.set(id, advanceConveyor(id, stepDt));
        continue;
      }
      if (stock.queue) {
        valueById.set(id, advanceQueue(id, stepDt));
        continue;
      }
      let inflow = 0;
      let outflow = 0;
      for (const fid of inflowIds.get(id)!) inflow += valueById.get(fid) ?? 0;
      for (const fid of outflowIds.get(id)!) outflow += valueById.get(fid) ?? 0;
      const before = valueById.get(id) ?? 0;
      let v = rk ? rk.get(id)! : before + (inflow - outflow) * stepDt;
      if ((stock.nonNegative || stock.queue) && v < 0) v = 0;
      valueById.set(id, v);
      // Remaining contents age by one step; this step's inflow arrives aged
      // one step too (the same convention as queue and conveyor batches).
      const stay = Math.max(0, before - Math.max(0, outflow) * stepDt);
      const added = Math.max(0, inflow) * stepDt;
      const age = meanAge.get(id) ?? 0;
      meanAge.set(id, stay + added > EPS ? (stay * (age + stepDt) + added * stepDt) / (stay + added) : 0);
    }
  };

  // ----- record times --------------------------------------------------------
  const times: number[] = [];
  for (let t = start; t < stop - EPS; t += saveEvery) times.push(t);
  times.push(stop);

  const tracked = [...model.stocks, ...model.flows, ...model.converters];
  const series: Record<string, number[]> = {};
  for (const e of tracked) series[e.name] = new Array(times.length).fill(Number.NaN);

  const record = (row: number): void => {
    times[row] = time;
    for (const e of tracked) {
      series[e.name][row] = valueById.get(e.id) ?? Number.NaN;
    }
  };

  // ----- run ----------------------------------------------------------------
  // t0: every element exactly once, in initialization order (stateful
  // builtins advance on each call, so no second pass).
  for (const id of order.initial) {
    if (stocksById.has(id)) {
      const conveyor = stocksById.get(id)!.conveyor;
      const v = conveyor && initialList.has(id) ? 0 : evaluateElement(id);
      valueById.set(id, v);
      if (conveyor) valueById.set(id, initConveyor(id));
      if (stocksById.get(id)!.queue) queues.set(id, v > 0 ? [{ amount: v, entered: start, stamped: false }] : []);
      if (stocksById.get(id)!.oven) {
        ovens.set(id, { contents: v, phase: "open", openedAt: start, cookEnd: 0, cookTime: 0 });
      }
    } else {
      evalNode(id);
    }
  }
  limitOutflows(dt);
  limitOvenInflows(dt);
  record(0);

  for (let ri = 1; ri < times.length; ri += 1) {
    const target = times[ri];
    while (time < target - EPS) {
      const stepDt = Math.min(dt, target - time);
      integrate(stepDt);
      time += stepDt;
      evalAux();
      limitOutflows(dt); // so recorded flows show what actually moved
      limitOvenInflows(dt);
    }
    time = target;
    record(ri);
  }

  return { time: times, series };
}