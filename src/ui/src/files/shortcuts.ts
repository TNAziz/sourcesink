/**
 * Global keyboard shortcuts, autosave, and the unload guard.
 *
 * The key → action mapping is a pure function (`shortcutFor`) so it can be
 * unit-tested without a DOM; `useShortcuts` only wires it to window events and
 * to the editor store.
 */

import { useEffect } from "react";
import { useEditor, type Tool } from "../state/store";
import { writeAutosave } from "./autosave";
import { openModelFile, saveModelFile } from "./fileActions";
import { isDesktop } from "../desktop/desktop";

export type ShortcutAction =
  | "save"
  | "save-as"
  | "open"
  | "undo"
  | "redo"
  | "run"
  | "escape"
  | "tool:select"
  | "tool:stock"
  | "tool:flow"
  | "tool:converter"
  | "tool:connector"
  | "tidy"
  | "toggle-constants";

/** The subset of a KeyboardEvent the mapping needs (keeps it pure/testable). */
export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

const TOOL_ACTIONS: Partial<Record<ShortcutAction, Tool>> = {
  "tool:select": "select",
  "tool:stock": "stock",
  "tool:flow": "flow",
  "tool:converter": "converter",
  "tool:connector": "connector",
};

/** Actions that still fire while typing in a field (document-level commands). */
const DOCUMENT_ACTIONS = new Set<ShortcutAction>(["save", "save-as", "open", "run"]);

const AUTOSAVE_DELAY_MS = 800;

/** Map a key event to an editor action, or `null` when it is not a shortcut. */
export function shortcutFor(event: KeyLike): ShortcutAction | null {
  const key = event.key.toLowerCase();
  const mod = Boolean(event.ctrlKey || event.metaKey);

  if (mod) {
    if (event.altKey) return null;
    switch (key) {
      case "s":
        return event.shiftKey ? "save-as" : "save";
      case "o":
        return "open";
      case "z":
        return event.shiftKey ? "redo" : "undo";
      case "y":
        return "redo";
      case "enter":
        return "run";
      default:
        return null;
    }
  }

  if (event.altKey || event.shiftKey) return null;
  switch (key) {
    case "escape":
      return "escape";
    case "v":
      return "tool:select";
    case "s":
      return "tool:stock";
    case "f":
      return "tool:flow";
    case "c":
      return "tool:converter";
    case "k":
      return "tool:connector";
    case "l":
      return "tidy";
    case "h":
      return "toggle-constants";
    default:
      return null;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function runAction(action: ShortcutAction): void {
  const store = useEditor.getState();
  switch (action) {
    case "save":
      void saveModelFile(false);
      return;
    case "save-as":
      void saveModelFile(true);
      return;
    case "open":
      void openModelFile();
      return;
    case "undo":
      store.undo();
      return;
    case "redo":
      store.redo();
      return;
    case "run":
      store.run();
      return;
    case "escape":
      store.setTool("select");
      store.select([]);
      return;
    case "tidy":
      store.tidyLayout();
      return;
    case "toggle-constants":
      store.setShowConstants(!store.showConstants);
      return;
    default: {
      const tool = TOOL_ACTIONS[action];
      if (tool) store.setTool(tool);
    }
  }
}

/** Install the window listeners: shortcuts, debounced autosave, unload guard. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = shortcutFor(event);
      if (!action) return;
      if (isEditableTarget(event.target) && !DOCUMENT_ACTIONS.has(action)) return;
      event.preventDefault();
      runAction(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useEditor.subscribe((state, prev) => {
      if (state.model === prev.model) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const current = useEditor.getState();
        writeAutosave(current.model, current.fileName);
      }, AUTOSAVE_DELAY_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    // The desktop shell asks about unsaved changes with a native dialog.
    if (isDesktop()) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!useEditor.getState().dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
}
