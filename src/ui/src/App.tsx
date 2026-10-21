/**
 * SourceSink — application shell: top bar (file actions, undo/redo, run, theme),
 * left tool palette, canvas, right inspector and a collapsible, drag-resizable
 * results drawer at the bottom that opens automatically after a run.
 */

import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CircleDashed,
  Database,
  FilePlus2,
  FlaskConical,
  FolderOpen,
  Lightbulb,
  MessageSquare,
  Monitor,
  Moon,
  MousePointer2,
  Play,
  Redo2,
  Save,
  Spline,
  LayoutGrid,
  Link2,
  Sun,
  Variable,
  Undo2,
} from "lucide-react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEditor, type Tool } from "./state/store";
import { loadInitialModel } from "./files/startup";
import { useShortcuts } from "./files/shortcuts";
import { newModelFile, openModelContent, openModelFile, saveModelFile } from "./files/fileActions";
import { useDesktopIntegration } from "./desktop/desktop";
import { ExamplesMenu } from "./files/ExamplesMenu";
import { ExplainPanel } from "./explain/ExplainPanel";
import { AnalyzePanel, type AnalyzeInitial } from "./analyze/AnalyzePanel";
import { AssistantPanel } from "./assistant/AssistantPanel";
import { suggestionAction } from "./assistant/logic";
import type { FeatureSuggestion } from "@sourcesink/assistant";
import { Inspector } from "./inspector/Inspector";
import { ResultsPanel } from "./results/ResultsPanel";
import { Canvas } from "./canvas/Canvas";
import { ToastStack, useToasts } from "./canvas/toasts";
import "./styles.css";

type ThemeMode = "system" | "light" | "dark";

function applyTheme(mode: ThemeMode): void {
  const el = document.documentElement;
  el.dataset.theme = mode;
  try {
    localStorage.setItem("sourcesink:theme", mode);
  } catch {
    /* private mode etc. — theme just won't persist */
  }
}

function initialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem("sourcesink:theme") ?? localStorage.getItem("opensd:theme");
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    /* ignore */
  }
  // Light by default, like the AgenticNodes workbench; dark and "follow the
  // system" stay one click away.
  return "light";
}

/** Small original mark: a stock being filled by a flow. */
function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" className="app-logo">
      <rect
        x="2.5"
        y="7"
        width="12.5"
        height="10"
        rx="2.5"
        style={{ fill: "var(--stock-fill)", stroke: "var(--stock)", strokeWidth: "1.8" }}
      />
      <path
        d="M 15.5 12 h 5 m 0 0 l -2.6 -2.6 M 20.5 12 l -2.6 2.6"
        style={{
          fill: "none",
          stroke: "var(--flow)",
          strokeWidth: "2",
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }}
      />
    </svg>
  );
}

function ThemeToggle({ mode, onChange }: { mode: ThemeMode; onChange: (m: ThemeMode) => void }) {
  const next: ThemeMode = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
  const Icon = mode === "system" ? Monitor : mode === "light" ? Sun : Moon;
  return (
    <button
      type="button"
      className="app-iconbtn"
      title={`Theme: ${mode} (click for ${next})`}
      onClick={() => onChange(next)}
    >
      <Icon size={15} />
    </button>
  );
}

const PALETTE: { tool: Tool; icon: typeof MousePointer2; label: string; key: string }[] = [
  { tool: "select", icon: MousePointer2, label: "Select", key: "V" },
  { tool: "stock", icon: Database, label: "Stock", key: "S" },
  { tool: "flow", icon: ArrowRight, label: "Flow", key: "F" },
  { tool: "converter", icon: CircleDashed, label: "Converter", key: "C" },
  { tool: "connector", icon: Spline, label: "Connector", key: "K" },
];

