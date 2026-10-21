/**
 * SourceSink — desktop integration for the renderer.
 *
 * When the app runs inside the desktop shell, `window.sourcesink` is the bridge
 * from `src/desktop/src/preload.ts`. In a plain browser it is absent and every
 * helper here is a no-op, so the same UI build serves both.
 */

import { useEffect } from "react";
import type { DesktopApi, MenuAction } from "@sourcesink/desktop/api";
import { useEditor } from "../state/store";

declare global {
  interface Window {
    sourcesink?: DesktopApi;
  }
}

export function desktop(): DesktopApi | undefined {
  return typeof window === "undefined" ? undefined : window.sourcesink;
}

export function isDesktop(): boolean {
  return desktop() !== undefined;
}

/** Window title for the current document, e.g. "lake.xmile • — SourceSink". */
export function windowTitle(fileName: string | null, modelName: string, dirty: boolean): string {
  const doc = fileName ?? (modelName.trim() || "Untitled");
  return `${doc}${dirty ? " •" : ""} — SourceSink`;
}

/** True when keyboard focus is in a text field (undo/redo should stay native). */
function editingText(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export interface DesktopHandlers {
  newModel(): void;
  open(): void;
  save(saveAs: boolean): Promise<boolean>;
  openPath(name: string, content: string | Uint8Array, path: string): void;
  showExamples(): void;
  toggleTheme(): void;
}

/**
 * Wire native menu commands, the window title / unsaved-changes state and
 * launch-time files to the editor. Call once from the app root.
 */
export function useDesktopIntegration(h: DesktopHandlers): void {
  useEffect(() => {
    const api = desktop();
    if (!api) return;

    const publish = () => {
      const s = useEditor.getState();
      api.setDocumentState({ dirty: s.dirty, title: windowTitle(s.fileName, s.model.name, s.dirty) });
    };
    publish();
    const unsubscribe = useEditor.subscribe((s, prev) => {
      if (s.dirty !== prev.dirty || s.fileName !== prev.fileName || s.model.name !== prev.model.name) {
        publish();
      }
    });

    const run = (action: MenuAction) => {
      const s = useEditor.getState();
      switch (action) {
        case "new":
          return h.newModel();
        case "open":
          return h.open();
        case "examples":
          return h.showExamples();
        case "save":
          return void h.save(false);
        case "saveAs":
          return void h.save(true);
        case "saveAndClose":
          return void h.save(false).then((saved) => saved && api.closeWindow());
        case "undo":
          return editingText() ? void document.execCommand("undo") : s.undo();
        case "redo":
          return editingText() ? void document.execCommand("redo") : s.redo();
        case "run":
          return s.run();
        case "toggleTheme":
          return h.toggleTheme();
      }
    };
    const offMenu = api.onMenu(run);
    const offOpen = api.onOpenPath((f) => h.openPath(f.name, f.bytes ?? f.text, f.path));
    void api.initialFile().then((f) => f && h.openPath(f.name, f.bytes ?? f.text, f.path));

    return () => {
      unsubscribe();
      offMenu();
      offOpen();
    };
    // Handlers are stable module functions / state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
