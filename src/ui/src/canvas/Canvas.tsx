/**
 * SourceSink — the diagram canvas.
 *
 * React Flow renders the projection from `toFlow` (stocks, converters, flow
 * valves + derived clouds, pipes, connectors). Interactions:
 *  - tool + click on empty canvas → add element; flow/connector tools support
 *    drag gestures (pointer capture) that wire flows between stocks (clouds at
 *    the free ends) and add connectors, with toasts for connector errors;
 *  - select tool: drag nodes (moves persist through the store), marquee and
 *    shift multi-select, pipes/connector edges select their element;
 *  - Delete/Backspace removes the selection (ignored while typing);
 *  - double-click focuses the inspector name field via a window event.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { Point } from "@sourcesink/model";
import { useEditor } from "../state/store";
import { CloudNode, ConverterNode, StockNode, ValveNode } from "./nodes";
import { BowEdge, PipeEdge } from "./edges";
import { edgeElementId, isCloudId, selectionIds, toFlow } from "./toFlow";
import { layoutFromNode, mid, topLeftOf } from "./geometry";
import { ToastStack, useToasts } from "./toasts";
import { overlappingPairs } from "./overlaps";
import { MIN_READABLE_ZOOM, readableViewport } from "./fit";
import "./canvas.css";

const nodeTypes: NodeTypes = {
  "sd-stock": StockNode,
  "sd-converter": ConverterNode,
  "sd-valve": ValveNode,
  "sd-cloud": CloudNode,
};

const edgeTypes = { "sd-bow": BowEdge, "sd-pipe": PipeEdge };

interface Gesture {
  /** Element under the pointer-down (never a derived cloud). */
  startNode: string | null;
  /** Flow-space anchor: the start node's center, or the pane point. */
  startFlow: Point;
  startClient: Point;
  rect: DOMRect;
  moved: boolean;
}

interface Ghost {
  kind: "flow" | "connector";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Fit the diagram to the canvas, but never below a readable zoom (a huge
 * diagram then opens at its top-left instead of as specks). */
function fitReadable(inst: ReactFlowInstance, el: HTMLElement | null, duration: number): void {
  const nodes = inst.getNodes();
  if (!el || nodes.length === 0) return;
  const vp = readableViewport(inst.getNodesBounds(nodes), el.clientWidth, el.clientHeight);
  void inst.setViewport(vp, { duration });
}

/** Refit the view whenever a different document is loaded (not on edits). */
function AutoFit({ wrapRef }: { wrapRef: React.RefObject<HTMLDivElement | null> }) {
  const inst = useReactFlow();
  const pristine = useEditor((s) => (s.past.length === 0 && s.future.length === 0 ? s.model : null));
  const layoutVersion = useEditor((s) => s.layoutVersion);
  const prev = useRef<unknown>(null);
  const prevLayout = useRef(layoutVersion);
  useEffect(() => {
    const changed = pristine !== null && prev.current !== null && pristine !== prev.current;
    const tidied = layoutVersion !== prevLayout.current;
    prev.current = pristine;
    prevLayout.current = layoutVersion;
    if (!changed && !tidied) return;
    const t = setTimeout(() => fitReadable(inst, wrapRef.current, 400), 60);
    return () => clearTimeout(t);
  }, [pristine, layoutVersion, inst, wrapRef]);
  return null;
}

/** A quiet pill offering "Tidy up" when shapes overlap. Dismissing it hides
 * it until the number of overlaps changes. */
function TidyHint() {
  const model = useEditor((s) => s.model);
  const tidyLayout = useEditor((s) => s.tidyLayout);
  const count = useMemo(() => overlappingPairs(model).length, [model]);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  if (count === 0 || dismissedAt === count) return null;
  return (
    <div className="cv-tidy-hint" role="status">
      <span>
        {count === 1 ? "Two elements overlap" : `${count} overlapping pairs`}
      </span>
      <button type="button" className="cv-tidy-btn" onClick={tidyLayout}>
        Tidy up
      </button>
      <button
        type="button"
        className="cv-tidy-dismiss"
        aria-label="Dismiss"
        onClick={() => setDismissedAt(count)}
      >
        ×
      </button>
    </div>
  );
}

/** A dragged node's position as a layout entry (see ANCHORS in geometry). */
function layoutPoint(node: Node): { x: number; y: number } {
  const kind = node.type === "sd-stock" ? "stock" : node.type === "sd-converter" ? "converter" : "valve";
  return layoutFromNode(node.position, kind);
}

export function Canvas({ colorMode = "system" }: { colorMode?: "light" | "dark" | "system" }) {
  const model = useEditor((s) => s.model);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const result = useEditor((s) => s.result);
  const showConstants = useEditor((s) => s.showConstants);

  const { toasts, push } = useToasts();

  const { nodes, edges } = useMemo(
    () => toFlow(model, { selection, result, hideConstants: !showConstants }),
    [model, selection, result, showConstants],
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const suppressPaneClick = useRef(false);
  const [ghost, setGhost] = useState<Ghost | null>(null);

  const centerOfNode = useCallback(
    (id: string): Point | null => {
      const n = nodes.find((x) => x.id === id);
      if (!n) return null;
      return { x: n.position.x + (n.width ?? 0) / 2, y: n.position.y + (n.height ?? 0) / 2 };
    },
    [nodes],
  );

  // --- element creation via pane click ---------------------------------------
  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      if (suppressPaneClick.current) {
        suppressPaneClick.current = false;
        return;
      }
      const st = useEditor.getState();
      if (st.selection.length > 0) st.select([]); // clicking the background deselects
      if (st.tool !== "stock" && st.tool !== "converter" && st.tool !== "flow") return;
      const inst = rfRef.current;
      if (!inst) return;
      const pos = inst.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      st.addElement(st.tool, pos);
    },
    [],
  );

