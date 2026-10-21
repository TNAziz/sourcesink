/**
 * SourceSink — layout for models grouped into sectors.
 *
 * Each sector is laid out on its own (saved positions first, auto-layout for
 * the rest) and drawn inside a titled frame; a folded sector is a single card.
 * The frames and cards are then packed into rows, in sector order, so folding
 * a sector closes the gap it leaves and a fully folded model is a compact
 * overview. Elements in no sector form one last, unframed block.
 *
 * Saved positions of sector members are relative to their own block: the
 * block's offset is added when drawing and subtracted again when an element is
 * dragged, so packing can move whole sectors without rewriting the layout.
 */

import type { Model, Point, Sector } from "@sourcesink/model";
import { autoLayout } from "./autoLayout.js";
import { CLOUD_OFFSET, centerOf, SIZES } from "./geometry.js";

/** A folded sector's card (also its size in the layout). */
export const SECTOR_CARD = { w: 240, h: 92 };
/** Space inside a frame around its elements, and the frame's title band. */
const FRAME_PAD = 40;
const FRAME_HEADER = 44;
/** Space between packed blocks. */
const BLOCK_GAP = 90;

export interface SectorBlock {
  /** Sector id, or null for the unframed block of unsectored elements. */
  id: string | null;
  name: string;
  collapsed: boolean;
  members: string[];
  /** The frame (or card) rectangle in flow coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Added to the saved (block-relative) entries of its elements; absent for
   * a folded sector. */
  offset?: Point;
}

export interface SectorLayout {
  /** Absolute layout entries for every element in an open block. */
  positions: Record<string, Point>;
  blocks: SectorBlock[];
  /** Element name → the offset added to its saved (block-relative) entry. */
  offsets: Record<string, Point>;
  /** Element name → id of the folded sector hiding it. */
  hiddenBy: Map<string, string>;
}

type Kind = "stock" | "valve" | "converter";

/** Sectors restricted to elements that exist (and are drawn) in `m`, each
 * element in its first sector only; empty sectors are dropped. */
export function liveSectors(m: Model): Sector[] {
  const kinds = elementKinds(m);
  const taken = new Set<string>();
  const out: Sector[] = [];
  for (const s of m.sectors ?? []) {
    const members = s.members.filter((n) => kinds.has(n) && !taken.has(n));
    members.forEach((n) => taken.add(n));
    if (members.length > 0) out.push({ ...s, members });
  }
  return out;
}

function elementKinds(m: Model): Map<string, Kind> {
  const kinds = new Map<string, Kind>();
  for (const s of m.stocks) kinds.set(s.name, "stock");
  for (const f of m.flows) kinds.set(f.name, "valve");
  for (const c of m.converters) kinds.set(c.name, "converter");
  return kinds;
}

/** The part of `m` made of `members` (flow wiring and connectors kept only
 * inside it), carrying the members' saved positions. */
function subModel(m: Model, members: Set<string>): Model {
  const flows = m.flows.filter((f) => members.has(f.name));
  const flowIds = new Set(flows.map((f) => f.id));
  const layout: Record<string, Point> = {};
  for (const [name, p] of Object.entries(m.layout ?? {})) if (members.has(name)) layout[name] = p;
  return {
    ...m,
    stocks: m.stocks
      .filter((s) => members.has(s.name))
      .map((s) => ({
        ...s,
        inflows: (s.inflows ?? []).filter((id) => flowIds.has(id)),
        outflows: (s.outflows ?? []).filter((id) => flowIds.has(id)),
      })),
    flows,
    converters: m.converters.filter((c) => members.has(c.name)),
    connectors: m.connectors.filter((c) => members.has(c.from) && members.has(c.to)),
    layout,
  };
}

