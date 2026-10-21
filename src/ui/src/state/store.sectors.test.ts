import { describe, expect, it } from "vitest";
import { simulate } from "@sourcesink/engine";
import { emptyModel, type Model } from "@sourcesink/model";

import { useEditor } from "./store";

const st = () => useEditor.getState();

/** Two plants written out by hand: `cap_1`, `cap_2`, … */
function copies(): Model {
  const m = emptyModel("copies");
  m.run = { ...m.run, start: 0, stop: 4, dt: 1, saveEvery: 1 };
  for (const i of ["1", "2"]) {
    m.stocks.push({ kind: "stock", id: `cap_${i}`, name: `cap_${i}`, equation: "0", inflows: [`build_${i}`] });
    m.flows.push({ kind: "flow", id: `build_${i}`, name: `build_${i}`, equation: `rate_${i}` });
    m.converters.push({ kind: "converter", id: `rate_${i}`, name: `rate_${i}`, equation: i });
  }
  m.converters.push({ kind: "converter", id: "total", name: "total", equation: "cap_1 + cap_2" });
  m.sectors = [{ id: "s1", name: "Plants", members: ["cap_1", "build_1", "rate_1", "cap_2", "build_2", "rate_2"] }];
  return m;
}

describe("store — sectors", () => {
  it("keeps sector members in step with renames and deletes", () => {
    st().loadModel(copies(), null);
    expect(st().renameElement("rate_1", "speed_1")).toBeNull();
    expect(st().model.sectors![0].members).toContain("speed_1");
    st().deleteElements(["rate_1"]); // ids survive renames
    expect(st().model.sectors![0].members).not.toContain("speed_1");
  });

  it("folds, unfolds, groups, moves and removes sectors", () => {
    st().loadModel(copies(), null);
    st().toggleSector("s1");
    expect(st().model.sectors![0].collapsed).toBe(true);
    st().setAllSectorsCollapsed(false);
    expect(st().model.sectors![0].collapsed).toBeUndefined();
    const id = st().addSector("Totals", ["total"]);
    expect(st().model.sectors!.find((s) => s.id === id)!.members).toEqual(["total"]);
    st().moveToSector(["total"], "s1");
    expect(st().model.sectors!.map((s) => s.name)).toEqual(["Plants"]);
    expect(st().renameSector("s1", "  ")).toMatch(/name/);
    st().deleteSector("s1");
    expect(st().model.sectors).toBeUndefined();
  });

  it("converts copies to arrays with unchanged results and sectors that follow", () => {
    st().loadModel(copies(), null);
    const before = simulate(st().model);
    const plans = [
      {
        name: "Plant",
        labels: ["1", "2"],
        families: (["stock", "flow", "converter"] as const).map((kind) => ({
          base: kind === "stock" ? "cap" : kind === "flow" ? "build" : "rate",
          kind,
          members: ["1", "2"].map((label) => ({ name: `${kind === "stock" ? "cap" : kind === "flow" ? "build" : "rate"}_${label}`, label })),
        })),
      },
    ];
    expect(st().convertToArrays(plans)).toBeNull();
    const after = simulate(st().model);
    expect(after.series["cap[2]"]).toEqual(before.series.cap_2);
    expect(after.series.total).toEqual(before.series.total);
    expect(st().model.sectors![0].members.sort()).toEqual(["build", "cap", "rate"]);
    st().undo();
    expect(st().model.stocks).toHaveLength(2);
  });
});
