import { describe, expect, it } from "vitest";
import {
  bowControl,
  connectorBow,
  formatValue,
  pointSegDist,
  segSegDist,
  type Segment,
} from "./geometry";

const close = (a: number, b: number, tol = 0.001) => Math.abs(a - b) <= tol;
const seg = (ax: number, ay: number, bx: number, by: number): Segment => ({
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
});

describe("bowControl", () => {
  it("bows clockwise for positive offsets (south for eastbound links)", () => {
    const c = bowControl({ x: 0, y: 0 }, { x: 100, y: 0 }, 15);
    expect(close(c.x, 50)).toBe(true);
    expect(close(c.y, 15)).toBe(true);
  });

  it("bows counter-clockwise for negative offsets", () => {
    const c = bowControl({ x: 0, y: 0 }, { x: 100, y: 0 }, -15);
    expect(close(c.y, -15)).toBe(true);
  });

  it("west of a southbound link for a positive offset", () => {
    const c = bowControl({ x: 0, y: 0 }, { x: 0, y: 100 }, 10);
    expect(close(c.x, -10)).toBe(true);
    expect(close(c.y, 50)).toBe(true);
  });

  it("degrades to the midpoint for a zero offset", () => {
    expect(bowControl({ x: 0, y: 0 }, { x: 80, y: 40 }, 0)).toEqual({ x: 40, y: 20 });
  });
});

describe("connectorBow", () => {
  it("bows gently (min(30, 15% of length)) and clockwise when pipes are far", () => {
    const far = seg(0, 200, 200, 200);
    expect(connectorBow({ x: 0, y: 0 }, { x: 200, y: 0 }, [far])).toBe(30);
    expect(connectorBow({ x: 0, y: 0 }, { x: 60, y: 0 }, [])).toBe(9);
  });

  it("bends away from a pipe that runs just south of the link", () => {
    const pipe = seg(0, 4, 200, 4); // 4px below an eastbound chord
    expect(connectorBow({ x: 0, y: 0 }, { x: 200, y: 0 }, [pipe])).toBe(-30);
  });

  it("bends away from a pipe just north of the link", () => {
    const pipe = seg(0, -4, 200, -4);
    expect(connectorBow({ x: 0, y: 0 }, { x: 200, y: 0 }, [pipe])).toBe(30);
  });

  it("keeps the clockwise side when the pipe lies exactly on the chord", () => {
    const pipe = seg(0, 0, 200, 0);
    expect(connectorBow({ x: 0, y: 0 }, { x: 200, y: 0 }, [pipe])).toBe(30);
  });

  it("only clears as much as needed on short links", () => {
    const pipe = seg(0, 2, 60, 2); // base bow would be 9, clearance needs 20
    expect(connectorBow({ x: 0, y: 0 }, { x: 60, y: 0 }, [pipe])).toBe(-20);
  });

  it("ignores pipes that only share the chord's boundary tip", () => {
    // A pipe starting at the chord's far end, heading away east.
    const pipe = seg(0, 100, 50, 100);
    expect(connectorBow({ x: 0, y: 0 }, { x: 0, y: 100 }, [pipe])).toBe(15);
  });
});

describe("segSegDist / pointSegDist", () => {
  it("returns 0 for crossing, touching or collinear segments", () => {
    expect(segSegDist({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(0);
    expect(segSegDist({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 })).toBe(0);
    expect(segSegDist({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 })).toBe(0);
  });

  it("measures parallel and disjoint segments", () => {
    expect(segSegDist({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(5);
    expect(segSegDist({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 })).toBe(10);
    expect(segSegDist({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 })).toBe(10);
  });

  it("clamps point distance to segment ends", () => {
    expect(pointSegDist({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(pointSegDist({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(pointSegDist({ x: 3, y: 4 }, { x: 3, y: 3 }, { x: 3, y: 3 })).toBe(1);
  });
});

describe("formatValue", () => {
  it("formats compactly for on-canvas display", () => {
    expect(formatValue(1234.5678)).toBe("1235");
    expect(formatValue(0.5)).toBe("0.5");
    expect(formatValue(0)).toBe("0");
    expect(formatValue(Number.NaN)).toBe("—");
    expect(formatValue(1e-5)).toBe("1.00e-5");
    expect(formatValue(2e7)).toBe("2.00e+7");
  });
});
