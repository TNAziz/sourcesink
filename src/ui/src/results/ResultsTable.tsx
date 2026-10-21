/**
 * Time-series table: sticky header, fixed-height monospace rows, and simple
 * windowing — only the rows in (and near) the viewport are rendered, so runs
 * with tens of thousands of samples stay fast.
 */
import { useEffect, useRef, useState } from "react";
import { formatNumber } from "./csv";
import { padHeights, visibleRange } from "./series";

/** Must match .res-td height in results.css. */
const ROW_HEIGHT = 28;
/** Must match .res-th height in results.css. */
const HEADER_HEIGHT = 32;
const OVERSCAN = 10;

export interface TableColumn {
  name: string;
  color: string;
  values: readonly (number | null)[];
}

export interface ResultsTableProps {
  time: readonly number[];
  columns: TableColumn[];
  timeUnits?: string;
}

export function ResultsTable({ time, columns, timeUnits }: ResultsTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = (): void => setViewport(Math.max(0, el.clientHeight - HEADER_HEIGHT));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const range = visibleRange(scrollTop, viewport, time.length, ROW_HEIGHT, OVERSCAN);
  const pads = padHeights(range, time.length, ROW_HEIGHT);
  const rows = Array.from({ length: Math.max(0, range.end - range.start) }, (_, k) => range.start + k);

  return (
    <div
      className="res-table-scroll"
      ref={scrollRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <table className="res-table">
        <thead>
          <tr>
            <th className="res-th res-th-time" scope="col">
              {timeUnits ? timeUnits : "time"}
            </th>
            {columns.map((c) => (
              <th key={c.name} className="res-th" scope="col">
                <span className="res-dot" style={{ background: c.color }} />
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pads.top > 0 && (
            <tr className="res-pad" aria-hidden="true" style={{ height: pads.top }}>
              <td colSpan={columns.length + 1} />
            </tr>
          )}
          {rows.map((i) => (
            <tr key={i} className={i % 2 === 1 ? "res-row-alt" : undefined}>
              <td className="res-td res-td-time">{formatNumber(time[i])}</td>
              {columns.map((c) => {
                const v = c.values[i];
                return (
                  <td key={c.name} className="res-td">
                    {v == null ? "—" : formatNumber(v)}
                  </td>
                );
              })}
            </tr>
          ))}
          {pads.bottom > 0 && (
            <tr className="res-pad" aria-hidden="true" style={{ height: pads.bottom }}>
              <td colSpan={columns.length + 1} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
