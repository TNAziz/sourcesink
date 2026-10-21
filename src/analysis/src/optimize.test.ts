import { describe, expect, it } from "vitest";

import { differentialEvolution, nelderMead } from "./optimize.js";

/** Classic 2-D Rosenbrock banana: minimum 0 at (1, 1). */
function rosenbrock(x: number[]): number {
  return (1 - x[0]) ** 2 + 100 * (x[1] - x[0] ** 2) ** 2;
}

/** Shifted, scaled sphere: minimum 0 at `center`. */
function sphere(center: number[]): (x: number[]) => number {
  return (x) => x.reduce((sum, v, i) => sum + (v - center[i]) ** 2, 0);
}

const BOUNDS_2D: [number[], number[]] = [
  [-2, -2],
  [2, 2],
];
const BOUNDS_4D: [number[], number[]] = [
  [-5, -5, -5, -5],
  [5, 5, 5, 5],
];

describe("nelderMead", () => {
  it("finds the Rosenbrock minimum inside the box", () => {
    const result = nelderMead(rosenbrock, [-1.2, 1], BOUNDS_2D[0], BOUNDS_2D[1], {
      maxEvaluations: 40_000,
      tol: 1e-12,
    });
    expect(result.converged).toBe(true);
    expect(Math.abs(result.x[0] - 1)).toBeLessThan(1e-4);
    expect(Math.abs(result.x[1] - 1)).toBeLessThan(1e-4);
    expect(result.f).toBeLessThan(1e-8);
    expect(result.history.length).toBe(result.evaluations);
    expect(result.history.at(-1)).toBe(result.f);
  });

  it("finds a shifted sphere minimum in 4-D", () => {
    const center = [1, -2, 0.5, 3];
    const result = nelderMead(sphere(center), [0.5, -0.5, 0, 1.5], BOUNDS_4D[0], BOUNDS_4D[1], {
      maxEvaluations: 40_000,
      tol: 1e-12,
    });
    expect(result.converged).toBe(true);
    for (let i = 0; i < center.length; i += 1) {
      expect(Math.abs(result.x[i] - center[i])).toBeLessThan(1e-3);
    }
  });

  it("survives NaN and Infinity regions by treating them as +Infinity", () => {
    const f = (x: number[]): number =>
      x[0] < 0
        ? Number.NaN
        : x[0] > 0.9
          ? Number.POSITIVE_INFINITY
          : x[0] < 0.5
            ? 2 * (x[0] - 0.5) ** 2
            : (x[0] - 0.5) ** 2;
    const result = nelderMead(f, [0.8], [-1], [1], { maxEvaluations: 5_000, tol: 1e-10 });
    expect(Number.isFinite(result.f)).toBe(true);
    expect(Math.abs(result.x[0] - 0.5)).toBeLessThan(1e-3);
  });

  it("stops at the evaluation budget", () => {
    const result = nelderMead(rosenbrock, [0, 0], BOUNDS_2D[0], BOUNDS_2D[1], {
      maxEvaluations: 25,
    });
    expect(result.evaluations).toBeLessThanOrEqual(25);
    expect(result.converged).toBe(false);
  });
});

describe("differentialEvolution", () => {
  it("finds the Rosenbrock minimum", () => {
    const result = differentialEvolution(rosenbrock, BOUNDS_2D[0], BOUNDS_2D[1], {
      maxEvaluations: 60_000,
      tol: 1e-10,
      seed: 123,
    });
    expect(Math.abs(result.x[0] - 1)).toBeLessThan(1e-2);
    expect(Math.abs(result.x[1] - 1)).toBeLessThan(1e-2);
  });

  it("finds a shifted sphere minimum in 4-D", () => {
    const center = [1, -2, 0.5, 3];
    const result = differentialEvolution(sphere(center), BOUNDS_4D[0], BOUNDS_4D[1], {
      maxEvaluations: 60_000,
      tol: 1e-10,
      seed: 7,
    });
    for (let i = 0; i < center.length; i += 1) {
      expect(Math.abs(result.x[i] - center[i])).toBeLessThan(1e-2);
    }
  });

  it("is reproducible for a given seed", () => {
    const run = (): ReturnType<typeof differentialEvolution> =>
      differentialEvolution(rosenbrock, BOUNDS_2D[0], BOUNDS_2D[1], {
        maxEvaluations: 2_000,
        seed: 42,
      });
    const first = run();
    const second = run();
    expect(second.x).toEqual(first.x);
    expect(second.f).toBe(first.f);
    expect(second.evaluations).toBe(first.evaluations);
    expect(second.history).toEqual(first.history);
  });

  it("survives NaN regions by treating them as +Infinity", () => {
    const f = (x: number[]): number => (x[0] < 0 ? Number.NaN : (x[0] - 0.5) ** 2);
    const result = differentialEvolution(f, [-1], [1], {
      maxEvaluations: 5_000,
      tol: 1e-10,
      seed: 3,
    });
    expect(Number.isFinite(result.f)).toBe(true);
    expect(Math.abs(result.x[0] - 0.5)).toBeLessThan(1e-2);
  });
});
