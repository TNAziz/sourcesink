/**
 * Pure helpers for the results view: display number formatting and RFC 4180
 * CSV export. No React and no DOM, so everything here is unit-testable.
 */

/** Display format: 4 significant digits, trailing zeros trimmed. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e12 || abs < 1e-6) return n.toExponential(3);
  return String(Number(n.toPrecision(4)));
}

const NEEDS_QUOTES = /[",\r\n]/;

function csvCell(value: string): string {
  return NEEDS_QUOTES.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Minimal shape of a run needed for export. */
export interface CsvResult {
  time: readonly number[];
  series: Readonly<Record<string, readonly number[]>>;
}

/**
 * Serialize a run as CSV: one header row, then one row per sample with the
 * time column first and full numeric precision. Lines end with CRLF and any
 * field containing a comma, quote or newline is quoted (RFC 4180).
 */
export function toCsv(result: CsvResult, columns: readonly string[]): string {
  const cols = columns.filter((c) => c in result.series);
  const lines: string[] = [["time", ...cols].map(csvCell).join(",")];
  for (let i = 0; i < result.time.length; i++) {
    const cells = [result.time[i], ...cols.map((c) => result.series[c][i])];
    lines.push(cells.map((v) => csvCell(String(v))).join(","));
  }
  return lines.join("\r\n");
}

/** Filesystem-safe download name, e.g. "Deer Population-results.csv". */
export function csvFileName(modelName: string): string {
  const clean = modelName
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${clean === "" ? "model" : clean}-results.csv`;
}
