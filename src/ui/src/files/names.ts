/**
 * Small pure naming helpers shared by the file modules.
 *
 * Kept free of React and browser globals so they are trivially unit-testable
 * (the examples gallery and the file actions both need the same behavior).
 */

/**
 * Turn a raw model/file identifier into a human title.
 *
 * Slugs like `logistic-harvest` / `co2_accumulation` become "Logistic Harvest"
 * and "Co2 Accumulation"; anything that already carries capitalization (a real
 * model name such as "Streeter-Phelps DO sag") is returned untouched so we do
 * not mangle proper nouns or acronyms.
 */
export function prettifyExampleName(raw: string): string {
  const s = raw.trim();
  if (!s) return "Untitled";
  const isSlug = /^[a-z0-9]+(?:[ _-][a-z0-9]+)*$/.test(s);
  if (!isSlug) return s;
  return s
    .split(/[ _-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** The first non-empty line of a documentation block, trimmed. */
export function firstLine(text: string | undefined | null): string {
  if (!text) return "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/**
 * A safe XMILE file name for a model: the existing name when present, else a
 * slug derived from the model's display name.
 */
export function suggestFileName(fileName: string | null | undefined, modelName: string): string {
  const base = (fileName ?? "").trim();
  if (base) return ensureXmileExtension(base);
  const slug =
    modelName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled";
  return `${slug}.xmile`;
}

/** Force an accepted XMILE extension onto a file name. */
export function ensureXmileExtension(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xmile") || lower.endsWith(".xml") || lower.endsWith(".stmx")) {
    return fileName;
  }
  return `${fileName}.xmile`;
}
