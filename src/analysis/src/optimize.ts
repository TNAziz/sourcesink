/**
 * SourceSink — derivative-free minimisers for calibration.
 *
 * Both optimisers are pure and deterministic (given a seed for differential
 * evolution). A non-finite objective value (`NaN`, `±Infinity`) is treated as
 * `+Infinity`, so a parameter region that makes the model fail simply looks
 * unattractive instead of poisoning the search.
 */

export interface OptimizeResult {
  x: number[];
  f: number;
  evaluations: number;
  converged: boolean;
  history: number[];
}

/** Guard for the relative convergence test: keeps a zero objective from
 * demanding an impossible absolute spread. */
const TINY = 1e-12;

/** mulberry32 PRNG: returns floats in [0, 1). Local copy: sampling.ts does
 * not export its generator. */
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

interface Vertex {
  x: number[];
  f: number;
}

function clampPoint(x: number[], lo: number[], hi: number[]): number[] {
  return x.map((v, i) => Math.min(hi[i], Math.max(lo[i], v)));
}

function checkBounds(lo: number[], hi: number[]): void {
  if (lo.length !== hi.length) throw new Error("optimize: lo and hi must have the same length");
  for (let i = 0; i < lo.length; i += 1) {
    if (!Number.isFinite(lo[i]) || !Number.isFinite(hi[i]) || lo[i] > hi[i]) {
      throw new Error(`optimize: invalid bounds for variable ${i} ([${lo[i]}, ${hi[i]}])`);
    }
  }
}

/** Nelder-Mead simplex minimiser in a box.
 *
 * Standard coefficients (α=1, γ=2, ρ=0.5, σ=0.5). The initial simplex starts
 * at `x0` and steps by 5% of each range; a coordinate at zero uses 0.00025
 * instead (a zero-length step would collapse the simplex). Bounds are honoured
 * by clamping every trial point before evaluation. The search stops when the
 * objective spread over the simplex is ≤ tol × (|f_best| + tiny), or when the
 * evaluation budget runs out. `history` records the best objective after each
 * evaluation. */
export function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  lo: number[],
  hi: number[],
  opts: { maxEvaluations?: number; tol?: number } = {},
): OptimizeResult {
  checkBounds(lo, hi);
  if (x0.length !== lo.length) throw new Error("optimize: x0 must match the bounds length");
  const dim = lo.length;
  const maxEvaluations = opts.maxEvaluations ?? 10_000;
  const tol = opts.tol ?? 1e-8;

  let evaluations = 0;
  let bestF = Number.POSITIVE_INFINITY;
  let bestX = clampPoint(x0, lo, hi);
  const history: number[] = [];

  const evalAt = (x: number[]): Vertex | null => {
    if (evaluations >= maxEvaluations) return null;
    const point = clampPoint(x, lo, hi);
    evaluations += 1;
    const raw = f(point);
    const value = Number.isFinite(raw) ? raw : Number.POSITIVE_INFINITY;
    if (value < bestF) {
      bestF = value;
      bestX = point;
    }
    history.push(bestF);
    return { x: point, f: value };
  };

  if (dim === 0) {
    const only = evalAt([]);
    return {
      x: [],
      f: only ? only.f : Number.POSITIVE_INFINITY,
      evaluations,
      converged: only !== null && Number.isFinite(only.f),
      history,
    };
  }

  const start = clampPoint(x0, lo, hi);
  const first = evalAt(start);
  if (!first) {
    return { x: bestX, f: bestF, evaluations, converged: false, history };
  }
  const simplex: Vertex[] = [first];

  for (let i = 0; i < dim; i += 1) {
    const span = hi[i] - lo[i];
    let step = start[i] === 0 ? 0.00025 : 0.05 * span;
    if (!(step > 0)) step = 0.00025;
    const point = start.slice();
    let value = start[i] + step;
    if (value > hi[i]) value = start[i] - step;
    point[i] = value;
    const vertex = evalAt(point);
    if (!vertex) {
      return { x: bestX, f: bestF, evaluations, converged: false, history };
    }
    simplex.push(vertex);
  }

  let converged = false;
  outer: while (evaluations < maxEvaluations) {
    simplex.sort((a, b) => a.f - b.f);
    const best = simplex[0];
    const worst = simplex[dim];
    const spread = worst.f - best.f;
    if (Number.isFinite(spread) && spread <= tol * (Math.abs(best.f) + TINY)) {
      converged = true;
      break;
    }

    const centroid = new Array<number>(dim).fill(0);
    for (let i = 0; i < dim; i += 1) {
      for (let d = 0; d < dim; d += 1) centroid[d] += simplex[i].x[d] / dim;
    }

    const reflected = centroid.map((c, d) => c + (c - worst.x[d]));
    const reflectedV = evalAt(reflected);
    if (!reflectedV) break;

    if (reflectedV.f < best.f) {
      const expanded = centroid.map((c, d) => c + 2 * (reflectedV.x[d] - c));
      const expandedV = evalAt(expanded);
      if (!expandedV) break;
      simplex[dim] = expandedV.f < reflectedV.f ? expandedV : reflectedV;
    } else if (reflectedV.f < simplex[dim - 1].f) {
      simplex[dim] = reflectedV;
    } else {
      let shrink = false;
      if (reflectedV.f < worst.f) {
        const contracted = centroid.map((c, d) => c + 0.5 * (reflectedV.x[d] - c));
        const contractedV = evalAt(contracted);
        if (!contractedV) break;
        if (contractedV.f <= reflectedV.f) simplex[dim] = contractedV;
        else shrink = true;
      } else {
        const contracted = centroid.map((c, d) => c + 0.5 * (worst.x[d] - c));
        const contractedV = evalAt(contracted);
        if (!contractedV) break;
        if (contractedV.f < worst.f) simplex[dim] = contractedV;
        else shrink = true;
      }

      if (shrink) {
        for (let i = 1; i <= dim; i += 1) {
          const point = best.x.map((b, d) => b + 0.5 * (simplex[i].x[d] - b));
          const vertex = evalAt(point);
          if (!vertex) break outer;
          simplex[i] = vertex;
        }
      }
    }
  }

  return { x: bestX, f: bestF, evaluations, converged, history };
}

