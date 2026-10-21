/**
 * Pure series-selection and table-windowing logic for the results view.
 * Mirrors the store's convention: an empty `plotted` list means "all stocks".
 */
import type { Model, RunSpec } from "@sourcesink/model";
import { formatNumber } from "./csv";

/** The series an element produces: itself, or one per array element
 * (`Population[North]`, …) when it is arrayed. */
export function elementSeries(model: Model, name: string): string[] {
  const spec = model.arrayed[name];
  if (!spec || spec.dimensions.length === 0) return [name];
  const labels = spec.dimensions.map((n) => model.dimensions.find((d) => d.name === n)?.values ?? []);
  return labels
    .reduce<string[][]>((acc, ls) => acc.flatMap((c) => ls.map((l) => [...c, l])), [[]])
    .map((c) => `${name}[${c.join(",")}]`);
}

/** Plottable series names in stable model order: stocks, flows, converters. */
export function seriesNames(model: Model, extra: readonly string[] = []): string[] {
  const base = [
    ...model.stocks.flatMap((s) => elementSeries(model, s.name)),
    ...model.flows.flatMap((f) => elementSeries(model, f.name)),
    ...model.converters.flatMap((c) => elementSeries(model, c.name)),
  ];
  const known = new Set(base);
  return [...base, ...extra.filter((n) => !known.has(n))];
}

/** The default plotted set when nothing is explicitly selected: every stock. */
export function defaultPlotted(model: Model): string[] {
  return model.stocks.flatMap((s) => elementSeries(model, s.name));
}

/**
 * Resolve what is actually shown. `plotted` is the store list (empty means
 * "all stocks"); the result is reordered to stable model order and restricted
 * to `available` (the keys of the current run), so selections that no longer
 * have data — e.g. after a rename without a re-run — disappear.
 */
export function effectivePlotted(
  plotted: readonly string[],
  model: Model,
  available: readonly string[],
): string[] {
  const chosen = new Set(plotted.length === 0 ? defaultPlotted(model) : plotted);
  const availableSet = new Set(available);
  const order = orderedNames(plotted, model);
  return order.filter((n) => chosen.has(n) && availableSet.has(n));
}

/** Toggle one name in the plotted set, keeping stable model order. */
export function togglePlotted(
  plotted: readonly string[],
  name: string,
  model: Model,
): string[] {
  const chosen = new Set(plotted.length === 0 ? defaultPlotted(model) : plotted);
  if (chosen.has(name)) chosen.delete(name);
  else chosen.add(name);
  return orderedNames(plotted, model).filter((n) => chosen.has(n));
}

function orderedNames(plotted: readonly string[], model: Model): string[] {
  const modelNames = seriesNames(model);
  const known = new Set(modelNames);
  return [...modelNames, ...plotted.filter((n) => !known.has(n))];
}

export interface WindowRange {
  /** First visible row (inclusive). */
  start: number;
  /** One past the last visible row. */
  end: number;
}

/**
 * Which table rows to render for a scroll area with fixed-height rows.
 * `viewportHeight` must exclude any sticky header. The range is padded by
 * `overscan` rows on each side and clamped to the data.
 */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  totalRows: number,
  rowHeight: number,
  overscan = 10,
): WindowRange {
  if (totalRows <= 0 || viewportHeight <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(totalRows, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  return { start, end: Math.max(start, end) };
}

/** Spacer heights that hold the place of the rows outside the window. */
export function padHeights(
  range: WindowRange,
  totalRows: number,
  rowHeight: number,
): { top: number; bottom: number } {
  return {
    top: range.start * rowHeight,
    bottom: Math.max(0, (totalRows - range.end) * rowHeight),
  };
}

/** "t = 0 … 12 Year, DT = 0.25" — the small header caption. */
export function runCaption(run: RunSpec): string {
  const units = run.timeUnits ? ` ${run.timeUnits}` : "";
  return `t = ${formatNumber(run.start)} … ${formatNumber(run.stop)}${units}, DT = ${formatNumber(run.dt)}`;
}
