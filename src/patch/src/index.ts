/**
 * SourceSink — model patch format and validation gauntlet.
 *
 * Patch an IR model with reviewable operations, validate the result through
 * schema → apply → parse → structure → smoke, and render a before/after diff
 * for human review.
 */

export { applyPatch } from "./apply.js";
export { diffModels, renderDiff } from "./diff.js";
export type { ConnectorDiff, ElementDiff, FieldDiff, ModelDiff, RunDiff } from "./diff.js";
export { runGauntlet } from "./gauntlet.js";
export { canonicalName } from "./elements.js";
export { checkPatchSchema } from "./schema.js";
export { structuralFindings } from "./structure.js";
export {
  PatchError,
  type ElementKind,
  type Finding,
  type GauntletResult,
  type ModelPatch,
  type PatchElement,
  type PatchOp,
  type Stage,
} from "./types.js";