function Palette() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const tidyLayout = useEditor((s) => s.tidyLayout);
  const connectAll = useEditor((s) => s.connectAll);
  const showConstants = useEditor((s) => s.showConstants);
  const setShowConstants = useEditor((s) => s.setShowConstants);
  return (
    <nav className="app-palette" aria-label="Tools">
      {PALETTE.map(({ tool: t, icon: Icon, label, key }) => (
        <button
          key={t}
          type="button"
          className={`app-tool${tool === t ? " active" : ""}`}
          data-tip={`${label} · ${key}`}
          aria-label={`${label} (${key})`}
          aria-pressed={tool === t}
          onClick={() => setTool(t)}
        >
          <Icon size={17} />
        </button>
      ))}
      <span className="app-palette-sep" aria-hidden="true" />
      <button
        type="button"
        className="app-tool"
        data-tip="Tidy up layout · L"
        aria-label="Tidy up layout (L)"
        onClick={tidyLayout}
      >
        <LayoutGrid size={17} />
      </button>
      <button
        type="button"
        className="app-tool"
        data-tip="Connect all: draw every link the equations use"
        aria-label="Connect all"
        onClick={() => connectAll()}
      >
        <Link2 size={17} />
      </button>
      <button
        type="button"
        className={`app-tool${showConstants ? "" : " active"}`}
        data-tip={showConstants ? "Hide constants · H" : "Show constants · H"}
        aria-label={showConstants ? "Hide constants (H)" : "Show constants (H)"}
        aria-pressed={!showConstants}
        onClick={() => setShowConstants(!showConstants)}
      >
        <Variable size={17} />
      </button>
    </nav>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Drawer height: ~40% of the window, kept within [260px, 80% of window]. */
const drawerHeightBounds = (): { min: number; max: number } => ({
  min: 260,
  max: Math.max(320, Math.round(window.innerHeight * 0.8)),
});

function defaultDrawerHeight(): number {
  return clamp(Math.round(window.innerHeight * 0.4), drawerHeightBounds().min, drawerHeightBounds().max);
}

function ResultsDrawer() {
  const result = useEditor((s) => s.result);
  const runError = useEditor((s) => s.runError);
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(defaultDrawerHeight);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    if (result) setOpen(true);
  }, [result]);

  useEffect(() => {
    if (runError) setOpen(true);
  }, [runError]);

  // Keep the drawer inside the window if the viewport shrinks.
  useEffect(() => {
    const onResize = () => {
      setHeight((h) => clamp(h, drawerHeightBounds().min, drawerHeightBounds().max));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    setResizing(true);
    const move = (ev: PointerEvent) => {
      const { min, max } = drawerHeightBounds();
      setHeight(clamp(startH + (startY - ev.clientY), min, max));
    };
    const up = () => {
      setResizing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <section
      className="app-drawer"
      data-open={open ? "true" : undefined}
      style={{ height: open ? height : 37, transition: resizing ? "none" : undefined }}
    >
      <div className="app-drawer-grip" onPointerDown={startResize} title="Drag to resize" />
      <header className="app-drawer-head">
        <button
          type="button"
          className="app-iconbtn app-drawer-toggle"
          title={open ? "Collapse results" : "Expand results"}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
        <span className="app-drawer-title">Results</span>
        {runError ? <span className="app-drawer-error">{runError}</span> : null}
      </header>
      {open ? (
        <div className="app-drawer-body">
          <ResultsPanel />
        </div>
      ) : null}
    </section>
  );
}

export default function App() {
  const fileName = useEditor((s) => s.fileName);
  const modelName = useEditor((s) => s.model.name);
  const dirty = useEditor((s) => s.dirty);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const runError = useEditor((s) => s.runError);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [describeOpen, setDescribeOpen] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [analyzeInitial, setAnalyzeInitial] = useState<AnalyzeInitial | undefined>();
  const [analyzeKey, setAnalyzeKey] = useState(0);
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialTheme);
  const { toasts, push } = useToasts();

  useEffect(() => applyTheme(themeMode), [themeMode]);

  useEffect(() => {
    const { model, fileName: name } = loadInitialModel();
    useEditor.getState().loadModel(model, name);
  }, []);

  useShortcuts();

  useDesktopIntegration({
    newModel: () => void newModelFile(),
    open: () => void openModelFile(),
    save: (saveAs) => saveModelFile(saveAs),
    openPath: (name, content, path) => void openModelContent(name, content, path),
    showExamples: () => setExamplesOpen(true),
    toggleTheme: () =>
      setThemeMode((m) => {
        const dark =
          m === "dark" || (m === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
        return dark ? "light" : "dark";
      }),
  });

  // Surface file-operation toasts published by the files module.
  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<{ kind?: string; message?: string }>).detail;
      if (!detail?.message) return;
      const kind = detail.kind === "error" ? "error" : detail.kind === "success" ? "success" : "info";
      push(detail.message, kind);
    };
    window.addEventListener("sourcesink:toast", onToast);
    return () => window.removeEventListener("sourcesink:toast", onToast);
  }, [push]);

  // A failed run is worth announcing at app level too.
  useEffect(() => {
    if (runError) push(runError, "error");
  }, [runError, push]);

  const st = () => useEditor.getState();
  const fileTitle = fileName ?? (modelName.trim() ? modelName : "Untitled");

  // Suggestion buttons only choose a destination; the assistant never reaches
  // into another panel's state directly.
  const onSuggestion = (suggestion: FeatureSuggestion) => {
    const action = suggestionAction(suggestion);
    switch (action.kind) {
      case "run":
        st().run();
        break;
      case "describe":
        setDescribeOpen(true);
        break;
      case "analyze":
        setAnalyzeInitial({ tab: action.tab, elements: action.elements });
        setAnalyzeKey((n) => n + 1);
        setAnalyzeOpen(true);
        break;
      case "scenarios":
        st().select([]);
        push(action.hint, "info");
        break;
    }
  };

  return (
    <div className="app-root">
      <header className="app-top">
        <div className="app-brand">
          <LogoMark />
          <span className="app-title">SourceSink</span>
        </div>

        <div className="app-file">
          <span className="app-file-name" title={fileTitle}>
            {fileTitle}
          </span>
          {dirty ? <span className="app-dirty-dot" title="Unsaved changes" /> : null}
        </div>

        <div className="app-actions">
          <button type="button" className="app-btn" title="New model" onClick={() => void newModelFile()}>
            <FilePlus2 size={14} />
            New
          </button>
          <button
            type="button"
            className="app-btn"
            title="Open model…"
            onClick={() => void openModelFile()}
          >
            <FolderOpen size={14} />
            Open
          </button>
          <button
            type="button"
            className="app-btn"
            title="Save model"
            onClick={() => void saveModelFile()}
          >
            <Save size={14} />
            Save
          </button>
          <button
            type="button"
            className="app-btn"
            title="Example models"
            onClick={() => setExamplesOpen((v) => !v)}
          >
            <Lightbulb size={14} />
            Examples
          </button>
          <button
            type="button"
            className="app-btn"
            title="Ask the assistant to draft a model"
            aria-pressed={assistantOpen}
            onClick={() => setAssistantOpen((v) => !v)}
          >
            <MessageSquare size={14} />
            Assistant
          </button>
          <button
            type="button"
            className="app-btn"
            title="Describe the model"
            aria-pressed={describeOpen}
            onClick={() => setDescribeOpen((v) => !v)}
          >
            <BookOpen size={14} />
            Describe
          </button>
          <button
            type="button"
            className="app-btn"
            title="Calibrate, sensitivity and uncertainty analysis"
            aria-pressed={analyzeOpen}
            onClick={() => {
              setAnalyzeInitial(undefined);
              setAnalyzeKey((n) => n + 1);
              setAnalyzeOpen((v) => !v);
            }}
          >
            <FlaskConical size={14} />
            Analyze
          </button>

          <span className="app-sep" />

          <button
            type="button"
            className="app-iconbtn"
            title="Undo"
            disabled={!canUndo}
            onClick={() => st().undo()}
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            className="app-iconbtn"
            title="Redo"
            disabled={!canRedo}
            onClick={() => st().redo()}
          >
            <Redo2 size={15} />
          </button>

          <span className="app-sep" />

          <button
            type="button"
            className="app-btn app-btn-run"
            title={runError ?? "Run the simulation"}
            onClick={() => st().run()}
          >
            <Play size={14} />
            Run
          </button>

          <ThemeToggle mode={themeMode} onChange={setThemeMode} />
        </div>

        <div className="app-menu-anchor">
          {examplesOpen ? <ExamplesMenu onClose={() => setExamplesOpen(false)} /> : null}
        </div>
      </header>

      <div className="app-mid">
        <Palette />
        <main className="app-canvas-col">
          <Canvas colorMode={themeMode} />
        </main>
        <aside className="app-inspector-col">
          <Inspector />
        </aside>
      </div>

      <ResultsDrawer />
      {assistantOpen ? (
        <AssistantPanel
          onClose={() => setAssistantOpen(false)}
          onSuggestion={onSuggestion}
        />
      ) : null}
      {describeOpen ? <ExplainPanel onClose={() => setDescribeOpen(false)} /> : null}
      {analyzeOpen ? (
        <AnalyzePanel
          key={analyzeKey}
          initial={analyzeInitial}
          onClose={() => setAnalyzeOpen(false)}
        />
      ) : null}
      <ToastStack toasts={toasts} className="app-toasts" />
    </div>
  );
}
