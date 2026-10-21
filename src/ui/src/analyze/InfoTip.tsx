/**
 * SourceSink — hover explanations for the Analyze drawer.
 *
 * `FloatingCard` is portalled to <body> with fixed positioning so the
 * scrolling Analyze body cannot clip it; it sits below its anchor and flips
 * above near the bottom of the window. `InfoTip` is a small ⓘ next to a label
 * that opens one on hover or keyboard focus.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

const GAP = 6;
const MARGIN = 8;

/** The part of a DOMRect the card is placed against, in client pixels. */
export interface Anchor {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

export function FloatingCard({
  anchor,
  title,
  width = 300,
  children,
}: {
  anchor: Anchor;
  title: string;
  width?: number;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const height = cardRef.current?.getBoundingClientRect().height ?? 120;
    const left = Math.min(
      Math.max(MARGIN, anchor.left + anchor.width / 2 - width / 2),
      window.innerWidth - width - MARGIN,
    );
    const below = anchor.bottom + GAP;
    const top = below + height > window.innerHeight - MARGIN ? anchor.top - GAP - height : below;
    setPos({ left, top: Math.max(MARGIN, top) });
  }, [anchor.left, anchor.top, anchor.bottom, anchor.width, width]);

  return createPortal(
    <div
      ref={cardRef}
      className="ana-tipcard"
      role="tooltip"
      style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      <div className="ana-tipcard-title">{title}</div>
      <div className="ana-tipcard-body">{children}</div>
    </div>,
    document.body,
  );
}

export function InfoTip({ title, children }: { title: string; children: ReactNode }) {
  const iconRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const show = (): void => {
    const rect = iconRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width });
  };
  const hide = (): void => setAnchor(null);

  return (
    <>
      <button
        ref={iconRef}
        type="button"
        className="ana-info"
        aria-label={`About ${title}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(event) => event.preventDefault()}
      >
        <Info size={12} aria-hidden />
      </button>
      {anchor ? (
        <FloatingCard anchor={anchor} title={title}>
          {children}
        </FloatingCard>
      ) : null}
    </>
  );
}
