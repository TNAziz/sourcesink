/**
 * SourceSink — deterministic auto-layout.
 *
 * `model.layout` (keyed by element name) is optional; anything missing gets a
 * position from this pure function so every model can be drawn. Anchored to
 * existing layout entries where present, otherwise a classic stock-and-flow
 * arrangement:
 *
 * - stocks in a horizontal row, with room for a valve chip between them;
 * - a flow between two stocks sits midway on the row;
 * - flows to or from clouds use the free side of the row first (inflows on
 *   the left, outflows on the right) and then fan out above (inflows) or
 *   below (outflows) the stock, so pipes never run on top of each other;
 * - converters float beside the element they feed, on the side away from the
 *   row, so information links stay short.
 *
 * Collision-free by construction: every placement checks the drawn boxes
 * (with a margin) and slides to the nearest free spot.
 */

import type { Flow, Model, Point, Stock } from "@sourcesink/model";
import { centerOf, SIZES, topLeftOf } from "./geometry.js";

type Kind = keyof typeof SIZES;

/** Center-to-center distance between neighbouring stocks on the row. */
const STOCK_STEP = 340;
/** Vertical distance between stock rows: room for fanned flows and their
 * converters above and below each row. */
const ROW_STEP = 460;
/** How far a fanned-out cloud flow's valve sits above/below its stock. */
const FAN_DY = 120;
/** Horizontal spacing between fanned-out valves. */
const FAN_DX = 150;
/** How far a converter floats from the element it feeds. */
const CONVERTER_GAP = 72;
/** Clearance kept around every drawn box. */
const MARGIN = 16;

interface Placed {
  center: Point;
  kind: Kind;
}

function overlaps(a: Placed, b: Placed): boolean {
  const sa = SIZES[a.kind];
  const sb = SIZES[b.kind];
  // A valve sits on its pipe, right next to the stocks it joins; it only
  // needs to clear them, not keep the full margin.
  const pair = new Set([a.kind, b.kind]);
  const margin = pair.has("valve") && pair.has("stock") ? 4 : MARGIN;
  return (
    Math.abs(a.center.x - b.center.x) < (sa.w + sb.w) / 2 + margin &&
    Math.abs(a.center.y - b.center.y) < (sa.h + sb.h) / 2 + margin
  );
}

/** Group stocks into chains (connected by stock-to-stock flows) and order
 * each chain upstream to downstream; chains sorted largest first, ties in
 * model order, then rows of up to five unconnected stocks. Deterministic. */
