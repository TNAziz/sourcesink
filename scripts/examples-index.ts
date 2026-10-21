/**
 * Generate `examples/README.md` from the category catalogs.
 *
 * Run with `npm run examples:index`. The same renderer is imported by the
 * example tests, so a stale README fails CI instead of drifting silently.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Reference {
  citation: string;
  doi?: string;
}

interface Entry {
  id: string;
  file: string;
  title: string;
  category: string;
  level: string;
  question: string;
  references: Reference[];
  original?: boolean;
}

interface CategoryCopy {
  id: string;
  name: string;
  blurb: string;
}

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "examples");

const CATEGORY_COPY: readonly CategoryCopy[] = [
  {
    id: "environmental",
    name: "Environmental engineering",
    blurb: "Water, air and contaminant systems built from environmental-engineering models.",
  },
  {
    id: "business",
    name: "Business and management",
    blurb: "Firms, markets and the diffusion of products and practices.",
  },
  {
    id: "resources",
    name: "Natural resources and economics",
    blurb: "Harvested resources, depletion and the economics of extraction.",
  },
  {
    id: "climate",
    name: "Climate and the Earth system",
    blurb: "Carbon, energy balance and feedbacks in the climate system.",
  },
  {
    id: "ecology",
    name: "Populations and ecology",
    blurb: "Populations, food webs and the dynamics of living systems.",
  },
  {
    id: "problem-solving",
    name: "Environmental problem solving",
    blurb: "Structured exercises that turn a messy problem into a testable model.",
  },
];

const INTRO =
  "A library of well-known system-dynamics models, each an original SourceSink implementation built from the cited equations. Open a model from the in-app Examples gallery or from the table below. Every model is unit-checked, simulates cleanly and ships with the checks a teacher would use in class. Choices made where a source leaves room for interpretation are recorded in [MODELING-NOTES.md](MODELING-NOTES.md).";

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function entriesOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object");
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["models", "entries", "examples"]) {
      const list = record[key];
      if (Array.isArray(list)) {
        return list.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object");
      }
    }
  }
  return [];
}

function parseReferences(value: unknown): Reference[] {
  if (!Array.isArray(value)) return [];
  const out: Reference[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const record = item as { citation?: unknown; doi?: unknown };
    const citation = stringValue(record.citation).trim();
    if (!citation) continue;
    const doi = stringValue(record.doi).trim();
    out.push(doi ? { citation, doi } : { citation });
  }
  return out;
}

function readCategory(category: string): Entry[] {
  const path = join(EXAMPLES_DIR, category, "catalog.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    console.error(`SourceSink: could not parse example catalog "${path}"`, error);
    return [];
  }
  const entries: Entry[] = [];
  for (const record of entriesOf(value)) {
    const id = stringValue(record.id).trim();
    const file = stringValue(record.file).trim();
    if (!id || !file) continue;
    entries.push({
      id,
      file,
      title: stringValue(record.title, id).trim() || id,
      category: stringValue(record.category, category).trim() || category,
      level: stringValue(record.level, "intro").trim() || "intro",
      question: stringValue(record.question).trim(),
      references: parseReferences(record.references),
      ...(record.original === true ? { original: true } : {}),
    });
  }
  entries.sort((a, b) => a.title.localeCompare(b.title));
  return entries;
}

function shortAttribution(reference: Reference): string {
  const citation = reference.citation.trim();
  const year = /\((\d{4})[a-z]?\)/.exec(citation)?.[1];
  const surname = citation.split(/[,.(]/)[0]?.trim() || citation;
  return year ? `${surname} (${year})` : surname;
}

function sourceCell(entry: Entry): string {
  if (entry.references.length > 0) {
    const reference = entry.references[0];
    const label = shortAttribution(reference);
    return reference.doi ? `[${label}](https://doi.org/${reference.doi.trim()})` : label;
  }
  return entry.original ? "SourceSink original" : "—";
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/** The full contents of `examples/README.md` for the catalogs on disk. */
export function renderExamplesReadme(): string {
  const known = new Set(CATEGORY_COPY.map((category) => category.id));
  const onDisk = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const unknown = onDisk.filter((category) => !known.has(category) && readCategory(category).length > 0);
  const categories: CategoryCopy[] = [
    ...CATEGORY_COPY,
    ...unknown.map((id) => ({ id, name: id.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()), blurb: "" })),
  ];

  const lines: string[] = ["# Example models", "", INTRO, ""];
  for (const category of categories) {
    const entries = readCategory(category.id);
    if (entries.length === 0) continue;
    lines.push(`## ${category.name}`, "");
    if (category.blurb) lines.push(category.blurb, "");
    lines.push("| Model | Level | Question | Source |", "| --- | --- | --- | --- |");
    for (const entry of entries) {
      const link = `[${cell(entry.title)}](${category.id}/${entry.file})`;
      lines.push(`| ${link} | ${cell(entry.level)} | ${cell(entry.question)} | ${sourceCell(entry)} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const path = join(EXAMPLES_DIR, "README.md");
  writeFileSync(path, renderExamplesReadme());
  console.log(`wrote ${path}`);
}
