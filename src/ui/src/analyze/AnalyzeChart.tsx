/**
 * SourceSink — a compact uPlot chart for analysis results.
 *
 * Supports lines, observation dots and shaded bands between two edge series
 * (used for the uncertainty percentiles). Colors resolve from the live theme
 * so light/dark changes rebuild the chart, like the results chart.
 * Hovering shows a readout under the plot for the time under the cursor.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import { formatNumber } from "../results/csv.js";
import { exportChart, downloadBlob, safeFileName, type ExportChartSpec } from "../results/exportChart.js";
import { ExportMenu, type ExportFormat } from "../results/ExportMenu.js";
import { useChartTheme } from "../results/useChartTheme.js";

export interface AnalyzeSeriesSpec {
  name: string;
  color: string;
  values: readonly (number | null)[];
  /** Draw dots instead of a line (observations). */
  points?: boolean;
  dash?: number[];
  lineWidth?: number;
  /** 1-based series index of the lower band edge. */
  bandTo?: number;
  /** Fill between this series and `bandTo`; defaults to a translucent color. */
  bandFill?: string;
}

export interface AnalyzeChartProps {
  time: readonly number[];
  series: AnalyzeSeriesSpec[];
  title?: string;
  note?: string;
  timeUnits?: string;
  height?: number;
  /** Lines shown under the plot for the hovered sample; defaults to each
   * visible series' value. */
  readout?: (index: number) => ReactNode;
  /** X axis label when it is not time (e.g. a swept parameter). */
  xLabel?: string;
  xLog?: boolean;
  yLog?: boolean;
  /** Y axis label for exports. */
  yLabel?: string;
  /** Show an Export button; the name is the file's base name. */
  exportName?: string;
}

const AXIS_FONT = "11px Inter, system-ui, sans-serif";
const SETTLE_FRAMES = 20;

