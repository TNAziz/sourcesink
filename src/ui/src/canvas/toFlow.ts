/**
 * SourceSink — projection of the model IR onto React Flow nodes/edges (pure).
 *
 * Symbology: stocks → rounded rectangles; converters → circles with the name
 * below; a flow → a thick straight "pipe" drawn as two edges that meet at the
 * flow's valve node (a small bow-tie carrying the name); unattached pipe ends
 * terminate in cloud nodes derived from the valve position. Connectors → thin
 * curved arrows. All colors go through CSS variables from theme.css.
 */

import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { Model, Point } from "@sourcesink/model";
import type { SimulationResult } from "@sourcesink/engine";
import { autoLayout } from "./autoLayout.js";
import { liveSectors, sectorLayout } from "./sectorLayout.js";
import { withoutConstants } from "../inspector/parameters.js";
import {
  CLOUD_OFFSET,
  boundaryPoint,
  centerOf,
  connectorBow,
  formatValue,
  pickHandle,
  type Segment,
  SIZES,
  nodeTopLeft,
} from "./geometry.js";

// --- node data payloads ------------------------------------------------------

export interface StockNodeData extends Record<string, unknown> {
  name: string;
  /** Drawn differently: a belt for conveyors, slots for queues. */
  variant: "reservoir" | "conveyor" | "queue" | "oven";
  /** Arrayed elements are drawn as a stack. */
  arrayed?: boolean;
  /** AI-proposed elements carry a small accent badge. */
  proposedByAi?: boolean;
  /** Formatted final value shown after a run (null before). */
  final: string | null;
  /** Declared units, shown muted next to the value. */
  units?: string;
}
export interface ConverterNodeData extends Record<string, unknown> {
  name: string;
  arrayed?: boolean;
  proposedByAi?: boolean;
  /** The value of a plain constant ("0.3"), shown in the pill; absent for
   * computed converters. */
  constant?: string;
}
export interface ValveNodeData extends Record<string, unknown> {
  name: string;
  biflow: boolean;
}
export interface CloudNodeData extends Record<string, unknown> {
  flow: string;
}
/** An open sector's frame, drawn behind its elements. */
export interface SectorFrameData extends Record<string, unknown> {
  sectorId: string;
  name: string;
  count: number;
}
/** A folded sector: one card standing for all its elements. */
export interface SectorCardData extends Record<string, unknown> {
  sectorId: string;
  name: string;
  stocks: number;
  flows: number;
  converters: number;
}
/** Exact pipe endpoints (flow coordinates), boundary to boundary. */
export interface PipeEdgeData extends Record<string, unknown> {
  a: Point;
  b: Point;
}
/** Precomputed arc bow for a connector edge (signed: + bows clockwise). */
export interface ConnectorEdgeData extends Record<string, unknown> {
  bow: number;
}

export interface ToFlowOptions {
  /** Currently selected element ids (nodes and their edges light up). */
  selection?: string[];
  /** Last simulation result (enables final values on stocks). */
  result?: SimulationResult | null;
  /** Leave constant converters (and their connectors) off the diagram. */
  hideConstants?: boolean;
}

export interface FlowDiagram {
  nodes: Node[];
  edges: Edge[];
  /** Element id → offset between its drawn and saved position (sector
   * blocks); subtract it when saving a dragged position. */
  offsets: Record<string, Point>;
}

/** Node id of a folded sector's card. */
export function sectorCardId(sectorId: string): string {
  return `sector:${sectorId}`;
}

export function isSectorNodeId(id: string): boolean {
  return id.startsWith("sector:") || id.startsWith("frame:");
}

/** Derived cloud node id for the stock-less end of a flow. */
export function cloudId(side: "src" | "snk", flowId: string): string {
  return `cloud:${side}:${flowId}`;
}

export function isCloudId(id: string): boolean {
  return id.startsWith("cloud:");
}

/** A plain numeric equation, formatted for a converter pill. */
function constantOf(equation: string): string | undefined {
  const text = equation.trim();
  if (text === "" || !Number.isFinite(Number(text))) return undefined;
  return formatValue(Number(text));
}

/** Element ids for a canvas selection: node ids plus the elements behind
 * selected edges, each once. A selected flow also marks its two pipe edges
 * selected, so without de-duplication one flow would read as three elements. */
