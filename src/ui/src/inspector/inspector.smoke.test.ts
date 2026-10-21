import { describe, expect, it } from "vitest";

import { Inspector } from "./Inspector";
import { RunSpecPanel } from "./RunSpecPanel";

describe("inspector module", () => {
  it("exports the components the shell mounts", () => {
    expect(typeof Inspector).toBe("function");
    expect(typeof RunSpecPanel).toBe("function");
  });
});
