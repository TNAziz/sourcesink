import { describe, expect, it } from "vitest";
import { emptyModel, type Model } from "@sourcesink/model";

import { useEditor } from "./store";

const st = () => useEditor.getState();

function unwired(): Model {
  const m = emptyModel();
  m.flows = [{ kind: "flow", id: "f", name: "out", equation: "k * 2" }];
  m.converters = [
    { kind: "converter", id: "k", name: "k", equation: "j + 1" },
    { kind: "converter", id: "j", name: "j", equation: "3" },
  ];
  return m;
}

describe("store — inferred connectors", () => {
  it("draws the implied links when a model with no connectors is loaded", () => {
    st().loadModel(unwired(), null);
    expect(st().model.connectors.map((c) => `${c.from}->${c.to}`)).toEqual(["k->out", "j->k"]);
    expect(st().dirty).toBe(false);
  });

  it("leaves a model that already draws some links alone; Connect all adds the rest as one undo step", () => {
    const m = unwired();
    m.connectors = [{ kind: "connector", id: "c", name: "j -> k", from: "j", to: "k" }];
    st().loadModel(m, null);
    expect(st().model.connectors).toHaveLength(1);
    expect(st().connectAll()).toBe(1);
    expect(st().model.connectors).toHaveLength(2);
    expect(st().connectAll()).toBe(0);
    st().undo();
    expect(st().model.connectors).toHaveLength(1);
  });

  it("toggles constants without touching the model or history", () => {
    st().loadModel(unwired(), null);
    st().setShowConstants(false);
    expect(st().showConstants).toBe(false);
    expect(st().past).toEqual([]);
    st().setShowConstants(true);
  });
});
