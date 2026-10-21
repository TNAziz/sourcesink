/**
 * SourceSink — desktop shell (Electron main process).
 *
 * Opens the editor in a native window with a native menu bar, native file
 * dialogs and an unsaved-changes prompt on close. The renderer is the same
 * React app as the browser build; it talks to this process only through the
 * narrow API in `preload.ts`.
 *
 * Menu items whose shortcuts the renderer already handles are declared with
 * `registerAccelerator: false`, so the key hint is shown but each key press is
 * handled exactly once (by the page).
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { MenuAction, OpenedFile, SaveRequest, SavedFile } from "./api.js";
import { checkOpencode, createServerComplete, listModels } from "@sourcesink/assistant/node";
import type { ChatMessage } from "@sourcesink/assistant";

const DEV_URL = process.env.SOURCESINK_DEV_URL;
const isMac = process.platform === "darwin";

const XMILE_FILTERS = [
  { name: "System dynamics models", extensions: ["xmile", "xml", "stmx", "stm", "STM", "itm", "ITM"] },
  { name: "All files", extensions: ["*"] },
];

let win: BrowserWindow | null = null;
let dirty = false;
let forceClose = false;
/** The assistant bridge: one long-lived server, stopped when the app quits. */
const assistantComplete = createServerComplete();
/** At most one in-flight completion per window (webContents id). */
const assistantRuns = new Map<number, AbortController>();
/** A model path given on the command line or by the OS (double-click). */
let pendingFile: string | null = fileArg(process.argv);

function fileArg(argv: string[]): string | null {
  const candidate = argv.slice(app.isPackaged ? 1 : 2).find((a) => /\.(xmile|xml|stmx|stm|itm)$/i.test(a));
  return candidate ? path.resolve(candidate) : null;
}

function send(action: MenuAction): void {
  win?.webContents.send("sourcesink:menu", action);
}

