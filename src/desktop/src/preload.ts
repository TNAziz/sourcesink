/**
 * SourceSink — preload bridge. Exposes `window.sourcesink` (see `api.ts`) to the
 * sandboxed page; nothing else from Node or Electron is reachable.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { DesktopApi, MenuAction, OpenedFile } from "./api.js";

/** Distinguishes concurrent completions' streamed-text events. */
let nextAssistantRequest = 0;

const api: DesktopApi = {
  isDesktop: true,
  openFile: () => ipcRenderer.invoke("sourcesink:open-file"),
  initialFile: () => ipcRenderer.invoke("sourcesink:initial-file"),
  saveFile: (req) => ipcRenderer.invoke("sourcesink:save-file", req),
  confirmDiscard: (message, detail) => ipcRenderer.invoke("sourcesink:confirm", message, detail),
  setDocumentState: (state) => ipcRenderer.send("sourcesink:document-state", state),
  closeWindow: () => ipcRenderer.send("sourcesink:close-window"),
  onMenu(listener) {
    const h = (_e: IpcRendererEvent, action: MenuAction) => listener(action);
    ipcRenderer.on("sourcesink:menu", h);
    return () => ipcRenderer.removeListener("sourcesink:menu", h);
  },
  onOpenPath(listener) {
    const h = (_e: IpcRendererEvent, file: OpenedFile) => listener(file);
    ipcRenderer.on("sourcesink:open-path", h);
    return () => ipcRenderer.removeListener("sourcesink:open-path", h);
  },
  assistant: {
    complete(req, onText) {
      nextAssistantRequest += 1;
      const id = `ast_${Date.now()}_${nextAssistantRequest}`;
      if (!onText) {
        return ipcRenderer.invoke("sourcesink:assistant-complete", { id, ...req });
      }
      const h = (_e: IpcRendererEvent, event: { id: string; text: string }) => {
        if (event.id === id) onText(event.text);
      };
      ipcRenderer.on("sourcesink:assistant-text", h);
      return ipcRenderer
        .invoke("sourcesink:assistant-complete", { id, ...req })
        .finally(() => ipcRenderer.removeListener("sourcesink:assistant-text", h));
    },
    models: () => ipcRenderer.invoke("sourcesink:assistant-models"),
    status: () => ipcRenderer.invoke("sourcesink:assistant-status"),
    cancel: () => ipcRenderer.send("sourcesink:assistant-cancel"),
  },
};

contextBridge.exposeInMainWorld("sourcesink", api);
