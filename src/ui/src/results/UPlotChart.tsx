/**
 * React wrapper around uPlot: creates the chart on mount, pushes new data in
 * via setData, follows container resizes, and rebuilds the chart when the
 * theme or series list changes so colors re-resolve from CSS variables.
 * The legend is mounted into a sibling slot below the canvas and shows the
 * cursor value while hovering, or the last sample value otherwise.
 */
import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { formatNumber } from "./csv";
import type { ChartTheme } from "./useChartTheme";

export interface ChartSeries {
  name: string;
  color: string;
  values: readonly (number | null)[];
}

export interface UPlotChartProps {
  time: readonly number[];
  series: ChartSeries[];
  theme: ChartTheme;
  timeUnits?: string;
  /** Logarithmic y axis; values at or below zero are left out. */
  yLog?: boolean;
  /** Charts with the same key share one cursor (stacked panels). */
  syncKey?: string;
}

const AXIS_FONT = "11px Inter, system-ui, sans-serif";
/** uPlot is never constructed at 0 height; the resize sync corrects it. */
const MIN_CHART_HEIGHT = 1;
/** Frames of rAF settling after creation, so open/resize transitions are caught. */
const SETTLE_FRAMES = 40;

/** uPlot wants one aligned array per series: equal lengths, nulls for gaps. */
function alignData(time: readonly number[], series: readonly ChartSeries[], positive = false): uPlot.AlignedData {
  const n = time.length;
  return [
    Array.from(time),
    ...series.map((s) => {
      const values = new Array<number | null>(n).fill(null);
      for (let i = 0; i < n && i < s.values.length; i++) {
        const v = s.values[i] ?? null;
        values[i] = positive && v != null && v <= 0 ? null : v;
      }
      return values;
    }),
  ];
}

/** Legend value: the cursor value while hovering, the last sample otherwise. */
function legendValue(self: uPlot, raw: number, seriesIdx: number): string {
  if (raw != null) return formatNumber(raw);
  const arr = self.data[seriesIdx] as number[] | undefined;
  const last = arr && arr[arr.length - 1];
  return last == null ? "--" : formatNumber(last);
}

export function UPlotChart({ time, series, theme, timeUnits, yLog, syncKey }: UPlotChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const dataRef = useRef<uPlot.AlignedData>([]);

  const data = useMemo(() => alignData(time, series, yLog), [time, series, yLog]);
  dataRef.current = data;

  // Only names + colors define the chart skeleton; values flow in via setData.
  const seriesKey = series.map((s) => `${s.name}\u0000${s.color}`).join("\u0001");

  const dense = time.length > 40;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const syncSize = (): void => {
      const plot = plotRef.current;
      if (!plot) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) plot.setSize({ width: w, height: h });
    };

    const options: uPlot.Options = {
      width: container.clientWidth,
      height: Math.max(container.clientHeight, MIN_CHART_HEIGHT),
      class: "res-uplot",
      legend: {
        show: true,
        live: true,
        mount: (_self, legendEl) => {
          legendRef.current?.appendChild(legendEl);
        },
      },
      scales: { x: { time: false }, y: yLog ? { distr: 3 } : {} },
      cursor: syncKey ? { sync: { key: syncKey } } : {},
      axes: [
        {
          label: timeUnits,
          labelSize: 13,
          labelGap: 2,
          stroke: theme.muted,
          font: AXIS_FONT,
          labelFont: AXIS_FONT,
          grid: { stroke: theme.border },
          ticks: { stroke: theme.border },
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
        ...series.map((s) => ({
          label: s.name,
          stroke: s.color,
          width: 1.75,
          // Point markers only on short runs; long runs read as clean lines.
          points: { show: !dense, size: 5 },
          value: legendValue,
        })),
      ],
    };

    const plot = new uPlot(options, dataRef.current, container);
    plotRef.current = plot;

    const timeArr = plot.data[0] as number[] | undefined;
    if (timeArr && timeArr.length > 0) plot.setLegend({ idx: timeArr.length - 1 });

    // Settle loop: the drawer opens with a height transition, so the container
    // can be at a transient size (or 0) when the chart is first built.
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
      legendRef.current?.replaceChildren();
    };
  }, [theme, seriesKey, timeUnits, dense, yLog, syncKey]);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    plot.setData(data);
    const timeArr = data[0] as number[] | undefined;
    if (timeArr && timeArr.length > 0) plot.setLegend({ idx: timeArr.length - 1 });
  }, [data]);

  return (
    <div className="res-chartwrap">
      <div className="res-chart" ref={containerRef} />
      <div className="res-legend" ref={legendRef} />
    </div>
  );
}
