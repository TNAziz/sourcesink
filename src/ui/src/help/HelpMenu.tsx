/**
 * SourceSink — Help menu: the user manual and a jump list of its tutorials.
 * A tutorial that works through an example model can also open that model.
 */

import { useEffect, useRef } from "react";
import { BookOpenText, FileText, FolderOpen, X } from "lucide-react";

import { openExampleModel } from "../files/fileActions";
import { getExample } from "../files/examples";
import { openManual, REFERENCE, TUTORIALS } from "./manual";
import "./help.css";

export function HelpMenu({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      if ((target as Element).closest?.("[data-help-toggle]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  const read = (dest?: string): void => {
    openManual(dest);
    onClose();
  };

  const openExample = (id: string): void => {
    const entry = getExample(id);
    if (!entry) return;
    void openExampleModel(entry.model).then((opened) => opened && onClose());
  };

  return (
    <div className="help-menu" ref={ref} role="dialog" aria-label="Help">
      <header className="help-head">
        <span className="help-title">Help</span>
        <button type="button" className="help-close" aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      <button type="button" className="help-manual" onClick={() => read()}>
        <BookOpenText size={18} aria-hidden />
        <span>
          <span className="help-manual-title">User manual (PDF)</span>
          <span className="help-muted">Seven step-by-step tutorials and a full reference.</span>
        </span>
      </button>

      <h3 className="help-section">Tutorials</h3>
      <ul className="help-list">
        {TUTORIALS.map((section) => (
          <li key={section.dest} className="help-item">
            <button type="button" className="help-link" onClick={() => read(section.dest)}>
              <span className="help-link-title">{section.title}</span>
              <span className="help-muted">{section.blurb}</span>
            </button>
            {section.example && getExample(section.example) ? (
              <button
                type="button"
                className="help-example"
                title={`Open the example this tutorial uses: ${getExample(section.example)!.title}`}
                onClick={() => openExample(section.example!)}
              >
                <FolderOpen size={13} aria-hidden />
                Open example
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      <h3 className="help-section">Reference</h3>
      <div className="help-chips">
        {REFERENCE.map((section) => (
          <button
            key={section.dest}
            type="button"
            className="help-chip"
            title={section.blurb || section.title}
            onClick={() => read(section.dest)}
          >
            <FileText size={12} aria-hidden />
            {section.title}
          </button>
        ))}
      </div>
    </div>
  );
}
