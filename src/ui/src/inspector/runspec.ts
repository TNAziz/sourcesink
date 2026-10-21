/**
 * SourceSink — pure run-spec field handling for the inspector.
 *
 * Keeps the numeric text fields as strings while editing (so a partially typed
 * value is never clobbered) and validates them as a set before committing.
 */

import type { RunSpec } from "@sourcesink/model";

/** Text drafts for the four numeric run fields. */
export interface RunDraft {
  start: string;
  stop: string;
  dt: string;
  saveEvery: string;
}

export type RunField = keyof RunDraft;

export interface RunValidation {
  /** First error per field, if any. */
  errors: Partial<Record<RunField, string>>;
  /** Numeric values for the valid fields. */
  values: Partial<RunSpec>;
  /** True when every field is valid and the value may be committed. */
  valid: boolean;
}

/** Seed drafts from a committed run spec. */
export function runToDraft(run: RunSpec): RunDraft {
  return {
    start: String(run.start),
    stop: String(run.stop),
    dt: String(run.dt),
    saveEvery: String(run.saveEvery),
  };
}

function toNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Validate the drafts: `dt > 0`, `saveEvery > 0`, `stop >= start`. Invalid or
 * empty fields are reported and omitted from `values`, so callers can commit
 * only when `valid` is true.
 */
export function validateRunDraft(draft: RunDraft): RunValidation {
  const errors: Partial<Record<RunField, string>> = {};
  const values: Partial<RunSpec> = {};

  const start = toNumber(draft.start);
  const stop = toNumber(draft.stop);
  const dt = toNumber(draft.dt);
  const saveEvery = toNumber(draft.saveEvery);

  if (start === null) errors.start = "Enter a number";
  else values.start = start;

  if (stop === null) errors.stop = "Enter a number";
  else if (start !== null && stop < start) errors.stop = "Must be ≥ start";
  else values.stop = stop;

  if (dt === null) errors.dt = "Enter a number";
  else if (dt <= 0) errors.dt = "Must be > 0";
  else values.dt = dt;

  if (saveEvery === null) errors.saveEvery = "Enter a number";
  else if (saveEvery <= 0) errors.saveEvery = "Must be > 0";
  else values.saveEvery = saveEvery;

  return { errors, values, valid: Object.keys(errors).length === 0 };
}
