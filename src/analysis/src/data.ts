/**
 * SourceSink — observed data from delimited text, and goodness of fit.
 *
 * The parser is deliberately forgiving about layout (BOM, CRLF, blank lines,
 * quoted fields) and strict about values: a time axis that is not numeric or
 * not increasing, or a cell that cannot become a number, names its line so a
 * data typo is easy to find. Missing cells become NaN and are later dropped
 * by `align`.
 */

import type { Alignment, Dataset, FitMetrics, ObjectiveKind } from "./contracts.js";

export interface CsvOptions {
  /** Column holding time; default: the first column whose header matches
   * /^(time|t|date|day|days|year|years|month|months|hour|hours)$/i, else column 0. */
  timeColumn?: string;
  /** Map CSV headers to model element names, e.g. { "DO (mg/L)": "DO" }. */
  rename?: Record<string, string>;
  /** Only keep these (renamed) series. */
  columns?: string[];
}

/** Cells that mean "no observation". Compared case-insensitively. */
const MISSING = new Set(["", "na", "n/a", "#n/a", "nan", "-"]);

const TIME_HEADER = /^(time|t|date|day|days|year|years|month|months|hour|hours)$/i;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

interface RawRecord {
  fields: string[];
  /** 1-based physical line where the record starts (counts blank lines). */
  line: number;
}

/** Split text into records, honouring quotes, escaped quotes and newlines
 * inside quoted fields. Line ends must already be normalised to `\n`. */
function tokenize(text: string, delimiter: string): RawRecord[] {
  const records: RawRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let line = 1;
  let startLine = 1;
  let quoted = false;
  let inQuotes = false;
  let i = 0;

  const endRecord = (): void => {
    fields.push(field);
    records.push({ fields, line: startLine });
    fields = [];
    field = "";
    quoted = false;
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === "\n") line += 1;
      field += ch;
      i += 1;
      continue;
    }
    if (quoted) {
      if (ch === delimiter) {
        fields.push(field);
        field = "";
        quoted = false;
        i += 1;
        continue;
      }
      if (ch === "\n") {
        endRecord();
        line += 1;
        startLine = line;
        i += 1;
        continue;
      }
      if ((ch === " " || ch === "\t") && ch !== delimiter) {
        i += 1;
        continue;
      }
      throw new Error(`line ${line}: unexpected character '${ch}' after a closing quote`);
    }
    if (ch === '"' && field.trim() === "") {
      field = "";
      quoted = true;
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      fields.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRecord();
      line += 1;
      startLine = line;
      i += 1;
      continue;
    }
    if (ch === '"') throw new Error(`line ${line}: unexpected quote inside an unquoted field`);
    field += ch;
    i += 1;
  }
  if (inQuotes) throw new Error(`line ${startLine}: unterminated quoted field`);
  if (field !== "" || fields.length > 0) endRecord();

  return records.filter((r) => !(r.fields.length === 1 && r.fields[0].trim() === ""));
}

/** Delimiter with the most occurrences outside quotes on the header line;
 * commas win ties and files without a delimiter. */
function detectDelimiter(text: string): string {
  const candidates = [",", ";", "\t"];
  const counts = new Map(candidates.map((c) => [c, 0]));
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes) {
      if (ch === "\n") break;
      const count = counts.get(ch);
      if (count !== undefined) counts.set(ch, count + 1);
    }
  }
  let best = ",";
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = counts.get(candidate)!;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Parse either a plain number or an ISO date; `null` when the cell is
 * neither (so the caller can report the line). */
function parseTimeCell(value: string): number | null {
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  if (!ISO_DATE.test(value)) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const ms = Date.UTC(year, month - 1, day);
    const date = new Date(ms);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return null;
    }
    return ms;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

const isMissing = (value: string): boolean => MISSING.has(value.trim().toLowerCase());

/** Parse a numeric cell; throws (with its line) on text that is neither a
 * number nor a missing-value marker. */
function parseNumber(value: string, header: string, line: number): number {
  if (isMissing(value)) return Number.NaN;
  const number = Number(value.trim());
  if (!Number.isFinite(number)) {
    throw new Error(`line ${line}: expected a number in column '${header}' but got '${value.trim()}'`);
  }
  return number;
}

function findColumn(headers: string[], name: string): number {
  const exact = headers.indexOf(name);
  if (exact >= 0) return exact;
  const lower = name.toLowerCase();
  return headers.findIndex((h) => h.toLowerCase() === lower);
}