/** Turn a hex color into rgba so canvas bands can be translucent. */
export function alphaColor(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return color;
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** uPlot band options for every series with a `bandTo` edge. uPlot fills
 * from the first (upper) series down to the second (lower) one; reversing
 * them draws nothing. */
export function uplotBands(series: readonly AnalyzeSeriesSpec[]): uPlot.Band[] {
  return series.flatMap((spec, i) =>
    spec.bandTo === undefined
      ? []
      : [{ series: [i + 1, spec.bandTo] as [number, number], fill: spec.bandFill ?? alphaColor(spec.color, 0.18) }],
  );
}

function alignData(
  time: readonly number[],
  series: readonly AnalyzeSeriesSpec[],
): uPlot.AlignedData {
  const n = time.length;
  return [
    Array.from(time),
    ...series.map((s) => {
      const values = new Array<number | null>(n).fill(null);
      for (let i = 0; i < n && i < s.values.length; i += 1) values[i] = s.values[i] ?? null;
      return values;
    }),
  ];
}

export function AnalyzeChart({
  time,
  series,
  title,
  note,
  timeUnits,
  height = 190,
  readout,
  xLabel,
  xLog,
  yLog,
  yLabel,
  exportName,
}: AnalyzeChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const theme = useChartTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const dataRef = useRef<uPlot.AlignedData>([]);

  const data = useMemo(() => alignData(time, series), [time, series]);
  dataRef.current = data;
  const seriesKey = series
    .map((s) =>
      [s.name, s.color, s.points ? "p" : "l", s.lineWidth ?? "", s.bandTo ?? "", s.bandFill ?? ""].join(
        "\u0000",
      ),
    )
    .join("\u0001");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const syncSize = (): void => {
      const plot = plotRef.current;
      if (!plot) return;
      const width = container.clientWidth;
      const h = container.clientHeight;
      if (width > 0 && h > 0) plot.setSize({ width, height: h });
    };

    const options: uPlot.Options = {
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      class: "ana-uplot",
      legend: { show: false },
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            setHoverIndex(idx == null || idx < 0 ? null : idx);
          },
        ],
      },
      scales: {
        x: xLog ? { time: false, distr: 3 } : { time: false },
        y: yLog ? { distr: 3 } : {},
      },
      bands: uplotBands(series),
      axes: [
        {
          label: xLabel ?? timeUnits,
          labelSize: 12,
          labelGap: 2,
          stroke: theme.muted,
          font: AXIS_FONT,
          labelFont: AXIS_FONT,
          grid: { stroke: theme.border },
          ticks: { stroke: theme.border },
          values: (_self, splits) => splits.map((v) => (v == null ? "" : formatNumber(v))),
        },
        {
          stroke: theme.muted,
          font: AXIS_FONT,
          grid: { stroke: theme.border },
          ticks: { stroke: theme.border },
          values: (_self, splits) => splits.map((v) => (v == null ? "" : formatNumber(v))),
        },
      ],
      series: [
        { label: timeUnits === "" || timeUnits == null ? "time" : timeUnits },
        ...series.map((spec) => ({
          label: spec.name,
          stroke: spec.color,
          width: spec.points ? 0 : (spec.lineWidth ?? 1.75),
          dash: spec.dash,
          spanGaps: true,
          points: spec.points
            ? { show: true, size: 5, width: 1.5, stroke: spec.color, fill: spec.color }
            : { show: false },
        })),
      ],
    };

    const plot = new uPlot(options, dataRef.current, container);
    plotRef.current = plot;

    let frame = 0;
    let rafId: number | null = null;
    const settle = (): void => {
      frame += 1;
      syncSize();
      if (frame < SETTLE_FRAMES) rafId = requestAnimationFrame(settle);
    };
    settle();

    const observer = new ResizeObserver(syncSize);
    observer.observe(container);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [theme, seriesKey, timeUnits, xLabel, xLog, yLog]);

  useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  const hoverTime = hoverIndex == null ? undefined : time[hoverIndex];
  const defaultReadout = (index: number): ReactNode =>
    series
      .filter((spec) => spec.lineWidth !== 0 || spec.points)
      .map((spec) => {
        const value = spec.values[index];
        return (
          <span key={spec.name} className="ana-readout-item">
            <span className="ana-readout-swatch" style={{ background: spec.color }} />
            {spec.name} {value == null ? "–" : formatNumber(value)}
          </span>
        );
      });

  const onExport = async (format: ExportFormat): Promise<void> => {
    const base = exportName ?? title ?? "chart";
    const visible = series.filter((spec) => spec.lineWidth !== 0 || spec.points);
    if (format === "csv") {
      const header = [xLabel ?? (timeUnits ? `time (${timeUnits})` : "time"), ...series.map((s) => s.name)];
      const rows = time.map((t, i) =>
        [t, ...series.map((s) => s.values[i] ?? "")].map((v) => (typeof v === "number" ? String(v) : v)).join(","),
      );
      const csv = [header.map((h) => (/[",]/.test(h) ? `"${h.replace(/"/g, '""')}"` : h)).join(","), ...rows].join("\n");
      downloadBlob(new Blob([`${csv}\n`], { type: "text/csv;charset=utf-8" }), `${safeFileName(base)}.csv`);
      return;
    }
    const spec: ExportChartSpec = {
      title,
      x: time,
      xLabel: xLabel ?? (timeUnits || "time"),
      yLabel,
      xLog,
      yLog,
      series: visible.map((s) => ({
        name: s.name,
        color: s.color,
        values: s.values,
        dash: s.dash,
        points: s.points,
        width: s.lineWidth === undefined ? undefined : Math.max(1, s.lineWidth * 1.25),
        legend: visible.length <= 12,
      })),
      bands: series.flatMap((s) =>
        s.bandTo === undefined
          ? []
          : [{ upper: s.values, lower: series[s.bandTo - 1]?.values ?? [], fill: s.bandFill ?? alphaColor(s.color, 0.18) }],
      ),
    };
    await exportChart(spec, format, base);
  };

  return (
    <figure className="ana-chart" aria-label={title}>
      {title || exportName ? (
        <figcaption className="ana-chart-head">
          {title ? <span className="ana-chart-title">{title}</span> : <span />}
          {exportName ? <ExportMenu onExport={onExport} className="ana-export" /> : null}
        </figcaption>
      ) : null}
      <div
        className="ana-chart-canvas"
        ref={containerRef}
        style={{ height }}
        onMouseLeave={() => setHoverIndex(null)}
      />
      {hoverIndex != null && hoverTime !== undefined ? (
        <div className="ana-readout" aria-live="polite">
          <span className="ana-readout-time">
            {xLabel ? `${xLabel} = ` : "t = "}
            {formatNumber(hoverTime)}
            {!xLabel && timeUnits ? ` ${timeUnits}` : ""}
          </span>
          {(readout ?? defaultReadout)(hoverIndex)}
        </div>
      ) : note ? (
        <div className="ana-chart-note">{note}</div>
      ) : null}
    </figure>
  );
}
