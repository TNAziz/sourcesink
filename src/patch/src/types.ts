/**
 * SourceSink — model patch format.
 *
 * A patch is the only sanctioned way for an automated authoring layer (an AI,
 * the MCP server, a script) to change a model. Every operation is explicit,
 * reviewable and validated by `runGauntlet` before its result is simulated.
 */

import type {
  Converter,
  Flow,
  GraphFunction,
  Model,
  Provenance,
  RunSpec,
  Stock,
} from "@sourcesink/model";

/** Element kinds a patch can add. Connectors are created by `connect`. */
export type ElementKind = "stock" | "flow" | "converter" | "graphFunction";

/** A partial element supplied to `add`; only `name` is mandatory. */
export type PatchElement = Partial<Stock | Flow | Converter | GraphFunction> & {
  name: string;
};

export type PatchOp =
  | { op: "add"; kind: ElementKind; element: PatchElement }
  | { op: "update"; name: string; changes: Record<string, unknown> }
  | { op: "rename"; name: string; to: string }
  | { op: "remove"; name: string }
  | { op: "connect"; from: string; to: string }
  | { op: "disconnect"; from: string; to: string }
  | { op: "wire"; flow: string; from?: string | null; to?: string | null }
  | { op: "setRun"; run: Partial<RunSpec> }
  | { op: "setLayout"; name: string; x: number; y: number };

export interface ModelPatch {
  ops: PatchOp[];
  /** Stamped onto every element the patch adds or changes. */
  provenance?: Provenance;
  /** Free text: why this patch was proposed. */
  rationale?: string;
}

/** A raised condition in one stage of the validation gauntlet. */
export interface Finding {
  stage: Stage;
  severity: "error" | "warning";
  element?: string;
  message: string;
}

export type Stage = "schema" | "apply" | "parse" | "structure" | "units" | "smoke";

export interface GauntletResult {
  /** True when no finding has severity "error". */
  ok: boolean;
  /** The patched model when the apply stage succeeded. */
  model?: Model;
  findings: Finding[];
}

/** A patch operation that cannot apply; carries the failing op index (-1 when
 * the patch as a whole is malformed). */
export class PatchError extends Error {
  readonly opIndex: number;
  readonly op?: PatchOp;

  constructor(opIndex: number, message: string, op?: PatchOp) {
    super(opIndex >= 0 ? `patch op ${opIndex}: ${message}` : message);
    this.name = "PatchError";
    this.opIndex = opIndex;
    this.op = op;
  }
}