function buildMenu(): Menu {
  // Shortcut shown in the menu but left for the renderer to handle.
  const page = (label: string, action: MenuAction, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: () => send(action),
  });

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "&File",
      submenu: [
        { label: "New Model", accelerator: "CmdOrCtrl+N", click: () => send("new") },
        page("Open…", "open", "CmdOrCtrl+O"),
        page("Examples…", "examples"),
        { type: "separator" },
        page("Save", "save", "CmdOrCtrl+S"),
        page("Save As…", "saveAs", "CmdOrCtrl+Shift+S"),
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit", label: "Quit" },
      ],
    },
    {
      label: "&Edit",
      submenu: [
        page("Undo", "undo", "CmdOrCtrl+Z"),
        page("Redo", "redo", "CmdOrCtrl+Shift+Z"),
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "&View",
      submenu: [
        page("Toggle Theme", "toggleTheme"),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" as const }]),
      ],
    },
    {
      label: "&Run",
      submenu: [page("Run Model", "run", "CmdOrCtrl+Enter")],
    },
    {
      label: "&Help",
      submenu: [
        { label: "User Manual", accelerator: "F1", click: () => send("manual") },
        { type: "separator" },
        {
          label: "About SourceSink",
          click: () =>
            void dialog.showMessageBox(win!, {
              type: "info",
              title: "About SourceSink",
              message: `SourceSink ${app.getVersion()}`,
              detail:
                "An open-source system dynamics modeling environment.\nReleased under the MIT license.",
            }),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "SourceSink",
    icon: path.join(__dirname, "../build/icon.png"),
    backgroundColor: "#0f1216",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win?.show());

  // Keep the app on its own page; real web links open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (DEV_URL && url.startsWith(DEV_URL)) return;
    event.preventDefault();
  });

  win.on("close", (event) => {
    if (!dirty || forceClose) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(win!, {
      type: "question",
      buttons: ["Save", "Don't Save", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      title: "Unsaved changes",
      message: "Save changes to this model before closing?",
      detail: "Your changes will be lost if you don't save them.",
    });
    if (choice === 0) send("saveAndClose");
    if (choice === 1) {
      forceClose = true;
      win?.close();
    }
  });
  win.on("closed", () => {
    win = null;
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(path.join(__dirname, "../ui/index.html"));
}

// ----- IPC: the only operations the page can ask for -----------------------

ipcMain.handle("sourcesink:open-file", async (): Promise<OpenedFile | null> => {
  const r = await dialog.showOpenDialog(win!, { properties: ["openFile"], filters: XMILE_FILTERS });
  if (r.canceled || r.filePaths.length === 0) return null;
  return readModel(r.filePaths[0]);
});

ipcMain.handle("sourcesink:initial-file", async (): Promise<OpenedFile | null> => {
  const p = pendingFile;
  pendingFile = null;
  return p ? readModel(p) : null;
});

ipcMain.handle("sourcesink:save-file", async (_e, req: SaveRequest): Promise<SavedFile | null> => {
  let target = req.path;
  if (!target) {
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: req.suggestedName,
      filters: XMILE_FILTERS,
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  await writeFile(target, req.text, "utf8");
  return { path: target, name: path.basename(target) };
});

ipcMain.handle("sourcesink:confirm", async (_e, message: string, detail?: string): Promise<boolean> => {
  const r = await dialog.showMessageBox(win!, {
    type: "warning",
    buttons: ["Discard Changes", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message,
    detail,
  });
  return r.response === 0;
});

ipcMain.on("sourcesink:document-state", (_e, state: { dirty: boolean; title: string }) => {
  dirty = state.dirty;
  win?.setTitle(state.title);
});

// The manual is a PDF bundled with the UI. Only the app's own PDFs may be
// opened, in a separate window with Chromium's PDF viewer.
let manualWin: BrowserWindow | null = null;

function isOwnPdf(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (!url.pathname.toLowerCase().endsWith(".pdf")) return false;
  if (DEV_URL) return url.origin === new URL(DEV_URL).origin;
  if (url.protocol !== "file:") return false;
  const uiDir = path.resolve(__dirname, "../ui");
  const file = path.resolve(fileURLToPath(url));
  return file.startsWith(uiDir + path.sep);
}

ipcMain.on("sourcesink:open-manual", (_e, url: string) => {
  if (typeof url !== "string" || !isOwnPdf(url)) return;
  if (manualWin && !manualWin.isDestroyed()) {
    void manualWin.loadURL(url);
    manualWin.focus();
    return;
  }
  manualWin = new BrowserWindow({
    width: 980,
    height: 1000,
    title: "SourceSink manual",
    icon: path.join(__dirname, "../build/icon.png"),
    autoHideMenuBar: true,
    webPreferences: { plugins: true, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  manualWin.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  manualWin.on("closed", () => {
    manualWin = null;
  });
  void manualWin.loadURL(url);
});

ipcMain.on("sourcesink:close-window", () => {
  forceClose = true;
  win?.close();
});

// ----- IPC: assistant (language model through OpenCode) --------------------

ipcMain.handle(
  "sourcesink:assistant-complete",
  async (event, req: { id: string; model: string; messages: ChatMessage[] }) => {
    const id = event.sender.id;
    assistantRuns.get(id)?.abort();
    const controller = new AbortController();
    assistantRuns.set(id, controller);
    try {
      return await assistantComplete({
        model: req.model,
        messages: req.messages,
        signal: controller.signal,
        onText: (text) => {
          if (event.sender.isDestroyed()) return;
          event.sender.send("sourcesink:assistant-text", { id: req.id, text });
        },
      });
    } finally {
      if (assistantRuns.get(id) === controller) assistantRuns.delete(id);
    }
  },
);

ipcMain.handle("sourcesink:assistant-models", () => listModels());

ipcMain.handle("sourcesink:assistant-status", () => checkOpencode());

ipcMain.on("sourcesink:assistant-cancel", (event) => {
  assistantRuns.get(event.sender.id)?.abort();
});

async function readModel(p: string): Promise<OpenedFile> {
  const name = path.basename(p);
  if (/\.(stm|itm)$/i.test(p)) return { path: p, name, text: "", bytes: new Uint8Array(await readFile(p)) };
  return { path: p, name, text: await readFile(p, "utf8") };
}

// ----- app lifecycle --------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const p = fileArg(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (p) void readModel(p).then((f) => win?.webContents.send("sourcesink:open-path", f));
    }
  });

  app.on("open-file", (event, p) => {
    // macOS: double-clicked a model file.
    event.preventDefault();
    if (win) void readModel(p).then((f) => win?.webContents.send("sourcesink:open-path", f));
    else pendingFile = p;
  });

  void app.whenReady().then(() => {
    Menu.setApplicationMenu(buildMenu());
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    void assistantComplete.dispose();
  });

  app.on("window-all-closed", () => {
    if (!isMac) app.quit();
  });
}
