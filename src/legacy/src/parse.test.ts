import { describe, expect, it } from "vitest";
import { parseStm } from "./parse.js";
import { legacySamples } from "./samples.test-util.js";

// Real legacy files are not in the repository; these checks run only when a
// local samples folder is present (see samples.test-util.ts).
const SAMPLES = legacySamples();

const UNIVERSAL_SECTIONS = [
  "Book",
  "C_String",
  "Dependents",
  "Draw_Specs",
  "Drawing_Model",
  "LIST",
  "List",
  "Model",
  "Run_Specs",
  "Simulation_Model",
  "diagram_struct",
  "entity_struct_array",
  "int16_array",
];

describe.skipIf(SAMPLES.length === 0)("parseStm — local sample files", () => {
  it.each(SAMPLES.map((s) => [s.name, s] as const))("parses %s", (_name, sample) => {
    const { header, sections, bodyOffset, byteLength } = parseStm(sample.bytes);

    // Format version 2 files: application/model tags in either variant.
    expect(["STL2", "ithn"]).toContain(header.appTag);
    expect(["STM2", "ithm"]).toContain(header.modelTag);
    expect(header.generation).toBe(1);

    expect(sections.length).toBeGreaterThan(0);
    expect(bodyOffset).toBeGreaterThan(0x80);
    expect(bodyOffset).toBeLessThan(byteLength);

    const names = new Set(sections.map((s) => s.name));
    for (const required of UNIVERSAL_SECTIONS) {
      expect(names, `missing section ${required}`).toContain(required);
    }

    let expectedTypeId = 1;
    for (const s of sections) {
      expect(s.typeId).toBe(expectedTypeId);
      expect(s.length).toBe(s.name.length + 5);
      expectedTypeId++;
    }
  });
});