  // --- click selection (immediate store update) --------------------------------
  const clickSelect = useCallback((id: string, additive: boolean): void => {
    const st = useEditor.getState();
    if (st.tool !== "select") return;
    const cur = st.selection;
    if (additive) {
      st.select(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
    } else if (!cur.includes(id) || cur.length !== 1) {
      st.select([id]);
    }
  }, []);

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (isCloudId(node.id)) return;
      clickSelect(node.id, event.shiftKey);
    },
    [clickSelect],
  );

  const onEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      const id = edgeElementId(edge.id);
      if (id) clickSelect(id, event.shiftKey);
    },
    [clickSelect],
  );

  // --- draw gestures (flow / connector tools) --------------------------------
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      suppressPaneClick.current = false; // any fresh press invalidates stale suppression
      const t = useEditor.getState().tool;
      if (t !== "flow" && t !== "connector") return;
      if (e.button !== 0) return;
      const target = e.target as Element;
      if (target.closest(".react-flow__controls, .react-flow__minimap, .react-flow__attribution, .cv-toasts")) {
        return;
      }
      const inst = rfRef.current;
      const wrap = wrapRef.current;
      if (!inst || !wrap) return;

      const nodeEl = target.closest(".react-flow__node");
      const idRaw = nodeEl?.getAttribute("data-id") ?? null;
      const startNode = idRaw && !isCloudId(idRaw) ? idRaw : null;
      const client = { x: e.clientX, y: e.clientY };
      const startFlow =
        (startNode ? centerOfNode(startNode) : null) ?? inst.screenToFlowPosition(client);

      const rect = wrap.getBoundingClientRect();
      gestureRef.current = { startNode, startFlow, startClient: client, rect, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);

      const p0 = inst.flowToScreenPosition(startFlow);
      setGhost({
        kind: t === "connector" ? "connector" : "flow",
        x0: p0.x - rect.left,
        y0: p0.y - rect.top,
        x1: client.x - rect.left,
        y1: client.y - rect.top,
      });
    },
    [centerOfNode],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g) return;
    if (!g.moved && Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y) > 5) {
      g.moved = true;
    }
    setGhost((cur) =>
      cur ? { ...cur, x1: e.clientX - g.rect.left, y1: e.clientY - g.rect.top } : cur,
    );
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = gestureRef.current;
      if (!g) return;
      gestureRef.current = null;
      setGhost(null);
      const inst = rfRef.current;
      if (!inst) return;

      const st = useEditor.getState();
      const t = st.tool;
      const endClient = { x: e.clientX, y: e.clientY };
      const endFlow = inst.screenToFlowPosition(endClient);
      const endEl = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest(
        ".react-flow__node",
      );
      const endIdRaw = endEl?.getAttribute("data-id") ?? null;
      const endNode = endIdRaw && !isCloudId(endIdRaw) ? endIdRaw : null;

      if (t === "connector") {
        if (!g.moved || !g.startNode || !endNode || g.startNode === endNode) return;
        const err = st.addConnector(g.startNode, endNode);
        if (err) push(err, "error");
        return;
      }

      if (t !== "flow") return;
      if (!g.moved) {
        // Plain click on empty canvas → cloud-to-cloud flow. Pointer capture
        // retargets the following click away from the pane, so we create here
        // (onPaneClick would double-create where capture is not honored).
        if (!g.startNode) {
          suppressPaneClick.current = true;
          st.addFlow(null, null, endFlow);
        }
        return;
      }
      suppressPaneClick.current = true;

      const startCenter = g.startFlow;
      const endCenter = (endNode ? centerOfNode(endNode) : null) ?? endFlow;
      const valvePos = topLeftOf(mid(startCenter, endCenter), "valve");

      // One undo step: a wired flow (a stock into itself is just a cloud end).
      const fromId = st.model.stocks.find((s) => s.id === g.startNode)?.id ?? null;
      let toId = st.model.stocks.find((s) => s.id === endNode)?.id ?? null;
      if (fromId && toId && fromId === toId) toId = null;
      st.addFlow(fromId, toId, valvePos);
    },
    [centerOfNode, push],
  );

  const onPointerCancel = useCallback(() => {
    gestureRef.current = null;
    setGhost(null);
  }, []);

  // --- node dragging → moveElement --------------------------------------------
  const onNodeDrag = useCallback((_e: unknown, node: Node, dragged: Node[]) => {
    if (dragged.length === 1) {
      useEditor.getState().moveElement(node.id, layoutPoint(node), true);
    }
  }, []);

  const onNodeDragStop = useCallback((_e: unknown, _node: Node, dragged: Node[]) => {
    const st = useEditor.getState();
    const coalesce = dragged.length === 1;
    for (const n of dragged) st.moveElement(n.id, layoutPoint(n), coalesce);
  }, []);

  // --- selection sync -----------------------------------------------------------
  const onSelectionChange = useCallback(({ nodes: ns, edges: es }: OnSelectionChangeParams) => {
    const ids = selectionIds(
      ns.map((n) => n.id),
      es.map((e: Edge) => e.id),
    );
    const cur = useEditor.getState().selection;
    if (ids.length !== cur.length || ids.some((id, i) => cur[i] !== id)) {
      useEditor.getState().select(ids);
    }
  }, []);

  // --- inspector focus ------------------------------------------------------------
  const onNodeDoubleClick = useCallback((_e: unknown, node: Node) => {
    if (isCloudId(node.id)) return;
    // Ensure the element is selected so the inspector is showing it, then ask
    // the inspector to focus its name field.
    const st = useEditor.getState();
    st.select([node.id]);
    window.dispatchEvent(new CustomEvent("sourcesink:focus-name", { detail: { id: node.id } }));
  }, []);

  // --- keyboard ---------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const st = useEditor.getState();
      if (e.key === "Escape") {
        if (gestureRef.current) {
          gestureRef.current = null;
          setGhost(null);
        } else if (st.tool !== "select") {
          st.setTool("select");
        } else if (st.selection.length > 0) {
          st.select([]);
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (st.selection.length > 0) {
          e.preventDefault();
          st.deleteElements([...st.selection]);
        }
        return;
      }
      switch (e.key.toLowerCase()) {
        case "v":
          st.setTool("select");
          break;
        case "s":
          st.setTool("stock");
          break;
        case "f":
          st.setTool("flow");
          break;
        case "c":
          st.setTool("converter");
          break;
        case "k":
          st.setTool("connector");
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- keep the diagram in view when the canvas resizes -------------------------
  // The canvas box only changes when the results drawer opens/resizes or the
  // window resizes; refit (debounced) so nothing is ever cut off.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let first = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (rfRef.current) fitReadable(rfRef.current, el, 200);
      }, 120);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const isEmpty = model.stocks.length + model.flows.length + model.converters.length === 0;

  return (
    <div
      ref={wrapRef}
      className="cv-wrap"
      data-tool={tool}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        className="cv-flow"
        colorMode={colorMode}
        onInit={(inst) => {
          rfRef.current = inst;
        }}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.3, minZoom: MIN_READABLE_ZOOM }}
        minZoom={0.15}
        maxZoom={2.5}
        selectionOnDrag={tool === "select"}
        panOnDrag={[1, 2]}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        zoomActivationKeyCode="Control"
        multiSelectionKeyCode="Shift"
        deleteKeyCode={null}
        nodesDraggable={tool === "select"}
        nodesConnectable={false}
        elementsSelectable={tool === "select"}
        onPaneClick={onPaneClick}
        onSelectionChange={onSelectionChange}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
        <Controls showInteractive={false} position="bottom-left" />
        <AutoFit wrapRef={wrapRef} />
      </ReactFlow>

      {ghost ? (
        <svg className="cv-ghost" aria-hidden="true">
          <circle cx={ghost.x0} cy={ghost.y0} r="3.5" />
          <line
            x1={ghost.x0}
            y1={ghost.y0}
            x2={ghost.x1}
            y2={ghost.y1}
            className={ghost.kind === "flow" ? "cv-ghost-flow" : "cv-ghost-conn"}
          />
        </svg>
      ) : null}

      {isEmpty ? (
        <div className="cv-empty">
          <div className="cv-empty-card">
            <div>
              Press <kbd>S</kbd> to add a stock, <kbd>F</kbd> to draw a flow…
            </div>
            <div className="cv-empty-sub">
              <kbd>C</kbd> converter · <kbd>K</kbd> connector · drag between stocks to wire a flow
            </div>
          </div>
        </div>
      ) : null}

      <TidyHint />
      <ToastStack toasts={toasts} />
    </div>
  );
}
