/**
 * SourceSink — structural and numeric comparison for the assistant round trip.
 *
 * The rebuilt model is compared to the original in three ways: stocks and
 * flows (matched by name, then by name similarity, then by the stocks'
 * connections), feedback loops (matched by their member stocks), and the
 * simulated series of every matched stock (normalized RMSE). The thresholds
 * live here so the evaluation report and its unit tests share one definition
 * of "pass".
 */

import type { Model, Stock } from "@sourcesink/model";
import { canonicalName, simulate, type SimulationResult } from "@sourcesink/engine";
import { findLoops } from "@sourcesink/explain";

export interface Comparison {
  stocks: { matched: number; expected: number; extra: number };
  flows: { matched: number; expected: number; extra: number };
  /** Feedback loops (findLoops from @sourcesink/explain), matched by the
   * set of member stock names after name matching. */
  loops: { matched: number; expected: number };
  /** For each matched stock: normalized RMSE of the rebuilt run against the
   * original over the original's save times (interpolate), NaN when the
   * rebuilt model fails to simulate. */
  nrmse: Record<string, number>;
  /** stocks and flows all matched, no loops missing, every nrmse < 0.05. */
  pass: boolean;
}

/** The similarity floor for "the most similar name": any shared token counts. */
const MIN_SIMILARITY = 0;
/** A matched stock passes when its NRMSE is below this fraction of the
 * original's range. */
const NRMSE_LIMIT = 0.05;

interface MatchMap {
  /** original name -> rebuilt name */
  toRebuilt: Map<string, string>;
  /** rebuilt name -> original name */
  toOriginal: Map<string, string>;
}

function emptyMap(): MatchMap {
  return { toRebuilt: new Map(), toOriginal: new Map() };
}

function canonical(name: string): string {
  return canonicalName(name);
}

/** Tokens of a name, split on underscores after canonicalization. */
function tokens(name: string): Set<string> {
  return new Set(
    canonical(name)
      .split("_")
      .filter((token) => token.length > 0),
  );
}

/** Jaccard overlap of name tokens: 0 when nothing is shared. */
function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

/** Pass 1: identical canonical names, in original order (first free wins). */
function matchCanonical(originals: string[], rebuilt: string[], map: MatchMap): void {
  for (const original of originals) {
    if (map.toRebuilt.has(original)) continue;
    const target = rebuilt.find(
      (name) => !map.toOriginal.has(name) && canonical(name) === canonical(original),
    );
    if (target === undefined) continue;
    map.toRebuilt.set(original, target);
    map.toOriginal.set(target, original);
  }
}

/** Pass 2: the most similar name (token overlap) among the same kind. */
function matchSimilar(originals: string[], rebuilt: string[], map: MatchMap): void {
  const pairs: Array<{ original: string; rebuilt: string; score: number }> = [];
  for (const original of originals) {
    if (map.toRebuilt.has(original)) continue;
    for (const target of rebuilt) {
      if (map.toOriginal.has(target)) continue;
      const score = nameSimilarity(original, target);
      if (score > MIN_SIMILARITY) pairs.push({ original, rebuilt: target, score });
    }
  }
  pairs.sort(
    (a, b) =>
      b.score - a.score ||
      a.original.localeCompare(b.original) ||
      a.rebuilt.localeCompare(b.rebuilt),
  );
  for (const pair of pairs) {
    if (map.toRebuilt.has(pair.original) || map.toOriginal.has(pair.rebuilt)) continue;
    map.toRebuilt.set(pair.original, pair.rebuilt);
    map.toOriginal.set(pair.rebuilt, pair.original);
  }
}

/** Names of the flows wired to a stock, resolved from flow ids. */
function connectedFlows(stock: Stock, flowNames: Map<string, string>): { in: string[]; out: string[] } {
  return {
    in: (stock.inflows ?? []).map((id) => flowNames.get(id)).filter((n): n is string => n !== undefined),
    out: (stock.outflows ?? []).map((id) => flowNames.get(id)).filter((n): n is string => n !== undefined),
  };
}

/** Flow ids to names, for resolving the flows a stock is wired to. */
function flowNameIndex(model: Model): Map<string, string> {
  return new Map(model.flows.map((flow) => [flow.id, flow.name]));
}

/** Pass 3: a stock whose inflow/outflow count and connected flow names match
 * the original's, after the flows that are already matched. An isolated stock
 * (no flows) is only matched by name, never by structure. */
