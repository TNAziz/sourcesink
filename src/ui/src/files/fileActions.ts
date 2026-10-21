/**
 * Open / save model actions (owned by the files agent).
 *
 * In the desktop shell, uses native dialogs and saves in place by path. In a
 * browser, prefers the File System Access API so the app can keep a handle and
 * save in place; falls back to a hidden `<input type="file">` for opening and a Blob
 * download for saving on browsers without it. All failures surface as an
 * `sourcesink:toast` CustomEvent (plus `console.error`) rather than `alert`.
 */

import type { Model } from "@sourcesink/model";
import { importStm } from "@sourcesink/legacy";
import { readXmile, writeXmile } from "@sourcesink/xmile";
import { useEditor } from "../state/store";
import { desktop } from "../desktop/desktop";
import { ensureXmileExtension, prettifyExampleName, suggestFileName } from "./names";

/** Extensions we accept/produce. XMILE is native; the rest are conveniences.
 * Legacy `.stm`/`.itm` models are import-only. */
export const ACCEPTED_EXTENSIONS = [".xmile", ".xml", ".stmx", ".stm", ".itm"] as const;

interface PickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenPickerOptions {
  multiple?: boolean;
  types?: PickerAcceptType[];
  excludeAcceptAllOption?: boolean;
}

interface SavePickerOptions {
  suggestedName?: string;
  types?: PickerAcceptType[];
  excludeAcceptAllOption?: boolean;
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: OpenPickerOptions) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options?: SavePickerOptions) => Promise<FileSystemFileHandle>;
  }
}

const XMILE_PICKER_TYPE: PickerAcceptType = {
  description: "System dynamics models",
  accept: { "application/xml": [".xmile", ".xml", ".stmx"], "application/octet-stream": [".stm", ".itm"] },
};

/** A legacy `.stm`/`.itm` model, read as bytes and imported (not saved back). */
export const isLegacyFile = (name: string): boolean => /\.(stm|itm)$/i.test(name);

/** The handle of the file currently being edited, when we have one. */
let currentHandle: FileSystemFileHandle | null = null;
/** Desktop shell: the path of the file currently being edited. */
let currentPath: string | null = null;

/** A model parsed from an opened file, with a sensible fallback title. */
export function parseModelText(xml: string, fileName: string): Model {
  const model = readXmile(xml);
  if (!model.name || model.name === "Untitled") {
    model.name = prettifyExampleName(fileName.replace(/\.[^.]+$/, ""));
  }
  return model;
}

/** Import a legacy model, telling the user what could not be carried over. */
function importLegacy(bytes: Uint8Array, fileName: string): Model {
  const { model, warnings } = importStm(bytes, prettifyExampleName(fileName.replace(/\.[^.]+$/, "")));
  const notes = warnings.length ? ` ${warnings.length} note(s): ${warnings.slice(0, 2).join("; ")}${warnings.length > 2 ? "; …" : ""}` : "";
  for (const w of warnings) console.info(`SourceSink import: ${w}`);
  toast("info", `Imported ${fileName}. Save to keep it as XMILE.${notes}`);
  return model;
}

/** Turn opened file contents into a document. Legacy imports keep no file
 * path or handle, so the first save asks where to write the new .xmile file. */
function loadOpened(name: string, content: string | Uint8Array, path: string | null, handle: FileSystemFileHandle | null): void {
  const legacy = isLegacyFile(name) && typeof content !== "string";
  const model = legacy ? importLegacy(content, name) : parseModelText(String(content), name);
  currentHandle = legacy ? null : handle;
  currentPath = legacy ? null : path;
  useEditor.getState().loadModel(model, legacy ? name.replace(/\.[^.]+$/, ".xmile") : name);
}

const readFileContent = async (file: File): Promise<string | Uint8Array> =>
  isLegacyFile(file.name) ? new Uint8Array(await file.arrayBuffer()) : file.text();

function toast(kind: "success" | "error" | "info", message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("sourcesink:toast", { detail: { kind, message } }));
}

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error("SourceSink: file operation failed", error);
  toast("error", message);
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "AbortError"
  );
}