export function sectorLayout(m: Model): SectorLayout {
  const kinds = elementKinds(m);
  const sectors = liveSectors(m);
  const inSector = new Set(sectors.flatMap((s) => s.members));
  const rest = [...kinds.keys()].filter((n) => !inSector.has(n));

  const groups: Array<{ id: string | null; name: string; collapsed: boolean; members: string[] }> = [
    ...sectors.map((s) => ({ id: s.id, name: s.name, collapsed: Boolean(s.collapsed), members: s.members })),
    ...(rest.length > 0 ? [{ id: null, name: "", collapsed: false, members: rest }] : []),
  ];

  // --- 1. lay out each open block in its own coordinates ----------------------
  const local = groups.map((g) => {
    if (g.collapsed) return { pos: {} as Record<string, Point>, minX: 0, minY: 0, w: SECTOR_CARD.w, h: SECTOR_CARD.h };
    const sub = subModel(m, new Set(g.members));
    const pos = { ...(sub.layout ?? {}), ...autoLayout(sub) };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const name of g.members) {
      const kind = kinds.get(name)!;
      const c = centerOf(pos[name] ?? { x: 0, y: 0 }, kind);
      minX = Math.min(minX, c.x - SIZES[kind].w / 2);
      maxX = Math.max(maxX, c.x + SIZES[kind].w / 2);
      minY = Math.min(minY, c.y - SIZES[kind].h / 2);
      maxY = Math.max(maxY, c.y + SIZES[kind].h / 2);
    }
    // Clouds at the open ends of flows sit beyond their valves (the same
    // rule the canvas draws them with), so the frame must include them.
    for (const f of sub.flows) {
      const src = sub.stocks.find((st) => st.outflows?.includes(f.id));
      const snk = sub.stocks.find((st) => st.inflows?.includes(f.id));
      if (src && snk) continue;
      const vc = centerOf(pos[f.name] ?? { x: 0, y: 0 }, "valve");
      const anchor = src ?? snk;
      const ac = anchor ? centerOf(pos[anchor.name] ?? { x: 0, y: 0 }, "stock") : null;
      for (const sign of src || snk ? [1] : [-1, 1]) {
        let cloud = { x: vc.x + sign * CLOUD_OFFSET, y: vc.y };
        if (ac) {
          const dx = vc.x - ac.x;
          const dy = vc.y - ac.y;
          if (Math.abs(dy) > Math.abs(dx)) cloud = { x: vc.x, y: vc.y + Math.sign(dy) * CLOUD_OFFSET };
          else if (Math.abs(dx) > 1) cloud = { x: vc.x + Math.sign(dx) * CLOUD_OFFSET, y: vc.y };
        }
        minX = Math.min(minX, cloud.x - SIZES.cloud.w / 2);
        maxX = Math.max(maxX, cloud.x + SIZES.cloud.w / 2);
        minY = Math.min(minY, cloud.y - SIZES.cloud.h / 2);
        maxY = Math.max(maxY, cloud.y + SIZES.cloud.h / 2);
      }
    }
    const framed = g.id !== null;
    const pad = framed ? FRAME_PAD : 0;
    const header = framed ? FRAME_HEADER : 0;
    return {
      pos,
      minX,
      minY,
      w: maxX - minX + 2 * pad,
      h: maxY - minY + pad + header,
    };
  });

  // --- 2. pack blocks into rows ------------------------------------------------
  // Rows aim for a landscape whole (about 3:1 before the window's own
  // aspect), counting the gaps, so a folded overview reads across the screen.
  const area = local.reduce((sum, b) => sum + (b.w + BLOCK_GAP) * (b.h + BLOCK_GAP), 0);
  const rowWidth = Math.max(...local.map((b) => b.w), Math.sqrt(area * 3));
  const blocks: SectorBlock[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  groups.forEach((g, i) => {
    const b = local[i];
    if (x > 0 && x + b.w > rowWidth) {
      x = 0;
      y += rowH + BLOCK_GAP;
      rowH = 0;
    }
    blocks.push({ id: g.id, name: g.name, collapsed: g.collapsed, members: g.members, x, y, w: b.w, h: b.h });
    x += b.w + BLOCK_GAP;
    rowH = Math.max(rowH, b.h);
  });

  // --- 3. absolute positions ---------------------------------------------------
  const positions: Record<string, Point> = {};
  const offsets: Record<string, Point> = {};
  const hiddenBy = new Map<string, string>();
  blocks.forEach((block, i) => {
    const b = local[i];
    if (block.collapsed) {
      for (const n of block.members) hiddenBy.set(n, block.id!);
      return;
    }
    const framed = block.id !== null;
    const offset = {
      x: block.x + (framed ? FRAME_PAD : 0) - b.minX,
      y: block.y + (framed ? FRAME_HEADER : 0) - b.minY,
    };
    block.offset = offset;
    for (const n of block.members) {
      const p = b.pos[n] ?? { x: 0, y: 0 };
      positions[n] = { x: p.x + offset.x, y: p.y + offset.y };
      offsets[n] = offset;
    }
  });

  return { positions, blocks, offsets, hiddenBy };
}

/** Where every drawn element sits: sector blocks when the model has sectors,
 * otherwise saved positions plus auto-layout. */
export function diagramPositions(m: Model): Record<string, Point> {
  if (liveSectors(m).length > 0) return sectorLayout(m).positions;
  return { ...(m.layout ?? {}), ...autoLayout(m) };
}

/** Where a new element dropped at `at` (flow coordinates) belongs: inside an
 * open sector's frame it joins that sector; otherwise it joins the
 * unsectored block. Returns the sector (or null) and the layout entry to
 * save, relative to that block, so the element appears where it was dropped. */
export function placementAt(m: Model, at: Point): { sectorId: string | null; at: Point } {
  if (liveSectors(m).length === 0) return { sectorId: null, at };
  const { blocks } = sectorLayout(m);
  const hit = blocks.find(
    (b) => b.id !== null && !b.collapsed && at.x >= b.x && at.x <= b.x + b.w && at.y >= b.y && at.y <= b.y + b.h,
  );
  const block = hit ?? blocks.find((b) => b.id === null);
  const o = block?.offset ?? { x: 0, y: 0 };
  return { sectorId: hit?.id ?? null, at: { x: at.x - o.x, y: at.y - o.y } };
}
