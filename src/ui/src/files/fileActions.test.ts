import { afterEach, describe, expect, it } from "vitest";

import { entity, runSpecs, stmFile } from "../../../legacy/src/stmBuilder.test-util";
import { useEditor } from "../state/store";
import { isLegacyFile, openModelContent, resetFileHandle } from "./fileActions";

afterEach(() => resetFileHandle());

describe("opening a legacy model", () => {
  it("recognises .stm/.itm in any case", () => {
    expect(["a.stm", "B.STM", "c.itm", "d.ITM"].every(isLegacyFile)).toBe(true);
    expect(isLegacyFile("model.xmile")).toBe(false);
  });

  it("imports the bytes and names the document as a new .xmile file", async () => {
    const bytes = stmFile([
      ...runSpecs(0, 10, 0.5, "Days"),
      ...entity({ kind: "s", name: "Water", equation: "5", outflows: [1] }, true),
      ...entity({ kind: "f", name: "draining", equation: "Water*0.1" }, false),
    ]);
    await openModelContent("Reservoir.STM", bytes, "/models/Reservoir.STM");
    const s = useEditor.getState();
    expect(s.fileName).toBe("Reservoir.xmile");
    expect(s.model.stocks.map((x) => x.name)).toEqual(["Water"]);
    expect(s.model.stocks[0].outflows).toEqual(["draining"]);
    expect(s.model.run).toMatchObject({ stop: 10, dt: 0.5, timeUnits: "Days" });
  });
});
