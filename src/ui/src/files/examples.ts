/**
 * The built-in example-model gallery.
 *
 * Every category directory under `examples/` contributes its `.xmile` models
 * and an optional `catalog.json` with teaching metadata. Both are pulled in at
 * build time with Vite raw globs, so merging a new category needs no UI change.
 * A model without a catalog entry still appears, using its own `<doc>` and the
 * category README question as a fallback.
 */

import type { Model } from "@sourcesink/model";
import { readXmile } from "@sourcesink/xmile";
import readmeRaw from "../../../../examples/environmental/README.md?raw";
import { firstLine, prettifyExampleName } from "./names";

export type ExampleLevel = "intro" | "intermediate" | "advanced";

export const EXAMPLE_LEVELS: readonly ExampleLevel[] = ["intro", "intermediate", "advanced"];

export interface Category {
  id: string;
  /** Display name for chips and section headings. */
  name: string;
  /** One line explaining what belongs in this category. */
  blurb: string;
}

/** Display order and copy for the known example categories. */
export const CATEGORIES: readonly Category[] = [
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

const CATEGORY_RANK = new Map(CATEGORIES.map((category, index) => [category.id, index]));

export interface ExampleReference {
  citation: string;
  doi?: string;
}

/** A single entry in an `examples/<category>/catalog.json` file. */
export interface CatalogEntry {
  id: string;
  file: string;
  title: string;
  category: string;
  level: ExampleLevel;
  summary: string;
  question: string;
  teaching: string;
  references: ExampleReference[];
  original?: boolean;
}

export interface ExampleEntry {
  /** Stable key: the file name without its extension. */
  id: string;
  /** File name with extension, for links and diagnostics. */
  file: string;
  title: string;
  category: string;
  level: ExampleLevel;
  summary: string;
  question: string;
  teaching: string;
  references: ExampleReference[];
  original?: boolean;
  /** Backwards-compatible one-line description (the model's first `<doc>`). */
  documentation: string;
  stocks: number;
  flows: number;
  converters: number;
  model: Model;
}

const rawModels = import.meta.glob("../../../../examples/*/*.xmile", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const rawCatalogs = import.meta.glob("../../../../examples/*/catalog.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Extract a one-line description per model from the examples README.
 *
 * The README documents each model under a `## … \`file.xmile\` …` heading
 * followed by a `**Question:**` paragraph; we return the question text with
 * its line wraps collapsed.
 */
export function parseExampleDescriptions(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = md.split(/\r?\n/);
  let current: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const heading = /^##\s+.*`([^`]+\.xmile)`/.exec(line);
    if (heading) {
      current = heading[1].trim();
      continue;
    }
    const question = /^\*\*Question:\*\*\s*(.*)$/.exec(line);
    if (question && current) {
      let text = question[1].trim();
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "") {
        text += ` ${lines[j].trim()}`;
        j += 1;
      }
      out[current] = text.replace(/\s+/g, " ").trim();
      i = j;
    }
  }
  return out;
}

/** The category directory that holds a globbed example path. */
function categoryOf(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 2] ?? "";
}

/** The file name (with extension) at the end of a globbed path. */
function fileOf(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeLevel(value: unknown): ExampleLevel {
  return value === "intermediate" || value === "advanced" ? value : "intro";
}

function parseReferences(value: unknown): ExampleReference[] {
  if (!Array.isArray(value)) return [];
  const references: ExampleReference[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const record = item as { citation?: unknown; doi?: unknown };
    const citation = stringValue(record.citation).trim();
    if (!citation) continue;
    const doi = stringValue(record.doi).trim();
    references.push(doi ? { citation, doi } : { citation });
  }
  return references;
}

/** Accept either a top-level array or a `{ models | entries | examples: [] }` wrapper. */
function entriesOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object");
  if (value === null || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["models", "entries", "examples"]) {
    const list = record[key];
    if (Array.isArray(list)) {
      return list.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object");
    }
  }
  return [];
}

function parseCatalog(raw: string, category: string, path: string): CatalogEntry[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    console.error(`SourceSink: could not parse example catalog "${path}"`, error);
    return [];
  }
  const entries: CatalogEntry[] = [];
  for (const record of entriesOf(value)) {
    const id = stringValue(record.id).trim();
    const file = stringValue(record.file).trim();
    if (!id || !file) continue;
    entries.push({
      id,
      file,
      title: stringValue(record.title).trim(),
      category: stringValue(record.category, category).trim() || category,
      level: normalizeLevel(record.level),
      summary: stringValue(record.summary).trim(),
      question: stringValue(record.question).trim(),
      teaching: stringValue(record.teaching).trim(),
      references: parseReferences(record.references),
      ...(record.original === true ? { original: true } : {}),
    });
  }
  return entries;
}

