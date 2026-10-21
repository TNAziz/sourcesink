/**
 * SourceSink — a small "Export" dropdown offering PNG, SVG and CSV.
 */

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";

import "./export.css";

export type ExportFormat = "png" | "svg" | "csv";

const LABELS: Record<ExportFormat, { label: string; hint: string }> = {
  png: { label: "PNG image", hint: "2× resolution, white background, for slides and documents" },
  svg: { label: "SVG vector", hint: "Scales to any size; edit in Illustrator or Inkscape" },
  csv: { label: "CSV data", hint: "The plotted numbers, for Excel, R or Python" },
};

export function ExportMenu({
  onExport,
  formats = ["png", "svg", "csv"],
  disabled,
  className = "res-export",
  compact,
}: {
  onExport: (format: ExportFormat) => void | Promise<void>;
  formats?: ExportFormat[];
  disabled?: boolean;
  className?: string;
  /** Icon only. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="exp-menu" ref={ref}>
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Export this chart"
        onClick={() => setOpen((v) => !v)}
      >
        <Download size={13} aria-hidden />
        {compact ? null : "Export"}
      </button>
      {open ? (
        <div className="exp-list" role="menu">
          {formats.map((format) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              className="exp-item"
              onClick={() => {
                setOpen(false);
                void onExport(format);
              }}
            >
              <span className="exp-item-label">{LABELS[format].label}</span>
              <span className="exp-item-hint">{LABELS[format].hint}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
