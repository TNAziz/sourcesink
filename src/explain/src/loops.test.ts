import { describe, expect, it } from "vitest";
import { findLoops } from "./index.ts";
import { decayModel, logisticModel, predatorPreyModel } from "./test-util.ts";

function cycleKey(elements: string[]): string {
  const min = elements.reduce((best, name) => (name < best ? name : best), elements[0]);
  const at = elements.indexOf(min);
  return [...elements.slice(at), ...elements.slice(0, at)].join("\u0000");
}

describe("findLoops", () => {
  it("finds the reinforcing births loop and the balancing crowding loop", () => {
    const { loops, truncated } = findLoops(logisticModel());
    expect(truncated).toBe(false);
    expect(loops).toHaveLength(2);

    const reinforcing = loops.find((l) => l.type === "reinforcing");
    const balancing = loops.find((l) => l.type === "balancing");
    expect(reinforcing?.elements).toEqual(["births", "Population"]);
    expect(balancing?.elements).toEqual(["births", "Population", "crowding"]);
    expect(reinforcing?.id).toBe("R1");
    expect(balancing?.id).toBe("B1");

    expect(reinforcing?.links.map((l) => l.polarity)).toEqual(["+", "+"]);
    expect(balancing?.links.map((l) => l.polarity)).toEqual(["+", "-", "+"]);
  });

  it("finds one balancing loop in simple decay", () => {
    const { loops } = findLoops(decayModel());
    expect(loops).toHaveLength(1);
    expect(loops[0].type).toBe("balancing");
    expect(new Set(loops[0].elements)).toEqual(new Set(["S", "drain"]));
  });

  it("types predator-prey loops without duplicates", () => {
    const { loops } = findLoops(predatorPreyModel());
    expect(loops.some((l) => l.type === "reinforcing")).toBe(true);
    expect(loops.some((l) => l.type === "balancing")).toBe(true);

    const keys = loops.map((l) => cycleKey(l.elements));
    expect(new Set(keys).size).toBe(keys.length);
    for (const loop of loops) {
      expect(loop.links).toHaveLength(loop.elements.length);
      expect(loop.links.map((l) => l.from)).toEqual(loop.elements);
    }
  });
});
