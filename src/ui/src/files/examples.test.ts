import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  attributionFor,
  categoryCounts,
  doiUrl,
  filterExamples,
  getExample,
  levelCounts,
  listExamples,
  parseExampleDescriptions,
  shortAttribution,
} from "./examples";

describe("parseExampleDescriptions", () => {
  it("pulls the Question paragraph under each model heading", () => {
    const md = [
      "# Examples",
      "",
      "## 1. `alpha.xmile` — First model",
      "",
      "**Question:** How does alpha behave?",
      "Does it settle?",
      "",
      "**State:** x.",
      "",
      "## 2. `beta.xmile` — Second model",
      "",
      "**Question:** What about beta?",
      "",
    ].join("\n");

    const out = parseExampleDescriptions(md);
    expect(out["alpha.xmile"]).toBe("How does alpha behave? Does it settle?");
    expect(out["beta.xmile"]).toBe("What about beta?");
    expect(Object.keys(out)).toHaveLength(2);
  });

  it("ignores headings without a Question paragraph", () => {
    expect(parseExampleDescriptions("## `gamma.xmile`\n\nNo question here.")).toEqual({});
  });
});

describe("listExamples", () => {
  it("parses every bundled example with counts and descriptions", () => {
    const examples = listExamples();
    expect(examples.length).toBeGreaterThanOrEqual(8);
    for (const entry of examples) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.stocks + entry.flows + entry.converters).toBeGreaterThan(0);
    }
  });

  it("includes the logistic-harvest starter with the expected shape", () => {
    const example = getExample("logistic-harvest");
    expect(example).toBeDefined();
    expect(example!.stocks).toBe(1);
    expect(example!.flows).toBe(2);
    expect(example!.converters).toBe(4);
    expect(example!.documentation.length).toBeGreaterThan(0);
  });

  it("caches its result", () => {
    expect(listExamples()).toBe(listExamples());
  });
});

describe("catalog metadata", () => {
  it("exposes the known categories with display names and blurbs", () => {
    expect(CATEGORIES.map((category) => category.id)).toEqual([
      "environmental",
      "business",
      "resources",
      "climate",
      "ecology",
      "problem-solving",
    ]);
    expect(CATEGORIES[0].name).toBe("Environmental engineering");
    expect(CATEGORIES[5].name).toBe("Environmental problem solving");
    for (const category of CATEGORIES) expect(category.blurb.length).toBeGreaterThan(0);
  });

  it("loads level, summary, question, teaching and references from the catalog", () => {
    const streeter = getExample("streeter-phelps");
    expect(streeter).toBeDefined();
    expect(streeter!.category).toBe("environmental");
    expect(streeter!.level).toBe("intro");
    expect(streeter!.summary).toContain("dissolved oxygen");
    expect(streeter!.question).toContain("waste load");
    expect(streeter!.teaching).toContain("deficit");
    expect(streeter!.references).toHaveLength(1);
    expect(streeter!.references[0].citation).toContain("Streeter");
  });

  it("builds short attributions and DOI links from the first reference", () => {
    const monod = getExample("activated-sludge")!;
    expect(shortAttribution(monod.references[0])).toBe("Monod (1949)");
    expect(doiUrl(monod.references[0].doi!)).toBe("https://doi.org/10.1146/annurev.mi.03.100149.002103");
    expect(attributionFor(monod)).toBe("Monod (1949)");
    expect(attributionFor(getExample("logistic-harvest")!)).toBe("Schaefer (1954)");
    expect(attributionFor(getExample("co2-accumulation")!)).toBe("SourceSink original");
  });

  it("filters by text, category and level", () => {
    const examples = listExamples();
    const environmental = filterExamples(examples, { category: "environmental" });
    expect(environmental.length).toBe(examples.filter((e) => e.category === "environmental").length);
    expect(environmental.length).toBeGreaterThanOrEqual(8);
    for (const entry of environmental) expect(entry.category).toBe("environmental");
    expect(filterExamples(examples, { query: "phosphorus" }).map((entry) => entry.id)).toContain(
      "eutrophication",
    );
    expect(filterExamples(examples, { query: "Schaefer" }).map((entry) => entry.id)).toContain(
      "logistic-harvest",
    );
    const intro = filterExamples(examples, { level: "intro" });
    expect(intro.length).toBeGreaterThan(0);
    for (const entry of intro) expect(entry.level).toBe("intro");
    expect(filterExamples(examples, { query: "no-such-model" })).toEqual([]);
  });

  it("counts categories and levels after the current filters", () => {
    const examples = listExamples();
    const counts = categoryCounts(examples);
    expect(counts.environmental).toBe(examples.filter((e) => e.category === "environmental").length);
    const total = Object.values(counts as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(total).toBe(examples.length);
    const levels = levelCounts(examples);
    expect(levels.all).toBe(examples.length);
    expect(levels.intro + levels.intermediate + levels.advanced).toBe(examples.length);
  });
});
