/**
 * Schema stage of the validation gauntlet.
 *
 * The checker deliberately validates *shape*, not meaning: every operation
 * must be a known op with no unknown keys, and every supplied element/run field
 * must have the type the IR declares. Semantic failures (a name that does not
 * exist, a cycle, a NaN run) belong to later stages.
 */

import type { ElementKind, Finding } from "./types.js";

const ELEMENT_KINDS: readonly ElementKind[] = ["stock", "flow", "converter", "graphFunction"];

const COMMON_FIELDS = ["name", "documentation", "units", "provenance", "annotations"] as const;

const KIND_FIELDS: Record<ElementKind, readonly string[]> = {
  stock: ["equation", "nonNegative", "inflows", "outflows", "conveyor", "queue", "oven"],
  flow: ["equation", "biflow", "nonNegative", "leak"],
  converter: ["equation"],
  graphFunction: ["points", "interpolation", "extrapolation"],
};

const RUN_FIELDS = ["start", "stop", "dt", "saveEvery", "integration", "timeUnits", "dtUnits"] as const;

const OP_FIELDS: Record<string, readonly string[]> = {
  add: ["op", "kind", "element"],
  update: ["op", "name", "changes"],
  rename: ["op", "name", "to"],
  remove: ["op", "name"],
  connect: ["op", "from", "to"],
  disconnect: ["op", "from", "to"],
  wire: ["op", "flow", "from", "to"],
  setRun: ["op", "run"],
  setLayout: ["op", "name", "x", "y"],
};

