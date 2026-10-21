/**
 * Autosave persistence.
 *
 * The working model is mirrored to localStorage so a reload never loses work.
 * Every storage access is guarded: private-mode browsers and quota errors must
 * never break the editor. The (de)serialization is pure and unit-tested; the
 * `read`/`write` wrappers are the only parts that touch the browser.
 */

import type { Model } from "@sourcesink/model";

export const AUTOSAVE_KEY = "sourcesink:autosave:v1";
/** Key used before the rename to SourceSink; read once so old work is not lost. */
export const LEGACY_AUTOSAVE_KEY = "opensd:autosave:v1";

export interface AutosaveRecord {
  model: Model;
  fileName: string | null;
  savedAt: number;
}

/** Minimal structural check so a corrupt/hostile payload cannot crash the app. */
function isModelLike(value: unknown): value is Model {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    Array.isArray(m.stocks) &&
    Array.isArray(m.flows) &&
    Array.isArray(m.converters) &&
    Array.isArray(m.connectors) &&
    typeof m.run === "object" &&
    m.run !== null
  );
}

export function serializeAutosave(
  model: Model,
  fileName: string | null,
  savedAt: number = Date.now(),
): string {
  const record: AutosaveRecord = { model, fileName, savedAt };
  return JSON.stringify(record);
}

export function deserializeAutosave(raw: string | null | undefined): AutosaveRecord | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (!isModelLike(record.model)) return null;
  return {
    model: record.model,
    fileName: typeof record.fileName === "string" ? record.fileName : null,
    savedAt: typeof record.savedAt === "number" ? record.savedAt : 0,
  };
}

/** Read the autosaved record, or `null` when absent/unreadable. */
export function readAutosave(): AutosaveRecord | null {
  try {
    return deserializeAutosave(
      localStorage.getItem(AUTOSAVE_KEY) ?? localStorage.getItem(LEGACY_AUTOSAVE_KEY),
    );
  } catch {
    return null;
  }
}

/** Persist the working model; silently no-ops when storage is unavailable. */
export function writeAutosave(model: Model, fileName: string | null): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeAutosave(model, fileName));
  } catch {
    /* storage disabled or over quota — autosave is best-effort */
  }
}

/** Drop the autosaved record (e.g. after an explicit save). */
export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
    localStorage.removeItem(LEGACY_AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
}