export function selectionIds(nodeIds: readonly string[], edgeIds: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of [...nodeIds, ...edgeIds.map(edgeElementId)]) {
    if (id !== null && !isCloudId(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Map a pipe/connector edge id back to the element id it represents. */
export function edgeElementId(edgeId: string): string | null {
  if (edgeId.startsWith("conn:")) return edgeId.slice(5);
  if (edgeId.startsWith("pipe:")) {
    const rest = edgeId.slice(5);
    const i = rest.lastIndexOf(":");
    return i === -1 ? rest : rest.slice(0, i);
  }
  return null;
}

function finalValue(result: SimulationResult | null, name: string): string | null {
  if (!result) return null;
  const s = result.series[name];
  if (!s || s.length === 0) return null;
  return formatValue(s[s.length - 1]);
}

/** Project the model into React Flow nodes/edges. */
export function toFlow(model: Model, opts: ToFlowOptions = {}): FlowDiagram {
  // Hidden constants are dropped before layout, so the rest closes up.
  const m = opts.hideConstants ? withoutConstants(model) : model;
  const sel = new Set(opts.selection ?? []);
  const result = opts.result ?? null;
  const grouped = liveSectors(m).length > 0 ? sectorLayout(m) : null;
  const positions: Record<string, Point> = grouped ? grouped.positions : { ...(m.layout ?? {}), ...autoLayout(m) };
  const posOf = (name: string): Point => positions[name] ?? { x: 0, y: 0 };
  const hiddenBy = grouped?.hiddenBy ?? new Map<string, string>();
  const isHidden = (name: string): boolean => hiddenBy.has(name);

  const idByName = new Map<string, string>();
  for (const e of [...m.stocks, ...m.flows, ...m.converters]) idByName.set(e.name, e.id);

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const offsets: Record<string, Point> = {};
  const cardCenter = new Map<string, Point>();

  // --- sectors: frames behind open ones, a card for each folded one ------------
  for (const block of grouped?.blocks ?? []) {
    if (block.id === null) continue;
    const size = { width: block.w, height: block.h, style: { width: `${block.w}px`, height: `${block.h}px` } };
    if (block.collapsed) {
      const id = sectorCardId(block.id);
      cardCenter.set(id, { x: block.x + block.w / 2, y: block.y + block.h / 2 });
      const count = (pred: (n: string) => boolean) => block.members.filter(pred).length;
      nodes.push({
        id,
        type: "sd-sector-card",
        position: { x: block.x, y: block.y },
        ...size,
        draggable: false,
        selectable: false,
        data: {
          sectorId: block.id,
          name: block.name,
          stocks: count((n) => m.stocks.some((s) => s.name === n)),
          flows: count((n) => m.flows.some((f) => f.name === n)),
          converters: count((n) => m.converters.some((c) => c.name === n)),
        } satisfies SectorCardData,
      });
    } else {
      nodes.push({
        id: `frame:${block.id}`,
        type: "sd-sector-frame",
        position: { x: block.x, y: block.y },
        ...size,
        zIndex: -1,
        draggable: false,
        selectable: false,
        focusable: false,
        data: { sectorId: block.id, name: block.name, count: block.members.length } satisfies SectorFrameData,
      });
    }
  }
  for (const [name, offset] of Object.entries(grouped?.offsets ?? {})) {
    const id = idByName.get(name);
    if (id) offsets[id] = offset;
  }
  /** The node standing for an element: itself, or its folded sector's card. */
  const nodeFor = (name: string): string => {
    const s = hiddenBy.get(name);
    return s !== undefined ? sectorCardId(s) : idByName.get(name)!;
  };
  /** Pipe segments (boundary to boundary) for connector clearance checks. */
  const pipeSegments: Segment[] = [];

  const kindOf = (id: string): keyof typeof SIZES => {
    if (isCloudId(id)) return "cloud";
    if (id.startsWith("sector:")) return "sector";
    const el = m.stocks.find((s) => s.id === id) ?? m.flows.find((f) => f.id === id) ?? m.converters.find((c) => c.id === id);
    return el?.kind === "stock" ? "stock" : el?.kind === "converter" ? "converter" : "valve";
  };

  const box = (kind: keyof typeof SIZES): { width: number; height: number; style: { width: string; height: string } } => {
    const s = SIZES[kind];
    return { width: s.w, height: s.h, style: { width: `${s.w}px`, height: `${s.h}px` } };
  };

  // --- stocks ---------------------------------------------------------------
  for (const s of m.stocks) {
    if (isHidden(s.name)) continue;
    const b = box("stock");
    nodes.push({
      id: s.id,
      type: "sd-stock",
      position: nodeTopLeft(centerOf(posOf(s.name), "stock"), "stock"),
      width: b.width,
      height: b.height,
      style: b.style,
      data: {
        name: s.name,
        variant: s.conveyor ? "conveyor" : s.queue ? "queue" : s.oven ? "oven" : "reservoir",
        arrayed: Boolean(m.arrayed[s.name]?.dimensions.length),
        proposedByAi: s.provenance?.author === "ai",
        final: finalValue(result, s.name),
        ...(s.units ? { units: s.units } : {}),
      } satisfies StockNodeData,
      selected: sel.has(s.id),
    });
  }

  // --- converters -------------------------------------------------------------
  for (const c of m.converters) {
    if (isHidden(c.name)) continue;
    const b = box("converter");
    nodes.push({
      id: c.id,
      type: "sd-converter",
      position: nodeTopLeft(centerOf(posOf(c.name), "converter"), "converter"),
      width: b.width,
      height: b.height,
      style: b.style,
      data: {
        name: c.name,
        arrayed: Boolean(m.arrayed[c.name]?.dimensions.length),
        proposedByAi: c.provenance?.author === "ai",
        ...(constantOf(c.equation) !== undefined ? { constant: constantOf(c.equation) } : {}),
      } satisfies ConverterNodeData,
      selected: sel.has(c.id),
    });
  }

  // --- flows: valve node + derived clouds + pipe segments ---------------------
  const crossing = new Set<string>();
  for (const f of m.flows) {
    const src = m.stocks.find((s) => (s.outflows ?? []).includes(f.id)) ?? null;
    const snk = m.stocks.find((s) => (s.inflows ?? []).includes(f.id)) ?? null;
    const pipe = (
      id: string,
      fromId: string,
      fromCenter: Point,
      toId: string,
      toCenter: Point,
      arrow: boolean,
    ): Edge => {
      const h = pickHandle(fromCenter, toCenter);
      let a = boundaryPoint(fromCenter, kindOf(fromId), h.sourceHandle.slice(2) as "l" | "r" | "t" | "b");
      let b = boundaryPoint(toCenter, kindOf(toId), h.targetHandle.slice(2) as "l" | "r" | "t" | "b");
      // A valve fanned out above/below a stock drops straight into the stock
      // at its own x (not the stock's top-center), so neighbouring pipes stay
      // parallel instead of converging.
      const vertical = h.sourceHandle === "s-t" || h.sourceHandle === "s-b";
      const fromStock = kindOf(fromId) === "stock";
      const toStock = kindOf(toId) === "stock";
      if (vertical && (fromStock || toStock)) {
        const stockC = fromStock ? fromCenter : toCenter;
        const other = fromStock ? toCenter : fromCenter;
        const half = SIZES.stock.w / 2 - 12;
        // Enter the stock edge at the valve's x, kept inside the card.
        const x = Math.min(stockC.x + half, Math.max(stockC.x - half, other.x));
        if (fromStock) {
          a = { x, y: a.y };
          b = { x: other.x, y: b.y };
        } else {
          a = { x: other.x, y: a.y };
          b = { x, y: b.y };
        }
      }
      // Record the pipe run (boundary to boundary) for connector clearance.
      pipeSegments.push({ a, b });
      return {
        id,
        source: fromId,
        target: toId,
        type: "sd-pipe",
        data: { a, b } satisfies PipeEdgeData,
        ...h,
        // A thin, solid neutral pipe: material moves along it. Markers scale
        // with stroke width (markerUnits="strokeWidth"); 4 renders ~12px.
        style: { stroke: "var(--pipe)", strokeWidth: 3, strokeLinecap: "round" },
        markerEnd: arrow
          ? { type: MarkerType.ArrowClosed, width: 4, height: 4, color: "var(--pipe)" }
          : undefined,
        selected: sel.has(f.id),
        interactionWidth: 16,
      };
    };
    // A flow inside a folded sector: only the pipes that cross the card's
    // edge are drawn, once per pair of nodes.
    if (isHidden(f.name)) {
      const card = nodeFor(f.name);
      const cc = cardCenter.get(card)!;
      const endCenter = (s: { name: string }): Point =>
        isHidden(s.name) ? cardCenter.get(nodeFor(s.name))! : centerOf(posOf(s.name), "stock");
      if (src && nodeFor(src.name) !== card && !crossing.has(`${nodeFor(src.name)}>${card}`)) {
        crossing.add(`${nodeFor(src.name)}>${card}`);
        edges.push(pipe(`pipe:${f.id}:a`, nodeFor(src.name), endCenter(src), card, cc, true));
      }
      if (snk && nodeFor(snk.name) !== card && !crossing.has(`${card}>${nodeFor(snk.name)}`)) {
        crossing.add(`${card}>${nodeFor(snk.name)}`);
        edges.push(pipe(`pipe:${f.id}:b`, card, cc, nodeFor(snk.name), endCenter(snk), true));
      }
      continue;
    }

    const valvePos = posOf(f.name);
    const vc = centerOf(valvePos, "valve");
    const vb = box("valve");
    nodes.push({
      id: f.id,
      type: "sd-valve",
      position: nodeTopLeft(vc, "valve"),
      width: vb.width,
      height: vb.height,
      style: vb.style,
      data: { name: f.name, biflow: f.biflow ?? false } satisfies ValveNodeData,
      selected: sel.has(f.id),
    });

    const stockCenter = (st: { name: string }): Point =>
      isHidden(st.name) ? cardCenter.get(nodeFor(st.name))! : centerOf(posOf(st.name), "stock");
    const srcC = src ? stockCenter(src) : null;
    const snkC = snk ? stockCenter(snk) : null;

    // A cloud sits CLOUD_OFFSET beyond the valve on the axis pointing away
    // from the attached stock (straight up/down for a valve above/below it,
    // straight left/right otherwise), so cloud pipes never run diagonally
    // across each other. Left/right when there is no stock.
    const cloudAt = (anchor: Point | null, sign: number): Point => {
      if (anchor) {
        const dx = vc.x - anchor.x;
        const dy = vc.y - anchor.y;
        if (Math.abs(dy) > Math.abs(dx)) return { x: vc.x, y: vc.y + Math.sign(dy) * CLOUD_OFFSET };
        if (Math.abs(dx) > 1) return { x: vc.x + Math.sign(dx) * CLOUD_OFFSET, y: vc.y };
      }
      return { x: vc.x + sign * CLOUD_OFFSET, y: vc.y };
    };

    const srcId = src ? nodeFor(src.name) : cloudId("src", f.id);
    const snkId = snk ? nodeFor(snk.name) : cloudId("snk", f.id);
    const srcCenter = srcC ?? cloudAt(snkC, -1);
    const snkCenter = snkC ?? cloudAt(srcC, 1);

    for (const side of ["src", "snk"] as const) {
      if (side === "src" ? src : snk) continue;
      const center = side === "src" ? srcCenter : snkCenter;
      const b = box("cloud");
      nodes.push({
        id: cloudId(side, f.id),
        type: "sd-cloud",
        position: nodeTopLeft(center, "cloud"),
        width: b.width,
        height: b.height,
        style: b.style,
        draggable: false,
        selectable: false,
        deletable: false,
        focusable: false,
        data: { flow: f.name } satisfies CloudNodeData,
      });
    }

    edges.push(pipe(`pipe:${f.id}:a`, srcId, srcCenter, f.id, vc, false));
    // The sink segment carries the direction arrow where it enters the stock/cloud.
    edges.push(pipe(`pipe:${f.id}:b`, f.id, vc, snkId, snkCenter, true));
  }

  // --- connectors: thin curved arrows ------------------------------------------
  const centerByName = new Map<string, Point>();
  for (const s of m.stocks) centerByName.set(s.name, centerOf(posOf(s.name), "stock"));
  for (const f of m.flows) centerByName.set(f.name, centerOf(posOf(f.name), "valve"));
  for (const c of m.converters) centerByName.set(c.name, centerOf(posOf(c.name), "converter"));

  // Links into or out of a folded sector attach to its card, once per pair.
  const drawnLinks = new Set<string>();
  for (const c of m.connectors) {
    if (!idByName.has(c.from) || !idByName.has(c.to)) continue;
    const fromId = nodeFor(c.from);
    const toId = nodeFor(c.to);
    const fromC = cardCenter.get(fromId) ?? centerByName.get(c.from);
    const toC = cardCenter.get(toId) ?? centerByName.get(c.to);
    if (!fromC || !toC || fromId === toId) continue;
    if (drawnLinks.has(`${fromId}>${toId}`)) continue;
    drawnLinks.add(`${fromId}>${toId}`);
    const h = pickHandle(fromC, toC);
    const fromSide = h.sourceHandle.slice(2) as "l" | "r" | "t" | "b";
    const toSide = h.targetHandle.slice(2) as "l" | "r" | "t" | "b";
    const bow = connectorBow(
      boundaryPoint(fromC, kindOf(fromId), fromSide),
      boundaryPoint(toC, kindOf(toId), toSide),
      pipeSegments,
    );
    edges.push({
      id: `conn:${c.id}`,
      source: fromId,
      target: toId,
      type: "sd-bow",
      ...h,
      data: { bow } satisfies ConnectorEdgeData,
      // Information links are dashed, like AgenticNodes wires, so they read
      // as lighter than the material pipes.
      style: { stroke: "var(--connector)", strokeWidth: 1.5, strokeDasharray: "5 4" },
      // ~7px across on the 1.5px stroke (markers scale with stroke width).
      markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color: "var(--connector)" },
      selected: sel.has(c.id),
      interactionWidth: 14,
    });
  }

  return { nodes, edges, offsets };
}
