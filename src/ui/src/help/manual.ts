/**
 * SourceSink — the user manual (docs/manual/sourcesink-manual.pdf), bundled
 * as an asset and opened at a chapter.
 *
 * Chapters are addressed by the named destinations hyperref writes
 * (`chapter.N`, `appendix.X`), so links survive page-count changes as long as
 * the chapter order does. The desktop app opens the PDF in its own window;
 * the browser build opens it in a new tab.
 */

import manualAsset from "../../../../docs/manual/sourcesink-manual.pdf?url";

import { desktop } from "../desktop/desktop.js";

export interface ManualSection {
  /** Named destination inside the PDF. */
  dest: string;
  title: string;
  blurb: string;
  /** Example model the chapter works through, if any. */
  example?: string;
}

export const TUTORIALS: readonly ManualSection[] = [
  {
    dest: "chapter.2",
    title: "Tutorial 1: Build your first model",
    blurb: "Phosphorus in a lake, from an empty canvas: stocks, flows, units and checking the answer.",
  },
  {
    dest: "chapter.3",
    title: "Tutorial 2: Explore the example library",
    blurb: "The 33 cited, tested examples and how to read one.",
  },
  {
    dest: "chapter.4",
    title: "Tutorial 3: Calibrate a model to field data",
    blurb: "Fit the Streeter-Phelps rates to river measurements.",
    example: "streeter-phelps",
  },
  {
    dest: "chapter.5",
    title: "Tutorial 4: Sensitivity and uncertainty",
    blurb: "What controls the lowest dissolved oxygen downstream? Morris, Sobol and ensembles.",
    example: "streeter-phelps",
  },
  {
    dest: "chapter.6",
    title: "Tutorial 5: Build a model with the assistant",
    blurb: "Describe a system in words and review the proposed changes.",
  },
  {
    dest: "chapter.7",
    title: "Tutorial 6: Tidy a crowded diagram",
    blurb: "Auto-layout, sectors and folding for large models.",
  },
  {
    dest: "chapter.8",
    title: "Tutorial 7: The command line",
    blurb: "Run, fit and analyse models from a terminal or script.",
  },
];

export const REFERENCE: readonly ManualSection[] = [
  { dest: "chapter.1", title: "Introduction", blurb: "What system dynamics is and a tour of the window." },
  { dest: "chapter.9", title: "Reference", blurb: "Every element, setting and panel." },
  { dest: "appendix.A", title: "Equation functions", blurb: "The built-in function library." },
  { dest: "appendix.B", title: "Units", blurb: "Writing and checking units." },
  { dest: "appendix.C", title: "Keyboard shortcuts", blurb: "" },
  { dest: "appendix.D", title: "Troubleshooting", blurb: "" },
];

/** Absolute URL of the manual, optionally at a named destination. */
export function manualUrl(dest?: string, base: string = window.location.href): string {
  const url = new URL(manualAsset, base).href;
  return dest ? `${url}#nameddest=${dest}` : url;
}

export function openManual(dest?: string): void {
  const url = manualUrl(dest);
  const api = desktop();
  if (api) api.openManual(url);
  else window.open(url, "_blank", "noopener");
}
