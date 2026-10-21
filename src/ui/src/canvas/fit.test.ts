import { describe, expect, it } from "vitest";
import { MIN_READABLE_ZOOM, readableViewport } from "./fit";

describe("readableViewport", () => {
  it("centres a small diagram, capped at the maximum zoom", () => {
    const vp = readableViewport({ x: 0, y: 0, width: 100, height: 100 }, 1000, 800);
    expect(vp.zoom).toBe(1.3);
    expect(vp.x).toBeCloseTo((1000 - 130) / 2);
    expect(vp.y).toBeCloseTo((800 - 130) / 2);
  });

  it("fits a medium diagram exactly", () => {
    const vp = readableViewport({ x: 100, y: 50, width: 1000, height: 400 }, 1000, 800);
    expect(vp.zoom).toBeCloseTo(0.8);
    expect(vp.x + 100 * vp.zoom).toBeCloseTo(100);
  });

  it("holds the minimum zoom for a huge diagram and shows its top-left", () => {
    const vp = readableViewport({ x: -200, y: 40, width: 6000, height: 9000 }, 1000, 800);
    expect(vp.zoom).toBe(MIN_READABLE_ZOOM);
    // Content's top-left corner lands at the padding.
    expect(vp.x + -200 * vp.zoom).toBeCloseTo(100);
    expect(vp.y + 40 * vp.zoom).toBeCloseTo(80);
  });
});