/** Parse delimited text into a Dataset. Accepts comma, semicolon or tab
 * delimiters (auto-detected from the header line), quoted fields with
 * embedded delimiters and "" escapes, a UTF-8 BOM, CRLF line ends, blank
 * lines, and blank/NA/NaN/#N/A/- cells (→ NaN). Header cells are trimmed;
 * a header like `DO (mg/L)` is kept as written unless renamed. Times must be
 * numeric and strictly increasing; ISO dates (2024-05-01) are converted to
 * days since the first date. Throw a clear Error naming the line for any
 * other non-numeric value. */
export function parseCsv(text: string, options: CsvOptions = {}): Dataset {
  let source = text.replace(/^\uFEFF/, "");
  source = source.replace(/\r\n?/g, "\n");
  const delimiter = detectDelimiter(source);
  const records = tokenize(source, delimiter);
  if (records.length === 0) throw new Error("CSV is empty");

  const headerRecord = records[0];
  const headers = headerRecord.fields.map((h) => h.trim());
  const seen = new Set<string>();
  for (const header of headers) {
    if (seen.has(header)) throw new Error(`line ${headerRecord.line}: duplicate column '${header}'`);
    seen.add(header);
  }

  let timeIndex: number;
  if (options.timeColumn !== undefined) {
    timeIndex = findColumn(headers, options.timeColumn.trim());
    if (timeIndex < 0) throw new Error(`time column '${options.timeColumn}' not found`);
  } else {
    timeIndex = headers.findIndex((h) => TIME_HEADER.test(h));
    if (timeIndex < 0) timeIndex = 0;
  }

  const rows = records.slice(1);
  for (const row of rows) {
    if (row.fields.length !== headers.length) {
      throw new Error(
        `line ${row.line}: expected ${headers.length} columns but got ${row.fields.length}`,
      );
    }
  }

  const rawTimes = rows.map((row) => {
    const value = row.fields[timeIndex].trim();
    if (isMissing(value)) throw new Error(`line ${row.line}: missing time value`);
    return { value, line: row.line };
  });
  const parsedTimes = rawTimes.map((cell) => parseTimeCell(cell.value));
  const firstBad = parsedTimes.findIndex((v) => v === null);
  if (firstBad >= 0) {
    throw new Error(`line ${rawTimes[firstBad].line}: time value '${rawTimes[firstBad].value}' is not numeric`);
  }
  const numericTimes = parsedTimes as number[];

  // Date columns are converted as a whole; mixing dates and numbers would
  // silently subtract days from an arbitrary numeric origin.
  const dateCount = rawTimes.filter((cell) => !Number.isFinite(Number(cell.value))).length;
  if (dateCount > 0 && dateCount < rawTimes.length) {
    const numberRow = rawTimes.find((cell) => Number.isFinite(Number(cell.value)));
    const dateRow = rawTimes.find((cell) => !Number.isFinite(Number(cell.value)));
    const offending = numberRow && dateRow && numberRow.line > dateRow.line ? numberRow : dateRow!;
    throw new Error(`line ${offending.line}: cannot mix ISO dates and numeric times`);
  }

  const time = dateCount > 0 ? numericTimes.map((ms) => (ms - numericTimes[0]) / 86400000) : numericTimes.slice();
  for (let i = 1; i < time.length; i += 1) {
    if (!(time[i] > time[i - 1])) {
      throw new Error(
        `line ${rows[i].line}: time values must be strictly increasing (got ${rawTimes[i].value} after ${rawTimes[i - 1].value})`,
      );
    }
  }

  const rename = new Map<string, string>();
  for (const [from, to] of Object.entries(options.rename ?? {})) {
    rename.set(from.trim(), to);
    rename.set(from.trim().toLowerCase(), to);
  }
  const renameOf = (header: string): string => rename.get(header) ?? rename.get(header.toLowerCase()) ?? header;

  const names: string[] = [];
  const columnIndexes: number[] = [];
  headers.forEach((header, index) => {
    if (index === timeIndex) return;
    const name = renameOf(header);
    if (options.columns !== undefined && !options.columns.includes(name)) return;
    if (names.includes(name)) throw new Error(`line ${headerRecord.line}: duplicate series '${name}' after renaming`);
    names.push(name);
    columnIndexes.push(index);
  });
  if (options.columns !== undefined) {
    for (const wanted of options.columns) {
      if (!names.includes(wanted)) throw new Error(`column '${wanted}' not found after renaming`);
    }
  }

  const series: Record<string, number[]> = {};
  names.forEach((name, s) => {
    const index = columnIndexes[s];
    series[name] = rows.map((row) => parseNumber(row.fields[index], headers[index], row.line));
  });

  return { time, series };
}

