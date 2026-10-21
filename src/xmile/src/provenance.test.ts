import { describe, expect, it } from "vitest";
import { emptyModel, type Model } from "@sourcesink/model";
import { readXmile, writeXmile } from "./index.ts";

const richModel = (): Model => ({
  ...emptyModel("Provenance demo"),
  stocks: [
    {
      kind: "stock",
      id: "Population",
      name: "Population",
      equation: "100",
      inflows: ["births"],
      provenance: {
        author: "ai",
        agent: "sourcesink-assistant",
        promptHash: "sha256:abc123",
        sources: ["https://doi.org/10.1000/xyz", "dataset:pop-2020"],
        confidence: 0.8,
        createdAt: "2026-01-02T03:04:05Z",
      },
      annotations: { reviewed: true, tags: ["baseline", "v2"] },
    },
  ],
  flows: [
    {
      kind: "flow",
      id: "births",
      name: "births",
      equation: "Population * birth_fraction",
      provenance: { author: "human" },
    },
  ],
  converters: [
    {
      kind: "converter",
      id: "birth_fraction",
      name: "birth_fraction",
      equation: "0.02",
      annotations: { note: "calibrated 2024" },
    },
  ],
  graphFunctions: [
    {
      kind: "graphFunction",
      id: "seasonal",
      name: "seasonal",
      points: [
        { x: 0, y: 1 },
        { x: 12, y: 1.2 },
      ],
      interpolation: "linear",
      extrapolation: "clip",
      provenance: { author: "import", agent: "legacy" },
    },
  ],
  metadata: {
    version: "1.2.0",
    license: "CC-BY-4.0",
    intendedUse: "research",
    authors: ["Ada Lovelace", "Alan Turing"],
    provenance: {
      author: "human",
      agent: "sourcesink-ui",
      sources: ["https://example.org/model"],
      createdAt: "2025-12-31T23:59:59Z",
    },
  },
  scenarios: [
    {
      id: "base",
      name: "Baseline",
      overrides: { birth_fraction: 0.02, shock: 1 },
      run: { stop: 40, dt: 0.25 },
      documentation: "Defaults from the paper.",
    },
    {
      id: "high",
      name: "High growth",
      overrides: { birth_fraction: 0.04, label: "high" },
      run: { stop: 50 },
    },
  ],
});

describe("SourceSink extensions in XMILE", () => {
  it("round-trips metadata, element provenance, annotations and scenarios", () => {
    const model = richModel();
    const out = readXmile(writeXmile(model));

    expect(out.metadata).toEqual(model.metadata);

    const stock = out.stocks[0];
    expect(stock.provenance).toEqual(model.stocks[0].provenance);
    expect(stock.annotations).toEqual({ reviewed: true, tags: ["baseline", "v2"] });
    expect(out.flows[0].provenance).toEqual({ author: "human" });
    expect(out.converters[0].annotations).toEqual({ note: "calibrated 2024" });
    expect(out.graphFunctions[0].provenance).toEqual({ author: "import", agent: "legacy" });

    expect(out.scenarios).toEqual(model.scenarios);
    expect(typeof out.scenarios?.[0].overrides.shock).toBe("number");
    expect(out.scenarios?.[1].overrides.label).toBe("high");
  });

  it("reads scenario overrides as numbers only when the text is a finite number", () => {
    const xml = `<?xml version="1.0"?>
<xmile version="1.0" xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0" xmlns:ss="https://sourcesink.dev/xmile/1">
  <sim_specs><start>0</start><stop>1</stop><dt>1</dt></sim_specs>
  <model>
    <variables/>
    <ss:scenarios>
      <ss:scenario id="s" name="S">
        <ss:override name="K">0.5</ss:override>
        <ss:override name="expr">K * 2</ss:override>
        <ss:override name="big">1e3</ss:override>
      </ss:scenario>
    </ss:scenarios>
  </model>
</xmile>`;
    expect(readXmile(xml).scenarios?.[0].overrides).toEqual({ K: 0.5, expr: "K * 2", big: 1000 });
  });

  it("reads a plain XMILE file with no ss: content", () => {
    const xml = writeXmile(emptyModel("Plain"));
    expect(xml).not.toContain("<ss:");
    const parsed = readXmile(xml);
    expect(parsed.metadata).toBeUndefined();
    expect(parsed.scenarios).toBeUndefined();
  });

  it("declares the ss namespace even when no extension elements are written", () => {
    expect(writeXmile(emptyModel("Plain"))).toContain('xmlns:ss="https://sourcesink.dev/xmile/1"');
  });

  it("omits empty annotations", () => {
    const model: Model = {
      ...emptyModel("Empty annotations"),
      converters: [{ kind: "converter", id: "a", name: "a", equation: "1", annotations: {} }],
    };
    const xml = writeXmile(model);
    expect(xml).not.toContain("<ss:annotations");
    expect(readXmile(xml).converters[0].annotations).toBeUndefined();
  });
});
