/**
 * Launch state: restore the autosaved model, else open a starter example.
 * Owned by the files agent; called once by the shell.
 */

import type { Model } from "@sourcesink/model";
import { emptyModel } from "@sourcesink/model";
import { readAutosave } from "./autosave";
import { getExample, listExamples } from "./examples";

/** The model to show on launch (autosave, else the logistic-harvest example). */
export function loadInitialModel(): { model: Model; fileName: string | null } {
  const saved = readAutosave();
  if (saved) return { model: saved.model, fileName: saved.fileName };

  const example = getExample("logistic-harvest") ?? listExamples()[0];
  if (example) return { model: example.model, fileName: null };

  return { model: emptyModel(), fileName: null };
}
