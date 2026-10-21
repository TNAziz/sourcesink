import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const run = `${root}/src/cli/src/run.ts`;

function cli(...args: string[]): string {
  return execFileSync(process.execPath, ["--import", "tsx", run, "units", ...args], {
    encoding: "utf8",
    cwd: root,
  });
}

describe("sourcesink units", () => {
  it("prints a clean report for a model with consistent units", () => {
    const out = cli(`${root}/examples/environmental/streeter-phelps.xmile`);
    expect(out).toContain("No unit problems found.");
  });

  it("prints findings and exits 0", () => {
    // Streeter–Phelps with one deliberate mistake: reaeration declared per
    // year in a model that runs in days.
    const text = readFileSync(`${root}/examples/environmental/streeter-phelps.xmile`, "utf8");
    const broken = text.replace(/(<flow name="reaeration">[\s\S]*?<units>)mg\/L\/day(<\/units>)/, "$1mg/L/year$2");
    expect(broken).not.toBe(text);
    const dir = mkdtempSync(join(tmpdir(), "sourcesink-units-"));
    try {
      const file = join(dir, "broken.xmile");
      writeFileSync(file, broken);
      const findings = JSON.parse(cli(file, "--json")) as { element: string; message: string }[];
      expect(findings.some((f) => f.element === "reaeration")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
