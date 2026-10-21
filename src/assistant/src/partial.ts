/**
 * SourceSink — read the assistant's reply while the model is still writing it.
 *
 * Replies are JSON objects, so the visible text is the value of the top-level
 * `message` field. Streaming bridges hand us a prefix of that JSON; this module
 * decodes the part of `message` that has arrived without requiring the rest of
 * the object to be valid yet.
 */

const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/** Drop a leading Markdown code fence (```json …) and whitespace before it. */
function withoutFence(text: string): string {
  const trimmed = text.replace(/^\s+/, "");
  if (!trimmed.startsWith("```")) return trimmed;
  const newline = trimmed.indexOf("\n");
  if (newline < 0) return "";
  return trimmed.slice(newline + 1).replace(/^\s+/, "");
}

/** Decode the JSON string whose opening quote is at `start` - 1. */
function readString(text: string, start: number): string {
  let out = "";
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') return out;
    if (ch !== "\\") {
      out += ch;
      i += 1;
      continue;
    }

    // An escape split across deltas: keep only the text decoded so far.
    if (i + 1 >= text.length) return out;
    const escape = text[i + 1];
    if (escape === "u") {
      const hex = text.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    const decoded = ESCAPES[escape];
    if (decoded === undefined) return out;
    out += decoded;
    i += 2;
  }
  return out;
}

/** Length of the JSON string literal that starts at `quote`, or -1 if the
 * closing quote has not arrived. */
function stringEnd(text: string, quote: number): number {
  let i = quote + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === '"') return i;
    i += 1;
  }
  return -1;
}

/**
 * The value of the top-level "message" field of a JSON object that is still
 * being written: handles escapes (\" \n é), returns the text so far when
 * the closing quote has not arrived, undefined when "message" has not
 * started. Tolerates a leading ```json fence.
 */
export function partialMessage(textSoFar: string): string | undefined {
  const text = withoutFence(textSoFar);
  const start = text.indexOf("{");
  if (start < 0) return undefined;

  // Depth counts `{`/`[` outside strings; the root object is depth 1, so only
  // keys at depth 1 are top-level keys (not a "message" inside a patch).
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];

    if (ch === '"') {
      const end = stringEnd(text, i);
      if (end < 0) return undefined; // an incomplete key or value
      let after = end + 1;
      while (after < text.length && /\s/.test(text[after])) after += 1;
      const isKey = text[after] === ":";
      if (!isKey) {
        i = end + 1;
        continue;
      }

      const key = readString(text, i + 1);
      if (depth === 1 && key === "message") {
        let value = after + 1;
        while (value < text.length && /\s/.test(text[value])) value += 1;
        if (value >= text.length || text[value] !== '"') return undefined;
        return readString(text, value + 1);
      }
      i = end + 1;
      continue;
    }

    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth <= 0) return undefined;
    }
    i += 1;
  }
  return undefined;
}
