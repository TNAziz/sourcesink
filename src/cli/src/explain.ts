/**
 * SourceSink — `explain` command helpers.
 *
 * Argument parsing and output assembly are pure functions so the command's
 * grammar and JSON shape can be tested without spawning the CLI.
 */

import {
  coverage,
  describeModel,
  findLoops,
  type Loop,
  type ModelDescription,
} from "@sourcesink/explain";
import type { Model } from "@sourcesink/model";

import { ArgError, parseFlags } from "./args.js";

export interface ExplainOptions {
  file: string;
  /** Print only the feedback-loop list. */
  loopsOnly: boolean;
  /** Print the machine-readable report. */
  json: boolean;
}

export interface ExplainReport {
  markdown: string;
  loops: Loop[];
  coverage: ReturnType<typeof coverage>;
}

/** Parse `sourcesink explain <model> [--loops] [--json]`. */
export function parseExplainArgs(args: string[]): ExplainOptions {
  const flags = parseFlags(args, { booleans: ["loops", "json"] });
  const file = flags.positional[0];
  if (!file) throw new ArgError("explain needs a model file");
  if (flags.positional.length > 1) {
    throw new ArgError(`explain takes one model file (unexpected '${flags.positional[1]}')`);
  }
  return {
    file,
    loopsOnly: flags.booleans.has("loops"),
    json: flags.booleans.has("json"),
  };
}

/** Everything the command prints, computed once from the model. */
export function explainReport(model: Model): ExplainReport {
  const description: ModelDescription = describeModel(model);
  return {
    markdown: description.markdown,
    loops: findLoops(model).loops,
    coverage: coverage(model, description),
  };
}

function display(name: string): string {
  return name.replace(/_/g, " ");
}

/** The loop list shared by `--loops` and the human-readable report. */
export function formatLoopList(loops: Loop[]): string {
  if (loops.length === 0) return "No feedback loops were found.";
  return loops
    .map((loop) => {
      const chain = [...loop.elements, loop.elements[0]].map((n) => display(n)).join(" → ");
      return `- **${loop.id} — ${loop.type}:** ${chain}.`;
    })
    .join("\n");
}

/** Render the selected output form (JSON wins when both flags are given). */
export function formatExplainReport(report: ExplainReport, options: ExplainOptions): string {
  if (options.json) return JSON.stringify(report, null, 2);
  if (options.loopsOnly) return formatLoopList(report.loops);
  return report.markdown;
}