/** The finite pairs of an alignment; NaN marks a missing observation or an
 * out-of-span simulation and is dropped. */
function finitePairs(a: Alignment): { observed: number[]; simulated: number[] } {
  const observed: number[] = [];
  const simulated: number[] = [];
  const n = Math.min(a.observed.length, a.simulated.length);
  for (let i = 0; i < n; i += 1) {
    if (Number.isFinite(a.observed[i]) && Number.isFinite(a.simulated[i])) {
      observed.push(a.observed[i]);
      simulated.push(a.simulated[i]);
    }
  }
  return { observed, simulated };
}

/** Population variance (the divisor is n). */
function variance(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}

function sumSquared(observed: number[], simulated: number[]): number {
  let sse = 0;
  for (let i = 0; i < observed.length; i += 1) {
    const error = simulated[i] - observed[i];
    sse += error * error;
  }
  return sse;
}

/** Goodness of fit of one alignment (see FitMetrics in contracts.ts). NSE
 * uses the observed mean; when the observations have zero variance, NSE
 * is NaN. An empty alignment gives n = 0 and NaN elsewhere. */
export function fitMetrics(a: Alignment): FitMetrics {
  const { observed, simulated } = finitePairs(a);
  const n = observed.length;
  if (n === 0) {
    return {
      n: 0,
      sse: Number.NaN,
      rmse: Number.NaN,
      nse: Number.NaN,
      r2: Number.NaN,
      bias: Number.NaN,
    };
  }

  const sse = sumSquared(observed, simulated);
  const meanObserved = observed.reduce((sum, v) => sum + v, 0) / n;
  const meanSimulated = simulated.reduce((sum, v) => sum + v, 0) / n;
  const ssObserved = observed.reduce((sum, v) => sum + (v - meanObserved) ** 2, 0);
  const ssSimulated = simulated.reduce((sum, v) => sum + (v - meanSimulated) ** 2, 0);
  const nse = ssObserved === 0 ? Number.NaN : 1 - sse / ssObserved;

  let r2 = Number.NaN;
  if (n >= 2 && ssObserved > 0 && ssSimulated > 0) {
    let covariance = 0;
    for (let i = 0; i < n; i += 1) {
      covariance += (observed[i] - meanObserved) * (simulated[i] - meanSimulated);
    }
    r2 = (covariance * covariance) / (ssObserved * ssSimulated);
  }

  let bias = 0;
  for (let i = 0; i < n; i += 1) bias += simulated[i] - observed[i];

  return { n, sse, rmse: Math.sqrt(sse / n), nse, r2, bias: bias / n };
}

/** Combine alignments into one number to minimise (see ObjectiveKind):
 * "sse" Σ (s−o)² × weight; "wsse" Σ SSE / var(observed) × weight (series
 * with zero variance fall back to SSE); "nse" Σ (1 − NSE) × weight. A series
 * with no paired points contributes nothing; if NO series has points, return
 * Infinity (so an optimizer steers away). */
export function objective(
  alignments: Alignment[],
  kind: ObjectiveKind,
  weights: Record<string, number> = {},
): number {
  let total = 0;
  let anyPoints = false;
  for (const alignment of alignments) {
    const { observed, simulated } = finitePairs(alignment);
    if (observed.length === 0) continue;
    anyPoints = true;
    const weight = weights[alignment.series] ?? 1;
    const sse = sumSquared(observed, simulated);
    let contribution: number;
    if (kind === "sse") {
      contribution = sse;
    } else if (kind === "wsse") {
      const spread = variance(observed);
      contribution = spread > 0 ? sse / spread : sse;
    } else {
      const spread = variance(observed);
      contribution = spread > 0 ? sse / (spread * observed.length) : Number.NaN;
    }
    if (Number.isFinite(contribution)) total += contribution * weight;
  }
  return anyPoints ? total : Number.POSITIVE_INFINITY;
}

/** Quote a CSV field when it needs it. */
function field(value: string): string {
  if (/[",\r\n]/.test(value) || value !== value.trim()) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Write a Dataset (or simulated vs observed pairs) back to CSV text. */
export function toCsv(data: Dataset): string {
  const names = Object.keys(data.series);
  const lines = [[field("Time"), ...names.map(field)].join(",")];
  data.time.forEach((t, i) => {
    const cells = [String(t)];
    for (const name of names) {
      const value = data.series[name][i];
      cells.push(value === undefined || Number.isNaN(value) ? "" : String(value));
    }
    lines.push(cells.join(","));
  });
  return `${lines.join("\n")}\n`;
}
