import { describe, expect, it } from "vitest";

import { align, interpolateAt } from "./align.js";

describe("align", () => {
  it("interpolates the simulation to observation times", () => {
    expect(interpolateAt([0, 1, 2], [0, 10, 30], 1.5)).toBe(20);
    expect(interpolateAt([0, 1, 2], [0, 10, 30], 2)).toBe(30);
    expect(interpolateAt([0, 1, 2], [0, 10, 30], 3)).toBeNaN();
  });

  it("pairs observed and simulated values, dropping NaN and out-of-span points", () => {
    const result = { time: [0, 1, 2], series: { S: [0, 10, 30] } };
    const data = { time: [0.5, 1, 1.5, 5], series: { S: [4, Number.NaN, 21, 99] } };
    expect(align(result, data)).toEqual([{ series: "S", time: [0.5, 1.5], observed: [4, 21], simulated: [5, 20] }]);
  });

  it("refuses observed series the model does not produce", () => {
    expect(() => align({ time: [0], series: { S: [1] } }, { time: [0], series: { T: [1] } })).toThrow(/'T'/);
  });
});
