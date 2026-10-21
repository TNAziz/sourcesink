import { beforeEach, describe, expect, it } from "vitest";
import { emptyModel, type Model } from "@sourcesink/model";

import { useEditor } from "./store";

function base(): Model {
  const m = emptyModel("base");
  m.stocks = [{ kind: "stock", id: "pop", name: "Population", equation: "100", inflows: ["births"] }];
  m.flows = [{ kind: "flow", id: "births", name: "births", equation: "Population * 0.1" }];
  return m;
}

const st = () => useEditor.getState();

describe("applyModel", () => {
  beforeEach(() => st().loadModel(base(), null));

  it("replaces the model as one undoable step", () => {
    const next = emptyModel("assistant");
    next.stocks = [{ kind: "stock", id: "water", name: "Water", equation: "10", inflows: [] }];

    st().applyModel(next);

    expect(st().model.name).toBe("assistant");
    expect(st().model.stocks.map((s) => s.name)).toEqual(["Water"]);
    expect(st().dirty).toBe(true);
    expect(st().past).toHaveLength(1);
    expect(st().past[0].name).toBe("base");

    st().undo();
    expect(st().model.name).toBe("base");
    st().redo();
    expect(st().model.name).toBe("assistant");
  });

  it("clears redo, the last run result and its error", () => {
    st().run();
    expect(st().result).not.toBeNull();

    st().undo();
    st().redo();
    expect(st().future).toHaveLength(0);

    st().run();
    st().applyModel(base());
    expect(st().result).toBeNull();
    expect(st().runError).toBeNull();
    expect(st().future).toHaveLength(0);
  });

  it("stores a copy, not the caller's object", () => {
    const next = emptyModel("copy");
    st().applyModel(next);
    next.name = "mutated";
    expect(st().model.name).toBe("copy");
  });
});