function matchStocksByStructure(original: Model, rebuilt: Model, map: MatchMap): void {
  const originalFlows = flowNameIndex(original);
  const rebuiltFlows = flowNameIndex(rebuilt);
  const rebuiltFlowName = (name: string): string | undefined => {
    const mapped = map.toRebuilt.get(name);
    if (mapped !== undefined) return mapped;
    return rebuilt.flows.find((flow) => canonical(flow.name) === canonical(name))?.name;
  };

  for (const stock of original.stocks) {
    if (map.toRebuilt.has(stock.name)) continue;
    const wanted = connectedFlows(stock, originalFlows);
    if (wanted.in.length === 0 && wanted.out.length === 0) continue;
    const wantedIn = wanted.in.map(rebuiltFlowName);
    const wantedOut = wanted.out.map(rebuiltFlowName);
    if ([...wantedIn, ...wantedOut].some((name) => name === undefined)) continue;

    const target = rebuilt.stocks.find((candidate) => {
      if (map.toOriginal.has(candidate.name)) return false;
      const have = connectedFlows(candidate, rebuiltFlows);
      if (have.in.length !== wanted.in.length || have.out.length !== wanted.out.length) return false;
      const sameSet = (expected: string[], actual: string[]): boolean => {
        const a = new Set(expected.map(canonical));
        const b = new Set(actual.map(canonical));
        return a.size === b.size && [...a].every((name) => b.has(name));
      };
      return sameSet(wantedIn as string[], have.in) && sameSet(wantedOut as string[], have.out);
    });
    if (target === undefined) continue;
    map.toRebuilt.set(stock.name, target.name);
    map.toOriginal.set(target.name, stock.name);
  }
}

/** Each flow's ends as (from stock, to stock) names; null is a cloud. */
function flowEnds(model: Model): Map<string, { from: string | null; to: string | null }> {
  const ends = new Map<string, { from: string | null; to: string | null }>();
  const byId = new Map(model.flows.map((flow) => [flow.id, flow.name]));
  for (const flow of model.flows) ends.set(flow.name, { from: null, to: null });
  for (const stock of model.stocks) {
    for (const id of stock.outflows ?? []) {
      const name = byId.get(id);
      if (name !== undefined) ends.get(name)!.from = stock.name;
    }
    for (const id of stock.inflows ?? []) {
      const name = byId.get(id);
      if (name !== undefined) ends.get(name)!.to = stock.name;
    }
  }
  return ends;
}

/** Pass 4: an unmatched flow matches an unmatched rebuilt flow that moves
 * material between the same (matched) stocks in the same direction, so
 * "diversion" can stand in for "Inflow" when both fill the same stock. At
 * least one end must be a stock; cloud-to-cloud flows match by name only. */
function matchFlowsByStructure(original: Model, rebuilt: Model, stocks: MatchMap, flows: MatchMap): void {
  const originalEnds = flowEnds(original);
  const rebuiltEnds = flowEnds(rebuilt);
  const mapEnd = (stock: string | null): string | null | undefined =>
    stock === null ? null : stocks.toRebuilt.get(stock);

  for (const flow of original.flows) {
    if (flows.toRebuilt.has(flow.name)) continue;
    const ends = originalEnds.get(flow.name)!;
    if (ends.from === null && ends.to === null) continue;
    const from = mapEnd(ends.from);
    const to = mapEnd(ends.to);
    if (from === undefined || to === undefined) continue;
    const target = rebuilt.flows.find((candidate) => {
      if (flows.toOriginal.has(candidate.name)) return false;
      const have = rebuiltEnds.get(candidate.name)!;
      return have.from === from && have.to === to;
    });
    if (target === undefined) continue;
    flows.toRebuilt.set(flow.name, target.name);
    flows.toOriginal.set(target.name, flow.name);
  }
}

/** Sorted member-stock names, used as a loop's identity. */
function loopKey(elements: string[], stockNames: Set<string>, rename: (name: string) => string | undefined): string | null {
  const members: string[] = [];
  for (const element of elements) {
    if (!stockNames.has(element)) continue;
    const mapped = rename(element);
    if (mapped === undefined) return null;
    members.push(canonicalName(mapped));
  }
  return [...new Set(members)].sort().join("|");
}

function countLoops(
  original: Model,
  rebuilt: Model,
  stocks: MatchMap,
): { matched: number; expected: number } {
  const originalStocks = new Set(original.stocks.map((stock) => stock.name));
  const rebuiltStocks = new Set(rebuilt.stocks.map((stock) => stock.name));
  const originalLoops = findLoops(original).loops;
  const rebuiltLoops = findLoops(rebuilt).loops;

  const available = new Map<string, number>();
  for (const loop of rebuiltLoops) {
    const key = loopKey(loop.elements, rebuiltStocks, (name) => name);
    if (key === null || key.length === 0) continue;
    available.set(key, (available.get(key) ?? 0) + 1);
  }

  let matched = 0;
  for (const loop of originalLoops) {
    const key = loopKey(loop.elements, originalStocks, (name) => stocks.toRebuilt.get(name));
    if (key === null || key.length === 0) continue;
    const count = available.get(key) ?? 0;
    if (count === 0) continue;
    available.set(key, count - 1);
    matched += 1;
  }
  return { matched, expected: originalLoops.length };
}

function safeSimulate(model: Model): SimulationResult | undefined {
  try {
    return simulate(model);
  } catch {
    return undefined;
  }
}