function readCatalogs(): Map<string, CatalogEntry> {
  const byPath = new Map<string, CatalogEntry>();
  for (const [path, raw] of Object.entries(rawCatalogs)) {
    const category = categoryOf(path);
    for (const entry of parseCatalog(raw, category, path)) {
      byPath.set(`${category}/${entry.file}`, entry);
    }
  }
  return byPath;
}

export function categoryInfo(id: string): Category {
  return (
    CATEGORIES.find((category) => category.id === id) ?? {
      id,
      name: prettifyExampleName(id),
      blurb: "",
    }
  );
}

/**
 * A compact source attribution from a citation: first author surname + year.
 * "Bass, F. M. (1969). …" becomes "Bass (1969)".
 */
export function shortAttribution(reference: ExampleReference): string {
  const citation = reference.citation.trim();
  const year = /\((\d{4})[a-z]?\)/.exec(citation)?.[1];
  const surname = citation.split(/[,.(]/)[0]?.trim() || citation;
  return year ? `${surname} (${year})` : surname;
}

/** "Based on …" source line for a catalog entry. */
export function attributionFor(entry: ExampleEntry): string {
  if (entry.references.length > 0) return shortAttribution(entry.references[0]);
  return entry.original ? "SourceSink original" : "";
}

/** A DOI as a clickable https URL. */
export function doiUrl(doi: string): string {
  return `https://doi.org/${doi.trim()}`;
}

export interface ExampleFilter {
  query?: string;
  category?: string;
  level?: ExampleLevel | "all";
}

/** Filter by free text (title, prose, category and citations), category, level. */
export function filterExamples(entries: readonly ExampleEntry[], filter: ExampleFilter = {}): ExampleEntry[] {
  const terms = (filter.query ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const category = filter.category && filter.category !== "all" ? filter.category : undefined;
  const level = filter.level && filter.level !== "all" ? filter.level : undefined;
  return entries.filter((entry) => {
    if (category !== undefined && entry.category !== category) return false;
    if (level !== undefined && entry.level !== level) return false;
    if (terms.length === 0) return true;
    const haystack = [
      entry.title,
      entry.summary,
      entry.question,
      entry.teaching,
      entry.category,
      categoryInfo(entry.category).name,
      ...entry.references.map((reference) => reference.citation),
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Per-category counts after applying the text and level filters. */
export function categoryCounts(
  entries: readonly ExampleEntry[],
  filter: ExampleFilter = {},
): Record<string, number> {
  const matched = filterExamples(entries, { ...filter, category: "all" });
  const counts: Record<string, number> = {};
  for (const entry of matched) counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  return counts;
}

/** Counts for the level segmented control, respecting the current category + text. */
export function levelCounts(
  entries: readonly ExampleEntry[],
  filter: ExampleFilter = {},
): Record<ExampleLevel | "all", number> {
  const counts: Record<ExampleLevel | "all", number> = {
    all: 0,
    intro: 0,
    intermediate: 0,
    advanced: 0,
  };
  const matched = filterExamples(entries, { ...filter, level: "all" });
  for (const entry of matched) {
    counts.all += 1;
    counts[entry.level] += 1;
  }
  return counts;
}

let cache: ExampleEntry[] | null = null;

/** All bundled examples, parsed and sorted by category then title. */
export function listExamples(): ExampleEntry[] {
  if (cache) return cache;
  const descriptions = parseExampleDescriptions(readmeRaw);
  const catalogs = readCatalogs();
  const entries: ExampleEntry[] = [];
  for (const [path, xml] of Object.entries(rawModels)) {
    const file = fileOf(path);
    const category = categoryOf(path);
    const id = file.replace(/\.xmile$/i, "");
    const catalog = catalogs.get(`${category}/${file}`);
    try {
      const model = readXmile(xml);
      const question = catalog?.question || descriptions[file] || "";
      const summary = catalog?.summary || firstLine(model.documentation) || descriptions[file] || "";
      entries.push({
        id,
        file,
        title: catalog?.title || prettifyExampleName(model.name || id),
        category,
        level: catalog?.level ?? "intro",
        summary,
        question,
        teaching: catalog?.teaching ?? "",
        references: catalog?.references ?? [],
        ...(catalog?.original === true ? { original: true } : {}),
        documentation: firstLine(model.documentation) || descriptions[file] || "",
        stocks: model.stocks.length,
        flows: model.flows.length,
        converters: model.converters.length,
        model,
      });
    } catch (error) {
      console.error(`SourceSink: could not parse example "${file}"`, error);
    }
  }
  entries.sort((a, b) => {
    const rankA = CATEGORY_RANK.get(a.category) ?? Number.MAX_SAFE_INTEGER;
    const rankB = CATEGORY_RANK.get(b.category) ?? Number.MAX_SAFE_INTEGER;
    return rankA - rankB || a.title.localeCompare(b.title);
  });
  cache = entries;
  return entries;
}

/** Look up a single example by its id (file stem). */
export function getExample(id: string): ExampleEntry | undefined {
  return listExamples().find((entry) => entry.id === id);
}