export function stockRows(m: Model, stocks: Stock[]): Stock[][] {
  const byId = new Map(m.stocks.map((s) => [s.id, s]));
  const include = new Set(stocks.map((s) => s.id));
  const next = new Map<string, Set<string>>();
  const prevs = new Map<string, Set<string>>();
  const link = (map: Map<string, Set<string>>, a: string, b: string) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  for (const f of m.flows) {
    const src = m.stocks.find((s) => (s.outflows ?? []).includes(f.id));
    const snk = m.stocks.find((s) => (s.inflows ?? []).includes(f.id));
    if (!src || !snk || src.id === snk.id || !include.has(src.id) || !include.has(snk.id)) continue;
    link(next, src.id, snk.id);
    link(prevs, snk.id, src.id);
  }
  const order = new Map(stocks.map((s, i) => [s.id, i]));
  const seen = new Set<string>();
  const rows: Stock[][] = [];
  for (const start of stocks) {
    if (seen.has(start.id)) continue;
    // The connected component (ignoring direction).
    const component: string[] = [];
    const stack = [start.id];
    seen.add(start.id);
    while (stack.length) {
      const id = stack.pop()!;
      component.push(id);
      for (const n of [...(next.get(id) ?? []), ...(prevs.get(id) ?? [])]) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    // Upstream-first order: repeatedly take stocks whose upstream stocks are
    // already placed; on a cycle (e.g. recycle), take the earliest in model order.
    const remaining = new Set(component);
    const row: Stock[] = [];
    while (remaining.size) {
      const ready = [...remaining].filter((id) => ![...(prevs.get(id) ?? [])].some((p) => remaining.has(p)));
      const pick = (ready.length ? ready : [...remaining]).sort((a, b) => order.get(a)! - order.get(b)!)[0];
      remaining.delete(pick);
      row.push(byId.get(pick)!);
    }
    rows.push(row);
  }
  // Chains of two or more get their own rows; lone stocks share rows of up
  // to five, after the chains.
  const chains = rows
    .filter((row) => row.length > 1)
    .map((row, i) => ({ row, i }))
    .sort((a, b) => b.row.length - a.row.length || a.i - b.i)
    .map(({ row }) => row);
  const singles = rows.filter((row) => row.length === 1).map((row) => row[0]);
  for (let i = 0; i < singles.length; i += 5) chains.push(singles.slice(i, i + 5));
  return chains;
}

/** Positions for every element that has no `model.layout` entry. */
export function autoLayout(m: Model): Record<string, Point> {
  const known = m.layout ?? {};
  const out: Record<string, Point> = {};
  const occupied: Placed[] = [];
  const kindOf = new Map<string, Kind>();
  for (const s of m.stocks) kindOf.set(s.name, "stock");
  for (const f of m.flows) kindOf.set(f.name, "valve");
  for (const c of m.converters) kindOf.set(c.name, "converter");

  for (const [name, pos] of Object.entries(known)) {
    const kind = kindOf.get(name);
    if (kind) occupied.push({ center: centerOf(pos, kind), kind });
  }

  const centerByName = (name: string): Point | undefined => {
    const kind = kindOf.get(name);
    const pos = known[name] ?? out[name];
    return kind && pos ? centerOf(pos, kind) : undefined;
  };

  const bottomY = (): number =>
    occupied.length === 0 ? 0 : Math.max(...occupied.map((p) => p.center.y)) + ROW_STEP;

  /** The free spot nearest the candidate, searching rings of offsets that
   * prefer the preferred direction (outward from the row). */
  const findFree = (center: Point, kind: Kind, preferY: number): Point => {
    const free = (p: Point) => !occupied.some((o) => overlaps(o, { center: p, kind }));
    if (free(center)) return center;
    const stepX = SIZES[kind].w / 2 + 24;
    const stepY = SIZES[kind].h + MARGIN;
    for (let ring = 1; ring <= 30; ring++) {
      const options: Point[] = [
        { x: center.x + ring * stepX, y: center.y },
        { x: center.x - ring * stepX, y: center.y },
        { x: center.x, y: center.y + preferY * ring * stepY },
        { x: center.x + ring * stepX, y: center.y + preferY * ring * stepY },
        { x: center.x - ring * stepX, y: center.y + preferY * ring * stepY },
      ];
      const hit = options.find(free);
      if (hit) return hit;
    }
    return center;
  };

  const place = (name: string, center: Point, kind: Kind, preferY = -1): void => {
    const spot = findFree(center, kind, preferY);
    out[name] = topLeftOf(spot, kind);
    occupied.push({ center: spot, kind });
  };

  // --- 1. stocks: one row per chain -----------------------------------------
  // Stocks joined by stock-to-stock flows form a chain; each chain gets its
  // own row (largest first), ordered along the direction material moves, so
  // separate subsystems never share a crowded line.
  const missingStocks = m.stocks.filter((s) => !known[s.name]);
  if (missingStocks.length > 0) {
    const knownStockY = m.stocks
      .filter((s) => known[s.name])
      .map((s) => centerOf(known[s.name]!, "stock").y);
    const firstRowY = knownStockY.length === 0 ? SIZES.stock.h / 2 : Math.max(...knownStockY) + ROW_STEP;
    stockRows(m, missingStocks).forEach((row, r) => {
      row.forEach((s, i) => {
        place(s.name, { x: i * STOCK_STEP + SIZES.stock.w / 2, y: firstRowY + r * ROW_STEP }, "stock");
      });
    });
  }

  // --- 2. flows ---------------------------------------------------------------
  const sourceOf = (f: Flow): Stock | undefined => m.stocks.find((s) => (s.outflows ?? []).includes(f.id));
  const sinkOf = (f: Flow): Stock | undefined => m.stocks.find((s) => (s.inflows ?? []).includes(f.id));

  // Between two stocks: midway (these claim the row slots first).
  for (const f of m.flows) {
    if (known[f.name]) continue;
    const src = sourceOf(f);
    const snk = sinkOf(f);
    if (!src || !snk) continue;
    const a = centerByName(src.name)!;
    const b = centerByName(snk.name)!;
    let center =
      a.x === b.x && a.y === b.y
        ? { x: a.x + STOCK_STEP / 2, y: a.y }
        : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // On one row, a flow that skips over stocks or runs backwards (a return
    // or recycle) loops below the row (backwards) or above it (forwards), so
    // it never lies on top of the neighbouring pipes.
    const sameRow = Math.abs(a.y - b.y) < 1;
    const skips = Math.abs(b.x - a.x) > STOCK_STEP * 1.1;
    const backwards = b.x < a.x;
    if (sameRow && (skips || backwards)) center = { x: center.x, y: a.y + (backwards ? 1 : -1) * FAN_DY };
    place(f.name, center, "valve", backwards ? 1 : -1);
  }

  // Cloud flows, grouped per stock so several of them fan out instead of
  // stacking on one line.
  // A row slot is free only at the open end of the row: no valve already
  // there and no neighbouring stock on that side (its cloud would land on it).
  const rowSlotTaken = (stockCenter: Point, side: -1 | 1): boolean =>
    occupied.some(
      (o) =>
        (o.kind === "valve" || o.kind === "stock") &&
        Math.abs(o.center.y - stockCenter.y) < SIZES.stock.h / 2 &&
        Math.sign(o.center.x - stockCenter.x) === side &&
        Math.abs(o.center.x - stockCenter.x) < STOCK_STEP * 1.25,
    );

  for (const stock of m.stocks) {
    const c = centerByName(stock.name);
    if (!c) continue;
    const cloudInflows = m.flows.filter((f) => !known[f.name] && !out[f.name] && sinkOf(f) === stock && !sourceOf(f));
    const cloudOutflows = m.flows.filter((f) => !known[f.name] && !out[f.name] && sourceOf(f) === stock && !sinkOf(f));

    const fan = (flows: Flow[], side: -1 | 1, dy: -1 | 1): void => {
      let rest = flows;
      if (rest.length > 0 && !rowSlotTaken(c, side)) {
        place(rest[0].name, { x: c.x + (side * STOCK_STEP) / 2, y: c.y }, "valve", dy);
        rest = rest.slice(1);
      }
      rest.forEach((f, i) => {
        const offset = (i - (rest.length - 1) / 2) * FAN_DX;
        place(f.name, { x: c.x + offset, y: c.y + dy * FAN_DY }, "valve", dy);
      });
    };
    fan(cloudInflows, -1, -1);
    fan(cloudOutflows, 1, 1);
  }

  // Flows with no stock at all.
  for (const f of m.flows) {
    if (known[f.name] || out[f.name]) continue;
    place(f.name, { x: 0, y: bottomY() }, "valve", 1);
  }

  // --- 3. converters: beside the element they feed --------------------------
  const rowYs = m.stocks.map((s) => centerByName(s.name)?.y).filter((y): y is number => y !== undefined);
  const nearestRowY = (y: number): number =>
    rowYs.length === 0 ? y : rowYs.reduce((best, r) => (Math.abs(r - y) < Math.abs(best - y) ? r : best));

  /** Place one converter next to `anchorName`, away from the row. */
  const placeBeside = (name: string, anchorName: string): void => {
    const anchor = centerByName(anchorName)!;
    const anchorKind = kindOf.get(anchorName)!;
    // Away from the row: above an element on (or above) it, below one under it.
    // "On the row" allows for the different heights of stocks and valves.
    const offset = anchor.y - nearestRowY(anchor.y);
    const tolerance = SIZES.stock.h / 2;
    const side: -1 | 1 = offset > tolerance ? 1 : -1;
    const offAxis = Math.abs(offset) > tolerance && anchorKind === "valve";
    const center = offAxis
      ? // A fanned-out valve: sit to its right, level with it.
        { x: anchor.x + SIZES.valve.w / 2 + SIZES.converter.w / 2 + 24, y: anchor.y }
      : { x: anchor.x, y: anchor.y + side * (SIZES[anchorKind].h / 2 + CONVERTER_GAP) };
    place(name, center, "converter", side);
  };

  // Place converters in passes so each one anchors to something already on
  // the canvas: first anything that feeds a placed element, then anything
  // that reads one (stocks and flows before other converters), repeating
  // until nothing changes. File order alone would strand a converter whose
  // only neighbour comes later.
  const pending = m.converters.filter((c) => !known[c.name]).map((c) => c.name);
  const rank = (name: string): number => (kindOf.get(name) === "converter" ? 1 : 0);
  let progress = true;
  while (pending.length > 0 && progress) {
    progress = false;
    for (const mode of ["feeds", "reads"] as const) {
      for (let i = 0; i < pending.length; i++) {
        const name = pending[i];
        const anchors = m.connectors
          .filter((k) => (mode === "feeds" ? k.from === name : k.to === name))
          .map((k) => (mode === "feeds" ? k.to : k.from))
          .filter((n) => n !== name && centerByName(n) !== undefined)
          .sort((x, y) => rank(x) - rank(y));
        if (anchors.length === 0) continue;
        placeBeside(name, anchors[0]);
        pending.splice(i, 1);
        i -= 1;
        progress = true;
      }
      if (progress) break;
    }
  }
  for (const name of pending) place(name, { x: 0, y: bottomY() }, "converter");

  return out;
}