const PROVENANCE_FIELDS = ["author", "agent", "promptHash", "sources", "confidence", "createdAt"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unknownKeys(obj: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

function checkProvenance(value: unknown, where: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${where} must be an object`);
    return;
  }
  for (const key of unknownKeys(value, PROVENANCE_FIELDS)) {
    errors.push(`${where} has unknown field '${key}'`);
  }
  if (!["human", "ai", "import"].includes(String(value.author))) {
    errors.push(`${where}.author must be "human", "ai" or "import"`);
  }
  for (const key of ["agent", "promptHash", "createdAt"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      errors.push(`${where}.${key} must be a string`);
    }
  }
  if (value.sources !== undefined) {
    if (!Array.isArray(value.sources) || value.sources.some((s) => typeof s !== "string")) {
      errors.push(`${where}.sources must be an array of strings`);
    }
  }
  if (value.confidence !== undefined) {
    if (!isFiniteNumber(value.confidence) || value.confidence < 0 || value.confidence > 1) {
      errors.push(`${where}.confidence must be a number between 0 and 1`);
    }
  }
}

function checkStringArray(value: unknown, where: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v.trim())) {
    errors.push(`${where} must be an array of non-empty strings`);
  }
}

/**
 * Type-check every field present on an element-shaped object (an `add`
 * element or an `update` changes bag). Unknown fields are reported separately
 * by the callers, which know which set of fields applies.
 */
export function checkFieldTypes(
  fields: Record<string, unknown>,
  where: string,
  errors: string[],
): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const at = `${where}.${key}`;
    switch (key) {
      case "name":
      case "documentation":
      case "units":
      case "equation":
      case "timeUnits":
      case "dtUnits":
        if (typeof value !== "string") errors.push(`${at} must be a string`);
        else if (key === "name" && !value.trim()) errors.push(`${at} must not be empty`);
        break;
      case "id":
        if (typeof value !== "string" || !value.trim()) errors.push(`${at} must be a non-empty string`);
        break;
      case "kind":
        if (!ELEMENT_KINDS.includes(value as ElementKind)) {
          errors.push(`${at} must be a stock/flow/converter/graphFunction`);
        }
        break;
      case "nonNegative":
      case "biflow":
      case "leak":
      case "queue":
        if (typeof value !== "boolean") errors.push(`${at} must be a boolean`);
        break;
      case "inflows":
      case "outflows":
        checkStringArray(value, at, errors);
        break;
      case "conveyor":
        if (!isRecord(value)) errors.push(`${at} must be an object`);
        else {
          for (const k of unknownKeys(value, ["transitTime"])) errors.push(`${at} has unknown field '${k}'`);
          if (typeof value.transitTime !== "string") errors.push(`${at}.transitTime must be a string`);
        }
        break;
      case "oven":
        if (!isRecord(value)) errors.push(`${at} must be an object`);
        else {
          for (const k of unknownKeys(value, ["capacity", "fillTime"])) errors.push(`${at} has unknown field '${k}'`);
          for (const k of ["capacity", "fillTime"]) {
            if (typeof value[k] !== "string") errors.push(`${at}.${k} must be a string`);
          }
        }
        break;
      case "points":
        if (!Array.isArray(value)) errors.push(`${at} must be an array of {x, y} points`);
        else {
          value.forEach((p, i) => {
            if (!isRecord(p) || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
              errors.push(`${at}[${i}] must be a finite {x, y} point`);
            } else {
              for (const k of unknownKeys(p, ["x", "y"])) errors.push(`${at}[${i}] has unknown field '${k}'`);
            }
          });
        }
        break;
      case "interpolation":
        if (!["linear", "held", "discrete"].includes(String(value))) {
          errors.push(`${at} must be "linear", "held" or "discrete"`);
        }
        break;
      case "extrapolation":
        if (!["clip", "extend"].includes(String(value))) {
          errors.push(`${at} must be "clip" or "extend"`);
        }
        break;
      case "annotations":
        if (!isRecord(value)) errors.push(`${at} must be an object`);
        break;
      case "provenance":
        checkProvenance(value, at, errors);
        break;
      default:
        // Fields of another kind are caught by the caller's allowed-key check.
        break;
    }
  }
}

function allowedElementFields(kind: ElementKind): string[] {
  return [...COMMON_FIELDS, ...KIND_FIELDS[kind], "id", "kind"];
}

function checkRun(run: unknown, where: string, errors: string[]): void {
  if (!isRecord(run)) {
    errors.push(`${where} must be an object`);
    return;
  }
  for (const key of unknownKeys(run, RUN_FIELDS)) errors.push(`${where} has unknown field '${key}'`);
  for (const key of ["start", "stop", "dt", "saveEvery"]) {
    if (run[key] !== undefined && !isFiniteNumber(run[key])) {
      errors.push(`${where}.${key} must be a finite number`);
    }
  }
  if (run.integration !== undefined && !["euler", "rk2", "rk4", "rk45"].includes(String(run.integration))) {
    errors.push(`${where}.integration must be "euler", "rk2", "rk4" or "rk45"`);
  }
  for (const key of ["timeUnits", "dtUnits"]) {
    if (run[key] !== undefined && typeof run[key] !== "string") {
      errors.push(`${where}.${key} must be a string`);
    }
  }
}

function checkOp(op: unknown, index: number): Finding[] {
  const findings: Finding[] = [];
  const at = `patch op ${index}`;
  if (!isRecord(op)) {
    return [{ stage: "schema", severity: "error", message: `${at} must be an object` }];
  }
  const name = typeof op.name === "string" ? op.name : undefined;
  const fail = (message: string): void => {
    findings.push({ stage: "schema", severity: "error", element: name, message: `${at}: ${message}` });
  };

  const opName = typeof op.op === "string" ? op.op : "";
  if (!(opName in OP_FIELDS)) {
    fail(`unknown op '${String(op.op)}'`);
    return findings;
  }
  for (const key of unknownKeys(op, OP_FIELDS[opName])) fail(`unknown field '${key}'`);

  switch (opName) {
    case "add": {
      if (!ELEMENT_KINDS.includes(op.kind as ElementKind)) {
        fail(`kind must be one of ${ELEMENT_KINDS.join(", ")}`);
        return findings;
      }
      const kind = op.kind as ElementKind;
      if (!isRecord(op.element)) {
        fail("element must be an object");
        return findings;
      }
      const element = op.element;
      for (const key of unknownKeys(element, allowedElementFields(kind))) {
        fail(`element has unknown field '${key}' for a ${kind}`);
      }
      const errors: string[] = [];
      checkFieldTypes(element, "element", errors);
      if (typeof element.name !== "string" || !element.name.trim()) {
        errors.push("element.name must be a non-empty string");
      }
      if (element.kind !== undefined && element.kind !== kind) {
        errors.push(`element.kind must match the declared kind '${kind}'`);
      }
      for (const e of errors) fail(e);
      break;
    }
    case "update": {
      if (typeof op.name !== "string" || !op.name.trim()) fail("name must be a non-empty string");
      if (!isRecord(op.changes)) {
        fail("changes must be an object");
        return findings;
      }
      const anyKindFields = [
        ...COMMON_FIELDS,
        ...ELEMENT_KINDS.flatMap((k) => KIND_FIELDS[k]),
      ].filter((k) => k !== "name");
      for (const key of unknownKeys(op.changes, anyKindFields)) fail(`changes has unknown field '${key}'`);
      if (op.changes.kind !== undefined || op.changes.id !== undefined || op.changes.name !== undefined) {
        fail("changes may not set kind, id or name (use rename)");
      }
      const errors: string[] = [];
      checkFieldTypes(op.changes, "changes", errors);
      for (const e of errors) fail(e);
      break;
    }
    case "rename":
      if (typeof op.name !== "string" || !op.name.trim()) fail("name must be a non-empty string");
      if (typeof op.to !== "string" || !op.to.trim()) fail("to must be a non-empty string");
      break;
    case "remove":
      if (typeof op.name !== "string" || !op.name.trim()) fail("name must be a non-empty string");
      break;
    case "connect":
    case "disconnect":
      if (typeof op.from !== "string" || !op.from.trim()) fail("from must be a non-empty string");
      if (typeof op.to !== "string" || !op.to.trim()) fail("to must be a non-empty string");
      break;
    case "wire":
      if (typeof op.flow !== "string" || !op.flow.trim()) fail("flow must be a non-empty string");
      for (const end of ["from", "to"] as const) {
        if (op[end] !== undefined && op[end] !== null && typeof op[end] !== "string") {
          fail(`${end} must be a stock name or null`);
        }
      }
      break;
    case "setRun": {
      const errors: string[] = [];
      checkRun(op.run, "run", errors);
      for (const e of errors) fail(e);
      break;
    }
    case "setLayout":
      if (typeof op.name !== "string" || !op.name.trim()) fail("name must be a non-empty string");
      if (!isFiniteNumber(op.x) || !isFiniteNumber(op.y)) fail("x and y must be finite numbers");
      break;
  }
  return findings;
}

/** Schema-check an entire patch, reporting every malformed op. */
export function checkPatchSchema(patch: unknown): Finding[] {
  if (!isRecord(patch)) {
    return [{ stage: "schema", severity: "error", message: "patch must be an object" }];
  }
  const findings: Finding[] = [];
  for (const key of unknownKeys(patch, ["ops", "provenance", "rationale"])) {
    findings.push({ stage: "schema", severity: "error", message: `patch has unknown field '${key}'` });
  }
  if (patch.rationale !== undefined && typeof patch.rationale !== "string") {
    findings.push({ stage: "schema", severity: "error", message: "rationale must be a string" });
  }
  if (patch.provenance !== undefined) {
    const errors: string[] = [];
    checkProvenance(patch.provenance, "provenance", errors);
    for (const e of errors) findings.push({ stage: "schema", severity: "error", message: e });
  }
  if (!Array.isArray(patch.ops)) {
    findings.push({ stage: "schema", severity: "error", message: "ops must be an array" });
    return findings;
  }
  patch.ops.forEach((op, i) => findings.push(...checkOp(op, i)));
  return findings;
}

/** Validate a single element-shaped object against a concrete kind, for the
 * apply stage (which knows the target element). Throws the first problem. */
export function assertElementFields(
  kind: ElementKind,
  fields: Record<string, unknown>,
  where: string,
): void {
  const allowed = allowedElementFields(kind);
  const unknown = unknownKeys(fields, allowed);
  if (unknown.length > 0) throw new Error(`${where} has unknown field '${unknown[0]}' for a ${kind}`);
  const errors: string[] = [];
  checkFieldTypes(fields, where, errors);
  if (errors.length > 0) throw new Error(errors[0]);
}

/** Validate an `update` changes bag against the target kind. */
export function assertChangeFields(kind: ElementKind, changes: Record<string, unknown>): void {
  const allowed = [...COMMON_FIELDS, ...KIND_FIELDS[kind]].filter((k) => k !== "name");
  const unknown = unknownKeys(changes, allowed);
  if (unknown.length > 0) throw new Error(`cannot update field '${unknown[0]}' of a ${kind}`);
  const errors: string[] = [];
  checkFieldTypes(changes, "changes", errors);
  if (errors.length > 0) throw new Error(errors[0]);
}

/** Validate a run-spec patch for the apply stage. */
export function assertRunFields(run: unknown): void {
  const errors: string[] = [];
  checkRun(run, "run", errors);
  if (errors.length > 0) throw new Error(errors[0]);
}

export { ELEMENT_KINDS, RUN_FIELDS };
