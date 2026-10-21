import { describe, expect, it } from "vitest";

import { uplotBands } from "./AnalyzeChart";

describe("uplotBands", () => {
  it("fills from the upper edge series down to its lower `bandTo` edge", () => {
    const bands = uplotBands([
      { name: "5%", color: "transparent", values: [0] },
      { name: "95%", color: "transparent", values: [1], bandTo: 1, bandFill: "red" },
      { name: "Median", color: "#3366ff", values: [0.5] },
    ]);
    expect(bands).toEqual([{ series: [2, 1], fill: "red" }]);
  });
});
