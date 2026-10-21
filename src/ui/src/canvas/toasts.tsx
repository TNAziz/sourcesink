/**
 * SourceSink — lightweight toast notifications (used by the canvas for connector
 * errors and by the app shell for run errors).
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface ToastItem {
  id: number;
  text: string;
  kind: "info" | "error" | "success";
}

export interface ToastsApi {
  toasts: ToastItem[];
  push: (text: string, kind?: ToastItem["kind"]) => void;
}

const LIFETIME = 2800;

export function useToasts(): ToastsApi {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const push = useCallback((text: string, kind: ToastItem["kind"] = "info") => {
    const id = nextId.current++;
    setToasts((cur) => [...cur, { id, text, kind }]);
    const t = setTimeout(() => {
      setToasts((cur) => cur.filter((x) => x.id !== id));
    }, LIFETIME);
    timers.current.push(t);
  }, []);

  useEffect(() => () => {
    for (const t of timers.current) clearTimeout(t);
  }, []);

  return { toasts, push };
}

export function ToastStack({ toasts, className = "" }: { toasts: ToastItem[]; className?: string }) {
  if (toasts.length === 0) return null;
  return (
    <div className={`cv-toasts ${className}`} role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`cv-toast cv-toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
