/**
 * SourceSink — pure helpers behind the equation editor's identifier autocomplete.
 *
 * Kept free of React so the matching/ranking and caret logic can be unit-tested
 * in a node environment (see `autocomplete.test.ts`).
 */

/** One row offered by the autocomplete popup. */
export interface Completion {
  /** Text shown in the popup (element names keep their spaces). */
  label: string;
  /** Text actually inserted into the equation (element names use underscores). */
  insert: string;
  kind: "element" | "builtin" | "clock" | "constant";
  /** Short right-aligned annotation, e.g. "1..3 args" or "stock". */
  detail?: string;
}

/** The identifier-like run of characters surrounding the caret. */
export interface TokenAtCursor {
  /** Index of the first character of the token. */
  start: number;
  /** Index just past the last character of the token. */
  end: number;
  /** The portion of the token before the caret — the match query. */
  query: string;
}

const IDENT = /[A-Za-z0-9_]/;

/**
 * Find the identifier token the caret sits in/next to. Identifiers are runs of
 * `[A-Za-z0-9_]` (the form model names take once spaces are replaced). Returns
 * `null` when the caret is not adjacent to an identifier character (e.g. after
 * `(`, an operator, or whitespace) so the popup stays closed there.
 */
export function tokenAtCursor(text: string, cursor: number): TokenAtCursor | null {
  const pos = Math.max(0, Math.min(cursor, text.length));

  let start = pos;
  while (start > 0 && IDENT.test(text[start - 1])) start -= 1;

  let end = pos;
  while (end < text.length && IDENT.test(text[end])) end += 1;

  if (end === start) return null;
  return { start, end, query: text.slice(start, pos) };
}

/**
 * Rank completion candidates against `query`, case-insensitively. Prefix
 * matches come before substring matches; within a tier shorter labels lead and
 * ties are broken alphabetically. Duplicates (by `insert`) are dropped. An
 * empty query returns every candidate in the order given.
 */
export function matchCompletions(query: string, candidates: Completion[]): Completion[] {
  const seen = new Set<string>();
  const unique: Completion[] = [];
  for (const c of candidates) {
    const key = c.insert.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  const q = query.toLowerCase();
  if (q === "") return unique;

  const scored: { item: Completion; rank: number }[] = [];
  for (const c of unique) {
    const key = c.insert.toLowerCase();
    if (key.startsWith(q)) scored.push({ item: c, rank: 0 });
    else if (key.includes(q)) scored.push({ item: c, rank: 1 });
  }

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const byLength = a.item.label.length - b.item.label.length;
    if (byLength !== 0) return byLength;
    return a.item.label.toLowerCase().localeCompare(b.item.label.toLowerCase());
  });

  return scored.map((s) => s.item);
}

/** Replace a token with `insert`; returns the new text and caret position. */
export function applyCompletion(
  text: string,
  token: TokenAtCursor,
  insert: string,
): { text: string; cursor: number } {
  const next = text.slice(0, token.start) + insert + text.slice(token.end);
  return { text: next, cursor: token.start + insert.length };
}
