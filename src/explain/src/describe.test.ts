import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readXmile } from "@sourcesink/xmile";
import { coverage, describeModel } from "./index.ts";
import { logisticModel } from "./test-util.ts";

describe("describeModel", () => {
  it("writes natural, sectioned Markdown with the model's names", () => {
    const { markdown } = describeModel(logisticModel());
    for (const heading of [
      "## Overview",
      "## Stocks",
      "## Flows",
      "## Converters and graph functions",
      "## Feedback loops",
      "## Time settings",
    ]) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toContain("**Population**");
    expect(markdown).toContain("carrying capacity");
    expect(markdown).not.toContain("carrying_capacity");
    expect(markdown).toContain("R1");
    expect(markdown).toContain("B1");
  });

  it("accounts for every element and causal link", () => {
    const model = logisticModel();
    const description = describeModel(model);
    expect(coverage(model, description).complete).toBe(true);
  });

  it("covers every environmental example model", () => {
    const dir = new URL("../../../examples/environmental/", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".xmile"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const model = readXmile(readFileSync(new URL(file, dir), "utf8"));
      const report = coverage(model, describeModel(model));
      expect(report, file).toEqual({ missingElements: [], missingLinks: [], complete: true });
    }
  });

  it("reports a removed mention as missing", () => {
    const model = logisticModel();
    const description = describeModel(model);
    const damaged = {
      markdown: description.markdown,
      mentions: {
        elements: description.mentions.elements.filter((name) => name !== "crowding"),
        links: description.mentions.links.filter(
          (link) => !(link.from === "Population" && link.to === "crowding"),
        ),
      },
    };
    const report = coverage(model, damaged);
    expect(report.missingElements).toEqual(["crowding"]);
    expect(report.missingLinks).toEqual([{ from: "Population", to: "crowding" }]);
    expect(report.complete).toBe(false);
  });
});
