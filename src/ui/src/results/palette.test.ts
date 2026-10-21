import { describe, expect, it } from "vitest";
import { buildPalette, resolveDark, seriesColorMap } from "./palette";

const LIGHT_KINDS = {
  stock: "#3b6ef5",
  flow: "#0f9d8a",
  converter: "#9a5cf0",
  success: "#1f9d6b",
  danger: "#d6455d",
};

describe("buildPalette", () => {
  it("mixes theme kind colors with Okabe-Ito hues", () => {
    const palette = buildPalette(LIGHT_KINDS);
    expect(palette).toContain("#3b6ef5");
    expect(palette).toContain("#0f9d8a");
    expect(palette).toContain("#9a5cf0");
    expect(palette).toContain("#e69f00");
  });

  it("yields 8 distinct colors", () => {
    const palette = buildPalette(LIGHT_KINDS);
    expect(palette).toHaveLength(8);
    expect(new Set(palette.map((c) => c.toLowerCase())).size).toBe(8);
  });

  it("starts with the stock color", () => {
    expect(buildPalette(LIGHT_KINDS)[0]).toBe("#3b6ef5");
  });

  it("deduplicates when theme colors collide and still reaches 8", () => {
    const palette = buildPalette({ ...LIGHT_KINDS, flow: LIGHT_KINDS.stock });
    expect(palette).toHaveLength(8);
    expect(new Set(palette.map((c) => c.toLowerCase())).size).toBe(8);
  });
});

describe("resolveDark", () => {
  it("prefers an explicit data-theme attribute", () => {
    expect(resolveDark("dark", false)).toBe(true);
    expect(resolveDark("light", true)).toBe(false);
  });

  it("falls back to the media query", () => {
    expect(resolveDark(null, true)).toBe(true);
    expect(resolveDark(null, false)).toBe(false);
  });
});

describe("seriesColorMap", () => {
  it("assigns a stable distinct color per name", () => {
    const palette = buildPalette(LIGHT_KINDS);
    const map = seriesColorMap(["a", "b", "c"], palette);
    expect(map.get("a")).toBe(palette[0]);
    expect(map.get("b")).toBe(palette[1]);
    expect(map.get("c")).toBe(palette[2]);
  });

  it("cycles the palette beyond 8 series", () => {
    const palette = buildPalette(LIGHT_KINDS);
    const names = Array.from({ length: 9 }, (_, i) => `s${i}`);
    const map = seriesColorMap(names, palette);
    expect(map.get("s8")).toBe(palette[0]);
  });
});
