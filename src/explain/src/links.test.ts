import { describe, expect, it } from "vitest";
import { causalLinks, linkPolarities } from "./index.ts";
import {
  decayModel,
  graphFunctionModel,
  logisticModel,
  zeroEffectModel,
} from "./test-util.ts";

function link(links: ReturnType<typeof causalLinks>, from: string, to: string, kind: string) {
  return links.find((l) => l.from === from && l.to === to && l.kind === kind);
}

describe("causalLinks", () => {
  it("turns stock wiring into signed material links", () => {
    const links = causalLinks(decayModel());
    expect(link(links, "drain", "S", "flow-out-of-stock")?.polarity).toBe("-");
    expect(link(links, "S", "drain", "information")).toBeDefined();
  });

  it("resolves equation references to the model's own names", () => {
    const links = causalLinks(logisticModel());
    expect(link(links, "Population", "births", "information")).toBeDefined();
    expect(link(links, "r", "births", "information")).toBeDefined();
    expect(link(links, "crowding", "births", "information")).toBeDefined();
    expect(link(links, "Population", "crowding", "information")).toBeDefined();
    expect(link(links, "carrying_capacity", "crowding", "information")).toBeDefined();
    expect(link(links, "births", "Population", "flow-into-stock")).toBeDefined();
  });

  it("links a graph function used as a variable from its input connector", () => {
    const links = causalLinks(graphFunctionModel());
    expect(link(links, "driver", "out", "information")).toBeDefined();
    expect(link(links, "curve", "out", "information")).toBeUndefined();
  });
});

describe("linkPolarities", () => {
  it("signs the logistic births and crowding paths", () => {
    const links = linkPolarities(logisticModel());
    expect(link(links, "Population", "births", "information")?.polarity).toBe("+");
    expect(link(links, "Population", "crowding", "information")?.polarity).toBe("-");
    expect(link(links, "crowding", "births", "information")?.polarity).toBe("+");
    expect(link(links, "carrying_capacity", "crowding", "information")?.polarity).toBe("+");
    expect(link(links, "births", "Population", "flow-into-stock")?.polarity).toBe("+");
  });

  it("marks a link whose effect is zero at every probe as unknown", () => {
    const links = linkPolarities(zeroEffectModel());
    expect(link(links, "S", "inflow", "information")?.polarity).toBe("?");
  });

  it("uses the input connector to sign a graph function used as a variable", () => {
    const links = linkPolarities(graphFunctionModel());
    expect(link(links, "driver", "out", "information")?.polarity).toBe("+");
  });

  it("keeps material-link signs fixed", () => {
    const links = linkPolarities(logisticModel());
    expect(link(links, "births", "Population", "flow-into-stock")?.polarity).toBe("+");
    expect(link(links, "drain", "S", "flow-out-of-stock")).toBeUndefined();
  });
});
