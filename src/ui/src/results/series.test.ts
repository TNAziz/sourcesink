import { describe, expect, it } from "vitest";
import type { Model } from "@sourcesink/model";
import { emptyModel } from "@sourcesink/model";
import {
  defaultPlotted,
  effectivePlotted,
  padHeights,
  runCaption,
  seriesNames,
  togglePlotted,
  visibleRange,
} from "./series";

function testModel(): Model {
  const model = emptyModel();
  model.stocks.push({
    id: "s1",
    name: "Population",
    kind: "stock",
    equation: "100",
    inflows: ["f1"],
  });
  model.flows.push({ id: "f1", name: "births", kind: "flow", equation: "1" });
  model.converters.push({ id: "c1", name: "rate", kind: "converter", equation: "0.5" });
  return model;
}

const AVAILABLE = ["Population", "births", "rate"];

describe("seriesNames", () => {
  it("lists stocks, flows and converters in model order", () => {
    expect(seriesNames(testModel())).toEqual(["Population", "births", "rate"]);
  });

  it("appends extras (e.g. stale run keys) that are not in the model", () => {
    expect(seriesNames(testModel(), ["old_name", "rate"])).toEqual([
      "Population",
      "births",
      "rate",
      "old_name",
    ]);
  });
});

describe("defaultPlotted", () => {
  it("is every stock", () => {
    expect(defaultPlotted(testModel())).toEqual(["Population"]);
  });

  it("is empty for a model without stocks", () => {
    const model = testModel();
    model.stocks = [];
    expect(defaultPlotted(model)).toEqual([]);
  });
});

describe("effectivePlotted", () => {
  it("falls back to all stocks when plotted is empty", () => {
    expect(effectivePlotted([], testModel(), AVAILABLE)).toEqual(["Population"]);
  });

  it("keeps the plotted set, reordered to model order", () => {
    expect(effectivePlotted(["rate", "Population"], testModel(), AVAILABLE)).toEqual([
      "Population",
      "rate",
    ]);
  });

  it("drops names without data and unknown names", () => {
    expect(effectivePlotted(["births", "ghost"], testModel(), ["births"])).toEqual([
      "births",
    ]);
  });

  it("yields nothing when the default stock has no data", () => {
    expect(effectivePlotted([], testModel(), ["births"])).toEqual([]);
  });
});

describe("togglePlotted", () => {
  it("adds a flow on top of the default stocks", () => {
    expect(togglePlotted([], "births", testModel())).toEqual(["Population", "births"]);
  });

  it("removes a plotted name", () => {
    expect(togglePlotted(["Population", "births"], "births", testModel())).toEqual([
      "Population",
    ]);
  });

  it("turns the last remaining series off, which resets to the default", () => {
    expect(togglePlotted(["Population"], "Population", testModel())).toEqual([]);
  });

  it("keeps stale plotted names at the end", () => {
    expect(togglePlotted(["old_name"], "Population", testModel())).toEqual([
      "Population",
      "old_name",
    ]);
    expect(togglePlotted(["old_name", "rate"], "rate", testModel())).toEqual(["old_name"]);
  });
});

describe("visibleRange", () => {
  const TOTAL = 10_000;
  const ROW = 28;
  const VIEW = 280;

  it("covers the viewport plus overscan at the top", () => {
    expect(visibleRange(0, VIEW, TOTAL, ROW)).toEqual({ start: 0, end: 20 });
  });

  it("slides the window with scrollTop", () => {
    expect(visibleRange(280, VIEW, TOTAL, ROW)).toEqual({ start: 0, end: 30 });
    expect(visibleRange(294, VIEW, TOTAL, ROW)).toEqual({ start: 0, end: 31 });
    expect(visibleRange(2800, VIEW, TOTAL, ROW)).toEqual({ start: 90, end: 120 });
  });

  it("clamps to the last row", () => {
    expect(visibleRange(27972, VIEW, 1005, ROW)).toEqual({ start: 989, end: 1005 });
  });

  it("handles empty and degenerate inputs", () => {
    expect(visibleRange(0, VIEW, 0, ROW)).toEqual({ start: 0, end: 0 });
    expect(visibleRange(0, 0, TOTAL, ROW)).toEqual({ start: 0, end: 0 });
    expect(visibleRange(0, VIEW, 5, ROW, 10)).toEqual({ start: 0, end: 5 });
  });
});

describe("padHeights", () => {
  it("sizes spacers for the rows outside the window", () => {
    expect(padHeights({ start: 90, end: 120 }, 10_000, 28)).toEqual({
      top: 2520,
      bottom: 276_640,
    });
  });

  it("is zero when everything is rendered", () => {
    expect(padHeights({ start: 0, end: 5 }, 5, 28)).toEqual({ top: 0, bottom: 0 });
  });
});

describe("runCaption", () => {
  it("shows start, stop, time units and DT", () => {
    const model = testModel();
    expect(runCaption(model.run)).toBe("t = 0 … 12 Year, DT = 0.25");
  });

  it("omits missing time units", () => {
    const model = testModel();
    model.run.timeUnits = undefined;
    expect(runCaption(model.run)).toBe("t = 0 … 12, DT = 0.25");
  });
});

describe("arrayed series", () => {
  it("expand arrayed elements into one series per element", () => {
    const m = emptyModel("a");
    m.dimensions = [{ kind: "dimension", id: "R", name: "R", values: ["N", "S"] }];
    m.stocks = [{ kind: "stock", id: "P", name: "P", equation: "1" }];
    m.converters = [{ kind: "converter", id: "k", name: "k", equation: "1" }];
    m.arrayed = { P: { dimensions: ["R"] } };
    expect(seriesNames(m)).toEqual(["P[N]", "P[S]", "k"]);
    expect(defaultPlotted(m)).toEqual(["P[N]", "P[S]"]);
  });
});
