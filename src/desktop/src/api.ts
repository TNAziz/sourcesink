/**
 * SourceSink — the desktop API shared by the Electron main process, the preload
 * bridge and the renderer (`window.sourcesink`). Types only.
 */

import type { ChatMessage, CompletionResponse } from "@sourcesink/assistant";
import type { OpencodeStatus } from "@sourcesink/assistant/node";

export type MenuAction =
  | "new"
  | "open"
  | "examples"
  | "save"
  | "saveAs"
  | "saveAndClose"
  | "undo"
  | "redo"
  | "run"
  | "toggleTheme";

export interface OpenedFile {
  path: string;
  name: string;
  text: string;
  /** Raw contents of a legacy `.stm`/`.itm` model file. */
  bytes?: Uint8Array;
}

export interface SaveRequest {
  /** Existing path to overwrite; omitted → ask with a Save dialog. */
  path?: string;
  suggestedName: string;
  text: string;
}

export interface SavedFile {
  path: string;
  name: string;
}

export interface AssistantApi {
  /** Ask the language model for one reply; `onText` receives the full text
   * written so far whenever more arrives. */
  complete(
    req: { model: string; messages: ChatMessage[] },
    onText?: (textSoFar: string) => void,
  ): Promise<CompletionResponse>;
  /** Provider/model ids reported by `opencode models`. */
  models(): Promise<string[]>;
  /** Whether the OpenCode CLI is installed and runnable. */
  status(): Promise<OpencodeStatus>;
  /** Abort the in-flight completion, if any. */
  cancel(): void;
}

export interface DesktopApi {
  readonly isDesktop: true;
  readonly assistant: AssistantApi;
  openFile(): Promise<OpenedFile | null>;
  /** The model the app was launched with (command line / double-click), once. */
  initialFile(): Promise<OpenedFile | null>;
  saveFile(req: SaveRequest): Promise<SavedFile | null>;
  /** Native "discard changes?" dialog; resolves true to discard. */
  confirmDiscard(message: string, detail?: string): Promise<boolean>;
  /** Tell the shell whether there are unsaved changes, and the window title. */
  setDocumentState(state: { dirty: boolean; title: string }): void;
  /** Close the window without prompting (after a save-and-close). */
  closeWindow(): void;
  /** Subscribe to native menu commands; returns an unsubscribe function. */
  onMenu(listener: (action: MenuAction) => void): () => void;
  /** Subscribe to files opened by the OS while running (second launch). */
  onOpenPath(listener: (file: OpenedFile) => void): () => void;
}
