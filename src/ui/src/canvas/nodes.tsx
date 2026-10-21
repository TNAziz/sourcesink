/**
 * SourceSink — canvas node components. All shapes/colors are original and styled
 * exclusively through theme.css variables (see canvas.css).
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { CloudNodeData, ConverterNodeData, StockNodeData, ValveNodeData } from "./toFlow";

/**
 * Every node exposes hidden anchor handles on its four sides (a source and a
 * target variant); toFlow picks facing ones per edge so pipes and connectors
 * terminate on the element border.
 */
function NodeHandles() {
  return (
    <>
      <Handle type="source" id="s-l" position={Position.Left} isConnectable={false} className="cv-h" />
      <Handle type="source" id="s-r" position={Position.Right} isConnectable={false} className="cv-h" />
      <Handle type="source" id="s-t" position={Position.Top} isConnectable={false} className="cv-h" />
      <Handle type="source" id="s-b" position={Position.Bottom} isConnectable={false} className="cv-h" />
      <Handle type="target" id="t-l" position={Position.Left} isConnectable={false} className="cv-h" />
      <Handle type="target" id="t-r" position={Position.Right} isConnectable={false} className="cv-h" />
      <Handle type="target" id="t-t" position={Position.Top} isConnectable={false} className="cv-h" />
      <Handle type="target" id="t-b" position={Position.Bottom} isConnectable={false} className="cv-h" />
    </>
  );
}

type StockNode = Node<StockNodeData, "sd-stock">;
type ConverterNode = Node<ConverterNodeData, "sd-converter">;
type ValveNode = Node<ValveNodeData, "sd-valve">;
type CloudNode = Node<CloudNodeData, "sd-cloud">;

/** Small corner marker for AI-proposed elements (imports stay unmarked). */
function AiBadge() {
  return <span className="cv-ai-badge" title="Proposed by AI" aria-label="Proposed by AI" />;
}

const VARIANT_TAG: Record<StockNodeData["variant"], string | null> = {
  reservoir: null,
  conveyor: "conveyor",
  queue: "queue",
  oven: "oven",
};

/** A stock: a card with a pastel header carrying the name, and the latest
 * value (with units) in the body. */
export function StockNode({ data }: NodeProps<StockNode>) {
  const tag = VARIANT_TAG[data.variant];
  return (
    <div className={`cv-stock cv-stock-${data.variant}${data.arrayed ? " cv-arrayed" : ""}`} title={data.name}>
      <NodeHandles />
      {data.proposedByAi ? <AiBadge /> : null}
      <div className="cv-stock-head">
        <span className="cv-stock-name">{data.name}</span>
        {tag ? <span className="cv-stock-tag">{tag}</span> : null}
      </div>
      <div className="cv-stock-body">
        <span className="cv-stock-final">{data.final ?? "—"}</span>
        {data.units ? <span className="cv-stock-units">{data.units}</span> : null}
      </div>
    </div>
  );
}

/** A converter: a pastel pill with its name and, for a constant, its value. */
export function ConverterNode({ data }: NodeProps<ConverterNode>) {
  return (
    <div className={`cv-converter${data.arrayed ? " cv-arrayed-converter" : ""}`} title={data.name}>
      <NodeHandles />
      {data.proposedByAi ? <AiBadge /> : null}
      <span className="cv-chip-name">{data.name}</span>
      {data.constant !== undefined ? <span className="cv-chip-value">{data.constant}</span> : null}
    </div>
  );
}

/** A flow's valve: a small chip on the pipe with a bow-tie mark and the name. */
export function ValveNode({ data }: NodeProps<ValveNode>) {
  return (
    <div className="cv-valve" title={data.name}>
      <NodeHandles />
      <span className="cv-valve-bow" data-biflow={data.biflow ? "true" : undefined} aria-hidden="true" />
      <span className="cv-chip-name">{data.name}</span>
    </div>
  );
}

/** The stock-less end of a flow: a faint cloud marking "outside the model". */
export function CloudNode(_props: NodeProps<CloudNode>) {
  return (
    <div className="cv-cloud">
      <NodeHandles />
      <svg viewBox="0 0 48 36" width="34" height="24" aria-hidden="true">
        <path
          className="cv-cloud-shape"
          d="M 13 27 C 6 27 3 22 6 18 C 3 13 8 8 13 10 C 15 4 24 3 27 9 C 33 6 39 11 37 16 C 43 17 43 25 36 27 Z"
        />
      </svg>
    </div>
  );
}
