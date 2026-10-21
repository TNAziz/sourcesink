/**
 * Local legacy sample files for corpus tests. None are in the repository: set
 * SOURCESINK_LEGACY_SAMPLES to a folder of .stm/.itm files (searched
 * recursively; the git-ignored `extraction/` folder is the default) to run
 * the corpus checks, which skip themselves when no files are found.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Sample {
  name: string;
  bytes: Uint8Array;
}

const ROOT = process.env.SOURCESINK_LEGACY_SAMPLES ?? fileURLToPath(new URL("../../../extraction", import.meta.url));

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries.sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(stm|itm)$/i.test(entry)) out.push(path);
  }
}

/** Every distinct legacy sample file under the samples folder. */
export function legacySamples(): Sample[] {
  const files: string[] = [];
  walk(ROOT, files);
  const seen = new Set<string>();
  const out: Sample[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(readFileSync(file));
    const hash = createHash("md5").update(bytes).digest("hex");
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push({ name: basename(file), bytes });
  }
  return out;
}
