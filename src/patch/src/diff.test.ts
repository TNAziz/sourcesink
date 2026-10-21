import { describe, expect, it } from "vitest";

import { emptyModel, type Model } from "@sourcesink/model";

import { applyPatch } from "./apply.js";
import { diffModels, renderDiff } from "./diff.js";

function base(): Model {
  const m = emptyModel("test");
  m.run = { start: 0, stop: 2, dt: 1, saveEvery: 1 };
  m.stocks = [{ kind: "stock", id: "pop", name: "Population", equation: "100", outflows: ["births"] }];
  m.flows = [{ kind: "flow", id: "births", name: "births", equation: "Population * growth rate" }];
  m.converters = [{ kind: "converter", id: "rate", name: "growth rate", equation: "0.1" }];
  m.connectors = [
    { kind: "connector", id: "p->b", name: "Population -> births", from: "Population", to: "births" },
  ];
  return m;
}

describe("diffModels / renderDiff", () => {
  it("reports field-level changes, connector and run changes as Markdown", () => {
    const before = base();
    const after = applyPatch(before, {
      ops: [
        { op: "update", name: "growth rate", changes: { equation: "0.2" } },
        { op: "setRun", run: { stop: 5 } },
        { op: "connect", from: "Population", to: "growth rate" },
      ],
    });
    const diff = diffModels(before, after);

    const changed = diff.elements.find((e) => e.name === "growth rate")!;
    expect(changed.change).toBe("changed");
    expect(changed.fields).toEqual([{ field: "equation", before: "0.1", after: "0.2" }]);
    expect(diff.connectors).toEqual([{ from: "Population", to: "growth rate", change: "added" }]);
    expect(diff.run).toEqual([{ field: "stop", before: 2, after: 5 }]);

    expect(renderDiff(diff)).toBe(
      [
        "# Model diff",
        "",
        "## Changed",
        "- **converter** `growth rate` — equation: `0.1` → `0.2`",
        "",
        "## Connectors",
        "- added `Population -> growth rate`",
        "",
        "## Run",
        "- `stop`: 2 → 5",
        "",
      ].join("\n"),
    );
  });

  it("reports added and removed elements with their fields", () => {
    const before = base();
    const after = applyPatch(before, {
      ops: [
        { op: "add", kind: "converter", element: { name: "k2", equation: "0.3" } },
        { op: "remove", name: "births" },
      ],
    });
    const diff = diffModels(before, after);
    expect(diff.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "converter", name: "k2", change: "added" }),
        expect.objectContaining({ kind: "flow", name: "births", change: "removed" }),
      ]),
    );
    expect(diff.connectors).toEqual([{ from: "Population", to: "births", change: "removed" }]);
    const markdown = renderDiff(diff);
    expect(markdown).toContain("## Added");
    expect(markdown).toContain("- **converter** `k2` — equation = `0.3`");
    expect(markdown).toContain("## Removed");
    expect(markdown).toContain("- **flow** `births` — equation = `Population * growth rate`");
  });

  it("renders an empty diff", () => {
    const m = base();
    expect(renderDiff(diffModels(m, m))).toBe("# Model diff\n\nNo changes.\n");
  });

  it("shows a rename as a name change when the id survives", () => {
    const before = base();
    const after = applyPatch(before, { ops: [{ op: "rename", name: "Population", to: "pop" }] });
    const diff = diffModels(before, after);
    const element = diff.elements.find((e) => e.name === "pop")!;
    expect(element.change).toBe("changed");
    expect(element.fields).toContainEqual({ field: "name", before: "Population", after: "pop" });
  });
});