function seriesKeys(series: Record<string, number[]>, name: string): string[] {
  return Object.keys(series).filter(
    (key) => key === name || (key.startsWith(`${name}[`) && key.endsWith("]")),
  );
}

/** Linear interpolation, clamped to the nearest sample at both ends. */
function interpolate(time: number[], values: number[], at: number): number | undefined {
  const n = Math.min(time.length, values.length);
  if (n === 0) return undefined;
  if (at <= time[0]) return values[0];
  if (at >= time[n - 1]) return values[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid] <= at) lo = mid;
    else hi = mid;
  }
  const span = time[hi] - time[lo];
  if (span === 0) return values[hi];
  const fraction = (at - time[lo]) / span;
  return values[lo] + fraction * (values[hi] - values[lo]);
}

/** NRMSE of one matched stock, normalized by the original's range (falling
 * back to its magnitude when the series is constant). */
function stockNrmse(
  originalName: string,
  rebuiltName: string,
  original: SimulationResult | undefined,
  rebuilt: SimulationResult | undefined,
): number {
  if (!original || !rebuilt) return Number.NaN;
  const originalKeys = seriesKeys(original.series, originalName);
  if (originalKeys.length === 0) return Number.NaN;

  const rebuiltKeys = seriesKeys(rebuilt.series, rebuiltName);
  let sumSquares = 0;
  let points = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let maxAbs = 0;

  for (const key of originalKeys) {
    const suffix = key.slice(originalName.length);
    const rebuiltKey = rebuiltKeys.includes(`${rebuiltName}${suffix}`)
      ? `${rebuiltName}${suffix}`
      : rebuiltKeys.length === 1 && originalKeys.length === 1
        ? rebuiltKeys[0]
        : undefined;
    const values = original.series[key];
    const rebuiltValues = rebuiltKey === undefined ? undefined : rebuilt.series[rebuiltKey];
    if (!rebuiltValues) return Number.NaN;

    for (let row = 0; row < original.time.length; row += 1) {
      const expected = values[row];
      const actual = interpolate(rebuilt.time, rebuiltValues, original.time[row]);
      if (actual === undefined || expected === undefined) return Number.NaN;
      if (!Number.isFinite(expected) || !Number.isFinite(actual)) return Number.NaN;
      sumSquares += (expected - actual) ** 2;
      points += 1;
      min = Math.min(min, expected);
      max = Math.max(max, expected);
      maxAbs = Math.max(maxAbs, Math.abs(expected));
    }
  }

  if (points === 0) return Number.NaN;
  const range = max - min;
  const denominator = range > 1e-9 ? range : Math.max(1, maxAbs);
  return Math.sqrt(sumSquares / points) / denominator;
}

function compareKind(
  originalNames: string[],
  rebuiltNames: string[],
  map: MatchMap,
): { matched: number; expected: number; extra: number } {
  const matched = originalNames.filter((name) => map.toRebuilt.has(name)).length;
  const extra = rebuiltNames.filter((name) => !map.toOriginal.has(name)).length;
  return { matched, expected: originalNames.length, extra };
}

/** Compare a rebuilt model with the original it was meant to reproduce. */
export function compareModels(original: Model, rebuilt: Model): Comparison {
  const stocks = emptyMap();
  const flows = emptyMap();
  const originalStockNames = original.stocks.map((stock) => stock.name);
  const rebuiltStockNames = rebuilt.stocks.map((stock) => stock.name);
  const originalFlowNames = original.flows.map((flow) => flow.name);
  const rebuiltFlowNames = rebuilt.flows.map((flow) => flow.name);

  matchCanonical(originalFlowNames, rebuiltFlowNames, flows);
  matchSimilar(originalFlowNames, rebuiltFlowNames, flows);
  matchCanonical(originalStockNames, rebuiltStockNames, stocks);
  matchSimilar(originalStockNames, rebuiltStockNames, stocks);
  matchStocksByStructure(original, rebuilt, stocks);
  matchFlowsByStructure(original, rebuilt, stocks, flows);

  const originalRun = safeSimulate(original);
  const rebuiltRun = safeSimulate(rebuilt);
  const nrmse: Record<string, number> = {};
  for (const [originalName, rebuiltName] of stocks.toRebuilt) {
    nrmse[originalName] = stockNrmse(originalName, rebuiltName, originalRun, rebuiltRun);
  }

  const stockResult = compareKind(originalStockNames, rebuiltStockNames, stocks);
  const flowResult = compareKind(originalFlowNames, rebuiltFlowNames, flows);
  const loopResult = countLoops(original, rebuilt, stocks);

  const allPresent = (result: { matched: number; expected: number; extra: number }): boolean =>
    result.matched === result.expected && result.extra === 0;
  const pass =
    allPresent(stockResult) &&
    allPresent(flowResult) &&
    loopResult.matched === loopResult.expected &&
    Object.values(nrmse).every((value) => value < NRMSE_LIMIT);

  return { stocks: stockResult, flows: flowResult, loops: loopResult, nrmse, pass };
}
