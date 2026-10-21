import { beforeEach, describe, expect, it } from "vitest";
import { emptyModel, type Model } from "@sourcesink/model";

import { useEditor } from "./store";

function base(): Model {
  const m = emptyModel("arrays");
  m.converters = [{ kind: "converter", id: "rate", name: "rate", equation: "0.1" }];
  return m;
}

const st = () => useEditor.getState();

describe("array editing in the store", () => {
  beforeEach(() => st().loadModel(base(), null));

  it("defines dimensions and arrays an element over them", () => {
    st().setDimensions([{ name: "Region", values: ["North", "South"] }]);
    st().setElementDimensions("rate", ["Region"]);
    expect(st().model.dimensions.map((d) => [d.name, d.values])).toEqual([["Region", ["North", "South"]]]);
    expect(st().model.arrayed.rate).toEqual({ dimensions: ["Region"] });
  });

  it("sets and clears per-element equations, as undoable steps", () => {
    st().setDimensions([{ name: "Region", values: ["North", "South"] }]);
    st().setElementDimensions("rate", ["Region"]);
    st().setElementEquation("rate", "South", "0.2");
    expect(st().model.arrayed.rate.elements).toEqual({ South: "0.2" });
    st().setElementEquation("rate", "South", null);
    expect(st().model.arrayed.rate).toEqual({ dimensions: ["Region"] });
    st().undo();
    expect(st().model.arrayed.rate.elements).toEqual({ South: "0.2" });
  });

  it("drops a removed dimension from arrayed elements", () => {
    st().setDimensions([
      { name: "Region", values: ["North", "South"] },
      { name: "Age", values: ["Young", "Old"] },
    ]);
    st().setElementDimensions("rate", ["Region", "Age"]);
    st().setDimensions([{ name: "Age", values: ["Young", "Old"] }]);
    expect(st().model.arrayed.rate).toEqual({ dimensions: ["Age"] });
    st().setDimensions([]);
    expect(st().model.arrayed.rate).toBeUndefined();
  });

  it("runs an arrayed model", () => {
    st().setDimensions([{ name: "Region", values: ["North", "South"] }]);
    st().setElementDimensions("rate", ["Region"]);
    st().setElementEquation("rate", "South", "0.2");
    st().run();
    expect(st().runError).toBeNull();
    expect(st().result?.series["rate[South]"][0]).toBe(0.2);
  });
});

describe("scenarios in the store", () => {
  function scenarioBase(): Model {
    const m = emptyModel("scenarios");
    m.stocks = [{ kind: "stock", id: "pop", name: "Population", equation: "100", inflows: ["births"] }];
    m.flows = [{ kind: "flow", id: "births", name: "births", equation: "Population * rate" }];
    m.converters = [{ kind: "converter", id: "rate", name: "rate", equation: "0.1" }];
    return m;
  }

  beforeEach(() => st().loadModel(scenarioBase(), null));

  it("adds scenarios with unique ids and names, as an undoable step", () => {
    const first = st().addScenario("High growth");
    const second = st().addScenario("High growth");
    expect(st().model.scenarios?.map((s) => [s.id, s.name])).toEqual([
      ["high-growth", "High growth"],
      ["high-growth-2", "High growth 2"],
    ]);
    expect(st().dirty).toBe(true);
    st().undo();
    expect(st().model.scenarios?.map((s) => s.id)).toEqual([first]);
    expect(second).toBe("high-growth-2");
  });

  it("updates and deletes scenarios through the undo history", () => {
    const id = st().addScenario("Half");
    st().updateScenario(id, { overrides: { Population: 50 }, run: { stop: 4 } });
    expect(st().model.scenarios?.[0]).toMatchObject({ overrides: { Population: 50 }, run: { stop: 4 } });
    st().undo();
    expect(st().model.scenarios?.[0].overrides).toEqual({});
    st().redo();

    st().setActiveScenario(id);
    st().deleteScenario(id);
    expect(st().model.scenarios ?? []).toHaveLength(0);
    expect(st().activeScenario).toBeNull();
    st().undo();
    expect(st().model.scenarios?.map((s) => s.id)).toEqual([id]);
  });

  it("selects an active scenario without dirtying the model or adding undo", () => {
    st().setActiveScenario("scenario-x");
    expect(st().activeScenario).toBe("scenario-x");
    expect(st().dirty).toBe(false);
    expect(st().past).toHaveLength(0);
  });

  it("applies the active scenario (and its stop time) on run", () => {
    const id = st().addScenario("Half");
    st().updateScenario(id, { overrides: { Population: 50 }, run: { stop: 2 } });
    st().setActiveScenario(id);
    st().run();
    expect(st().runError).toBeNull();
    expect(st().result?.series.Population[0]).toBe(50);
    expect(st().result?.time.at(-1)).toBe(2);

    st().setActiveScenario(null);
    st().run();
    expect(st().result?.series.Population[0]).toBe(100);
  });
});