/** Ask before throwing away unsaved changes (no-op when nothing is unsaved). */
export async function confirmDiscard(
  message = "This model has unsaved changes. Discard them and continue?",
): Promise<boolean> {
  if (typeof window === "undefined" || !useEditor.getState().dirty) return true;
  const api = desktop();
  if (api) return api.confirmDiscard(message, "Your changes will be lost.");
  return window.confirm(message);
}

/** Start a new, empty model (asks first if there are unsaved changes). */
export async function newModelFile(): Promise<void> {
  if (!(await confirmDiscard())) return;
  currentHandle = null;
  currentPath = null;
  useEditor.getState().newModel();
}

/** Open an in-memory model (an example) as a new, unsaved document. */
export async function openExampleModel(model: Model): Promise<boolean> {
  if (!(await confirmDiscard("Discard unsaved changes and open this example?"))) return false;
  currentHandle = null;
  currentPath = null;
  useEditor.getState().loadModel(model, null);
  return true;
}

/** Load a model that came from a known path (desktop launch / OS open). */
export async function openModelContent(name: string, content: string | Uint8Array, path: string | null): Promise<void> {
  if (!(await confirmDiscard())) return;
  try {
    loadOpened(name, content, path, null);
  } catch (error) {
    fail(error);
  }
}

function pickViaInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPTED_EXTENSIONS.join(",");
    input.style.display = "none";
    const finish = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

function downloadBlob(text: string, fileName: string): void {
  const blob = new Blob([text], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Open a model from disk, replacing the current document. */
export async function openModelFile(): Promise<void> {
  if (!(await confirmDiscard())) return;

  try {
    const api = desktop();
    if (api) {
      const f = await api.openFile();
      if (!f) return;
      loadOpened(f.name, f.bytes ?? f.text, f.path, null);
      return;
    }

    if (typeof window !== "undefined" && typeof window.showOpenFilePicker === "function") {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [XMILE_PICKER_TYPE],
      });
      if (!handle) return;
      const file = await handle.getFile();
      loadOpened(file.name, await readFileContent(file), null, handle);
      return;
    }

    const file = await pickViaInput();
    if (!file) return;
    loadOpened(file.name, await readFileContent(file), null, null);
  } catch (error) {
    if (isAbort(error)) return;
    fail(error);
  }
}

/** Save the current model, reusing the open file unless `saveAs` is set.
 * Resolves true when the model was written. */
export async function saveModelFile(saveAs = false): Promise<boolean> {
  const store = useEditor.getState();
  const xml = writeXmile(store.model);
  const suggested = ensureXmileExtension(suggestFileName(store.fileName, store.model.name));

  try {
    const api = desktop();
    if (api) {
      const saved = await api.saveFile({
        path: saveAs ? undefined : (currentPath ?? undefined),
        suggestedName: suggested,
        text: xml,
      });
      if (!saved) return false;
      currentPath = saved.path;
      store.markSaved(saved.name);
      toast("success", `Saved ${saved.name}`);
      return true;
    }

    if (typeof window !== "undefined" && typeof window.showSaveFilePicker === "function") {
      let handle = currentHandle;
      if (!handle || saveAs) {
        handle = await window.showSaveFilePicker({
          suggestedName: suggested,
          types: [XMILE_PICKER_TYPE],
        });
      }
      const writable = await handle.createWritable();
      await writable.write(xml);
      await writable.close();
      currentHandle = handle;
      store.markSaved(handle.name);
      toast("success", `Saved ${handle.name}`);
      return true;
    }

    downloadBlob(xml, suggested);
    store.markSaved(suggested);
    toast("success", `Downloaded ${suggested}`);
    return true;
  } catch (error) {
    if (!isAbort(error)) fail(error);
    return false;
  }
}

/** For tests / the shell: forget the retained file handle. */
export function resetFileHandle(): void {
  currentHandle = null;
  currentPath = null;
}
