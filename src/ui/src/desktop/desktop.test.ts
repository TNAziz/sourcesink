import { describe, expect, it } from "vitest";
import { isDesktop, windowTitle } from "./desktop";

describe("desktop integration helpers", () => {
  it("titles the window after the file, marking unsaved changes", () => {
    expect(windowTitle("lake.xmile", "Lake", false)).toBe("lake.xmile — SourceSink");
    expect(windowTitle("lake.xmile", "Lake", true)).toBe("lake.xmile • — SourceSink");
  });

  it("falls back to the model name, then Untitled", () => {
    expect(windowTitle(null, "Streeter-Phelps", false)).toBe("Streeter-Phelps — SourceSink");
    expect(windowTitle(null, "  ", false)).toBe("Untitled — SourceSink");
  });

  it("is not in desktop mode without the shell bridge", () => {
    expect(isDesktop()).toBe(false);
  });
});
