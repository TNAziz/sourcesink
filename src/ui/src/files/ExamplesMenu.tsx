/**
 * Example-model gallery modal: search, category and level filters, a card grid
 * and a detail pane with the teaching notes and cited references.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Search, X } from "lucide-react";
import {
  CATEGORIES,
  EXAMPLE_LEVELS,
  attributionFor,
  categoryCounts,
  categoryInfo,
  doiUrl,
  filterExamples,
  levelCounts,
  listExamples,
  type ExampleEntry,
  type ExampleLevel,
} from "./examples";
import { openExampleModel } from "./fileActions";
import "./examples.css";

/** "1 stock", "3 stocks". */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const CATEGORY_KEY = "sourcesink:examples:category";

function trapFocus(event: KeyboardEvent, root: HTMLElement | null): void {
  if (!root) return;
  const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (items.length === 0) {
    event.preventDefault();
    root.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Last category filter, remembered across openings; bad values fall back to all. */
function readLastCategory(): string {
  try {
    const saved = localStorage.getItem(CATEGORY_KEY);
    if (saved !== null && (saved === "all" || CATEGORIES.some((category) => category.id === saved))) {
      return saved;
    }
  } catch {
    /* private mode etc. — the filter just will not persist */
  }
  return "all";
}

function rememberCategory(category: string): void {
  try {
    localStorage.setItem(CATEGORY_KEY, category);
  } catch {
    /* private mode etc. — the filter just will not persist */
  }
}

const LEVEL_LABEL: Record<ExampleLevel | "all", string> = {
  all: "All levels",
  intro: "Intro",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export function ExamplesMenu({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const examples = useMemo(() => listExamples(), []);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(readLastCategory);
  const [level, setLevel] = useState<ExampleLevel | "all">("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const filter = useMemo(() => ({ query, category, level }), [query, category, level]);
  const shown = useMemo(() => filterExamples(examples, filter), [examples, filter]);
  const counts = useMemo(() => categoryCounts(examples, filter), [examples, filter]);
  const levels = useMemo(() => levelCounts(examples, filter), [examples, filter]);
  const detail = useMemo(() => examples.find((entry) => entry.id === detailId), [examples, detailId]);

  const chips = useMemo(() => {
    const known = new Set(CATEGORIES.map((category) => category.id));
    const extras = [...new Set(examples.map((entry) => entry.category))].filter((id) => !known.has(id));
    return [...CATEGORIES, ...extras.map(categoryInfo)];
  }, [examples]);

  useEffect(() => {
    if (!shown.some((entry) => entry.id === activeId)) {
      setActiveId(shown[0]?.id ?? null);
    }
    if (detailId !== null && !shown.some((entry) => entry.id === detailId)) {
      setDetailId(null);
    }
  }, [shown, activeId, detailId]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (detailId !== null) setDetailId(null);
        else onClose();
        return;
      }
      if (event.key === "Tab") {
        trapFocus(event, dialogRef.current);
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing || shown.length === 0) return;
      const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
      const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
      if (!forward && !backward) return;
      event.preventDefault();
      const index = Math.max(0, shown.findIndex((entry) => entry.id === activeId));
      const step = forward ? 1 : -1;
      const next = shown[(index + step + shown.length) % shown.length];
      setActiveId(next.id);
      if (detailId !== null) setDetailId(next.id);
      cards.current.get(next.id)?.focus();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeId, detailId, onClose, shown]);

  const choose = (entry: ExampleEntry) => {
    void openExampleModel(entry.model).then((opened) => opened && onClose());
  };

  const pickCategory = (next: string) => {
    setCategory(next);
    rememberCategory(next);
  };

  const openDetail = (entry: ExampleEntry) => {
    setActiveId(entry.id);
    setDetailId(entry.id);
  };

  return (
    <div
      className="file-examples-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="file-examples"
        role="dialog"
        aria-modal="true"
        aria-label="Example models"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className="file-examples-head">
          <div>
            <h2 className="file-examples-title">Example models</h2>
            <p className="file-examples-sub">
              Start from a cited system-dynamics model, then edit the structure or parameters.
            </p>
          </div>
          <button className="file-examples-close" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="file-examples-toolbar">
          <label className="file-examples-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, summary, topic or source"
              aria-label="Search examples"
            />
          </label>
          <div className="file-examples-levels" role="group" aria-label="Filter by level">
            {(["all", ...EXAMPLE_LEVELS] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`file-examples-level${level === value ? " file-examples-level-on" : ""}`}
                aria-pressed={level === value}
                onClick={() => setLevel(value)}
              >
                {LEVEL_LABEL[value]}
                <span className="file-examples-level-count">{levels[value]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="file-examples-chips" role="group" aria-label="Filter by category">
          <button
            type="button"
            className={`file-examples-chip${category === "all" ? " file-examples-chip-on" : ""}`}
            aria-pressed={category === "all"}
            onClick={() => pickCategory("all")}
          >
            All models
            <span className="file-examples-chip-count">{levels.all}</span>
          </button>
          {chips.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`file-examples-chip${category === item.id ? " file-examples-chip-on" : ""}`}
              data-category={item.id}
              aria-pressed={category === item.id}
              title={item.blurb}
              onClick={() => pickCategory(item.id)}
            >
              {item.name}
              <span className="file-examples-chip-count">{counts[item.id] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="file-examples-body">
          <div className="file-examples-main">
            {shown.length === 0 ? (
              <p className="file-examples-empty">No models match those filters.</p>
            ) : (
              <div className="file-examples-grid">
                {shown.map((entry) => {
                  const source = attributionFor(entry);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      ref={(node) => {
                        if (node) cards.current.set(entry.id, node);
                        else cards.current.delete(entry.id);
                      }}
                      className={`file-example-card${activeId === entry.id ? " file-example-card-on" : ""}`}
                      data-category={entry.category}
                      onFocus={() => setActiveId(entry.id)}
                      onClick={() => openDetail(entry)}
                    >
                      <span className="file-example-card-top">
                        <span className="file-example-level-badge">{entry.level}</span>
                        <span className="file-example-chip" data-category={entry.category}>
                          {categoryInfo(entry.category).name}
                        </span>
                      </span>
                      <span className="file-example-title">{entry.title}</span>
                      <span className="file-example-summary">{entry.summary}</span>
                      {entry.question ? (
                        <span className="file-example-question">{entry.question}</span>
                      ) : null}
                      <span className="file-example-source">
                        {source && !entry.original ? `Based on ${source}` : "SourceSink original model"}
                      </span>
                      <span className="file-example-counts">
                        <FileText size={12} aria-hidden="true" />
                        <span>{plural(entry.stocks, "stock")}</span>
                        <span className="file-example-dot">·</span>
                        <span>{plural(entry.flows, "flow")}</span>
                        <span className="file-example-dot">·</span>
                        <span>{plural(entry.converters, "converter")}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {detail ? (
            <aside className="file-example-detail" aria-label="Example details">
              <div className="file-example-detail-top">
                <span className="file-example-level-badge">{detail.level}</span>
                <span className="file-example-chip" data-category={detail.category}>
                  {categoryInfo(detail.category).name}
                </span>
                <button
                  type="button"
                  className="file-example-detail-close"
                  onClick={() => setDetailId(null)}
                  aria-label="Close details"
                >
                  <X size={16} />
                </button>
              </div>
              <h3 className="file-example-detail-title">{detail.title}</h3>
              <p className="file-example-detail-summary">{detail.summary}</p>
              {detail.teaching ? (
                <>
                  <h4 className="file-example-detail-heading">Teaching notes</h4>
                  <p className="file-example-detail-text">{detail.teaching}</p>
                </>
              ) : null}
              {detail.question ? (
                <>
                  <h4 className="file-example-detail-heading">Question</h4>
                  <p className="file-example-detail-text">{detail.question}</p>
                </>
              ) : null}
              <h4 className="file-example-detail-heading">References</h4>
              {detail.references.length > 0 ? (
                <ul className="file-example-references">
                  {detail.references.map((reference) => (
                    <li key={reference.citation}>
                      {reference.doi ? (
                        <a href={doiUrl(reference.doi)} target="_blank" rel="noreferrer">
                          {reference.citation}
                        </a>
                      ) : (
                        <span>{reference.citation}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="file-example-detail-text">SourceSink original model.</p>
              )}
              <p className="file-example-detail-counts">
                {plural(detail.stocks, "stock")} · {plural(detail.flows, "flow")} ·{" "}
                {plural(detail.converters, "converter")}
              </p>
              <button type="button" className="file-example-open" onClick={() => choose(detail)}>
                Open model
              </button>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