/** Index in [0, n) that is not in `taken`; retries until one is found (n is
 * always ≥ 15 in DE, so this terminates quickly). */
function pickDistinct(rand: () => number, n: number, taken: Set<number>): number {
  for (;;) {
    const r = Math.floor(rand() * n);
    if (!taken.has(r)) return r;
  }
}

/** Differential evolution (DE/rand/1/bin, F=0.8, CR=0.9) in a box.
 *
 * The population has 10×dim individuals (at least 15), drawn uniformly inside
 * the bounds from a seeded mulberry32 generator, so a given seed is
 * reproducible. The run stops when the population's objective spread is
 * ≤ tol × (|f_best| + tiny), or at the evaluation budget. `history` holds the
 * best objective per generation (the initial population is generation 0). */
export function differentialEvolution(
  f: (x: number[]) => number,
  lo: number[],
  hi: number[],
  opts: { maxEvaluations?: number; tol?: number; seed?: number } = {},
): OptimizeResult {
  checkBounds(lo, hi);
  const dim = lo.length;
  const maxEvaluations = opts.maxEvaluations ?? 10_000;
  const tol = opts.tol ?? 1e-8;
  const rand = mulberry32(opts.seed ?? 0);
  const F = 0.8;
  const CR = 0.9;

  let evaluations = 0;
  let bestF = Number.POSITIVE_INFINITY;
  let bestX = lo.map((v, i) => (v + hi[i]) / 2);
  const history: number[] = [];

  const evalAt = (x: number[]): Vertex | null => {
    if (evaluations >= maxEvaluations) return null;
    const point = clampPoint(x, lo, hi);
    evaluations += 1;
    const raw = f(point);
    const value = Number.isFinite(raw) ? raw : Number.POSITIVE_INFINITY;
    if (value < bestF) {
      bestF = value;
      bestX = point;
    }
    return { x: point, f: value };
  };

  if (dim === 0) {
    const only = evalAt([]);
    return {
      x: [],
      f: only ? only.f : Number.POSITIVE_INFINITY,
      evaluations,
      converged: only !== null && Number.isFinite(only.f),
      history: only ? [only.f] : [],
    };
  }

  const populationSize = Math.max(15, 10 * dim);
  const population: Vertex[] = [];
  for (let i = 0; i < populationSize; i += 1) {
    const point = lo.map((v, d) => v + (hi[d] - v) * rand());
    const vertex = evalAt(point);
    if (!vertex) break;
    population.push(vertex);
  }
  history.push(bestF);

  let converged = false;
  while (evaluations < maxEvaluations && population.length === populationSize) {
    const values = population.map((p) => p.f);
    const spread = Math.max(...values) - Math.min(...values);
    if (Number.isFinite(spread) && spread <= tol * (Math.abs(bestF) + TINY)) {
      converged = true;
      break;
    }

    for (let i = 0; i < populationSize; i += 1) {
      if (evaluations >= maxEvaluations) break;
      const taken = new Set<number>([i]);
      const r1 = pickDistinct(rand, populationSize, taken);
      taken.add(r1);
      const r2 = pickDistinct(rand, populationSize, taken);
      taken.add(r2);
      const r3 = pickDistinct(rand, populationSize, taken);
      const forced = Math.floor(rand() * dim);
      const trial = population[i].x.map((v, d) => {
        if (d === forced || rand() < CR) {
          return population[r1].x[d] + F * (population[r2].x[d] - population[r3].x[d]);
        }
        return v;
      });
      const vertex = evalAt(trial);
      if (!vertex) break;
      if (vertex.f <= population[i].f) population[i] = vertex;
    }
    history.push(bestF);
  }

  return { x: bestX, f: bestF, evaluations, converged, history };
}
