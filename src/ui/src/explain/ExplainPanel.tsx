/**
 * SourceSink — Describe drawer.
 *
 * Shows the deterministic, graph-grounded description of the current model,
 * a visual feedback-loop list (R/B badges) and the completeness check. The
 * description is memoized on the model object, so it is recomputed only when
 * the model actually changes.
 */

import { useEffect, useMemo } from "react";
import { BookOpen, X } from "lucide-react";
import { coverage, describeModel, findLoops, type Loop } from "@sourcesink/explain";

import { useEditor } from "../state/store";
import { Markdown } from "./markdown";
import "./explain.css";

function display(name: string): string {
  return name.replace(/_/g, " ");
}

function loopChain(loop: Loop): string {
  return [...loop.elements, loop.elements[0]].map(display).join(" → ");
}

export function ExplainPanel({ onClose }: { onClose: () => void }) {
  const model = useEditor((s) => s.model);

  const description = useMemo(() => describeModel(model), [model]);
  const loopResult = useMemo(() => findLoops(model), [model]);
  const cover = useMemo(() => coverage(model, description), [model, description]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const elementCount = description.mentions.elements.length;
  const linkCount = description.mentions.links.length;

  return (
    <>
      <div className="exp-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="exp-panel" role="dialog" aria-label="Model description" aria-modal="true">
        <header className="exp-head">
          <span className="exp-title">
            <BookOpen size={15} aria-hidden />
            Describe
          </span>
          <span className="exp-model" title={model.name}>
            {display(model.name)}
          </span>
          <button type="button" className="exp-close" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="exp-body">
          <div className="exp-md">
            <Markdown markdown={description.markdown} />
          </div>

          <section className="exp-section" aria-label="Feedback loops">
            <h3 className="exp-section-title">Loops at a glance</h3>
            {loopResult.loops.length === 0 ? (
              <p className="exp-muted">No feedback loops were found.</p>
            ) : (
              <ul className="exp-loops">
                {loopResult.loops.map((loop) => (
                  <li key={loop.id} className="exp-loop">
                    <span className={`exp-badge exp-badge-${loop.type}`}>{loop.id}</span>
                    <span className={`exp-loop-type exp-loop-type-${loop.type}`}>{loop.type}</span>
                    <span className="exp-loop-chain">{loopChain(loop)}</span>
                  </li>
                ))}
              </ul>
            )}
            {loopResult.truncated ? (
              <p className="exp-muted">Only the first 500 loops are listed.</p>
            ) : null}
          </section>

          <section className="exp-section" aria-label="Coverage">
            <h3 className="exp-section-title">Coverage</h3>
            {cover.complete ? (
              <p className="exp-coverage-ok">
                Covers all {elementCount} element{elementCount === 1 ? "" : "s"} and {linkCount} link
                {linkCount === 1 ? "" : "s"}.
              </p>
            ) : (
              <div className="exp-coverage-missing">
                {cover.missingElements.length > 0 ? (
                  <p>
                    <span className="exp-missing-label">Missing elements:</span>{" "}
                    {cover.missingElements.map(display).join(", ")}
                  </p>
                ) : null}
                {cover.missingLinks.length > 0 ? (
                  <p>
                    <span className="exp-missing-label">Missing links:</span>{" "}
                    {cover.missingLinks.map((link) => `${display(link.from)} → ${display(link.to)}`).join(", ")}
                  </p>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
